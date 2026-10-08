import { createExecutionContext, createMessageBatch, env, getQueueResult } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type {
	ExtractionDetail,
	JobMessage,
	ProjectDetail,
	ProjectQuotes,
	UploadTicket,
} from "../src/shared/api-types";
import { handleQueue } from "../src/worker/queue";
import type { Bindings } from "../src/worker/types";
import { ADMIN, api, createProject, VIEWER } from "./helpers";

const QUOTE_TEXT = `# Harbour Frames Pty Ltd
ABN 51 824 753 556 · quotes@harbourframes.example · 02 9000 0000
Quote Q-1042 · Date 20/09/2026 · Valid 90 days
| Item | Amount |
| Wall frames | $18,500.00 |
| Roof trusses | $11,500.00 |
Subtotal $30,000.00 · GST $3,000.00 · Total $33,000.00`;

/** A stand-in for the Workers AI binding: toMarkdown + a JSON-mode model keyed on the schema it's asked for. */
function fakeAi(opts: { failRun?: boolean; rejectSchema?: boolean; markdown?: string } = {}) {
	const calls: string[] = [];
	const ai = {
		calls,
		async toMarkdown(file: { name: string }) {
			calls.push("toMarkdown");
			return {
				id: "1",
				name: file.name,
				mimeType: "application/pdf",
				format: "markdown",
				tokens: 100,
				data: opts.markdown ?? QUOTE_TEXT,
			};
		},
		async run(
			_model: string,
			input: {
				response_format?: { json_schema: { properties: Record<string, unknown> } };
				messages?: { content: unknown }[];
			},
		) {
			if (opts.failRun) throw new Error("AI unavailable");
			if (Array.isArray(input.messages?.[0]?.content)) {
				calls.push("transcribe");
				return { response: QUOTE_TEXT };
			}
			const props = input.response_format?.json_schema.properties ?? {};
			if ("documentType" in props) {
				calls.push("classify");
				return {
					response: JSON.stringify({
						documentType: "quote",
						confidence: 0.93,
						suggestedStage: "frame",
						suggestedItem: "frame inspection",
					}),
				};
			}
			calls.push("extract");
			return {
				response: {
					supplierName: "Harbour Frames Pty Ltd",
					abn: "51 824 753 556",
					trade: "Framing",
					supplierEmail: "quotes@harbourframes.example",
					supplierPhone: "02 9000 0000",
					quoteNumber: "Q-1042",
					quoteDate: "2026-09-20",
					validUntil: "2026-12-19",
					lineItems: [
						{ description: "Wall frames", amount: 18500 },
						{ description: "Roof trusses", amount: 11500 },
					],
					subtotalExGst: 30000,
					gst: 2500, // wrong on purpose: validation should flag it
					totalIncGst: 33000,
				},
			};
		},
	};
	return ai;
}

