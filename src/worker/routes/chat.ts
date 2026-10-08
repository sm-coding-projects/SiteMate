/** Ask AI: one conversation per project (admins only). The model runs in the queue consumer (ai/chat.ts). */
import { and, asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { ulid } from "ulid";
import { aiChatMessages } from "../../db/schema";
import type { ChatAction, ChatMessage, JobMessage } from "../../shared/api-types";
import { chatActionParam, chatDecision, chatSend, idParam } from "../../shared/schemas";
import { applyChatAction, authorNames } from "../ai/chat";
import { conflict, notFound, zv } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";
import { assertProject } from "./projects";

type Row = typeof aiChatMessages.$inferSelect;

const HISTORY_LIMIT = 100;
/** A reply that hasn't arrived in this long is treated as lost (queue gave up) so the chat isn't stuck. */
const PENDING_TIMEOUT_MS = 3 * 60_000;

async function toMessages(db: AppEnv["Variables"]["db"], rows: Row[]): Promise<ChatMessage[]> {
	const ids = new Set<string>();
	for (const r of rows) {
		if (r.authorId) ids.add(r.authorId);
		for (const a of r.actions ?? []) if (a.decidedBy?.id) ids.add(a.decidedBy.id);
	}
	const names = await authorNames(db, [...ids]);
	const now = Date.now();
	return rows.map((r) => {
		const stale = r.status === "pending" && now - r.createdAt > PENDING_TIMEOUT_MS;
		return {
			id: r.id,
			role: r.role,
			content: r.content,
			status: stale ? "failed" : r.status,
			error: stale ? "No answer came back. Try asking again." : r.error,
			actions: (r.actions ?? []).map((a) =>
				a.decidedBy
					? { ...a, decidedBy: { id: a.decidedBy.id, name: names.get(a.decidedBy.id) ?? null } }
					: a,
			),
			author: r.authorId ? { id: r.authorId, name: names.get(r.authorId) ?? null } : null,
			createdAt: r.createdAt,
		};
	});
}

export const projectChatRoutes = new Hono<AppEnv>()
	.get("/:id/chat", requireRole("admin"), zv("param", idParam), async (c) => {
		const db = c.get("db");
		const { id } = c.req.valid("param");
		await assertProject(db, id);
		const rows = await db
			.select()
			.from(aiChatMessages)
			.where(eq(aiChatMessages.projectId, id))
			.orderBy(desc(aiChatMessages.createdAt))
			.limit(HISTORY_LIMIT);
		return c.json({ messages: await toMessages(db, rows.reverse()) });
	})

	.post("/:id/chat", requireRole("admin"), zv("param", idParam), zv("json", chatSend), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const { message } = c.req.valid("json");
		await assertProject(db, id);
		const waiting = await db
			.select({ createdAt: aiChatMessages.createdAt })
			.from(aiChatMessages)
			.where(and(eq(aiChatMessages.projectId, id), eq(aiChatMessages.status, "pending")))
			.get();
		if (waiting && Date.now() - waiting.createdAt < PENDING_TIMEOUT_MS)
			throw conflict("Still answering your last question");
		const now = Date.now();
		const userId = ulid(now);
		const replyId = ulid(now + 1);
		await db.batch([
			db.insert(aiChatMessages).values({
				id: userId,
				projectId: id,
				role: "user",
				authorId: user.id,
				content: message,
				createdAt: now,
				updatedAt: now,
			}),
			db.insert(aiChatMessages).values({
				id: replyId,
				projectId: id,
				role: "assistant",
				status: "pending",
				createdAt: now + 1,
				updatedAt: now + 1,
			}),
		]);
		await c.env.JOBS.send({ type: "chat", messageId: replyId } satisfies JobMessage);
		const rows = await db
			.select()
			.from(aiChatMessages)
			.where(eq(aiChatMessages.projectId, id))
			.orderBy(asc(aiChatMessages.createdAt));
		return c.json({ messages: await toMessages(db, rows.slice(-HISTORY_LIMIT)) }, 202);
	})

	// Clears the conversation only. Never touches the project's files.
	.delete("/:id/chat", requireRole("admin"), zv("param", idParam), async (c) => {
		const db = c.get("db");
		const { id } = c.req.valid("param");
		await assertProject(db, id);
		await db.delete(aiChatMessages).where(eq(aiChatMessages.projectId, id));
		return c.json({ ok: true });
	});

export const chatRoutes = new Hono<AppEnv>()
	// Approve (run it as this admin) or dismiss one proposal.
	.post("/:id/actions/:actionId", zv("param", chatActionParam), zv("json", chatDecision), async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id, actionId } = c.req.valid("param");
		const { decision } = c.req.valid("json");
		const msg = await db.query.aiChatMessages.findFirst({ where: eq(aiChatMessages.id, id) });
		const action = msg?.actions?.find((a) => a.id === actionId);
		if (!msg || !action) throw notFound("Proposal not found");
		if (action.status !== "proposed") throw conflict(`Already ${action.status}`);

		let next: ChatAction;
		const decided = { decidedBy: { id: user.id, name: user.name }, decidedAt: Date.now() };
		if (decision === "dismiss") {
			next = { ...action, ...decided, status: "dismissed" };
		} else {
			try {
				await applyChatAction(db, user, msg.projectId, action);
				next = { ...action, ...decided, status: "applied", error: null };
			} catch (err) {
				next = {
					...action,
					...decided,
					status: "failed",
					error: err instanceof Error ? err.message : String(err),
				};
			}
		}
		await db
			.update(aiChatMessages)
			.set({ actions: (msg.actions ?? []).map((a) => (a.id === actionId ? next : a)), updatedAt: Date.now() })
			.where(eq(aiChatMessages.id, id));
		return c.json(next, next.status === "failed" ? 422 : 200);
	});
