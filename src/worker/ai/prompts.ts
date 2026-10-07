/**
 * Prompts and JSON schemas for document extraction, in one place so every provider uses the same ones
 * (docs/DESIGN.md §5). The model's output is parsed with Zod and then checked by src/shared/validators.ts.
 */
import { z } from "zod";
import { DOCUMENT_TYPES } from "../../shared/schemas";

export const SYSTEM_PROMPT = `You read construction documents for a Sydney residential builder (NSW, Australia).
Documents are supplier quotes, invoices, certificates, plans, contracts and similar.
Report only what the document says. Use null for anything that isn't stated. Never guess numbers.
Dates are YYYY-MM-DD (Australian documents write dates day-first: 03/10/2026 is 3 October 2026).
Money is in Australian dollars as plain numbers (1234.5, not "$1,234.50").`;

// ── Classification ───────────────────────────────────────────────────────────

export const classificationSchema = {
	type: "object",
	additionalProperties: false,
	required: ["documentType", "confidence", "suggestedStage"],
	properties: {
		documentType: { type: "string", enum: [...DOCUMENT_TYPES] },
		confidence: { type: "number", description: "0 to 1" },
		suggestedStage: {
			type: ["string", "null"],
			description:
				"The build stage this document most likely belongs to, copied exactly from the list given, or null",
		},
	},
} as const;

export const classificationResult = z.object({
	documentType: z.enum(DOCUMENT_TYPES).catch("other"),
	confidence: z.coerce.number().min(0).max(1).catch(0.5),
	suggestedStage: z.string().nullable().catch(null),
});

export const classifyPrompt = (text: string, stages: string[]) =>
	`Classify this document.
Types: quote (a price offered for future work, incl. estimates/tenders), invoice (a bill for work done or goods supplied),
certificate (compliance, inspection, insurance, warranty, occupation), plan (drawings, specs, engineering),
contract (building contract, variation, agreement), other.
Build stages for this project: ${stages.map((s) => `"${s}"`).join(", ") || "none"}.

<document>
${text}
</document>`;

// ── Quote extraction ─────────────────────────────────────────────────────────

const nullable = (type: string, description?: string) => ({
	type: [type, "null"],
	...(description ? { description } : {}),
});

export const quoteSchema = {
	type: "object",
	additionalProperties: false,
	required: [
		"supplierName",
		"abn",
		"trade",
		"supplierEmail",
		"supplierPhone",
		"quoteNumber",
		"quoteDate",
		"validUntil",
		"lineItems",
		"subtotalExGst",
		"gst",
		"totalIncGst",
	],
	properties: {
		supplierName: nullable("string", "The business issuing the quote (not the builder or client)"),
		abn: nullable("string", "Supplier's 11-digit ABN as printed"),
		trade: nullable("string", "Trade in a word or two, e.g. Plumbing, Electrical, Framing, Concreting"),
		supplierEmail: nullable("string"),
		supplierPhone: nullable("string"),
		quoteNumber: nullable("string"),
		quoteDate: nullable("string", "YYYY-MM-DD"),
		validUntil: nullable("string", "YYYY-MM-DD; compute from 'valid for N days' if stated"),
		lineItems: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["description", "amount"],
				properties: {
					description: { type: "string" },
					amount: { type: "number", description: "Line total in AUD" },
				},
			},
		},
		subtotalExGst: nullable("number", "Total excluding GST, AUD"),
		gst: nullable("number", "GST amount, AUD"),
		totalIncGst: nullable("number", "Total including GST, AUD"),
	},
} as const;

const cents = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);
const dateOrNull = z
	.string()
	.nullable()
	.transform((s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null))
	.catch(null);
const str = z.string().trim().max(300).nullable().catch(null);

/** Model output → the QuoteFields shape (integer cents). Tolerant: bad fields become null, not errors. */
export const quoteResult = z
	.object({
		supplierName: str,
		abn: str,
		trade: str,
		supplierEmail: str,
		supplierPhone: str,
		quoteNumber: str,
		quoteDate: dateOrNull,
		validUntil: dateOrNull,
		lineItems: z
			.array(z.object({ description: z.string().catch(""), amount: z.unknown() }))
			.catch([])
			.default([]),
		subtotalExGst: z.unknown(),
		gst: z.unknown(),
		totalIncGst: z.unknown(),
	})
	.transform((q) => {
		let ex = cents(q.subtotalExGst);
		let gst = cents(q.gst);
		let inc = cents(q.totalIncGst);
		// Fill one missing amount from the other two (common on short quotes).
		if (ex == null && gst != null && inc != null) ex = inc - gst;
		if (gst == null && ex != null && inc != null) gst = inc - ex;
		if (inc == null && ex != null && gst != null) inc = ex + gst;
		return {
			supplierName: q.supplierName,
			abn: q.abn,
			trade: q.trade,
			supplierEmail: q.supplierEmail,
			supplierPhone: q.supplierPhone,
			quoteNumber: q.quoteNumber,
			quoteDate: q.quoteDate,
			validUntil: q.validUntil,
			lineItems: q.lineItems
				.map((l) => ({ description: l.description.slice(0, 300), amountCents: cents(l.amount) }))
				.filter((l): l is { description: string; amountCents: number } => l.amountCents !== null),
			amountExGstCents: ex,
			gstCents: gst,
			amountIncGstCents: inc,
		};
	});

export const quotePrompt = (text: string) =>
	`Extract the quote details from this supplier quote.
The builder is the customer; the supplier is the business quoting. If several options are priced, use the
recommended or first complete option and list its line items.

<document>
${text}
</document>`;

// ── Other documents ──────────────────────────────────────────────────────────

export const genericSchema = {
	type: "object",
	additionalProperties: false,
	required: ["title", "issuer", "documentDate", "reference", "summary"],
	properties: {
		title: nullable("string"),
		issuer: nullable("string", "Who issued the document"),
		documentDate: nullable("string", "YYYY-MM-DD"),
		reference: nullable("string", "Certificate, invoice or drawing number"),
		summary: nullable("string", "One or two sentences on what this document is and what it confirms"),
	},
} as const;

export const genericResult = z.object({
	title: str,
	issuer: str,
	documentDate: dateOrNull,
	reference: str,
	summary: z.string().trim().max(2000).nullable().catch(null),
});

export const genericPrompt = (text: string, type: string) =>
	`Summarise this ${type} for the builder's records.

<document>
${text}
</document>`;

/** Images (scans, phone photos of paperwork) are transcribed first, then go through the same text prompts. */
export const TRANSCRIBE_PROMPT = `Transcribe all text in this image of a document, keeping tables as Markdown tables.
It may be handwritten: copy every number, price, date and phone number exactly as written, one line per line
of writing, and keep the writer's own arithmetic (e.g. "150 x 307 = 46,050"). Write [?] for anything illegible.
Output only the transcription.`;

/** Keep prompts inside the model's context and the free-tier neuron budget. */
export const MAX_DOCUMENT_CHARS = 60_000;
