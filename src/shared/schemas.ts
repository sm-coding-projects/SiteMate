/**
 * Request schemas shared by the Worker (validation) and the SPA (forms).
 * Every request body, query string and path param goes through one of these.
 */
import { z } from "zod";

export const PROJECT_STATUSES = ["active", "on_hold", "complete", "archived"] as const;
export const STAGE_STATUSES = ["not_started", "in_progress", "complete"] as const;
export const FILE_CATEGORIES = [
	"photo",
	"document",
	"quote",
	"invoice",
	"certificate",
	"plan",
	"other",
] as const;
export const DOCUMENT_CATEGORIES = FILE_CATEGORIES.filter((c) => c !== "photo");
export const QUOTE_STATUSES = ["pending", "accepted", "rejected"] as const;
export const EXTRACTION_STATUSES = ["queued", "processing", "needs_review", "confirmed", "failed"] as const;
export const DOCUMENT_TYPES = ["quote", "invoice", "certificate", "plan", "contract", "other"] as const;
export const ROLE_VALUES = ["admin", "viewer"] as const;
/** Wire formats a custom AI endpoint can speak. */
export const AI_PROTOCOLS = ["openai", "anthropic"] as const;

// ── Primitives ───────────────────────────────────────────────────────────────

/** ULIDs, plus the fixed ids used by seeded rows (e.g. `tpl_nsw_new_build`). */
export const idSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z0-9_-]+$/, "Invalid id");

export const idParam = z.object({ id: idSchema });

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
	trimmed(max)
		.transform((s) => (s === "" ? null : s))
		.nullable()
		.optional();

/** YYYY-MM-DD, a real calendar date. */
export const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
	.refine(
		(s) =>
			!Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
		{
			message: "Not a real date",
		},
	);
const optionalDate = z
	.union([isoDate, z.literal("")])
	.transform((s) => (s === "" ? null : s))
	.nullable()
	.optional();

const optionalEmail = z
	.union([z.email("Enter a valid email").max(254), z.literal("")])
	.transform((s) => (s === "" ? null : s))
	.nullable()
	.optional();

export const limitParam = z.coerce.number().int().min(1).max(100).default(20);

// ── Projects ─────────────────────────────────────────────────────────────────

