import { createExecutionContext, createMessageBatch, env, getQueueResult } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ChatAction, ChatMessage, JobMessage, ProjectDetail } from "../src/shared/api-types";
import { applyChatAction } from "../src/worker/ai/chat";
import { createDb } from "../src/worker/db";
import { handleQueue } from "../src/worker/queue";
import type { Bindings } from "../src/worker/types";
import { ADMIN, api, createProject, VIEWER } from "./helpers";

let seq = 0;
async function addFile(projectId: string, category: string, filename: string) {
	const id = `01JCHAT${String(++seq).padStart(19, "0")}`;
	await env.DB.prepare(
		`INSERT INTO files (id, project_id, category, r2_key, filename, mime_type, size_bytes, upload_status, uploaded_by, uploaded_at)
		 VALUES (?, ?, ?, ?, ?, 'application/pdf', 1000, 'uploaded', ?, ?)`,
	)
		.bind(id, projectId, category, `projects/${projectId}/${id}/${filename}`, filename, ADMIN.id, Date.now())
		.run();
	return id;
}

/** Workers AI stand-in: answers chat calls with fixed text and tool calls, and records what it was sent. */
function fakeChatAi(reply: { text: string; calls: { name: string; arguments: unknown }[] }) {
	const seen: { system: string; tools: string[] }[] = [];
	return {
		seen,
		async run(
			_model: string,
			input: { messages: { role: string; content: string }[]; tools?: { function: { name: string } }[] },
		) {
			seen.push({
				system: input.messages[0]?.content ?? "",
				tools: (input.tools ?? []).map((t) => t.function.name),
			});
			return { response: reply.text, tool_calls: reply.calls };
		},
	};
}

async function ask(projectId: string, message: string, ai: ReturnType<typeof fakeChatAi>) {
	const sent = await api<{ messages: ChatMessage[] }>(`/projects/${projectId}/chat`, {
		as: ADMIN,
		method: "POST",
		body: { message },
	});
	expect(sent.status).toBe(202);
	const pending = sent.body.messages.at(-1);
	expect(pending).toMatchObject({ role: "assistant", status: "pending" });
	const batch = createMessageBatch<JobMessage>("sitemate-jobs", [
		{
			id: crypto.randomUUID(),
			timestamp: new Date(),
			attempts: 1,
			body: { type: "chat", messageId: pending?.id ?? "" },
		},
	]);
	await handleQueue(batch, { ...env, AI: ai } as unknown as Bindings);
	await getQueueResult(batch, createExecutionContext());
	const chat = await api<{ messages: ChatMessage[] }>(`/projects/${projectId}/chat`, { as: ADMIN });
	const reply = chat.body.messages.at(-1);
	if (!reply) throw new Error("no reply");
	return reply;
}

async function setup() {
	const projectId = await createProject("Chat St");
	const p = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body;
	const contract = p.stages[0]?.items[0];
	const engineering = p.stages[0]?.items.find((i) => i.title === "Engineering plans");
	if (!contract || !engineering) throw new Error("fixture");
	const plan = await addFile(projectId, "plan", "Structural drawings.pdf");
	await api(`/items/${contract.id}/files`, { as: ADMIN, method: "PUT", body: { fileIds: [plan] } });
	return { projectId, contract, engineering, plan };
}

const decide = (messageId: string, actionId: string, decision: "approve" | "dismiss", as = ADMIN) =>
	api<ChatAction & { error?: string }>(`/chat/${messageId}/actions/${actionId}`, {
		as,
		method: "POST",
		body: { decision },
	});

