import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ulid } from "ulid";
import { z } from "zod";
import { activity, ROLES, users } from "../../db/schema";
import type { JobMessage, Role, Team } from "../../shared/api-types";
import { idSchema, inviteCreate, roleUpdate } from "../../shared/schemas";
import { logActivity } from "../lib/activity";
import { badRequest, zv } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";

const toRole = (v: unknown): Role => (ROLES.includes(v as Role) ? (v as Role) : "viewer");
const userParam = z.object({ id: idSchema });

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

	.get("/team", async (c) => {
		const clerk = c.get("clerk");
		const [list, invites] = await Promise.all([
			clerk.users.getUserList({ limit: 100, orderBy: "-created_at" }),
			clerk.invitations.getInvitationList({ status: "pending", limit: 100 }),
		]).catch(clerkError);
		const team: Team = {
			members: list.data.map((u) => ({
				id: u.id,
				email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? "",
				name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
				role: toRole(u.publicMetadata?.role),
				imageUrl: u.hasImage ? u.imageUrl : null,
				lastSignInAt: u.lastSignInAt,
				createdAt: u.createdAt,
			})),
			invitations: invites.data.map((i) => ({
				id: i.id,
				email: i.emailAddress,
				role: toRole(i.publicMetadata?.role),
				status: i.status,
				createdAt: i.createdAt,
			})),
		};
		return c.json(team);
	})

	.post("/invitations", zv("json", inviteCreate), async (c) => {
		const user = c.get("user");
		const { email, role } = c.req.valid("json");
		const appUrl = (c.env.APP_URL || new URL(c.req.url).origin).replace(/\/$/, "");
		const invitation = await c
			.get("clerk")
			.invitations.createInvitation({
				emailAddress: email,
				publicMetadata: { role },
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
			meta: { email, role },
		});
		return c.json({ id: invitation.id, email, role, status: invitation.status }, 201);
	})

	.delete("/invitations/:id", zv("param", userParam), async (c) => {
		const { id } = c.req.valid("param");
		await c.get("clerk").invitations.revokeInvitation(id).catch(clerkError);
		return c.json({ ok: true });
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
		const email =
			updated.primaryEmailAddress?.emailAddress ?? updated.emailAddresses?.[0]?.emailAddress ?? "";
		const db = c.get("db");
		// The session token picks the new role up on its next refresh (≤ 1 min); update our copy now.
		await db.batch([
			db.update(users).set({ role, updatedAt: Date.now() }).where(eq(users.id, id)),
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
