import { clerkMiddleware, getAuth } from "@clerk/hono";
import { eq, sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { projectAccess, projects, ROLES, users } from "../../db/schema";
import type { Me, Role } from "../../shared/api-types";
import type { AppEnv } from "../types";

/** Verifies the Clerk session token (cookie or Bearer header). Does not reject anonymous requests. */
export const clerk = () =>
	createMiddleware<AppEnv>((c, next) =>
		clerkMiddleware({
			secretKey: c.env.CLERK_SECRET_KEY,
			publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
			jwtKey: c.env.CLERK_JWT_KEY,
			authorizedParties: c.env.AUTHORIZED_PARTIES?.split(",").map((s) => s.trim()),
		})(c, next),
	);

/** `users.last_active_at` is rewritten at most this often per user, not on every request. */
export const LAST_ACTIVE_RESOLUTION_MS = 5 * 60_000;

const toRole = (value: unknown): Role => (ROLES.includes(value as Role) ? (value as Role) : "viewer");

/**
 * Custom session-token claims, configured in Clerk Dashboard → Sessions → Customize session token:
 *   { "email": "{{user.primary_email_address}}", "name": "{{user.full_name}}",
 *     "role": "{{user.public_metadata.role}}" }
 * Reading them from the token avoids a Clerk API call per request.
 */
interface SessionClaims {
	email?: string;
	name?: string;
	role?: string;
}

/**
 * Rejects anonymous requests with 401, then lazily upserts the `users` row.
 * Writes only when the row is missing or its email/name/role changed in Clerk.
 */
export const requireUser = () =>
	createMiddleware<AppEnv>(async (c, next) => {
		const auth = getAuth(c);
		if (!auth.userId) throw new HTTPException(401, { message: "Not signed in" });

		const claims = (auth.sessionClaims ?? {}) as SessionClaims;
		let profile: Omit<Me, "id"> | null = claims.email
			? { email: claims.email, name: claims.name || null, role: toRole(claims.role) }
			: null;

		const db = c.get("db");
		const existing = await db.query.users.findFirst({ where: eq(users.id, auth.userId) });
		// Clerk ends a removed user's sessions, but a token already issued stays valid for up to a minute.
		if (existing?.accessRevokedAt) throw new HTTPException(403, { message: "Your access has been removed" });

		// First request from this user: the session token may not be customised yet, and a new viewer's
		// projects (copied from their invitation) only live in Clerk's publicMetadata. One Clerk call, once.
		let invitedProjectIds: string[] = [];
		if (!existing && (!profile || profile.role === "viewer")) {
			const u = await c.get("clerk").users.getUser(auth.userId);
			const email = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? "";
			profile ??= {
				email,
				name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
				role: toRole(u.publicMetadata.role),
			};
			const ids = u.publicMetadata.projectIds;
			if (Array.isArray(ids)) invitedProjectIds = ids.filter((x): x is string => typeof x === "string");
		}

		let me: Me;
		if (!profile) {
			me = existing as Me;
		} else if (
			existing?.email === profile.email &&
			existing.name === profile.name &&
			existing.role === profile.role
		) {
			me = existing;
		} else {
			const now = Date.now();
			await db
				.insert(users)
				.values({ id: auth.userId, ...profile, createdAt: now, updatedAt: now })
				.onConflictDoUpdate({ target: users.id, set: { ...profile, updatedAt: now } });
			me = { id: auth.userId, ...profile };
			if (!existing && me.role === "viewer" && invitedProjectIds.length > 0) {
				// Only projects that still exist (one may have been deleted since the invitation).
				await db.run(sql`
					insert or ignore into ${projectAccess} (project_id, user_id)
					select id, ${me.id} from ${projects} where id in ${invitedProjectIds}`);
			}
		}

		const now = Date.now();
		if (!existing?.lastActiveAt || now - existing.lastActiveAt > LAST_ACTIVE_RESOLUTION_MS) {
			await db.update(users).set({ lastActiveAt: now }).where(eq(users.id, me.id));
		}

		c.set("user", { id: me.id, email: me.email, name: me.name, role: me.role });
		await next();
	});

/** Use on every write route. Must run after `requireUser()`. */
export const requireRole = (role: Role) =>
	createMiddleware<AppEnv>(async (c, next) => {
		if (c.get("user").role !== role) {
			throw new HTTPException(403, { message: `Requires ${role} role` });
		}
		await next();
	});
