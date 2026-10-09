import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ulid } from "ulid";
import { z } from "zod";
import { activity, emailLog, projectAccess, projects, ROLES, users } from "../../db/schema";
import type { JobMessage, Role, Team } from "../../shared/api-types";
import { idSchema, inviteCreate, projectAccessUpdate, roleUpdate } from "../../shared/schemas";
import type { Db } from "../db";
import { logActivity } from "../lib/activity";
import { badRequest, zv } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";

const toRole = (v: unknown): Role => (ROLES.includes(v as Role) ? (v as Role) : "viewer");
const toIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** Drops ids that aren't projects (deleted, or never were). */
async function existingProjectIds(db: Db, ids: string[]) {
	if (ids.length === 0) return [];
	const rows = await db.select({ id: projects.id }).from(projects).where(inArray(projects.id, ids));
	return rows.map((r) => r.id);
}
const userParam = z.object({ id: idSchema });

type ClerkUser = {
	primaryEmailAddress?: { emailAddress: string } | null;
	emailAddresses?: { emailAddress: string }[];
};
const emailOf = (u: ClerkUser) =>
	u.primaryEmailAddress?.emailAddress ?? u.emailAddresses?.[0]?.emailAddress ?? "";

/** Mirrors a Clerk ban in `users` (a user who never signed in has no row yet) and logs it. */
const setAccess = (db: Db, actorId: string, id: string, email: string, revokedAt: number | null) =>
	db.batch([
		db.update(users).set({ accessRevokedAt: revokedAt, updatedAt: Date.now() }).where(eq(users.id, id)),
		logActivity(db, {
			actorId,
			action: revokedAt ? "user.access_removed" : "user.access_restored",
			entityType: "user",
			entityId: id,
			meta: { email },
		}),
	]);

/** Clerk API errors carry a list of { message, longMessage }; surface the first one. */
function clerkError(err: unknown): never {
	const e = err as { status?: number; errors?: { longMessage?: string; message?: string }[] };
	const msg = e.errors?.[0]?.longMessage ?? e.errors?.[0]?.message ?? "Clerk request failed";
	const status = e.status && e.status >= 400 && e.status < 500 ? e.status : 502;
	throw new HTTPException(status as 400, { message: msg });
}

/**
 * Admin-only endpoints. Team management goes through Clerk's Backend API: Clerk sends the invitation
 * email itself and stores the role in publicMetadata, which flows into the session token.
 */
