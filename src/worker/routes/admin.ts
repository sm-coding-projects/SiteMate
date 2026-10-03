import { Hono } from "hono";
import { ulid } from "ulid";
import { activity } from "../../db/schema";
import type { JobMessage } from "../../shared/api-types";
import { requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";

/** Admin-only operational endpoints. */
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
	});
