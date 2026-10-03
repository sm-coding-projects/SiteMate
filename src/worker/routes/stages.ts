import { asc, count, eq, max, sql } from "drizzle-orm";
import { Hono } from "hono";
import { ulid } from "ulid";
import { projectItems, projectStages } from "../../db/schema";
import type { JobMessage } from "../../shared/api-types";
import { applyManualStatus, deriveStageStatus, type StageState } from "../../shared/progress";
import { idParam, itemCreate, itemUpdate, reorderBody, stageCreate, stageUpdate } from "../../shared/schemas";
import { logActivity, touchProject } from "../lib/activity";
import { runBatch, type Statement } from "../lib/batch";
import { badRequest, notFound, zv } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";
import { assertProject } from "./projects";

type Db = AppEnv["Variables"]["db"];

async function loadStage(db: Db, stageId: string) {
	const stage = await db.query.projectStages.findFirst({ where: eq(projectStages.id, stageId) });
	if (!stage) throw notFound("Stage not found");
	return stage;
}

async function loadItem(db: Db, itemId: string) {
	const row = await db
		.select({ item: projectItems, stage: projectStages })
		.from(projectItems)
		.innerJoin(projectStages, eq(projectItems.projectStageId, projectStages.id))
		.where(eq(projectItems.id, itemId))
		.get();
	if (!row) throw notFound("Checklist item not found");
	return row;
}

async function itemCounts(db: Db, stageId: string) {
	const row = await db
		.select({ total: count(), done: sql<number>`count(${projectItems.completedAt})` })
		.from(projectItems)
		.where(eq(projectItems.projectStageId, stageId))
		.get();
	return { total: row?.total ?? 0, done: row?.done ?? 0 };
}

const sameState = (a: StageState, b: StageState) =>
	a.status === b.status && a.startedAt === b.startedAt && a.completedAt === b.completedAt;

/** Validates that `ids` is exactly the current set of siblings, in any order. */
function assertSameSet(current: string[], ids: string[]) {
	const a = new Set(current);
	if (ids.length !== a.size || new Set(ids).size !== ids.length || !ids.every((id) => a.has(id))) {
		throw badRequest("Order must list every item exactly once");
	}
}

/**
 * Statements that move a stage to `next` (if different), plus the activity row and the
 * stage-complete notification job when it has just been completed.
 */
function stageTransition(
	db: Db,
	stage: typeof projectStages.$inferSelect,
	next: StageState,
	actorId: string,
	now: number,
) {
	if (sameState(stage, next)) return { statements: [] as Statement[], job: null as JobMessage | null };
	const statements: Statement[] = [db.update(projectStages).set(next).where(eq(projectStages.id, stage.id))];
	let job: JobMessage | null = null;
	if (next.status !== stage.status) {
		statements.push(
			logActivity(
				db,
				{
					projectId: stage.projectId,
					actorId,
					action: next.status === "complete" ? "stage.completed" : "stage.status_changed",
					entityType: "stage",
					entityId: stage.id,
					meta: { stage: stage.name, from: stage.status, to: next.status },
				},
				now,
			),
		);
		if (next.status === "complete") {
			job = {
				type: "notify",
				kind: "stage_completed",
				projectId: stage.projectId,
				stageId: stage.id,
				actorId,
			};
		}
	}
	return { statements, job };
}

