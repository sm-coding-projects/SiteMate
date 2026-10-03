import { and, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { ulid } from "ulid";
import { activity, notes, projectStages, projects, users } from "../../db/schema";
import type { ActivityEntry, Note } from "../../shared/api-types";
import { idParam, noteCreate, noteUpdate, pageQuery } from "../../shared/schemas";
import { logActivity, touchProject } from "../lib/activity";
import { decodeCursor, page } from "../lib/cursor";
import { badRequest, notFound, zv } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";
import { assertProject } from "./projects";

type Db = AppEnv["Variables"]["db"];

const excerpt = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);

async function assertStageInProject(db: Db, stageId: string, projectId: string) {
	const s = await db.query.projectStages.findFirst({
		where: and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId)),
		columns: { id: true, name: true },
	});
	if (!s) throw badRequest("Stage is not part of this project");
	return s;
}

export const projectNoteRoutes = new Hono<AppEnv>()
	.get("/:id/notes", zv("param", idParam), zv("query", pageQuery), async (c) => {
		const db = c.get("db");
		const { id: projectId } = c.req.valid("param");
		const { cursor, limit } = c.req.valid("query");
		const where: SQL[] = [eq(notes.projectId, projectId), isNull(notes.deletedAt)];
		const after = decodeCursor(cursor);
		if (after) {
			where.push(
				sql`(${notes.createdAt} < ${after.sort} or (${notes.createdAt} = ${after.sort} and ${notes.id} < ${after.id}))`,
			);
		}
		const rows = await db
			.select({
				note: notes,
				stageName: projectStages.name,
				authorName: users.name,
				authorEmail: users.email,
			})
			.from(notes)
			.innerJoin(users, eq(notes.authorId, users.id))
			.leftJoin(projectStages, eq(notes.projectStageId, projectStages.id))
			.where(and(...where))
			.orderBy(desc(notes.createdAt), desc(notes.id))
			.limit(limit + 1);
		const { items, nextCursor } = page(rows, limit, (r) => [r.note.createdAt, r.note.id]);
		const result: Note[] = items.map((r) => ({
			id: r.note.id,
			body: r.note.body,
			stage: r.note.projectStageId && r.stageName ? { id: r.note.projectStageId, name: r.stageName } : null,
			author: { id: r.note.authorId, name: r.authorName, email: r.authorEmail },
			createdAt: r.note.createdAt,
			updatedAt: r.note.updatedAt,
		}));
		return c.json({ items: result, nextCursor });
	})

	.post("/:id/notes", requireRole("admin"), zv("param", idParam), zv("json", noteCreate), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id: projectId } = c.req.valid("param");
		const body = c.req.valid("json");
		await assertProject(db, projectId);
		const stage = body.stageId ? await assertStageInProject(db, body.stageId, projectId) : null;
		const now = Date.now();
		const id = ulid(now);
		await db.batch([
			db.insert(notes).values({
				id,
				projectId,
				projectStageId: stage?.id ?? null,
				body: body.body,
				authorId: user.id,
				createdAt: now,
				updatedAt: now,
			}),
			touchProject(db, projectId, now),
			logActivity(
				db,
				{
					projectId,
					actorId: user.id,
					action: "note.added",
					entityType: "note",
					entityId: id,
					meta: { excerpt: excerpt(body.body), stage: stage?.name ?? null },
				},
				now,
			),
		]);
		return c.json({ id }, 201);
	})

	.get("/:id/activity", zv("param", idParam), zv("query", pageQuery), async (c) => {
		const { id } = c.req.valid("param");
		const { cursor, limit } = c.req.valid("query");
		return c.json(await listActivity(c.get("db"), { projectId: id, cursor, limit }));
	});

export const noteRoutes = new Hono<AppEnv>()
	.patch("/:id", requireRole("admin"), zv("param", idParam), zv("json", noteUpdate), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const note = await db.query.notes.findFirst({ where: and(eq(notes.id, id), isNull(notes.deletedAt)) });
		if (!note) throw notFound("Note not found");
		if (body.stageId) await assertStageInProject(db, body.stageId, note.projectId);
		const now = Date.now();
		await db.batch([
			db
				.update(notes)
				.set({
					...(body.body !== undefined ? { body: body.body } : {}),
					...(body.stageId !== undefined ? { projectStageId: body.stageId } : {}),
					updatedAt: now,
				})
				.where(eq(notes.id, id)),
			logActivity(
				db,
				{
					projectId: note.projectId,
					actorId: user.id,
					action: "note.edited",
					entityType: "note",
					entityId: id,
					meta: { excerpt: excerpt(body.body ?? note.body) },
				},
				now,
			),
		]);
		return c.json({ id });
	})

	// Soft delete (user content).
	.delete("/:id", requireRole("admin"), zv("param", idParam), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const note = await db.query.notes.findFirst({ where: and(eq(notes.id, id), isNull(notes.deletedAt)) });
		if (!note) throw notFound("Note not found");
		const now = Date.now();
		await db.batch([
			db.update(notes).set({ deletedAt: now }).where(eq(notes.id, id)),
			logActivity(
				db,
				{
					projectId: note.projectId,
					actorId: user.id,
					action: "note.deleted",
					entityType: "note",
					entityId: id,
					meta: { excerpt: excerpt(note.body) },
				},
				now,
			),
		]);
		return c.json({ ok: true });
	});

/** Newest first, keyset-paginated on (created_at, id). Uses activity_project_created_idx / activity_created_idx. */
export async function listActivity(
	db: Db,
	{ projectId, cursor, limit }: { projectId?: string; cursor?: string; limit: number },
) {
	const where: SQL[] = [];
	if (projectId) where.push(eq(activity.projectId, projectId));
	const after = decodeCursor(cursor);
	if (after) {
		where.push(
			sql`(${activity.createdAt} < ${after.sort} or (${activity.createdAt} = ${after.sort} and ${activity.id} < ${after.id}))`,
		);
	}
	const rows = await db
		.select({
			a: activity,
			actorName: users.name,
			actorEmail: users.email,
			projectName: projects.name,
		})
		.from(activity)
		.innerJoin(users, eq(activity.actorId, users.id))
		.leftJoin(projects, eq(activity.projectId, projects.id))
		.where(where.length ? and(...where) : undefined)
		.orderBy(desc(activity.createdAt), desc(activity.id))
		.limit(limit + 1);
	const { items, nextCursor } = page(rows, limit, (r) => [r.a.createdAt, r.a.id]);
	const result: ActivityEntry[] = items.map((r) => ({
		id: r.a.id,
		project: r.a.projectId && r.projectName ? { id: r.a.projectId, name: r.projectName } : null,
		actor: { id: r.a.actorId, name: r.actorName, email: r.actorEmail },
		action: r.a.action,
		entityType: r.a.entityType,
		entityId: r.a.entityId,
		meta: r.a.meta ?? null,
		createdAt: r.a.createdAt,
	}));
	return { items: result, nextCursor };
}

export const activityRoutes = new Hono<AppEnv>().get("/", zv("query", pageQuery), async (c) => {
	const { cursor, limit } = c.req.valid("query");
	return c.json(await listActivity(c.get("db"), { cursor, limit }));
});
