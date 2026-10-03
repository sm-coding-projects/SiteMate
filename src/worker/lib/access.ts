import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { projectAccess, projects } from "../../db/schema";
import type { Me } from "../../shared/api-types";
import type { Db } from "../db";
import type { AppEnv } from "../types";
import { notFound } from "./validate";

/**
 * Admins see every project; viewers only those in project_access. A project a viewer can't see answers 404,
 * the same as one that doesn't exist, so its existence isn't revealed.
 */
export async function canSeeProject(db: Db, user: Me, projectId: string) {
	if (user.role === "admin") return true;
	const row = await db
		.select({ projectId: projectAccess.projectId })
		.from(projectAccess)
		.where(and(eq(projectAccess.projectId, projectId), eq(projectAccess.userId, user.id)))
		.get();
	return Boolean(row);
}

export async function assertProjectAccess(c: Context<AppEnv>, projectId: string) {
	if (!(await canSeeProject(c.get("db"), c.get("user"), projectId))) throw notFound("Project not found");
}

/** For `/projects/:id` and everything under it. */
export const requireProjectAccess = () =>
	createMiddleware<AppEnv>(async (c, next) => {
		const id = c.req.param("id");
		if (id) await assertProjectAccess(c, id);
		await next();
	});

/** A `where` clause limiting a projects query to what the user may see (undefined for admins). */
export function visibleProjects(user: Me): SQL | undefined {
	if (user.role === "admin") return undefined;
	return inArray(
		projects.id,
		sql`(select ${projectAccess.projectId} from ${projectAccess} where ${projectAccess.userId} = ${user.id})`,
	);
}
