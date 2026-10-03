import { createExecutionContext, createMessageBatch, env, getQueueResult } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobMessage, ProjectDetail } from "../src/shared/api-types";
import { renderEmail } from "../src/worker/email";
import { handleQueue } from "../src/worker/queue";
import type { Bindings } from "../src/worker/types";
import { ADMIN, api, createProject, VIEWER } from "./helpers";

const send = vi.fn(async (_payload: { to: string; subject: string; from: string }, _opts?: unknown) => ({
	data: { id: `re_${crypto.randomUUID()}` },
	error: null,
}));
vi.mock("resend", () => ({
	Resend: class {
		emails = { send };
	},
}));

const emailEnv = (over: Partial<Bindings> = {}) =>
	({ ...env, RESEND_API_KEY: "re_test", EMAIL_SANDBOX_TO: "owner@example.com", ...over }) as Bindings;

async function consume(message: JobMessage, e: Bindings) {
	const batch = createMessageBatch<JobMessage>("sitemate-jobs", [
		{ id: crypto.randomUUID(), timestamp: new Date(), attempts: 1, body: message },
	]);
	await handleQueue(batch, e);
	return getQueueResult(batch, createExecutionContext());
}

async function completedStage() {
	await api("/me", { as: VIEWER }); // make sure the viewer exists as a recipient
	const projectId = await createProject("7 Wattle Rd");
	const stage = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body.stages[0];
	if (!stage) throw new Error("stage");
	return { projectId, stageId: stage.id };
}

beforeEach(async () => {
	send.mockClear();
	await env.DB.prepare("delete from email_log").run();
});

describe("notification email", () => {
	it("sandbox mode redirects every email to EMAIL_SANDBOX_TO with the intended recipient in the subject", async () => {
		const { projectId, stageId } = await completedStage();
		await consume({ type: "notify", kind: "stage_completed", projectId, stageId, actorId: ADMIN.id }, emailEnv());
		expect(send).toHaveBeenCalledTimes(1); // the actor isn't emailed about their own change
		const [payload, opts] = send.mock.calls[0] ?? [];
		expect(payload?.to).toBe("owner@example.com");
		expect(payload?.subject).toBe("[to viewer@example.com] Pre-construction complete — 7 Wattle Rd");
		expect(payload?.from).toBe("SiteMate <onboarding@resend.dev>");
		expect(opts).toEqual({ idempotencyKey: `stage_completed:${stageId}:viewer@example.com` });
		const log = await env.DB.prepare("select status, intended_to, sent_to from email_log").first();
		expect(log).toEqual({ status: "sent", intended_to: "viewer@example.com", sent_to: "owner@example.com" });
	});

	it("live mode sends to the real recipient", async () => {
		const { projectId, stageId } = await completedStage();
		await consume(
			{ type: "notify", kind: "stage_completed", projectId, stageId, actorId: ADMIN.id },
			emailEnv({ EMAIL_MODE: "live" }),
		);
		expect(send.mock.calls[0]?.[0]?.to).toBe("viewer@example.com");
	});

	it("respects the per-user opt-out", async () => {
		const { projectId, stageId } = await completedStage();
		await api("/me/preferences", { as: VIEWER, method: "PATCH", body: { emailNotifications: false } });
		await consume({ type: "notify", kind: "stage_completed", projectId, stageId, actorId: ADMIN.id }, emailEnv());
		expect(send).not.toHaveBeenCalled();
		await api("/me/preferences", { as: VIEWER, method: "PATCH", body: { emailNotifications: true } });
	});

	it("stops at the daily limit and records the skip", async () => {
		const { projectId, stageId } = await completedStage();
		await consume(
			{ type: "notify", kind: "stage_completed", projectId, stageId, actorId: ADMIN.id },
			emailEnv({ EMAIL_DAILY_LIMIT: "0" }),
		);
		expect(send).not.toHaveBeenCalled();
		const log = await env.DB.prepare("select status, error from email_log").first();
		expect(log).toEqual({ status: "skipped", error: "Daily email limit (0) reached" });
	});

	it("does not send twice when the queue retries the same event", async () => {
		const { projectId, stageId } = await completedStage();
		const msg: JobMessage = { type: "notify", kind: "stage_completed", projectId, stageId, actorId: ADMIN.id };
		await consume(msg, emailEnv());
		await consume(msg, emailEnv());
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("without RESEND_API_KEY nothing is sent", async () => {
		const { projectId, stageId } = await completedStage();
		await consume(
			{ type: "notify", kind: "stage_completed", projectId, stageId, actorId: ADMIN.id },
			emailEnv({ RESEND_API_KEY: undefined }),
		);
		expect(send).not.toHaveBeenCalled();
	});

	it("completing a stage through the API queues the notification (not sent inline)", async () => {
		const { stageId } = await completedStage();
		const res = await api(`/stages/${stageId}`, { as: ADMIN, method: "PATCH", body: { status: "complete" } });
		expect(res.status).toBe(200);
		expect(send).not.toHaveBeenCalled();
	});

	it("admin test email goes through the queue", async () => {
		const res = await api<{ queued: boolean }>("/admin/test-email", { as: ADMIN, method: "POST" });
		expect(res.status).toBe(202);
		await consume({ type: "notify", kind: "test", to: ADMIN.email, requestedBy: ADMIN.id, at: Date.now() }, emailEnv());
		expect(send.mock.calls[0]?.[0]?.subject).toBe("[to admin@example.com] SiteMate test email");
	});

	it("escapes content in the HTML body", () => {
		const { html } = renderEmail(
			{ heading: "<script>x</script>", lines: ["a & b"], cta: { label: "Go", url: "https://x.test/?a=1&b=2" } },
			"footer",
		);
		expect(html).not.toContain("<script>");
		expect(html).toContain("a &amp; b");
	});
});
