/**
 * Document extraction, run by the Queue consumer (never in a request handler: Workers free plan allows
 * 10 ms CPU per request). R2 → text → classify → extract → validate → `needs_review`.
 */
import { asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { activity, documentExtractions, files, projectStages, suppliers } from "../db/schema";
import type { ExtractionFields, JobMessage } from "../shared/api-types";
import type { QuoteFields } from "../shared/schemas";
import { validateQuote } from "../shared/validators";
import {
	classificationResult,
	classificationSchema,
	classifyPrompt,
	genericPrompt,
	genericResult,
	genericSchema,
	quotePrompt,
	quoteResult,
	quoteSchema,
} from "./ai/prompts";
import { resolveProvider } from "./ai/providers";
import { createDb, type Db } from "./db";
import type { Bindings } from "./types";

export const MAX_EXTRACTION_ATTEMPTS = 3;

/** Thrown for problems a retry won't fix (missing file, unreadable format). */
export class PermanentError extends Error {}

export async function loadSuppliers(db: Db) {
	return db
		.select({ id: suppliers.id, name: suppliers.name, abn: suppliers.abn, trade: suppliers.trade })
		.from(suppliers)
		.orderBy(asc(suppliers.name))
		.limit(500);
}

export async function runExtraction(env: Bindings, extractionId: string, attempt: number) {
	const db = createDb(env.DB);
	const row = await db
		.select({ ex: documentExtractions, file: files })
		.from(documentExtractions)
		.innerJoin(files, eq(documentExtractions.fileId, files.id))
		.where(eq(documentExtractions.id, extractionId))
		.get();
	if (!row) throw new PermanentError("Extraction not found");
	if (row.ex.status === "confirmed") return; // a reviewer already confirmed it; never overwrite
	const { file } = row;

	const provider = await resolveProvider(env, db);
	await db
		.update(documentExtractions)
		.set({
			status: "processing",
			attempts: attempt,
			provider: provider.name,
			model: provider.model,
			updatedAt: Date.now(),
		})
		.where(eq(documentExtractions.id, extractionId));

	const object = await env.FILES.get(file.r2Key);
	if (!object) throw new PermanentError("The file is missing from storage");
	const bytes = await object.arrayBuffer();

	const stages = await db
		.select({ name: projectStages.name })
		.from(projectStages)
		.where(eq(projectStages.projectId, file.projectId))
		.orderBy(asc(projectStages.position));
	const stageNames = stages.map((s) => s.name);

	// 1. Text (or native PDF for providers that read PDFs).
	const input = await provider.prepare({ name: file.filename, mimeType: file.mimeType, bytes });
	if (input.kind === "text" && input.text.trim().length < 20) {
		throw new PermanentError("No readable text found in the document");
	}

	// 2. Classify.
	const cls = classificationResult.parse(
		await provider.json(input, (t) => classifyPrompt(t, stageNames), "classification", classificationSchema),
	);
	// A file uploaded as a quote is extracted as one even if the model is unsure.
	const documentType = file.category === "quote" && cls.documentType === "other" ? "quote" : cls.documentType;
	const suggestedStage =
		stageNames.find((s) => s.toLowerCase() === cls.suggestedStage?.toLowerCase()) ?? null;

	// 3. Extract with a JSON schema, 4. validate in code.
	const fields: ExtractionFields = { documentType, suggestedStage };
	let validation = { checks: [] as { id: string; ok: boolean; message: string }[], warnings: [] as string[] };
	if (documentType === "quote") {
		const quote: QuoteFields = quoteResult.parse(
			await provider.json(input, quotePrompt, "quote", quoteSchema),
		);
		const result = validateQuote(quote, { suppliers: await loadSuppliers(db) });
		fields.quote = quote;
		fields.supplierMatch = result.supplierMatch;
		validation = { checks: result.checks, warnings: result.warnings };
	} else {
		fields.generic = genericResult.parse(
			await provider.json(input, (t) => genericPrompt(t, documentType), "summary", genericSchema),
		);
	}
	if (input.kind === "text" && input.truncated) {
		validation.warnings.unshift(
			"The document was long; only the first part was read. Check the totals carefully.",
		);
	}

	// 5. Save for review.
	const now = Date.now();
	await db.batch([
		db
			.update(documentExtractions)
			.set({
				status: "needs_review",
				detectedType: documentType,
				fields: fields as unknown as Record<string, unknown>,
				validation,
				confidence: Math.round(cls.confidence * 100),
				error: null,
				updatedAt: now,
			})
			.where(eq(documentExtractions.id, extractionId)),
		db.insert(activity).values({
			id: ulid(now),
			projectId: file.projectId,
			actorId: file.uploadedBy,
			action: "extraction.ready",
			entityType: "extraction",
			entityId: extractionId,
			meta: { filename: file.filename, documentType, warnings: validation.warnings.length },
			createdAt: now,
		}),
	]);
	await env.JOBS.send({ type: "notify", kind: "extraction_ready", extractionId } satisfies JobMessage);
}

export async function markExtractionFailed(env: Bindings, extractionId: string, error: string) {
	const db = createDb(env.DB);
	const row = await db
		.select({ projectId: files.projectId, filename: files.filename, uploadedBy: files.uploadedBy })
		.from(documentExtractions)
		.innerJoin(files, eq(documentExtractions.fileId, files.id))
		.where(eq(documentExtractions.id, extractionId))
		.get();
	const now = Date.now();
	await db
		.update(documentExtractions)
		.set({ status: "failed", error: error.slice(0, 500), updatedAt: now })
		.where(eq(documentExtractions.id, extractionId));
	if (row) {
		await db.insert(activity).values({
			id: ulid(now),
			projectId: row.projectId,
			actorId: row.uploadedBy,
			action: "extraction.failed",
			entityType: "extraction",
			entityId: extractionId,
			meta: { filename: row.filename, error: error.slice(0, 200) },
			createdAt: now,
		});
	}
}

/** Between retries the row goes back to `queued` with the last error, so the UI can say what's happening. */
export async function markExtractionRetrying(env: Bindings, extractionId: string, error: string) {
	await createDb(env.DB)
		.update(documentExtractions)
		.set({ status: "queued", error: `Retrying: ${error.slice(0, 300)}`, updatedAt: Date.now() })
		.where(eq(documentExtractions.id, extractionId));
}
