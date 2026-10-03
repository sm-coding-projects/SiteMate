import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { activity, projects } from "../../db/schema";
import type { Db } from "../db";

export interface ActivityInput {
	projectId?: string | null;
	actorId: string;
	action: string;
	entityType: string;
	entityId?: string | null;
	/** Names/titles at the time of the change, so the timeline renders without joins and survives deletes. */
	meta?: Record<string, unknown>;
}

/** Statement for one activity row; add it to the same `db.batch` as the change it records. */
export const logActivity = (db: Db, a: ActivityInput, now = Date.now()) =>
	db.insert(activity).values({
		id: ulid(now),
		projectId: a.projectId ?? null,
		actorId: a.actorId,
		action: a.action,
		entityType: a.entityType,
		entityId: a.entityId ?? null,
		meta: a.meta ?? null,
		createdAt: now,
	});

/** Bumps `projects.updated_at` so the projects list sorts by last change. */
export const touchProject = (db: Db, projectId: string, now = Date.now()) =>
	db.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId));
