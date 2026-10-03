/**
 * D1 schema (see docs/DESIGN.md §3).
 *
 * Conventions:
 * - ids are text ULIDs (except `users.id`, which is the Clerk user id)
 * - timestamps are unix-ms integers
 * - money is integer cents (AUD)
 * - user content is soft-deleted via `deleted_at`
 *
 * Tables are grouped by build step; later steps add their tables in the marked sections.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

const createdAt = () => integer("created_at").notNull().default(now);
const updatedAt = () => integer("updated_at").notNull().default(now);

export const ROLES = ["admin", "viewer"] as const;
export type Role = (typeof ROLES)[number];

// ── Step 1: identity & audit ────────────────────────────────────────────────

/** Upserted lazily from Clerk on authenticated requests. */
export const users = sqliteTable("users", {
	id: text("id").primaryKey(), // Clerk user id
	email: text("email").notNull(),
	name: text("name"),
	role: text("role", { enum: ROLES }).notNull().default("viewer"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

/** Append-only audit log. `project_id` is nullable until projects exist (step 2). */
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
	],
);

// ── Step 2: workflow templates & projects ───────────────────────────────────
// workflow_templates, template_stages, template_items, projects, project_stages, project_items

// ── Step 3: notes ───────────────────────────────────────────────────────────
// notes

// ── Step 4: files ───────────────────────────────────────────────────────────
// suppliers, files

// ── Step 5: AI extraction & quotes ──────────────────────────────────────────
// document_extractions, quotes

export type User = typeof users.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;