export const projectStageRoutes = new Hono<AppEnv>()
	// Add a custom stage at the end.
	.post("/:id/stages", requireRole("admin"), zv("param", idParam), zv("json", stageCreate), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id: projectId } = c.req.valid("param");
		const body = c.req.valid("json");
		await assertProject(db, projectId);
		const last = await db
			.select({ pos: max(projectStages.position) })
			.from(projectStages)
			.where(eq(projectStages.projectId, projectId))
			.get();
		const now = Date.now();
		const id = ulid(now);
		await db.batch([
			db.insert(projectStages).values({
				id,
				projectId,
				name: body.name,
				description: body.description ?? null,
				position: (last?.pos ?? 0) + 1,
				status: "not_started",
				source: "custom",
			}),
			touchProject(db, projectId, now),
			logActivity(
				db,
				{
					projectId,
					actorId: user.id,
					action: "stage.added",
					entityType: "stage",
					entityId: id,
					meta: { stage: body.name },
				},
				now,
			),
		]);
		return c.json({ id }, 201);
	})

	.post(
		"/:id/stages/reorder",
		requireRole("admin"),
		zv("param", idParam),
		zv("json", reorderBody),
		async (c) => {
			const db = c.get("db");
			const user = c.get("user");
			const { id: projectId } = c.req.valid("param");
			const { ids } = c.req.valid("json");
			await assertProject(db, projectId);
			const current = await db
				.select({ id: projectStages.id })
				.from(projectStages)
				.where(eq(projectStages.projectId, projectId));
			assertSameSet(
				current.map((s) => s.id),
				ids,
			);
			const now = Date.now();
			await db.batch([
				// One statement: position = index in the new order.
				db
					.update(projectStages)
					.set({
						position: sql`case ${projectStages.id} ${sql.join(
							ids.map((sid, i) => sql`when ${sid} then ${i + 1}`),
							sql` `,
						)} end`,
					})
					.where(eq(projectStages.projectId, projectId)),
				touchProject(db, projectId, now),
				logActivity(
					db,
					{
						projectId,
						actorId: user.id,
						action: "stage.reordered",
						entityType: "project",
						entityId: projectId,
					},
					now,
				),
			]);
			return c.json({ ok: true });
		},
	);

export const stageRoutes = new Hono<AppEnv>()
	.patch("/:id", requireRole("admin"), zv("param", idParam), zv("json", stageUpdate), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const stage = await loadStage(db, id);
		const now = Date.now();

		const statements: Statement[] = [];
		const fields: Partial<typeof projectStages.$inferInsert> = {};
		if (body.name !== undefined && body.name !== stage.name) fields.name = body.name;
		if (body.description !== undefined && body.description !== stage.description)
			fields.description = body.description;
		if (Object.keys(fields).length) {
			statements.push(db.update(projectStages).set(fields).where(eq(projectStages.id, id)));
			if (fields.name) {
				statements.push(
					logActivity(
						db,
						{
							projectId: stage.projectId,
							actorId: user.id,
							action: "stage.renamed",
							entityType: "stage",
							entityId: id,
							meta: { stage: fields.name, from: stage.name },
						},
						now,
					),
				);
			}
		}
		let job: JobMessage | null = null;
		if (body.status) {
			const t = stageTransition(
				db,
				{ ...stage, ...fields },
				applyManualStatus(stage, body.status, now),
				user.id,
				now,
			);
			statements.push(...t.statements);
			job = t.job;
		}
		if (statements.length === 0) return c.json({ id, changed: false });
		statements.push(touchProject(db, stage.projectId, now));
		await runBatch(db, statements);
		if (job) await c.env.JOBS.send(job);
		return c.json({ id, changed: true });
	})

	// Removing a stage removes its checklist; notes and files keep existing with no stage.
	.delete("/:id", requireRole("admin"), zv("param", idParam), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const stage = await loadStage(db, id);
		const now = Date.now();
		await db.batch([
			db.delete(projectStages).where(eq(projectStages.id, id)),
			touchProject(db, stage.projectId, now),
			logActivity(
				db,
				{
					projectId: stage.projectId,
					actorId: user.id,
					action: "stage.removed",
					entityType: "stage",
					entityId: id,
					meta: { stage: stage.name, source: stage.source },
				},
				now,
			),
		]);
		return c.json({ ok: true });
	})

	.post("/:id/items", requireRole("admin"), zv("param", idParam), zv("json", itemCreate), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id: stageId } = c.req.valid("param");
		const { title } = c.req.valid("json");
		const stage = await loadStage(db, stageId);
		const [last, counts] = await Promise.all([
			db
				.select({ pos: max(projectItems.position) })
				.from(projectItems)
				.where(eq(projectItems.projectStageId, stageId))
				.get(),
			itemCounts(db, stageId),
		]);
		const now = Date.now();
		const id = ulid(now);
		// A new unticked item reopens a completed stage.
		const next = deriveStageStatus(stage, counts.done, counts.total + 1, now);
		const t = stageTransition(db, stage, next, user.id, now);
		await runBatch(db, [
			db.insert(projectItems).values({
				id,
				projectStageId: stageId,
				title,
				position: (last?.pos ?? 0) + 1,
				source: "custom",
			}),
			...t.statements,
			touchProject(db, stage.projectId, now),
			logActivity(
				db,
				{
					projectId: stage.projectId,
					actorId: user.id,
					action: "item.added",
					entityType: "item",
					entityId: id,
					meta: { item: title, stage: stage.name },
				},
				now,
			),
		]);
		return c.json({ id }, 201);
	})

	.post(
		"/:id/items/reorder",
		requireRole("admin"),
		zv("param", idParam),
		zv("json", reorderBody),
		async (c) => {
			const db = c.get("db");
			const { id: stageId } = c.req.valid("param");
			const { ids } = c.req.valid("json");
			const stage = await loadStage(db, stageId);
			const current = await db
				.select({ id: projectItems.id })
				.from(projectItems)
				.where(eq(projectItems.projectStageId, stageId));
			assertSameSet(
				current.map((s) => s.id),
				ids,
			);
			const now = Date.now();
			await db.batch([
				db
					.update(projectItems)
					.set({
						position: sql`case ${projectItems.id} ${sql.join(
							ids.map((iid, i) => sql`when ${iid} then ${i + 1}`),
							sql` `,
						)} end`,
					})
					.where(eq(projectItems.projectStageId, stageId)),
				touchProject(db, stage.projectId, now),
			]);
			return c.json({ ok: true });
		},
	)

	.get("/:id/items", zv("param", idParam), async (c) => {
		const db = c.get("db");
		const { id } = c.req.valid("param");
		await loadStage(db, id);
		const rows = await db
			.select()
			.from(projectItems)
			.where(eq(projectItems.projectStageId, id))
			.orderBy(asc(projectItems.position));
		return c.json(rows);
	});

