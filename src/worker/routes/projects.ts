import { and, asc, desc, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { ulid } from "ulid";
import {
	files,
	itemFiles,
	projectItems,
	projectStages,
	projects,
	templateItems,
	templateStages,
	users,
	workflowTemplates,
} from "../../db/schema";
import type {
	ItemAttachment,
	ProjectDetail,
	ProjectSummary,
	StageLite,
	TemplateSummary,
} from "../../shared/api-types";
import { idParam, projectCreate, projectListQuery, projectUpdate } from "../../shared/schemas";
import { logActivity } from "../lib/activity";
import { chunkRows } from "../lib/batch";
import { decodeCursor, page } from "../lib/cursor";
import { signThumbUrls } from "../lib/r2";
import { badRequest, notFound, zv } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export const templateRoutes = new Hono<AppEnv>().get("/", async (c) => {
	const db = c.get("db");
	const rows = await db
		.select({
			id: workflowTemplates.id,
			name: workflowTemplates.name,
			description: workflowTemplates.description,
			isDefault: workflowTemplates.isDefault,
			stageCount: sql<number>`count(distinct ${templateStages.id})`,
			itemCount: sql<number>`count(${templateItems.id})`,
		})
		.from(workflowTemplates)
		.leftJoin(templateStages, eq(templateStages.templateId, workflowTemplates.id))
		.leftJoin(templateItems, eq(templateItems.templateStageId, templateStages.id))
		.groupBy(workflowTemplates.id)
		.orderBy(desc(workflowTemplates.isDefault), asc(workflowTemplates.name));
	return c.json(rows satisfies TemplateSummary[]);
});

export const projectRoutes = new Hono<AppEnv>()
	// List: filter by status, search name/suburb/address, keyset-paginated by last change.
	.get("/", zv("query", projectListQuery), async (c) => {
		const db = c.get("db");
		const { status, q, cursor, limit } = c.req.valid("query");

		const where: SQL[] = [];
		if (status === "open") where.push(sql`${projects.status} != 'archived'`);
		else if (status !== "all") where.push(eq(projects.status, status));
		if (q) {
			const pattern = `%${escapeLike(q)}%`;
			const match = or(
				sql`${projects.name} like ${pattern} escape '\\'`,
				sql`${projects.suburb} like ${pattern} escape '\\'`,
				sql`${projects.siteAddress} like ${pattern} escape '\\'`,
			);
			if (match) where.push(match);
		}
		const after = decodeCursor(cursor);
		if (after) {
			where.push(
				sql`(${projects.updatedAt} < ${after.sort} or (${projects.updatedAt} = ${after.sort} and ${projects.id} < ${after.id}))`,
			);
		}

		const rows = await db
			.select()
			.from(projects)
			.where(and(...where))
			.orderBy(desc(projects.updatedAt), desc(projects.id))
			.limit(limit + 1);
		const { items, nextCursor } = page(rows, limit, (p) => [p.updatedAt, p.id]);
		const ids = items.map((p) => p.id);
		if (ids.length === 0) return c.json({ items: [], nextCursor: null });

		const [[stageRows, itemCounts, photoCounts], recent] = await Promise.all([
			db.batch([
				db
					.select({
						id: projectStages.id,
						projectId: projectStages.projectId,
						name: projectStages.name,
						status: projectStages.status,
					})
					.from(projectStages)
					.where(inArray(projectStages.projectId, ids))
					.orderBy(asc(projectStages.projectId), asc(projectStages.position)),
				db
					.select({
						projectId: projectStages.projectId,
						total: sql<number>`count(${projectItems.id})`,
						done: sql<number>`count(${projectItems.completedAt})`,
					})
					.from(projectItems)
					.innerJoin(projectStages, eq(projectItems.projectStageId, projectStages.id))
					.where(inArray(projectStages.projectId, ids))
					.groupBy(projectStages.projectId),
				db
					.select({ projectId: files.projectId, n: sql<number>`count(*)` })
					.from(files)
					.where(
						and(
							inArray(files.projectId, ids),
							eq(files.category, "photo"),
							eq(files.uploadStatus, "uploaded"),
							isNull(files.deletedAt),
						),
					)
					.groupBy(files.projectId),
			]),
			// Up to 4 latest photos per project (window function, one query for the page).
			db.all<{ id: string; project_id: string; thumb_key: string | null }>(sql`
				select id, project_id, thumb_key from (
					select id, project_id, thumb_key,
						row_number() over (partition by project_id order by created_at desc) as rn
					from files
					where project_id in ${ids} and category = 'photo' and upload_status = 'uploaded' and deleted_at is null
				) where rn <= 4`),
		]);

		const thumbUrls = await signThumbUrls(
			c.env,
			recent.map((r) => r.thumb_key),
		);

		const result: ProjectSummary[] = items.map((p) => {
			const stages: StageLite[] = stageRows
				.filter((s) => s.projectId === p.id)
				.map(({ id, name, status }) => ({ id, name, status }));
			const counts = itemCounts.find((r) => r.projectId === p.id);
			return {
				id: p.id,
				name: p.name,
				siteAddress: p.siteAddress,
				suburb: p.suburb,
				clientName: p.clientName,
				status: p.status,
				startDate: p.startDate,
				targetCompletion: p.targetCompletion,
				updatedAt: p.updatedAt,
				stages,
				itemsDone: counts?.done ?? 0,
				itemsTotal: counts?.total ?? 0,
				photoCount: photoCounts.find((r) => r.projectId === p.id)?.n ?? 0,
				recentPhotos: recent
					.map((r, i) => ({ r, url: thumbUrls[i] ?? null }))
					.filter(({ r }) => r.project_id === p.id)
					.map(({ r, url }) => ({ id: r.id, thumbUrl: url })),
			};
		});
		return c.json({ items: result, nextCursor });
	})

	// Create: copy the template's stages and items into the project in one D1 batch.
	.post("/", requireRole("admin"), zv("json", projectCreate), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const body = c.req.valid("json");

		const template = await db.query.workflowTemplates.findFirst({
			where: body.templateId
				? eq(workflowTemplates.id, body.templateId)
				: eq(workflowTemplates.isDefault, true),
			with: {
				stages: {
					orderBy: asc(templateStages.position),
					with: { items: { orderBy: asc(templateItems.position) } },
				},
			},
		});
		if (!template) throw badRequest(body.templateId ? "Unknown template" : "No default template seeded");

		const now = Date.now();
		const projectId = ulid(now);
		const stageRows: (typeof projectStages.$inferInsert)[] = [];
		const itemRows: (typeof projectItems.$inferInsert)[] = [];
		for (const ts of template.stages) {
			const stageId = ulid(now);
			stageRows.push({
				id: stageId,
				projectId,
				name: ts.name,
				description: ts.description,
				position: ts.position,
				status: "not_started",
				source: "template",
				startedAt: null,
				completedAt: null,
			});
			for (const ti of ts.items) {
				itemRows.push({
					id: ulid(now),
					projectStageId: stageId,
					title: ti.title,
					position: ti.position,
					source: "template",
					completedAt: null,
					completedBy: null,
				});
			}
		}

		const { templateId: _ignored, ...fields } = body;
		await db.batch([
			db.insert(projects).values({
				id: projectId,
				...fields,
				status: "active",
				templateId: template.id,
				createdBy: user.id,
				createdAt: now,
				updatedAt: now,
			}),
			...chunkRows(stageRows, 9).map((rows) => db.insert(projectStages).values(rows)),
			...chunkRows(itemRows, 7).map((rows) => db.insert(projectItems).values(rows)),
			logActivity(
				db,
				{
					projectId,
					actorId: user.id,
					action: "project.created",
					entityType: "project",
					entityId: projectId,
					meta: {
						name: body.name,
						template: template.name,
						stages: stageRows.length,
						items: itemRows.length,
					},
				},
				now,
			),
		]);
		return c.json({ id: projectId }, 201);
	})

	.get("/:id", zv("param", idParam), async (c) => {
		const db = c.get("db");
		const { id } = c.req.valid("param");
		const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
		if (!project) throw notFound("Project not found");

		const [stages, items, attached] = await db.batch([
			db
				.select()
				.from(projectStages)
				.where(eq(projectStages.projectId, id))
				.orderBy(asc(projectStages.position)),
			db
				.select({
					id: projectItems.id,
					stageId: projectItems.projectStageId,
					title: projectItems.title,
					position: projectItems.position,
					source: projectItems.source,
					completedAt: projectItems.completedAt,
					completedById: projectItems.completedBy,
					completedByName: users.name,
					completedByEmail: users.email,
				})
				.from(projectItems)
				.innerJoin(projectStages, eq(projectItems.projectStageId, projectStages.id))
				.leftJoin(users, eq(projectItems.completedBy, users.id))
				.where(eq(projectStages.projectId, id))
				.orderBy(asc(projectItems.position)),
			// Attachments: only live, fully uploaded files.
			db
				.select({
					itemId: itemFiles.itemId,
					fileId: files.id,
					filename: files.filename,
					category: files.category,
					mimeType: files.mimeType,
					thumbKey: files.thumbKey,
				})
				.from(itemFiles)
				.innerJoin(files, eq(itemFiles.fileId, files.id))
				.where(and(eq(files.projectId, id), isNull(files.deletedAt), eq(files.uploadStatus, "uploaded")))
				.orderBy(asc(itemFiles.createdAt), asc(files.createdAt), asc(files.id)),
		]);
		const thumbs = await signThumbUrls(
			c.env,
			attached.map((a) => a.thumbKey),
		);
		const attachmentsByItem = new Map<string, ItemAttachment[]>();
		attached.forEach((a, i) => {
			const list = attachmentsByItem.get(a.itemId) ?? [];
			list.push({
				fileId: a.fileId,
				filename: a.filename,
				category: a.category,
				mimeType: a.mimeType,
				thumbUrl: thumbs[i] ?? null,
			});
			attachmentsByItem.set(a.itemId, list);
		});

		const detail: ProjectDetail = {
			id: project.id,
			name: project.name,
			siteAddress: project.siteAddress,
			suburb: project.suburb,
			clientName: project.clientName,
			clientEmail: project.clientEmail,
			clientPhone: project.clientPhone,
			status: project.status,
			startDate: project.startDate,
			targetCompletion: project.targetCompletion,
			templateId: project.templateId,
			createdAt: project.createdAt,
			updatedAt: project.updatedAt,
			stages: stages.map((s) => ({
				id: s.id,
				name: s.name,
				description: s.description,
				position: s.position,
				status: s.status,
				source: s.source,
				startedAt: s.startedAt,
				completedAt: s.completedAt,
				items: items
					.filter((i) => i.stageId === s.id)
					.map((i) => ({
						id: i.id,
						title: i.title,
						position: i.position,
						source: i.source,
						completedAt: i.completedAt,
						completedBy: i.completedById
							? { id: i.completedById, name: i.completedByName ?? i.completedByEmail }
							: null,
						attachments: attachmentsByItem.get(i.id) ?? [],
					})),
			})),
		};
		return c.json(detail);
	})

	.patch("/:id", requireRole("admin"), zv("param", idParam), zv("json", projectUpdate), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
		if (!project) throw notFound("Project not found");

		const changed = Object.keys(body).filter(
			(k) => body[k as keyof typeof body] !== project[k as keyof typeof project],
		);
		if (changed.length === 0) return c.json({ id, changed });

		const now = Date.now();
		const statusChanged = body.status !== undefined && body.status !== project.status;
		await db.batch([
			db
				.update(projects)
				.set({ ...body, updatedAt: now })
				.where(eq(projects.id, id)),
			logActivity(
				db,
				{
					projectId: id,
					actorId: user.id,
					action: statusChanged
						? body.status === "archived"
							? "project.archived"
							: "project.status_changed"
						: "project.updated",
					entityType: "project",
					entityId: id,
					meta: {
						name: body.name ?? project.name,
						changed,
						...(statusChanged ? { from: project.status, to: body.status } : {}),
					},
				},
				now,
			),
		]);
		return c.json({ id, changed });
	})

	.post("/:id/archive", requireRole("admin"), zv("param", idParam), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
		if (!project) throw notFound("Project not found");
		if (project.status === "archived") return c.json({ id, status: project.status });
		const now = Date.now();
		await db.batch([
			db.update(projects).set({ status: "archived", updatedAt: now }).where(eq(projects.id, id)),
			logActivity(
				db,
				{
					projectId: id,
					actorId: user.id,
					action: "project.archived",
					entityType: "project",
					entityId: id,
					meta: { name: project.name, from: project.status, to: "archived" },
				},
				now,
			),
		]);
		return c.json({ id, status: "archived" });
	});

/** Used by other routes: 404 unless the project exists. */
export async function assertProject(db: AppEnv["Variables"]["db"], projectId: string) {
	const p = await db.query.projects.findFirst({
		where: eq(projects.id, projectId),
		columns: { id: true, name: true, status: true },
	});
	if (!p) throw notFound("Project not found");
	return p;
}
