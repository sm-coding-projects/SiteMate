import { and, desc, eq, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ulid } from "ulid";
import { documentExtractions, files, projectStages, users } from "../../db/schema";
import type { FileEntry, JobMessage, UploadTicket } from "../../shared/api-types";
import {
	fileCreate,
	fileListQuery,
	fileUpdate,
	fileUrlQuery,
	IMAGE_MIME_TYPES,
	idParam,
	MAX_DOCUMENT_BYTES,
	MAX_PHOTO_BYTES,
	MAX_THUMB_BYTES,
	uploadUrlsBody,
} from "../../shared/schemas";
import { assertProjectAccess } from "../lib/access";
import { logActivity, touchProject } from "../lib/activity";
import { decodeCursor, page } from "../lib/cursor";
import { fileKeys, presignGet, presignPut, r2Configured, signThumbUrls, UPLOAD_URL_TTL_S } from "../lib/r2";
import { badRequest, conflict, notFound, zv } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import type { AppEnv, Bindings } from "../types";
import { assertProject } from "./projects";

type Db = AppEnv["Variables"]["db"];

/** Documents the extraction pipeline can read (HEIC isn't decodable by the vision model). */
export const isExtractable = (category: string, mimeType: string) =>
	category !== "photo" && !/^image\/hei[cf]$/.test(mimeType);

function requireR2(env: Bindings) {
	if (!r2Configured(env)) {
		throw new HTTPException(503, {
			message: "File uploads aren't configured yet (R2 API token missing). See the README.",
		});
	}
}

async function assertStage(db: Db, stageId: string | null | undefined, projectId: string) {
	if (!stageId) return null;
	const s = await db.query.projectStages.findFirst({
		where: and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId)),
		columns: { id: true, name: true },
	});
	if (!s) throw badRequest("Stage is not part of this project");
	return s;
}

async function loadFile(db: Db, id: string) {
	const f = await db.query.files.findFirst({ where: and(eq(files.id, id), isNull(files.deletedAt)) });
	if (!f) throw notFound("File not found");
	return f;
}

async function uploadTicket(
	env: Bindings,
	f: typeof files.$inferSelect,
	thumb?: { bytes: number; mime: string },
) {
	const main = await presignPut(env, f.r2Key, f.mimeType, f.sizeBytes);
	const t = f.thumbKey && thumb ? await presignPut(env, f.thumbKey, thumb.mime, thumb.bytes) : null;
	return {
		fileId: f.id,
		uploadUrl: main.url,
		uploadHeaders: main.headers,
		thumbUploadUrl: t?.url ?? null,
		thumbUploadHeaders: t?.headers ?? null,
		expiresAt: Date.now() + UPLOAD_URL_TTL_S * 1000,
	} satisfies UploadTicket;
}

