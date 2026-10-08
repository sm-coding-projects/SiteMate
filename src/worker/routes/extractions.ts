import { and, asc, desc, eq, inArray, like, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { ulid } from "ulid";
import { z } from "zod";
import {
	documentExtractions,
	files,
	itemFiles,
	projectItems,
	projectStages,
	projects,
	quotes,
	suppliers,
	users,
} from "../../db/schema";
import type {
	ExtractionDetail,
	ExtractionFields,
	ExtractionSummary,
	JobMessage,
	MoneyTotals,
	ProjectQuotes,
	QuoteEntry,
	QuoteStatus,
} from "../../shared/api-types";
import { extractionConfirm, extractionListQuery, idParam, quoteStatusUpdate } from "../../shared/schemas";
import { matchSupplier, normalizeAbn, validateQuote } from "../../shared/validators";
import { loadSuppliers } from "../extract";
import { logActivity, touchProject } from "../lib/activity";
import { runBatch, type Statement } from "../lib/batch";
import { decodeCursor, page } from "../lib/cursor";
import { badRequest, conflict, notFound, zv } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";
import { assertProject } from "./projects";

type Db = AppEnv["Variables"]["db"];
export type ExtractionConfirmBody = z.output<typeof extractionConfirm>;

const OPEN = ["queued", "processing", "needs_review", "failed"] as const;
const FILE_CATEGORY_FOR: Record<string, "quote" | "invoice" | "certificate" | "plan" | "document"> = {
	quote: "quote",
	invoice: "invoice",
	certificate: "certificate",
	plan: "plan",
	contract: "document",
	other: "document",
};

async function loadExtraction(db: Db, id: string) {
	const row = await db
		.select({ ex: documentExtractions, file: files, projectName: projects.name, reviewerName: users.name })
		.from(documentExtractions)
		.innerJoin(files, eq(documentExtractions.fileId, files.id))
		.innerJoin(projects, eq(files.projectId, projects.id))
		.leftJoin(users, eq(documentExtractions.reviewedBy, users.id))
		.where(eq(documentExtractions.id, id))
		.get();
	// A deleted document leaves the review queue for good (the row is kept for history).
	if (!row || row.file.deletedAt) throw notFound("Extraction not found");
	return row;
}

const summary = (r: Awaited<ReturnType<typeof loadExtraction>>): ExtractionSummary => ({
	id: r.ex.id,
	status: r.ex.status,
	detectedType: (r.ex.detectedType as ExtractionSummary["detectedType"]) ?? null,
	confidence: r.ex.confidence,
	provider: r.ex.provider,
	model: r.ex.model,
	error: r.ex.error,
	createdAt: r.ex.createdAt,
	updatedAt: r.ex.updatedAt,
	file: { id: r.file.id, filename: r.file.filename, mimeType: r.file.mimeType, category: r.file.category },
	project: { id: r.file.projectId, name: r.projectName },
});

export const extractionRoutes = new Hono<AppEnv>()
	.get("/", zv("query", extractionListQuery), async (c) => {
		const db = c.get("db");
		const { status, projectId, cursor, limit } = c.req.valid("query");
		const where: SQL[] = [
			status === "open"
				? inArray(documentExtractions.status, [...OPEN])
				: eq(documentExtractions.status, status),
		];
		if (projectId) where.push(eq(files.projectId, projectId));
		const after = decodeCursor(cursor);
		if (after) {
			where.push(
				sql`(${documentExtractions.createdAt} < ${after.sort} or (${documentExtractions.createdAt} = ${after.sort} and ${documentExtractions.id} < ${after.id}))`,
			);
		}
		const rows = await db
			.select({ ex: documentExtractions, file: files, projectName: projects.name, reviewerName: users.name })
			.from(documentExtractions)
			.innerJoin(files, eq(documentExtractions.fileId, files.id))
			.innerJoin(projects, eq(files.projectId, projects.id))
			.leftJoin(users, eq(documentExtractions.reviewedBy, users.id))
			.where(and(...where, sql`${files.deletedAt} is null`))
			.orderBy(desc(documentExtractions.createdAt), desc(documentExtractions.id))
			.limit(limit + 1);
		const { items, nextCursor } = page(rows, limit, (r) => [r.ex.createdAt, r.ex.id]);
		return c.json({ items: items.map(summary), nextCursor });
	})

	.get("/:id", zv("param", idParam), async (c) => {
		const db = c.get("db");
		const { id } = c.req.valid("param");
		const r = await loadExtraction(db, id);
		const [stageRows, itemRows, quote] = await Promise.all([
			db
				.select({ id: projectStages.id, name: projectStages.name, status: projectStages.status })
				.from(projectStages)
				.where(eq(projectStages.projectId, r.file.projectId))
				.orderBy(asc(projectStages.position)),
			db
				.select({ id: projectItems.id, title: projectItems.title, stageId: projectItems.projectStageId })
				.from(projectItems)
				.innerJoin(projectStages, eq(projectItems.projectStageId, projectStages.id))
				.where(eq(projectStages.projectId, r.file.projectId))
				.orderBy(asc(projectItems.position)),
			db.select({ id: quotes.id }).from(quotes).where(eq(quotes.extractionId, id)).get(),
		]);
		const stages = stageRows.map((s) => ({
			...s,
			items: itemRows.filter((i) => i.stageId === s.id).map(({ id, title }) => ({ id, title })),
		}));
		const detail: ExtractionDetail = {
			...summary(r),
			fields: (r.ex.fields as unknown as ExtractionFields) ?? null,
			validation: r.ex.validation ?? null,
			reviewedBy: r.ex.reviewedBy ? { id: r.ex.reviewedBy, name: r.reviewerName } : null,
			reviewedAt: r.ex.reviewedAt,
			quoteId: quote?.id ?? null,
			stages,
		};
		return c.json(detail);
	})

	// Manual re-run after a failure (or to try a different provider). Never touches a confirmed quote.
	.post("/:id/rerun", requireRole("admin"), zv("param", idParam), async (c) => {
		const db = c.get("db");
		const { id } = c.req.valid("param");
		const r = await loadExtraction(db, id);
		if (r.ex.status === "confirmed") throw conflict("Already confirmed — edit the quote instead");
		if (r.ex.status === "processing" || r.ex.status === "queued") return c.json({ id, status: r.ex.status });
		await db
			.update(documentExtractions)
			.set({ status: "queued", error: null, attempts: 0, updatedAt: Date.now() })
			.where(eq(documentExtractions.id, id));
		await c.env.JOBS.send({ type: "extract", extractionId: id } satisfies JobMessage);
		return c.json({ id, status: "queued" }, 202);
	})

	// A human confirms (and may correct) the fields. Quotes create/update suppliers and quotes rows.
	.post(
		"/:id/confirm",
		requireRole("admin"),
		zv("param", idParam),
		zv("json", extractionConfirm),
		async (c) => {
			const db = c.get("db");
			const user = c.get("user");
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");
			return c.json(await confirmExtraction(db, user, id, body));
		},
	);

/**
 * A reviewer confirms (and may correct) the fields. Quotes create/update suppliers and quotes rows; with `itemId`
 * the file is also attached to that check. Shared by the Review screen and approved Ask AI proposals.
 */
export async function confirmExtraction(
	db: Db,
	user: { id: string },
	id: string,
	body: ExtractionConfirmBody,
) {
	const r = await loadExtraction(db, id);
	if (r.ex.status === "queued" || r.ex.status === "processing") throw conflict("Still reading this document");
	const projectId = r.file.projectId;
	if (body.stageId) {
		const s = await db.query.projectStages.findFirst({
			where: and(eq(projectStages.id, body.stageId), eq(projectStages.projectId, projectId)),
		});
		if (!s) throw badRequest("Stage is not part of this project");
	}
	const check = body.itemId
		? await db
				.select({ title: projectItems.title, stage: projectStages.name })
				.from(projectItems)
				.innerJoin(projectStages, eq(projectItems.projectStageId, projectStages.id))
				.where(and(eq(projectItems.id, body.itemId), eq(projectStages.projectId, projectId)))
				.get()
		: null;
	if (body.itemId && !check) throw badRequest("Checklist item is not part of this project");
	const alreadyAttached =
		body.itemId &&
		(await db
			.select({ fileId: itemFiles.fileId })
			.from(itemFiles)
			.where(and(eq(itemFiles.itemId, body.itemId), eq(itemFiles.fileId, r.file.id)))
			.get());

	const now = Date.now();
	const previous = (r.ex.fields as unknown as ExtractionFields | null) ?? null;
	const statements: Statement[] = [];
	let quoteId: string | null = null;

	if (body.documentType === "quote") {
		const q = body.fields;
		const allSuppliers = await loadSuppliers(db);
		const validation = validateQuote(q, { suppliers: allSuppliers });

		// Supplier: explicit choice → ABN/name match → new.
		let supplier: { id: string; name: string; abn: string | null; trade: string | null } | null =
			(body.supplierId ? allSuppliers.find((s) => s.id === body.supplierId) : null) ??
			matchSupplier({ name: q.supplierName, abn: q.abn }, allSuppliers);
		if (body.supplierId && !supplier) throw badRequest("Unknown supplier");
		const abn = normalizeAbn(q.abn) || null;
		let supplierId: string;
		if (supplier) {
			supplierId = supplier.id;
			const existing = await db.query.suppliers.findFirst({ where: eq(suppliers.id, supplierId) });
			// Fill gaps only; a reviewer's earlier corrections win.
			const patch = {
				...(!existing?.abn && abn ? { abn } : {}),
				...(!existing?.trade && q.trade ? { trade: q.trade } : {}),
				...(!existing?.email && q.supplierEmail ? { email: q.supplierEmail } : {}),
				...(!existing?.phone && q.supplierPhone ? { phone: q.supplierPhone } : {}),
			};
			if (
				Object.keys(patch).length &&
				!(patch.abn && allSuppliers.some((s) => s.id !== supplierId && normalizeAbn(s.abn) === abn))
			) {
				statements.push(
					db
						.update(suppliers)
						.set({ ...patch, updatedAt: now })
						.where(eq(suppliers.id, supplierId)),
				);
			}
		} else {
			supplierId = ulid(now);
			supplier = { id: supplierId, name: q.supplierName, abn, trade: q.trade };
			statements.push(
				db.insert(suppliers).values({
					id: supplierId,
					name: q.supplierName,
					abn,
					trade: q.trade,
					email: q.supplierEmail ?? null,
					phone: q.supplierPhone ?? null,
					createdAt: now,
					updatedAt: now,
				}),
			);
		}

		const existingQuote = await db
			.select({ id: quotes.id })
			.from(quotes)
			.where(eq(quotes.extractionId, id))
			.get();
		quoteId = existingQuote?.id ?? ulid(now);
		const values = {
			projectId,
			fileId: r.file.id,
			supplierId,
			trade: q.trade,
			quoteNumber: q.quoteNumber,
			quoteDate: q.quoteDate,
			validUntil: q.validUntil,
			amountExGstCents: q.amountExGstCents,
			gstCents: q.gstCents,
			amountIncGstCents: q.amountIncGstCents,
			extractionId: id,
			updatedAt: now,
		};
		statements.push(
			existingQuote
				? db.update(quotes).set(values).where(eq(quotes.id, quoteId))
				: db.insert(quotes).values({ id: quoteId, ...values, status: "pending", createdAt: now }),
		);
		statements.push(
			db
				.update(documentExtractions)
				.set({
					status: "confirmed",
					detectedType: "quote",
					fields: {
						...previous,
						documentType: "quote",
						quote: q,
						supplierMatch: supplier,
					} as unknown as Record<string, unknown>,
					validation: { checks: validation.checks, warnings: validation.warnings },
					reviewedBy: user.id,
					reviewedAt: now,
					error: null,
					updatedAt: now,
				})
				.where(eq(documentExtractions.id, id)),
		);
		if (!existingQuote) {
			statements.push(
				logActivity(
					db,
					{
						projectId,
						actorId: user.id,
						action: "quote.created",
						entityType: "quote",
						entityId: quoteId,
						meta: { supplier: q.supplierName, incGstCents: q.amountIncGstCents, trade: q.trade },
					},
					now,
				),
			);
		}
	} else {
		statements.push(
			db
				.update(documentExtractions)
				.set({
					status: "confirmed",
					detectedType: body.documentType,
					fields: {
						...previous,
						documentType: body.documentType,
						generic: body.fields,
					} as unknown as Record<string, unknown>,
					reviewedBy: user.id,
					reviewedAt: now,
					error: null,
					updatedAt: now,
				})
				.where(eq(documentExtractions.id, id)),
		);
	}

	statements.push(
		db
			.update(files)
			.set({
				category: FILE_CATEGORY_FOR[body.documentType] ?? "document",
				...(body.stageId !== undefined ? { projectStageId: body.stageId } : {}),
			})
			.where(eq(files.id, r.file.id)),
		touchProject(db, projectId, now),
		logActivity(
			db,
			{
				projectId,
				actorId: user.id,
				action: "extraction.confirmed",
				entityType: "extraction",
				entityId: id,
				meta: { filename: r.file.filename, documentType: body.documentType },
			},
			now,
		),
	);
	if (body.itemId && check && !alreadyAttached) {
		statements.push(
			db
				.insert(itemFiles)
				.values({ itemId: body.itemId, fileId: r.file.id, attachedBy: user.id, createdAt: now }),
			logActivity(
				db,
				{
					projectId,
					actorId: user.id,
					action: "item.files_attached",
					entityType: "item",
					entityId: body.itemId,
					meta: { item: check.title, stage: check.stage, count: 1, file: r.file.filename },
				},
				now + 1,
			),
		);
	}
	await runBatch(db, statements);
	return { id, status: "confirmed" as const, quoteId };
}

// ── Quotes ───────────────────────────────────────────────────────────────────

const emptyTotals = (): MoneyTotals => ({ exGstCents: 0, gstCents: 0, incGstCents: 0, count: 0 });
const addTo = (
	t: MoneyTotals,
	q: { amountExGstCents: number; gstCents: number; amountIncGstCents: number },
) => {
	t.exGstCents += q.amountExGstCents;
	t.gstCents += q.gstCents;
	t.incGstCents += q.amountIncGstCents;
	t.count += 1;
};

export const projectQuoteRoutes = new Hono<AppEnv>().get("/:id/quotes", zv("param", idParam), async (c) => {
	const db = c.get("db");
	const { id: projectId } = c.req.valid("param");
	await assertProject(db, projectId);
	const deciders = sql`(select name from users where users.id = ${quotes.decidedBy})`;
	const rows = await db
		.select({
			q: quotes,
			supplierName: suppliers.name,
			supplierAbn: suppliers.abn,
			decidedByName: sql<string | null>`${deciders}`,
		})
		.from(quotes)
		.leftJoin(suppliers, eq(quotes.supplierId, suppliers.id))
		.where(eq(quotes.projectId, projectId))
		.orderBy(desc(quotes.createdAt))
		.limit(500);

	// Quotes rows only exist once a reviewer confirmed the extraction, so every row counts.
	const byStatus: Record<QuoteStatus, MoneyTotals> = {
		pending: emptyTotals(),
		accepted: emptyTotals(),
		rejected: emptyTotals(),
	};
	const trades = new Map<string, MoneyTotals & { acceptedIncGstCents: number }>();
	const items: QuoteEntry[] = rows.map(({ q, supplierName, supplierAbn, decidedByName }) => {
		addTo(byStatus[q.status], q);
		if (q.status !== "rejected") {
			const key = q.trade?.trim() || "Unspecified";
			const t = trades.get(key) ?? { ...emptyTotals(), acceptedIncGstCents: 0 };
			addTo(t, q);
			if (q.status === "accepted") t.acceptedIncGstCents += q.amountIncGstCents;
			trades.set(key, t);
		}
		return {
			id: q.id,
			projectId: q.projectId,
			supplier:
				q.supplierId && supplierName ? { id: q.supplierId, name: supplierName, abn: supplierAbn } : null,
			trade: q.trade,
			quoteNumber: q.quoteNumber,
			quoteDate: q.quoteDate,
			validUntil: q.validUntil,
			amountExGstCents: q.amountExGstCents,
			gstCents: q.gstCents,
			amountIncGstCents: q.amountIncGstCents,
			status: q.status,
			decidedBy: q.decidedBy ? { id: q.decidedBy, name: decidedByName } : null,
			decidedAt: q.decidedAt,
			fileId: q.fileId,
			extractionId: q.extractionId,
		};
	});
	const result: ProjectQuotes = {
		quotes: items,
		totals: {
			byStatus,
			byTrade: [...trades.entries()]
				.map(([trade, t]) => ({ trade, ...t }))
				.sort((a, b) => b.incGstCents - a.incGstCents),
		},
	};
	return c.json(result);
});

export const quoteRoutes = new Hono<AppEnv>().patch(
	"/:id/status",
	requireRole("admin"),
	zv("param", idParam),
	zv("json", quoteStatusUpdate),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const { status } = c.req.valid("json");
		const row = await db
			.select({ q: quotes, supplierName: suppliers.name })
			.from(quotes)
			.leftJoin(suppliers, eq(quotes.supplierId, suppliers.id))
			.where(eq(quotes.id, id))
			.get();
		if (!row) throw notFound("Quote not found");
		if (row.q.status === status) return c.json({ id, status });
		const now = Date.now();
		await db.batch([
			db
				.update(quotes)
				.set({
					status,
					decidedBy: status === "pending" ? null : user.id,
					decidedAt: status === "pending" ? null : now,
					updatedAt: now,
				})
				.where(eq(quotes.id, id)),
			touchProject(db, row.q.projectId, now),
			logActivity(
				db,
				{
					projectId: row.q.projectId,
					actorId: user.id,
					action: "quote.status_changed",
					entityType: "quote",
					entityId: id,
					meta: {
						supplier: row.supplierName,
						from: row.q.status,
						to: status,
						incGstCents: row.q.amountIncGstCents,
					},
				},
				now,
			),
		]);
		return c.json({ id, status });
	},
);

export const supplierRoutes = new Hono<AppEnv>().get(
	"/",
	zv("query", z.object({ q: z.string().trim().max(80).optional() })),
	async (c) => {
		const { q } = c.req.valid("query");
		const db = c.get("db");
		const rows = await db
			.select()
			.from(suppliers)
			.where(q ? like(suppliers.name, `%${q.replace(/[%_]/g, "")}%`) : undefined)
			.orderBy(asc(suppliers.name))
			.limit(50);
		return c.json(
			rows.map(({ id, name, abn, trade, email, phone }) => ({ id, name, abn, trade, email, phone })),
		);
	},
);