describe("Ask AI", () => {
	it("answers with this project only, proposes a move, and applies it once approved", async () => {
		const { projectId, contract, engineering, plan } = await setup();
		const other = await createProject("Somewhere Else St");
		await addFile(other, "plan", "Not this project.pdf");
		const ai = fakeChatAi({
			text: "The drawings belong on Engineering plans.",
			calls: [
				{
					name: "propose_move_file",
					arguments: JSON.stringify({
						fileId: plan,
						fromItemId: contract.id,
						toItemId: engineering.id,
						reason: "They're structural drawings",
					}),
				},
			],
		});
		const reply = await ask(projectId, "Is everything on the right check?", ai);
		expect(ai.seen[0]?.system).toContain("Structural drawings.pdf");
		expect(ai.seen[0]?.system).not.toContain("Not this project.pdf");
		expect(ai.seen[0]?.tools).toEqual(["propose_move_file", "propose_attach_file", "propose_confirm_review"]);

		expect(reply).toMatchObject({ status: "done", content: "The drawings belong on Engineering plans." });
		const action = reply.actions[0];
		expect(action).toMatchObject({
			type: "move_file",
			status: "proposed",
			summary:
				"Move Structural drawings.pdf from “Signed contract” (Pre-construction) to “Engineering plans” (Pre-construction)",
		});
		if (!action) throw new Error("no proposal");

		// Proposing changed nothing.
		let p = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body;
		expect(p.stages[0]?.items[0]?.attachments.map((a) => a.fileId)).toEqual([plan]);

		expect((await decide(reply.id, action.id, "approve", VIEWER)).status).toBe(403);
		const approved = await decide(reply.id, action.id, "approve");
		expect(approved.status).toBe(200);
		expect(approved.body).toMatchObject({ status: "applied", decidedBy: { id: ADMIN.id } });
		p = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body;
		const onCheck = (title: string) =>
			p.stages[0]?.items.find((i) => i.title === title)?.attachments.map((a) => a.fileId);
		expect(onCheck("Signed contract")).toEqual([]);
		expect(onCheck("Engineering plans")).toEqual([plan]);

		expect((await decide(reply.id, action.id, "approve")).status).toBe(409);
	});

	it("refuses anything outside its three proposals, including deletes", async () => {
		const { projectId, contract, plan } = await setup();
		const ai = fakeChatAi({
			text: "Done.",
			calls: [
				{ name: "delete_file", arguments: { fileId: plan } },
				{ name: "propose_detach_file", arguments: { fileId: plan, itemId: contract.id } },
				{
					name: "propose_attach_file",
					arguments: { fileId: "01JNOTAREALFILE00000000000", itemId: contract.id },
				},
				{ name: "propose_attach_file", arguments: { fileId: plan, itemId: contract.id } }, // already there
			],
		});
		const reply = await ask(projectId, "Delete the drawings", ai);
		expect(reply.actions).toEqual([]);
		expect(reply.content).toContain("I left out 4 suggestions");
		// The file is untouched and still on its check.
		const p = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body;
		expect(p.stages[0]?.items[0]?.attachments.map((a) => a.fileId)).toEqual([plan]);
		const row = await env.DB.prepare("SELECT deleted_at FROM files WHERE id = ?").bind(plan).first();
		expect(row).toEqual({ deleted_at: null });

		// Even a hand-made "delete" proposal can't be applied.
		await expect(
			applyChatAction(createDb(env.DB), ADMIN, projectId, {
				id: "x",
				type: "delete_file" as never,
				summary: "",
				reason: null,
				params: { fileId: plan },
				status: "proposed",
			}),
		).rejects.toThrow("The assistant can't do that");
	});

	it("dismisses proposals, clears the chat without touching files, and is admin-only", async () => {
		const { projectId, engineering, plan } = await setup();
		const ai = fakeChatAi({
			text: "",
			calls: [
				{ name: "propose_attach_file", arguments: { fileId: plan, itemId: engineering.id, reason: "Plans" } },
			],
		});
		const reply = await ask(projectId, "Where should the drawings go?", ai);
		const action = reply.actions[0];
		if (!action) throw new Error("no proposal");
		expect((await decide(reply.id, action.id, "dismiss")).body.status).toBe("dismissed");

		expect((await api(`/projects/${projectId}/chat`, { as: VIEWER })).status).toBe(403);
		expect(
			(await api(`/projects/${projectId}/chat`, { as: VIEWER, method: "POST", body: { message: "hi" } }))
				.status,
		).toBe(403);

		expect((await api(`/projects/${projectId}/chat`, { as: ADMIN, method: "DELETE" })).status).toBe(200);
		const chat = await api<{ messages: ChatMessage[] }>(`/projects/${projectId}/chat`, { as: ADMIN });
		expect(chat.body.messages).toEqual([]);
		const files = await env.DB.prepare(
			"SELECT count(*) n FROM files WHERE project_id = ? AND deleted_at IS NULL",
		)
			.bind(projectId)
			.first<{ n: number }>();
		expect(files?.n).toBe(1);
	});

	it("one question at a time; a failed answer is reported and the next question works", async () => {
		const { projectId } = await setup();
		const first = await api(`/projects/${projectId}/chat`, {
			as: ADMIN,
			method: "POST",
			body: { message: "a" },
		});
		expect(first.status).toBe(202);
		const second = await api(`/projects/${projectId}/chat`, {
			as: ADMIN,
			method: "POST",
			body: { message: "b" },
		});
		expect(second.status).toBe(409);

		const broken = {
			async run() {
				throw new Error("model offline");
			},
		};
		const pending = (
			await api<{ messages: ChatMessage[] }>(`/projects/${projectId}/chat`, { as: ADMIN })
		).body.messages.at(-1);
		const batch = createMessageBatch<JobMessage>("sitemate-jobs", [
			{
				id: crypto.randomUUID(),
				timestamp: new Date(),
				attempts: 1,
				body: { type: "chat", messageId: pending?.id ?? "" },
			},
		]);
		await handleQueue(batch, { ...env, AI: broken } as unknown as Bindings);
		const after = (await api<{ messages: ChatMessage[] }>(`/projects/${projectId}/chat`, { as: ADMIN })).body
			.messages;
		expect(after.at(-1)).toMatchObject({ status: "failed", error: "model offline" });
		expect(
			(await api(`/projects/${projectId}/chat`, { as: ADMIN, method: "POST", body: { message: "c" } }))
				.status,
		).toBe(202);
	});

	it("proposes confirming a complete review and refuses one with missing details", async () => {
		const { projectId, engineering } = await setup();
		const p = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body;
		const slab = p.stages.find((st) => st.name === "Base / Slab");
		const pour = slab?.items[0];
		if (!slab || !pour) throw new Error("fixture");
		const quote = (supplierName: string | null) => ({
			documentType: "quote",
			suggestedStage: "Base / Slab",
			quote: {
				supplierName,
				abn: null,
				trade: "Concreting",
				supplierEmail: null,
				supplierPhone: null,
				quoteNumber: null,
				quoteDate: null,
				validUntil: null,
				lineItems: [],
				amountExGstCents: 5_185_000,
				gstCents: 518_500,
				amountIncGstCents: 5_703_500,
			},
		});
		const addReview = async (filename: string, fields: unknown) => {
			const fileId = await addFile(projectId, "quote", filename);
			const id = `01JEXTR${String(++seq).padStart(19, "0")}`;
			await env.DB.prepare(
				"INSERT INTO document_extractions (id, file_id, status, detected_type, fields, validation) VALUES (?, ?, 'needs_review', 'quote', ?, ?)",
			)
				.bind(id, fileId, JSON.stringify(fields), JSON.stringify({ checks: [], warnings: [] }))
				.run();
			return { id, fileId };
		};
		const good = await addReview("Anton Concrete quote.pdf", quote("Anton Concrete"));
		const bad = await addReview("Unclear quote.pdf", quote(null));

		const ai = fakeChatAi({
			text: "Anton's quote looks complete.",
			calls: [
				{
					name: "propose_confirm_review",
					arguments: {
						extractionId: good.id,
						stageId: slab.id,
						itemId: pour.id,
						reason: "All amounts present",
					},
				},
				{ name: "propose_confirm_review", arguments: { extractionId: bad.id, stageId: null, itemId: null } },
				// A check from another stage than the one named.
				{
					name: "propose_confirm_review",
					arguments: { extractionId: good.id, stageId: slab.id, itemId: engineering.id },
				},
			],
		});
		const reply = await ask(projectId, "Review the pending quotes", ai);
		expect(reply.actions).toHaveLength(1);
		expect(reply.actions[0]?.summary).toBe(
			`Confirm Anton Concrete quote.pdf as a quote from Anton Concrete ($57,035.00 inc GST), filed under Base / Slab and attached to “${pour.title}”`,
		);
		expect(reply.content).toContain("Unclear quote.pdf needs a person to fill in the supplier first");

		const action = reply.actions[0];
		if (!action) throw new Error("no proposal");
		expect((await decide(reply.id, action.id, "approve")).body.status).toBe("applied");
		const ex = await env.DB.prepare("SELECT status FROM document_extractions WHERE id = ?")
			.bind(good.id)
			.first();
		expect(ex).toEqual({ status: "confirmed" });
		const quoteRow = await env.DB.prepare("SELECT amount_inc_gst_cents a FROM quotes WHERE extraction_id = ?")
			.bind(good.id)
			.first();
		expect(quoteRow).toEqual({ a: 5_703_500 });
		const after = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body;
		const onPour = after.stages.flatMap((st) => st.items).find((i) => i.id === pour.id);
		expect(onPour?.attachments.map((a) => a.fileId)).toEqual([good.fileId]);
	});
});