export const projectFileRoutes = new Hono<AppEnv>()
	.get("/:id/files", zv("param", idParam), zv("query", fileListQuery), async (c) => {
		const db = c.get("db");
		const { id: projectId } = c.req.valid("param");
		const { kind, category, stageId, cursor, limit } = c.req.valid("query");
		const where: SQL[] = [
			eq(files.projectId, projectId),
			eq(files.uploadStatus, "uploaded"),
			isNull(files.deletedAt),
			kind === "photos" ? eq(files.category, "photo") : ne(files.category, "photo"),
		];
		if (category) where.push(eq(files.category, category));
		if (stageId) where.push(eq(files.projectStageId, stageId));
		const after = decodeCursor(cursor);
		if (after) {
			where.push(
				sql`(${files.createdAt} < ${after.sort} or (${files.createdAt} = ${after.sort} and ${files.id} < ${after.id}))`,
			);
		}
		const rows = await db
			.select({
				f: files,
				stageName: projectStages.name,
				uploaderName: users.name,
				uploaderEmail: users.email,
			})
			.from(files)
			.innerJoin(users, eq(files.uploadedBy, users.id))
			.leftJoin(projectStages, eq(files.projectStageId, projectStages.id))
			.where(and(...where))
			.orderBy(desc(files.createdAt), desc(files.id))
			.limit(limit + 1);
		const { items, nextCursor } = page(rows, limit, (r) => [r.f.createdAt, r.f.id]);

		const ids = items.map((r) => r.f.id);
		const [extractions, thumbs] = await Promise.all([
			ids.length && kind === "documents"
				? db
						.select({
							id: documentExtractions.id,
							fileId: documentExtractions.fileId,
							status: documentExtractions.status,
							detectedType: documentExtractions.detectedType,
						})
						.from(documentExtractions)
						.where(inArray(documentExtractions.fileId, ids))
				: Promise.resolve([]),
			signThumbUrls(
				c.env,
				items.map((r) => r.f.thumbKey),
			),
		]);

		const result: FileEntry[] = items.map((r, i) => {
			const ex = extractions.find((e) => e.fileId === r.f.id);
			return {
				id: r.f.id,
				projectId: r.f.projectId,
				stage: r.f.projectStageId && r.stageName ? { id: r.f.projectStageId, name: r.stageName } : null,
				category: r.f.category,
				filename: r.f.filename,
				mimeType: r.f.mimeType,
				sizeBytes: r.f.sizeBytes,
				caption: r.f.caption,
				uploadedBy: { id: r.f.uploadedBy, name: r.uploaderName ?? r.uploaderEmail },
				uploadedAt: r.f.uploadedAt,
				thumbUrl: thumbs[i] ?? null,
				extraction: ex ? { id: ex.id, status: ex.status, detectedType: ex.detectedType } : null,
			};
		});
		return c.json({ items: result, nextCursor });
	})

	// Step 2 of DESIGN.md §4: permission check, pending row, presigned PUT URL(s). Keys are built here.
	.post("/:id/files", requireRole("admin"), zv("param", idParam), zv("json", fileCreate), async (c) => {
		requireR2(c.env);
		const db = c.get("db");
		const user = c.get("user");
		const { id: projectId } = c.req.valid("param");
		const body = c.req.valid("json");
		await assertProject(db, projectId);
		await assertStage(db, body.stageId, projectId);

		const now = Date.now();
		const id = ulid(now);
		const keys = fileKeys(projectId, id, body.filename);
		const row: typeof files.$inferInsert = {
			id,
			projectId,
			projectStageId: body.stageId ?? null,
			category: body.category,
			r2Key: keys.key,
			thumbKey: body.withThumb ? keys.thumbKey : null,
			filename: body.filename,
			mimeType: body.mimeType,
			sizeBytes: body.sizeBytes,
			caption: body.caption ?? null,
			uploadStatus: "pending",
			uploadedBy: user.id,
			createdAt: now,
		};
		await db.insert(files).values(row);
		const ticket = await uploadTicket(
			c.env,
			row as typeof files.$inferSelect,
			body.withThumb && body.thumbBytes ? { bytes: body.thumbBytes, mime: body.thumbMimeType } : undefined,
		);
		return c.json(ticket, 201);
	});