export const itemRoutes = new Hono<AppEnv>()
	// Tick / untick (records who and when) and rename. Stage status follows the checklist.
	.patch("/:id", requireRole("admin"), zv("param", idParam), zv("json", itemUpdate), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const { item, stage } = await loadItem(db, id);
		const now = Date.now();

		const statements: Statement[] = [];
		const fields: Partial<typeof projectItems.$inferInsert> = {};
		if (body.title !== undefined && body.title !== item.title) {
			fields.title = body.title;
			statements.push(
				logActivity(
					db,
					{
						projectId: stage.projectId,
						actorId: user.id,
						action: "item.renamed",
						entityType: "item",
						entityId: id,
						meta: { item: body.title, from: item.title, stage: stage.name },
					},
					now,
				),
			);
		}
		let job: JobMessage | null = null;
		const wasDone = item.completedAt !== null;
		if (body.completed !== undefined && body.completed !== wasDone) {
			fields.completedAt = body.completed ? now : null;
			fields.completedBy = body.completed ? user.id : null;
			statements.push(
				logActivity(
					db,
					{
						projectId: stage.projectId,
						actorId: user.id,
						action: body.completed ? "item.completed" : "item.reopened",
						entityType: "item",
						entityId: id,
						meta: { item: fields.title ?? item.title, stage: stage.name },
					},
					now,
				),
			);
			const counts = await itemCounts(db, stage.id);
			const done = counts.done + (body.completed ? 1 : -1);
			const t = stageTransition(db, stage, deriveStageStatus(stage, done, counts.total, now), user.id, now);
			statements.push(...t.statements);
			job = t.job;
		}
		if (Object.keys(fields).length === 0) return c.json({ id, changed: false });
		statements.unshift(db.update(projectItems).set(fields).where(eq(projectItems.id, id)));
		statements.push(touchProject(db, stage.projectId, now));
		await runBatch(db, statements);
		if (job) await c.env.JOBS.send(job);
		return c.json({ id, changed: true, completedAt: fields.completedAt ?? item.completedAt });
	})

	.delete("/:id", requireRole("admin"), zv("param", idParam), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const { item, stage } = await loadItem(db, id);
		const counts = await itemCounts(db, stage.id);
		const now = Date.now();
		const done = counts.done - (item.completedAt ? 1 : 0);
		const t = stageTransition(db, stage, deriveStageStatus(stage, done, counts.total - 1, now), user.id, now);
		await runBatch(db, [
			db.delete(projectItems).where(eq(projectItems.id, id)),
			...t.statements,
			touchProject(db, stage.projectId, now),
			logActivity(
				db,
				{
					projectId: stage.projectId,
					actorId: user.id,
					action: "item.removed",
					entityType: "item",
					entityId: id,
					meta: { item: item.title, stage: stage.name },
				},
				now,
			),
		]);
		if (t.job) await c.env.JOBS.send(t.job);
		return c.json({ ok: true });
	});
