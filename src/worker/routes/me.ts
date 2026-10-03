import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { users } from "../../db/schema";
import type { MeWithPreferences } from "../../shared/api-types";
import { preferencesUpdate } from "../../shared/schemas";
import { zv } from "../lib/validate";
import type { AppEnv } from "../types";

export const meRoutes = new Hono<AppEnv>()
	.get("/", async (c) => {
		const me = c.get("user");
		const row = await c
			.get("db")
			.query.users.findFirst({ where: eq(users.id, me.id), columns: { emailNotifications: true } });
		return c.json({ ...me, emailNotifications: row?.emailNotifications ?? true } satisfies MeWithPreferences);
	})
	// Viewers may change their own preferences; this is the only write route without requireRole("admin").
	.patch("/preferences", zv("json", preferencesUpdate), async (c) => {
		const me = c.get("user");
		const { emailNotifications } = c.req.valid("json");
		await c
			.get("db")
			.update(users)
			.set({ emailNotifications, updatedAt: Date.now() })
			.where(eq(users.id, me.id));
		return c.json({ ...me, emailNotifications } satisfies MeWithPreferences);
	});