export const fileRoutes = new Hono<AppEnv>()
	// Fresh URLs for an upload that outlived its 5-minute ticket (flaky connection, app reopened).
	.post(
		"/:id/upload-urls",
		requireRole("admin"),
		zv("param", idParam),
		zv("json", uploadUrlsBody),
		async (c) => {
			requireR2(c.env);
			const db = c.get("db");
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");
			const f = await loadFile(db, id);
			if (f.uploadStatus !== "pending") throw conflict("File is already uploaded");
			const ticket = await uploadTicket(
				c.env,
				f,
				body.thumbBytes ? { bytes: body.thumbBytes, mime: body.thumbMimeType } : undefined,
			);
			return c.json(ticket);
		},
	)

	// Step 4: confirm the object really landed (HEAD via the binding), mark uploaded, enqueue extraction.
	.post("/:id/complete", requireRole("admin"), zv("param", idParam), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const f = await loadFile(db, id);
		if (f.uploadStatus === "uploaded") return c.json({ id, status: "uploaded" });

		const [head, thumbHead] = await Promise.all([
			c.env.FILES.head(f.r2Key),
			f.thumbKey ? c.env.FILES.head(f.thumbKey) : Promise.resolve(null),
		]);
		if (!head) throw conflict("Upload not found in storage yet. Try again.");
		const max = f.category === "photo" ? MAX_PHOTO_BYTES : MAX_DOCUMENT_BYTES;
		const actualType = head.httpMetadata?.contentType ?? f.mimeType;
		const typeOk =
			actualType === f.mimeType &&
			(f.category !== "photo" || (IMAGE_MIME_TYPES as readonly string[]).includes(actualType));
		if (head.size > max || head.size !== f.sizeBytes || !typeOk) {
			await c.env.FILES.delete([f.r2Key, ...(f.thumbKey ? [f.thumbKey] : [])]);
			await db.update(files).set({ deletedAt: Date.now() }).where(eq(files.id, id));
			throw badRequest("Uploaded file didn't match what was approved, so it was discarded");
		}
		const thumbKey = thumbHead && thumbHead.size <= MAX_THUMB_BYTES ? f.thumbKey : null;

		const now = Date.now();
		const extract = isExtractable(f.category, f.mimeType);
		const extractionId = extract ? ulid(now) : null;
		await db.batch([
			db.update(files).set({ uploadStatus: "uploaded", uploadedAt: now, thumbKey }).where(eq(files.id, id)),
			...(extractionId
				? [
						db
							.insert(documentExtractions)
							.values({ id: extractionId, fileId: id, status: "queued", createdAt: now, updatedAt: now }),
					]
				: []),
			touchProject(db, f.projectId, now),
			logActivity(
				db,
				{
					projectId: f.projectId,
					actorId: user.id,
					action: "file.uploaded",
					entityType: "file",
					entityId: id,
					meta: { filename: f.filename, category: f.category, caption: f.caption },
				},
				now,
			),
		]);
		if (extractionId) {
			await c.env.JOBS.send({ type: "extract", extractionId } satisfies JobMessage);
		}
		return c.json({ id, status: "uploaded", extractionId });
	})

	// Short-lived download link after the permission check (admins, and viewers of this project).
	.get("/:id/url", zv("param", idParam), zv("query", fileUrlQuery), async (c) => {
		requireR2(c.env);
		const db = c.get("db");
		const { id } = c.req.valid("param");
		const { download } = c.req.valid("query");
		const f = await loadFile(db, id);
		await assertProjectAccess(c, f.projectId);
		if (f.uploadStatus !== "uploaded") throw notFound("File is still uploading");
		return c.json(await presignGet(c.env, f.r2Key, { filename: f.filename, inline: download !== "1" }));
	})

	.patch("/:id", requireRole("admin"), zv("param", idParam), zv("json", fileUpdate), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const f = await loadFile(db, id);
		if (body.category && (body.category === "photo") !== (f.category === "photo")) {
			throw badRequest("Photos and documents can't be switched; upload it again instead");
		}
		await assertStage(db, body.stageId, f.projectId);
		const now = Date.now();
		await db.batch([
			db
				.update(files)
				.set({
					...(body.caption !== undefined ? { caption: body.caption } : {}),
					...(body.stageId !== undefined ? { projectStageId: body.stageId } : {}),
					...(body.category ? { category: body.category } : {}),
				})
				.where(eq(files.id, id)),
			logActivity(
				db,
				{
					projectId: f.projectId,
					actorId: user.id,
					action: "file.updated",
					entityType: "file",
					entityId: id,
					meta: { filename: f.filename, changed: Object.keys(body) },
				},
				now,
			),
		]);
		return c.json({ id });
	})

	// Soft delete: the row is hidden; the R2 object is kept (recoverable, and cheap at this scale).
	.delete("/:id", requireRole("admin"), zv("param", idParam), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const f = await loadFile(db, id);
		const now = Date.now();
		await db.batch([
			db.update(files).set({ deletedAt: now }).where(eq(files.id, id)),
			touchProject(db, f.projectId, now),
			logActivity(
				db,
				{
					projectId: f.projectId,
					actorId: user.id,
					action: "file.deleted",
					entityType: "file",
					entityId: id,
					meta: { filename: f.filename, category: f.category },
				},
				now,
			),
		]);
		return c.json({ ok: true });
	});