export const projectListQuery = z.object({
	status: z.enum([...PROJECT_STATUSES, "all", "open"]).default("open"),
	q: trimmed(100).optional(),
	cursor: z.string().max(100).optional(),
	// Each page's ids are bound into IN (...) lists; D1 allows 100 parameters per statement.
	limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ProjectListQuery = z.infer<typeof projectListQuery>;

const projectFields = {
	name: z.string().trim().min(1, "Give the project a name").max(120),
	siteAddress: optionalText(200),
	suburb: optionalText(80),
	clientName: optionalText(120),
	clientEmail: optionalEmail,
	clientPhone: optionalText(40),
	startDate: optionalDate,
	targetCompletion: optionalDate,
};

export const projectCreate = z.object({ ...projectFields, templateId: idSchema.optional() });
export type ProjectCreate = z.input<typeof projectCreate>;

export const projectUpdate = z
	.object({ ...projectFields, status: z.enum(PROJECT_STATUSES) })
	.partial()
	.refine((o) => Object.keys(o).length > 0, "Nothing to update");
export type ProjectUpdate = z.input<typeof projectUpdate>;

// ── Stages & checklist items ─────────────────────────────────────────────────

export const stageCreate = z.object({
	name: z.string().trim().min(1, "Name the stage").max(80),
	description: optionalText(300),
});
export const stageUpdate = z
	.object({
		name: z.string().trim().min(1).max(80),
		description: optionalText(300),
		status: z.enum(STAGE_STATUSES),
	})
	.partial()
	.refine((o) => Object.keys(o).length > 0, "Nothing to update");
export type StageUpdate = z.input<typeof stageUpdate>;

/** The complete new order: every sibling id exactly once. */
export const reorderBody = z.object({ ids: z.array(idSchema).min(1).max(200) });

export const itemCreate = z.object({ title: z.string().trim().min(1, "Describe the check").max(160) });
export const itemUpdate = z
	.object({ title: z.string().trim().min(1).max(160), completed: z.boolean() })
	.partial()
	.refine((o) => Object.keys(o).length > 0, "Nothing to update");
export type ItemUpdate = z.input<typeof itemUpdate>;

// ── Notes & activity ─────────────────────────────────────────────────────────

export const noteCreate = z.object({
	body: z.string().trim().min(1, "Write something").max(5000),
	stageId: idSchema.nullable().optional(),
});
export const noteUpdate = z
	.object({ body: z.string().trim().min(1).max(5000), stageId: idSchema.nullable() })
	.partial()
	.refine((o) => Object.keys(o).length > 0, "Nothing to update");

export const pageQuery = z.object({ cursor: z.string().max(100).optional(), limit: limitParam });

// ── Files ────────────────────────────────────────────────────────────────────

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** Photos are compressed in the browser to ~400 KB; this is a hard ceiling for odd cases. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_THUMB_BYTES = 512 * 1024;

export const IMAGE_MIME_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/heic",
	"image/heif",
] as const;
export const DOCUMENT_MIME_TYPES = [
	"application/pdf",
	...IMAGE_MIME_TYPES,
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"text/csv",
] as const;

export const fileListQuery = z.object({
	kind: z.enum(["photos", "documents"]).default("photos"),
	category: z.enum(FILE_CATEGORIES).optional(),
	stageId: idSchema.optional(),
	cursor: z.string().max(100).optional(),
	limit: limitParam,
});

export const fileCreate = z
	.object({
		filename: z
			.string()
			.trim()
			.min(1)
			.max(180)
			.refine((s) => !/[\\/\0]/.test(s), "Invalid file name"),
		mimeType: z.string().min(1).max(120),
		sizeBytes: z.number().int().positive(),
		category: z.enum(FILE_CATEGORIES),
		stageId: idSchema.nullable().optional(),
		caption: optionalText(300),
		/** Browser made a WebP thumbnail and will PUT it too. */
		withThumb: z.boolean().default(false),
		thumbBytes: z.number().int().positive().max(MAX_THUMB_BYTES).optional(),
		/** WebP where the browser can encode it (Safari < 17 can't), else JPEG. */
		thumbMimeType: z.enum(["image/webp", "image/jpeg"]).default("image/webp"),
	})
	.superRefine((f, ctx) => {
		const isPhoto = f.category === "photo";
		const allowed: readonly string[] = isPhoto ? IMAGE_MIME_TYPES : DOCUMENT_MIME_TYPES;
		if (!allowed.includes(f.mimeType)) {
			ctx.addIssue({
				code: "custom",
				path: ["mimeType"],
				message: isPhoto ? "Photos must be images" : "Upload a PDF, image or Office document",
			});
		}
		const max = isPhoto ? MAX_PHOTO_BYTES : MAX_DOCUMENT_BYTES;
		if (f.sizeBytes > max) {
			ctx.addIssue({
				code: "custom",
				path: ["sizeBytes"],
				message: `Files can be up to ${Math.round(max / 1024 / 1024)} MB`,
			});
		}
		if (f.withThumb && !f.thumbBytes) {
			ctx.addIssue({ code: "custom", path: ["thumbBytes"], message: "Thumbnail size required" });
		}
	});
export type FileCreate = z.input<typeof fileCreate>;

/** Re-issue upload URLs for a pending file (the 5-minute ticket expired on a slow connection). */
export const uploadUrlsBody = z.object({
	thumbBytes: z.number().int().positive().max(MAX_THUMB_BYTES).optional(),
	thumbMimeType: z.enum(["image/webp", "image/jpeg"]).default("image/webp"),
});

export const fileUrlQuery = z.object({ download: z.enum(["1", "0"]).optional() });

export const fileUpdate = z
	.object({
		caption: optionalText(300),
		stageId: idSchema.nullable(),
		category: z.enum(FILE_CATEGORIES),
	})
	.partial()
	.refine((o) => Object.keys(o).length > 0, "Nothing to update");

// ── Extraction & quotes ──────────────────────────────────────────────────────

const cents = z.number().int().min(0).max(100_000_000_00);

export const lineItem = z.object({
	description: z.string().trim().max(300),
	amountCents: z.number().int().min(-100_000_000_00).max(100_000_000_00),
});
export type LineItem = z.infer<typeof lineItem>;

/** The quote fields a reviewer sees and edits. Money is integer cents. */
export const quoteFields = z.object({
	supplierName: z.string().trim().max(160).nullable(),
	abn: z.string().trim().max(20).nullable(),
	trade: z.string().trim().max(80).nullable(),
	supplierEmail: z.string().trim().max(254).nullable().optional(),
	supplierPhone: z.string().trim().max(40).nullable().optional(),
	quoteNumber: z.string().trim().max(80).nullable(),
	quoteDate: isoDate.nullable(),
	validUntil: isoDate.nullable(),
	lineItems: z.array(lineItem).max(200).default([]),
	amountExGstCents: cents.nullable(),
	gstCents: cents.nullable(),
	amountIncGstCents: cents.nullable(),
});
export type QuoteFields = z.infer<typeof quoteFields>;

/** Non-quote documents: a light summary the reviewer can correct. */
export const genericFields = z.object({
	title: z.string().trim().max(200).nullable(),
	issuer: z.string().trim().max(160).nullable(),
	documentDate: isoDate.nullable(),
	reference: z.string().trim().max(120).nullable(),
	summary: z.string().trim().max(2000).nullable(),
});
export type GenericFields = z.infer<typeof genericFields>;

export const extractionListQuery = z.object({
	status: z.enum([...EXTRACTION_STATUSES, "open"]).default("open"),
	projectId: idSchema.optional(),
	cursor: z.string().max(100).optional(),
	limit: limitParam,
});

export const extractionConfirm = z.discriminatedUnion("documentType", [
	z.object({
		documentType: z.literal("quote"),
		fields: quoteFields.extend({
			supplierName: z.string().trim().min(1, "Supplier is required").max(160),
			amountExGstCents: cents,
			gstCents: cents,
			amountIncGstCents: cents,
		}),
		/** Use this existing supplier instead of matching/creating one. */
		supplierId: idSchema.nullable().optional(),
		stageId: idSchema.nullable().optional(),
	}),
	z.object({
		documentType: z.enum(["invoice", "certificate", "plan", "contract", "other"]),
		fields: genericFields,
		stageId: idSchema.nullable().optional(),
	}),
]);
export type ExtractionConfirm = z.input<typeof extractionConfirm>;

export const quoteStatusUpdate = z.object({ status: z.enum(QUOTE_STATUSES) });

// ── Team & preferences ───────────────────────────────────────────────────────

export const inviteCreate = z.object({
	email: z.email("Enter a valid email").max(254),
	role: z.enum(ROLE_VALUES),
});
export const roleUpdate = z.object({ role: z.enum(ROLE_VALUES) });
export const preferencesUpdate = z.object({ emailNotifications: z.boolean() });

// ── AI model (admin) ─────────────────────────────────────────────────────────

const aiBaseUrl = z
	.url({ protocol: /^https$/, message: "Enter an https:// URL" })
	.max(300)
	.transform((u) => u.replace(/\/+$/, ""));
const aiApiKey = z.string().trim().min(8, "Paste the full API key").max(500);

/** Fetch the endpoint's model list. Without `apiKey`, the saved key is used. */
export const aiModelsQuery = z.object({
	protocol: z.enum(AI_PROTOCOLS),
	baseUrl: aiBaseUrl,
	apiKey: aiApiKey.optional(),
});

/** Save the workspace model. Without `apiKey`, the saved key is kept. */
export const aiSettingsUpdate = aiModelsQuery.extend({
	model: z.string().trim().min(1, "Choose a model").max(200),
});