/** A one-page PDF whose page is a JPEG, like a phone scanner app makes (the JPEG body is filler). */
function scannedPdf() {
	const jpeg = new Uint8Array(40 * 1024);
	jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
	jpeg.set([0xff, 0xd9], jpeg.length - 2);
	const enc = new TextEncoder();
	const head = enc.encode(
		"%PDF-1.7\n1 0 obj << /Type /Pages /Kids [2 0 R] /Count 1 >> endobj\n" +
			"2 0 obj << /Type /Page /Parent 1 0 R /Resources << /XObject << /Im0 3 0 R >> >> >> endobj\n" +
			`3 0 obj << /Type /XObject /Subtype /Image /Width 2328 /Height 3224 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
	);
	const tail = enc.encode("\nendstream\nendobj\n%%EOF\n");
	const pdf = new Uint8Array(head.length + jpeg.length + tail.length);
	pdf.set(head);
	pdf.set(jpeg, head.length);
	pdf.set(tail, head.length + jpeg.length);
	return pdf;
}

async function uploadQuote(projectId: string, pdf: Uint8Array = new TextEncoder().encode("%PDF-1.4 quote")) {
	const t = await api<UploadTicket>(`/projects/${projectId}/files`, {
		as: ADMIN,
		method: "POST",
		body: {
			filename: "Harbour Frames Q-1042.pdf",
			mimeType: "application/pdf",
			sizeBytes: pdf.length,
			category: "quote",
		},
	});
	const key = decodeURIComponent(new URL(t.body.uploadUrl).pathname.split("/").slice(2).join("/"));
	await env.FILES.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });
	const done = await api<{ extractionId: string }>(`/files/${t.body.fileId}/complete`, {
		as: ADMIN,
		method: "POST",
	});
	return done.body.extractionId;
}

async function consume(message: JobMessage, testEnv: Bindings, attempts = 1) {
	const batch = createMessageBatch<JobMessage>("sitemate-jobs", [
		{ id: crypto.randomUUID(), timestamp: new Date(), attempts, body: message },
	]);
	const ctx = createExecutionContext();
	await handleQueue(batch, testEnv);
	return getQueueResult(batch, ctx);
}

describe("AI extraction pipeline", () => {
	it("toMarkdown → classify → extract → validate → needs_review, then confirm creates supplier + quote", async () => {
		const projectId = await createProject();
		const extractionId = await uploadQuote(projectId);
		const ai = fakeAi();
		const testEnv = { ...env, AI: ai } as unknown as Bindings;
		await consume({ type: "extract", extractionId }, testEnv);
		expect(ai.calls).toEqual(["toMarkdown", "classify", "extract"]);

		const ex = await api<ExtractionDetail>(`/extractions/${extractionId}`, { as: ADMIN });
		expect(ex.body.status).toBe("needs_review");
		expect(ex.body.provider).toBe("workers-ai");
		expect(ex.body.confidence).toBe(93);
		expect(ex.body.fields?.suggestedStage).toBe("Frame");
		expect(ex.body.fields?.suggestedItem).toBe("Frame inspection");
		const frame = ex.body.stages.find((st) => st.name === "Frame");
		const check = frame?.items.find((i) => i.title === "Frame inspection");
		if (!frame || !check) throw new Error("no Frame checklist");
		expect(ex.body.fields?.quote).toMatchObject({
			amountExGstCents: 3_000_000,
			gstCents: 250_000,
			quoteNumber: "Q-1042",
		});
		const failedChecks = ex.body.validation?.checks.filter((c) => !c.ok).map((c) => c.id);
		expect(failedChecks).toEqual(expect.arrayContaining(["gst_rate", "total"]));

		// Nothing counts until confirmed.
		let quotes = await api<ProjectQuotes>(`/projects/${projectId}/quotes`, { as: ADMIN });
		expect(quotes.body.quotes).toHaveLength(0);

		// Viewer can't confirm.
		const q = ex.body.fields?.quote;
		if (!q) throw new Error("no quote");
		const fields = {
			...q,
			supplierName: q.supplierName ?? "",
			gstCents: 300_000,
			amountExGstCents: 3_000_000,
			amountIncGstCents: 3_300_000,
		};
		expect(
			(
				await api(`/extractions/${extractionId}/confirm`, {
					as: VIEWER,
					method: "POST",
					body: { documentType: "quote", fields },
				})
			).status,
		).toBe(403);

		const confirm = await api<{ quoteId: string }>(`/extractions/${extractionId}/confirm`, {
			as: ADMIN,
			method: "POST",
			body: { documentType: "quote", fields, stageId: frame.id, itemId: check.id },
		});
		expect(confirm.status).toBe(200);
		const project = await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN });
		const attached = project.body.stages.flatMap((st) => st.items).filter((i) => i.attachments.length);
		expect(attached.map((i) => [i.title, i.attachments[0]?.filename])).toEqual([
			["Frame inspection", "Harbour Frames Q-1042.pdf"],
		]);
		const supplier = await env.DB.prepare("select name, abn, trade from suppliers").first();
		expect(supplier).toMatchObject({ name: "Harbour Frames Pty Ltd", abn: "51824753556", trade: "Framing" });

		quotes = await api<ProjectQuotes>(`/projects/${projectId}/quotes`, { as: ADMIN });
		expect(quotes.body.totals.byStatus.pending).toMatchObject({
			exGstCents: 3_000_000,
			gstCents: 300_000,
			incGstCents: 3_300_000,
			count: 1,
		});
		expect(quotes.body.totals.byTrade[0]).toMatchObject({ trade: "Framing", incGstCents: 3_300_000 });

		// Accept it.
		const accept = await api(`/quotes/${confirm.body.quoteId}/status`, {
			as: ADMIN,
			method: "PATCH",
			body: { status: "accepted" },
		});
		expect(accept.status).toBe(200);
		quotes = await api<ProjectQuotes>(`/projects/${projectId}/quotes`, { as: ADMIN });
		expect(quotes.body.totals.byStatus.accepted.incGstCents).toBe(3_300_000);
		expect(quotes.body.totals.byTrade[0]?.acceptedIncGstCents).toBe(3_300_000);

		// A second quote from the same supplier (by ABN) reuses the supplier row.
		const second = await uploadQuote(projectId);
		await consume({ type: "extract", extractionId: second }, testEnv);
		const ex2 = await api<ExtractionDetail>(`/extractions/${second}`, { as: ADMIN });
		expect(ex2.body.fields?.supplierMatch?.name).toBe("Harbour Frames Pty Ltd");
		await api(`/extractions/${second}/confirm`, {
			as: ADMIN,
			method: "POST",
			body: { documentType: "quote", fields },
		});
		const n = await env.DB.prepare("select count(*) n from suppliers").first<{ n: number }>();
		expect(n?.n).toBe(1);
	});

	it("transcribes the page images of a scanned PDF whose text layer is junk", async () => {
		const projectId = await createProject();
		const extractionId = await uploadQuote(projectId, scannedPdf());
		const ai = fakeAi({ markdown: "## Contents\n### Page 1\nI V 0 --\\ ~ r i u 'o V' 0-1 ~" });
		await consume({ type: "extract", extractionId }, { ...env, AI: ai } as unknown as Bindings);
		expect(ai.calls).toEqual(["toMarkdown", "transcribe", "classify", "extract"]);
		const ex = await api<ExtractionDetail>(`/extractions/${extractionId}`, { as: ADMIN });
		expect(ex.body.status).toBe("needs_review");
		expect(ex.body.fields?.quote?.quoteNumber).toBe("Q-1042");
	});

	it("keeps the text layer of a scanned PDF that already has real text", async () => {
		const projectId = await createProject();
		const extractionId = await uploadQuote(projectId, scannedPdf());
		const ai = fakeAi({ markdown: `${QUOTE_TEXT}\n${QUOTE_TEXT}` });
		await consume({ type: "extract", extractionId }, { ...env, AI: ai } as unknown as Bindings);
		expect(ai.calls).toEqual(["toMarkdown", "classify", "extract"]);
	});

	it("falls back to JSON mode when the model rejects the schema", async () => {
		const projectId = await createProject();
		const extractionId = await uploadQuote(projectId);
		await consume({ type: "extract", extractionId }, {
			...env,
			AI: fakeAi({ rejectSchema: true }),
		} as unknown as Bindings);
		const ex = await api<ExtractionDetail>(`/extractions/${extractionId}`, { as: ADMIN });
		expect(ex.body.status).toBe("needs_review");
		expect(ex.body.fields?.quote?.quoteNumber).toBe("Q-1042");
	});

	it("retries transient failures, then marks failed; re-run queues it again", async () => {
		const projectId = await createProject();
		const extractionId = await uploadQuote(projectId);
		const testEnv = { ...env, AI: fakeAi({ failRun: true }) } as unknown as Bindings;

		const first = await consume({ type: "extract", extractionId }, testEnv, 1);
		expect(first.retryMessages).toHaveLength(1);
		let ex = await api<ExtractionDetail>(`/extractions/${extractionId}`, { as: ADMIN });
		expect(ex.body.status).toBe("queued");
		expect(ex.body.error).toMatch(/Retrying/);

		const last = await consume({ type: "extract", extractionId }, testEnv, 3);
		expect(last.explicitAcks).toHaveLength(1);
		ex = await api<ExtractionDetail>(`/extractions/${extractionId}`, { as: ADMIN });
		expect(ex.body.status).toBe("failed");
		expect(ex.body.error).toBe("AI unavailable");

		const rerun = await api(`/extractions/${extractionId}/rerun`, { as: ADMIN, method: "POST" });
		expect(rerun.status).toBe(202);
		ex = await api<ExtractionDetail>(`/extractions/${extractionId}`, { as: ADMIN });
		expect(ex.body.status).toBe("queued");
	});

	it("a deleted document leaves the review queue and can't be confirmed", async () => {
		const projectId = await createProject();
		const extractionId = await uploadQuote(projectId);
		await consume({ type: "extract", extractionId }, { ...env, AI: fakeAi() } as unknown as Bindings);
		const ex = await api<ExtractionDetail>(`/extractions/${extractionId}`, { as: ADMIN });
		expect(ex.body.status).toBe("needs_review");

		expect((await api(`/files/${ex.body.file.id}`, { as: VIEWER, method: "DELETE" })).status).toBe(403);
		expect((await api(`/files/${ex.body.file.id}`, { as: ADMIN, method: "DELETE" })).status).toBe(200);

		const list = await api<{ items: { id: string }[] }>("/extractions?status=open", { as: ADMIN });
		expect(list.body.items.map((i) => i.id)).not.toContain(extractionId);
		expect((await api(`/extractions/${extractionId}`, { as: ADMIN })).status).toBe(404);
		const q = ex.body.fields?.quote;
		if (!q) throw new Error("no quote");
		const confirm = await api(`/extractions/${extractionId}/confirm`, {
			as: ADMIN,
			method: "POST",
			body: {
				documentType: "quote",
				fields: { ...q, supplierName: q.supplierName ?? "x", gstCents: 300_000 },
			},
		});
		expect(confirm.status).toBe(404);
		const quotes = await api<ProjectQuotes>(`/projects/${projectId}/quotes`, { as: ADMIN });
		expect(quotes.body.quotes).toHaveLength(0);
	});
});