export const adminRoutes = new Hono<AppEnv>()
	.use(requireRole("admin"))
	// Smoke test for the queue binding: the consumer logs the message (visible in `wrangler tail`).
	.post("/queue-ping", async (c) => {
		const user = c.get("user");
		const message: JobMessage = { type: "ping", requestedBy: user.id, at: Date.now() };
		await c.env.JOBS.send(message);
		await c.get("db").insert(activity).values({
			id: ulid(),
			actorId: user.id,
			action: "queue.ping",
			entityType: "system",
		});
		return c.json({ queued: true, message }, 202);
	})

	// Queues a test notification to the signed-in admin (sandbox mode redirects it to EMAIL_SANDBOX_TO).
	.post("/test-email", async (c) => {
		const user = c.get("user");
		const message: JobMessage = {
			type: "notify",
			kind: "test",
			to: user.email,
			requestedBy: user.id,
			at: Date.now(),
		};
		await c.env.JOBS.send(message);
		return c.json({ queued: true, mode: c.env.EMAIL_MODE || "sandbox" }, 202);
	})

	/** Recent sends, for checking delivery and the daily cap. */
	.get("/email-log", async (c) => {
		const db = c.get("db");
		const since = Date.now() - 86_400_000;
		const [rows, sent] = await db.batch([
			db.select().from(emailLog).orderBy(desc(emailLog.createdAt)).limit(25),
			db
				.select({ n: sql<number>`count(*)` })
				.from(emailLog)
				.where(and(eq(emailLog.status, "sent"), gte(emailLog.createdAt, since))),
		]);
		return c.json({
			sentLast24h: sent[0]?.n ?? 0,
			limit: Number(c.env.EMAIL_DAILY_LIMIT || 90),
			mode: c.env.EMAIL_MODE || "sandbox",
			configured: Boolean(c.env.RESEND_API_KEY),
			items: rows,
		});
	})

	.get("/team", async (c) => {
		const clerk = c.get("clerk");
		const db = c.get("db");
		const [list, invites] = await Promise.all([
			clerk.users.getUserList({ limit: 100, orderBy: "-created_at" }),
			clerk.invitations.getInvitationList({ status: "pending", limit: 100 }),
		]).catch(clerkError);
		const [projectRows, accessRows, activeRows] = await db.batch([
			db
				.select({ id: projects.id, name: projects.name, status: projects.status })
				.from(projects)
				.orderBy(asc(projects.name)),
			db.select({ userId: projectAccess.userId, projectId: projectAccess.projectId }).from(projectAccess),
			db.select({ id: users.id, lastActiveAt: users.lastActiveAt }).from(users),
		]);
		const activeAt = new Map(activeRows.map((u) => [u.id, u.lastActiveAt]));
		const team: Team = {
			projects: projectRows.map((p) => ({ id: p.id, name: p.name, archived: p.status === "archived" })),
			members: list.data.map((u) => ({
				id: u.id,
				email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? "",
				name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
				role: toRole(u.publicMetadata?.role),
				imageUrl: u.hasImage ? u.imageUrl : null,
				lastSignInAt: u.lastSignInAt,
				lastActiveAt: Math.max(u.lastSignInAt ?? 0, activeAt.get(u.id) ?? 0) || null,
				accessRemoved: u.banned,
				projectIds: accessRows.filter((a) => a.userId === u.id).map((a) => a.projectId),
				createdAt: u.createdAt,
			})),
			invitations: invites.data.map((i) => ({
				id: i.id,
				email: i.emailAddress,
				role: toRole(i.publicMetadata?.role),
				status: i.status,
				projectIds: toIds(i.publicMetadata?.projectIds),
				createdAt: i.createdAt,
			})),
		};
		return c.json(team);
	})

	.post("/invitations", zv("json", inviteCreate), async (c) => {
		const user = c.get("user");
		const { email, role } = c.req.valid("json");
		// Copied into the user's publicMetadata on sign-up; requireUser() turns it into project_access rows.
		const projectIds =
			role === "viewer" ? await existingProjectIds(c.get("db"), c.req.valid("json").projectIds) : [];
		const appUrl = (c.env.APP_URL || new URL(c.req.url).origin).replace(/\/$/, "");
		const invitation = await c
			.get("clerk")
			.invitations.createInvitation({
				emailAddress: email,
				publicMetadata: role === "viewer" ? { role, projectIds } : { role },
				// The invite link lands on our <SignUp>, which redeems Clerk's ticket (sign-up is invite-only).
				redirectUrl: `${appUrl}/sign-up`,
				notify: true,
			})
			.catch(clerkError);
		await logActivity(c.get("db"), {
			actorId: user.id,
			action: "user.invited",
			entityType: "invitation",
			entityId: invitation.id,
			meta: { email, role, projects: projectIds.length },
		});
		return c.json({ id: invitation.id, email, role, projectIds, status: invitation.status }, 201);
	})

	.delete("/invitations/:id", zv("param", userParam), async (c) => {
		const { id } = c.req.valid("param");
		await c.get("clerk").invitations.revokeInvitation(id).catch(clerkError);
		return c.json({ ok: true });
	})

	/** Bans the user in Clerk: ends their sessions and blocks sign-in. Reversible, and their history stays. */
	.post("/users/:id/remove-access", zv("param", userParam), async (c) => {
		const me = c.get("user");
		const { id } = c.req.valid("param");
		if (id === me.id) throw badRequest("You can't remove your own access. Ask another admin.");
		const banned = await c.get("clerk").users.banUser(id).catch(clerkError);
		await setAccess(c.get("db"), me.id, id, emailOf(banned), Date.now());
		return c.json({ id, accessRemoved: true });
	})

	.post("/users/:id/restore-access", zv("param", userParam), async (c) => {
		const me = c.get("user");
		const { id } = c.req.valid("param");
		const restored = await c.get("clerk").users.unbanUser(id).catch(clerkError);
		await setAccess(c.get("db"), me.id, id, emailOf(restored), null);
		return c.json({ id, accessRemoved: false });
	})

	/**
	 * Viewers only (admins can only have their access removed). Deletes the Clerk user, which frees the email
	 * for a new invitation. The `users` row stays, revoked, because notes, files and activity point at it; it
	 * also refuses a session token issued before the delete.
	 */
	.delete("/users/:id", zv("param", userParam), async (c) => {
		const me = c.get("user");
		const { id } = c.req.valid("param");
		if (id === me.id) throw badRequest("You can't delete your own account. Ask another admin.");
		const clerk = c.get("clerk");
		const target = await clerk.users.getUser(id).catch(clerkError);
		if (toRole(target.publicMetadata?.role) !== "viewer") {
			throw badRequest("Only viewers can be deleted. Remove an admin's access instead.");
		}
		await clerk.users.deleteUser(id).catch(clerkError);
		const db = c.get("db");
		const now = Date.now();
		await db.batch([
			db.update(users).set({ accessRevokedAt: now, updatedAt: now }).where(eq(users.id, id)),
			logActivity(db, {
				actorId: me.id,
				action: "user.deleted",
				entityType: "user",
				entityId: id,
				meta: { email: emailOf(target) },
			}),
		]);
		return c.json({ id, deleted: true });
	})

	/** Replaces the set of projects a viewer can see. */
	.put("/users/:id/projects", zv("param", userParam), zv("json", projectAccessUpdate), async (c) => {
		const me = c.get("user");
		const { id } = c.req.valid("param");
		const db = c.get("db");
		const target = await c.get("clerk").users.getUser(id).catch(clerkError);
		if (toRole(target.publicMetadata?.role) !== "viewer") {
			throw badRequest("Admins see every project. Only viewers get a project list.");
		}
		const email = emailOf(target);
		const ids = await existingProjectIds(db, c.req.valid("json").projectIds);
		const now = Date.now();
		// They may not have opened the app since accepting; access rows need their users row.
		await db
			.insert(users)
			.values({
				id,
				email,
				name: [target.firstName, target.lastName].filter(Boolean).join(" ") || null,
				role: "viewer",
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();
		await db.batch([
			db.delete(projectAccess).where(eq(projectAccess.userId, id)),
			...ids.map((projectId) => db.insert(projectAccess).values({ projectId, userId: id, grantedBy: me.id })),
			logActivity(db, {
				actorId: me.id,
				action: "user.projects_changed",
				entityType: "user",
				entityId: id,
				meta: { email, projects: ids.length },
			}),
		]);
		return c.json({ id, projectIds: ids });
	})

	.patch("/users/:id/role", zv("param", userParam), zv("json", roleUpdate), async (c) => {
		const me = c.get("user");
		const { id } = c.req.valid("param");
		const { role } = c.req.valid("json");
		if (id === me.id && role !== "admin") {
			throw badRequest("You can't remove your own admin role. Ask another admin.");
		}
		const clerk = c.get("clerk");
		const updated = await clerk.users.updateUserMetadata(id, { publicMetadata: { role } }).catch(clerkError);
		const email = emailOf(updated);
		const db = c.get("db");
		// The session token picks the new role up on its next refresh (≤ 1 min); update our copy now. Tokens issued
		// before this keep the old role, so requireUser checks them against roleChangedAt.
		const now = Date.now();
		await db.batch([
			db.update(users).set({ role, roleChangedAt: now, updatedAt: now }).where(eq(users.id, id)),
			logActivity(db, {
				actorId: me.id,
				action: "user.role_changed",
				entityType: "user",
				entityId: id,
				meta: { email, role },
			}),
		]);
		return c.json({ id, role });
	});
