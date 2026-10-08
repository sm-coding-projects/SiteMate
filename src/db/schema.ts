/**
 * D1 schema (see docs/DESIGN.md §3).
 *
 * Conventions:
 * - ids are text ULIDs (except `users.id`, which is the Clerk user id)
 * - timestamps are unix-ms integers
 * - money is integer cents (AUD)
 * - user content is soft-deleted via `deleted_at`
 *
 * Tables are grouped by build step.
 */
import { relations, sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
	AI_PROTOCOLS,
	AU_STATES,
	CHAT_ROLES,
	CHAT_STATUSES,
	EXTRACTION_STATUSES,
	FILE_CATEGORIES,
	PROJECT_STATUSES,
	QUOTE_STATUSES,
	STAGE_STATUSES,
} from "../shared/schemas";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

const createdAt = () => integer("created_at").notNull().default(now);
const updatedAt = () => integer("updated_at").notNull().default(now);

export const ROLES = ["admin", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const SOURCES = ["template", "custom"] as const;
export const UPLOAD_STATUSES = ["pending", "uploaded"] as const;

// ── Step 1: identity & audit ────────────────────────────────────────────────

/** Upserted lazily from Clerk on authenticated requests. */
export const users = sqliteTable("users", {
	id: text("id").primaryKey(), // Clerk user id
	email: text("email").notNull(),
	name: text("name"),
	role: text("role", { enum: ROLES }).notNull().default("viewer"),
	/** Opt-out for notification emails (Account page). */
	emailNotifications: integer("email_notifications", { mode: "boolean" }).notNull().default(true),
	/** Set when an admin removes their access (the Clerk user is banned). Blocks the API and notifications. */
	accessRevokedAt: integer("access_revoked_at"),
	/** Last authenticated API request, at most LAST_ACTIVE_RESOLUTION_MS stale. Clerk's lastSignInAt misses
	 * people who come back on a session that's still valid. */
	lastActiveAt: integer("last_active_at"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

/** Append-only audit log. `project_id` is null for workspace-level events (team, system). */
export const activity = sqliteTable(
	"activity",
	{
		id: text("id").primaryKey(), // ULID
		projectId: text("project_id"),
		actorId: text("actor_id")
			.notNull()
			.references(() => users.id),
		action: text("action").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: text("entity_id"),
		meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
		createdAt: createdAt(),
	},
	(t) => [
		index("activity_project_created_idx").on(t.projectId, t.createdAt),
		index("activity_actor_created_idx").on(t.actorId, t.createdAt),
		index("activity_created_idx").on(t.createdAt),
	],
);

// ── Step 2: workflow templates & projects ───────────────────────────────────

export const workflowTemplates = sqliteTable("workflow_templates", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
	createdAt: createdAt(),
});

export const templateStages = sqliteTable(
	"template_stages",
	{
		id: text("id").primaryKey(),
		templateId: text("template_id")
			.notNull()
			.references(() => workflowTemplates.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		position: integer("position").notNull(),
	},
	(t) => [index("template_stages_template_pos_idx").on(t.templateId, t.position)],
);

export const templateItems = sqliteTable(
	"template_items",
	{
		id: text("id").primaryKey(),
		templateStageId: text("template_stage_id")
			.notNull()
			.references(() => templateStages.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		position: integer("position").notNull(),
	},
	(t) => [index("template_items_stage_pos_idx").on(t.templateStageId, t.position)],
);

export const projects = sqliteTable(
	"projects",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		siteAddress: text("site_address"),
		suburb: text("suburb"),
		state: text("state", { enum: AU_STATES }),
		postcode: text("postcode"),
		clientName: text("client_name"),
		clientEmail: text("client_email"),
		clientPhone: text("client_phone"),
		status: text("status", { enum: PROJECT_STATUSES }).notNull().default("active"),
		startDate: text("start_date"), // YYYY-MM-DD
		targetCompletion: text("target_completion"), // YYYY-MM-DD
		templateId: text("template_id").references(() => workflowTemplates.id),
		createdBy: text("created_by")
			.notNull()
			.references(() => users.id),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("projects_status_updated_idx").on(t.status, t.updatedAt),
		index("projects_updated_idx").on(t.updatedAt),
	],
);

export const projectStages = sqliteTable(
	"project_stages",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		position: integer("position").notNull(),
		status: text("status", { enum: STAGE_STATUSES }).notNull().default("not_started"),
		source: text("source", { enum: SOURCES }).notNull().default("custom"),
		startedAt: integer("started_at"),
		completedAt: integer("completed_at"),
	},
	(t) => [index("project_stages_project_pos_idx").on(t.projectId, t.position)],
);

export const projectItems = sqliteTable(
	"project_items",
	{
		id: text("id").primaryKey(),
		projectStageId: text("project_stage_id")
			.notNull()
			.references(() => projectStages.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		position: integer("position").notNull(),
		source: text("source", { enum: SOURCES }).notNull().default("custom"),
		completedAt: integer("completed_at"),
		completedBy: text("completed_by").references(() => users.id),
	},
	(t) => [index("project_items_stage_pos_idx").on(t.projectStageId, t.position)],
);

// ── Step 3: notes ───────────────────────────────────────────────────────────

export const notes = sqliteTable(
	"notes",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		projectStageId: text("project_stage_id").references(() => projectStages.id, { onDelete: "set null" }),
		body: text("body").notNull(),
		authorId: text("author_id")
			.notNull()
			.references(() => users.id),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: integer("deleted_at"),
	},
	(t) => [index("notes_project_created_idx").on(t.projectId, t.createdAt)],
);

// ── Step 4: files ───────────────────────────────────────────────────────────

/** Shared across projects; matched fuzzily by name/ABN when confirming an extraction. */
export const suppliers = sqliteTable(
	"suppliers",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		abn: text("abn"), // 11 digits, no spaces
		trade: text("trade"),
		email: text("email"),
		phone: text("phone"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [uniqueIndex("suppliers_abn_uq").on(t.abn), index("suppliers_name_idx").on(t.name)],
);

export const files = sqliteTable(
	"files",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		projectStageId: text("project_stage_id").references(() => projectStages.id, { onDelete: "set null" }),
		category: text("category", { enum: FILE_CATEGORIES }).notNull(),
		r2Key: text("r2_key").notNull(),
		thumbKey: text("thumb_key"),
		filename: text("filename").notNull(),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		caption: text("caption"),
		uploadStatus: text("upload_status", { enum: UPLOAD_STATUSES }).notNull().default("pending"),
		uploadedBy: text("uploaded_by")
			.notNull()
			.references(() => users.id),
		uploadedAt: integer("uploaded_at"),
		createdAt: createdAt(),
		deletedAt: integer("deleted_at"),
	},
	(t) => [index("files_project_category_created_idx").on(t.projectId, t.category, t.createdAt)],
);

/** Project files attached to a checklist item as evidence (a file can back several items). */
export const itemFiles = sqliteTable(
	"item_files",
	{
		itemId: text("item_id")
			.notNull()
			.references(() => projectItems.id, { onDelete: "cascade" }),
		fileId: text("file_id")
			.notNull()
			.references(() => files.id, { onDelete: "cascade" }),
		attachedBy: text("attached_by")
			.notNull()
			.references(() => users.id),
		createdAt: createdAt(),
	},
	(t) => [primaryKey({ columns: [t.itemId, t.fileId] }), index("item_files_file_idx").on(t.fileId)],
);

/**
 * Projects a viewer may see. Admins see every project and have no rows here. Seeded on a viewer's first
 * sign-in from their invitation's publicMetadata.projectIds, then edited from Team.
 */
export const projectAccess = sqliteTable(
	"project_access",
	{
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		grantedBy: text("granted_by").references(() => users.id),
		createdAt: createdAt(),
	},
	(t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("project_access_user_idx").on(t.userId)],
);

// ── Step 5: AI extraction & quotes ──────────────────────────────────────────

export const documentExtractions = sqliteTable(
	"document_extractions",
	{
		id: text("id").primaryKey(),
		fileId: text("file_id")
			.notNull()
			.references(() => files.id, { onDelete: "cascade" }),
		detectedType: text("detected_type"),
		fields: text("fields", { mode: "json" }).$type<Record<string, unknown>>(),
		validation: text("validation", { mode: "json" }).$type<{
			checks: { id: string; ok: boolean; message: string }[];
			warnings: string[];
		}>(),
		confidence: integer("confidence"), // 0–100
		provider: text("provider"),
		model: text("model"),
		status: text("status", { enum: EXTRACTION_STATUSES }).notNull().default("queued"),
		error: text("error"),
		attempts: integer("attempts").notNull().default(0),
		reviewedBy: text("reviewed_by").references(() => users.id),
		reviewedAt: integer("reviewed_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("document_extractions_file_idx").on(t.fileId),
		index("document_extractions_status_created_idx").on(t.status, t.createdAt),
	],
);

export const quotes = sqliteTable(
	"quotes",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		fileId: text("file_id").references(() => files.id, { onDelete: "set null" }),
		supplierId: text("supplier_id").references(() => suppliers.id),
		trade: text("trade"),
		quoteNumber: text("quote_number"),
		quoteDate: text("quote_date"),
		validUntil: text("valid_until"),
		amountExGstCents: integer("amount_ex_gst_cents").notNull(),
		gstCents: integer("gst_cents").notNull(),
		amountIncGstCents: integer("amount_inc_gst_cents").notNull(),
		status: text("status", { enum: QUOTE_STATUSES }).notNull().default("pending"),
		decidedBy: text("decided_by").references(() => users.id),
		decidedAt: integer("decided_at"),
		extractionId: text("extraction_id").references((): AnySQLiteColumn => documentExtractions.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("quotes_project_status_idx").on(t.projectId, t.status),
		uniqueIndex("quotes_extraction_uq").on(t.extractionId),
	],
);

// ── Step 6: email ───────────────────────────────────────────────────────────

/** One row per notification attempt. Enforces the 100/day Resend cap and records sandbox redirects. */
export const emailLog = sqliteTable(
	"email_log",
	{
		id: text("id").primaryKey(),
		kind: text("kind").notNull(),
		intendedTo: text("intended_to").notNull(),
		sentTo: text("sent_to"),
		subject: text("subject").notNull(),
		status: text("status", { enum: ["sent", "skipped", "failed"] }).notNull(),
		providerId: text("provider_id"),
		error: text("error"),
		createdAt: createdAt(),
	},
	(t) => [index("email_log_created_idx").on(t.createdAt)],
);

// ── AI model ────────────────────────────────────────────────────────────────

/**
 * The workspace's own AI endpoint (one row, id "default"). When present it serves every AI call instead
 * of the AI_PROVIDER default. The API key is AES-GCM encrypted with SETTINGS_ENCRYPTION_KEY.
 */
export const aiSettings = sqliteTable("ai_settings", {
	id: text("id").primaryKey(),
	protocol: text("protocol", { enum: AI_PROTOCOLS }).notNull(),
	baseUrl: text("base_url").notNull(),
	model: text("model").notNull(),
	apiKeyEncrypted: text("api_key_encrypted").notNull(),
	keyHint: text("key_hint").notNull(),
	updatedBy: text("updated_by").references(() => users.id),
	updatedAt: updatedAt(),
});

// ── Relations (for db.query … with) ─────────────────────────────────────────

export const workflowTemplatesRelations = relations(workflowTemplates, ({ many }) => ({
	stages: many(templateStages),
}));
export const templateStagesRelations = relations(templateStages, ({ one, many }) => ({
	template: one(workflowTemplates, {
		fields: [templateStages.templateId],
		references: [workflowTemplates.id],
	}),
	items: many(templateItems),
}));
export const templateItemsRelations = relations(templateItems, ({ one }) => ({
	stage: one(templateStages, { fields: [templateItems.templateStageId], references: [templateStages.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type ProjectStage = typeof projectStages.$inferSelect;
/**
 * Ask AI: one conversation per project, shared by admins. Assistant rows start `pending` while the queue consumer
 * asks the model, and carry the changes it proposes (`actions`); each waits for a person to approve or dismiss.
 */
export const aiChatMessages = sqliteTable(
	"ai_chat_messages",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		role: text("role", { enum: CHAT_ROLES }).notNull(),
		/** Who asked (user rows); null for the assistant. */
		authorId: text("author_id").references(() => users.id),
		content: text("content").notNull().default(""),
		status: text("status", { enum: CHAT_STATUSES }).notNull().default("done"),
		actions: text("actions", { mode: "json" }).$type<import("../shared/api-types").ChatAction[]>(),
		error: text("error"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("ai_chat_messages_project_idx").on(t.projectId, t.createdAt)],
);

export type ProjectItem = typeof projectItems.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type Extraction = typeof documentExtractions.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type AiSettingsRow = typeof aiSettings.$inferSelect;
