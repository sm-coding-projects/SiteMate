import { clerkMiddleware, getAuth } from "@clerk/hono";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { ROLES, users } from "../../db/schema";
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

		// Session token not customised yet: fall back to the Clerk API, but only when
		// we have nothing stored for this user.
		if (!profile && !existing) {
			const u = await c.get("clerk").users.getUser(auth.userId);
			const email = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? "";
			profile = {
				email,
				name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
				role: toRole(u.publicMetadata.role),
			};
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
