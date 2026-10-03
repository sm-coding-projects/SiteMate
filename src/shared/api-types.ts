/** Response types shared between the Worker API and the SPA. Request bodies live in ./schemas.ts. */
import type { StageStatus } from "./progress";
import type { GenericFields, QuoteFields } from "./schemas";

export type Role = "admin" | "viewer";

export interface Me {
	id: string;
	email: string;
	name: string | null;
	role: Role;
}

export interface MeWithPreferences extends Me {
	emailNotifications: boolean;
}

export interface ApiError {
	error: string;
}

export interface Page<T> {
	items: T[];
	nextCursor: string | null;
}

export type ProjectStatus = "active" | "on_hold" | "complete" | "archived";
export type Source = "template" | "custom";
export type { StageStatus };

// ── Templates ────────────────────────────────────────────────────────────────

export interface TemplateSummary {
	id: string;
	name: string;
	description: string | null;
	isDefault: boolean;
	stageCount: number;
	itemCount: number;
}

// ── Projects ─────────────────────────────────────────────────────────────────

export interface StageLite {
	id: string;
	name: string;
	status: StageStatus;
}

export interface ProjectSummary {
	id: string;
	name: string;
	siteAddress: string | null;
	suburb: string | null;
	clientName: string | null;
	status: ProjectStatus;
	startDate: string | null;
	targetCompletion: string | null;
	updatedAt: number;
	stages: StageLite[];
	itemsDone: number;
	itemsTotal: number;
	photoCount: number;
	recentPhotos: { id: string; thumbUrl: string | null }[];
}

export interface ProjectItem {
	id: string;
	title: string;
	position: number;
	source: Source;
	completedAt: number | null;
	completedBy: { id: string; name: string | null } | null;
}

export interface ProjectStage {
	id: string;
	name: string;
	description: string | null;
	position: number;
	status: StageStatus;
	source: Source;
	startedAt: number | null;
	completedAt: number | null;
	items: ProjectItem[];
}

export interface ProjectDetail {
	id: string;
	name: string;
	siteAddress: string | null;
	suburb: string | null;
	clientName: string | null;
	clientEmail: string | null;
	clientPhone: string | null;
	status: ProjectStatus;
	startDate: string | null;
	targetCompletion: string | null;
	templateId: string | null;
	createdAt: number;
	updatedAt: number;
	stages: ProjectStage[];
}

// ── Notes & activity ─────────────────────────────────────────────────────────

export interface Note {
	id: string;
	body: string;
	stage: { id: string; name: string } | null;
	author: { id: string; name: string | null; email: string };
	createdAt: number;
	updatedAt: number;
}

export interface ActivityEntry {
	id: string;
	project: { id: string; name: string } | null;
	actor: { id: string; name: string | null; email: string };
	action: string;
	entityType: string;
	entityId: string | null;
	meta: Record<string, unknown> | null;
	createdAt: number;
}

// ── Files ────────────────────────────────────────────────────────────────────

export type FileCategory = "photo" | "document" | "quote" | "invoice" | "certificate" | "plan" | "other";

export interface FileEntry {
	id: string;
	projectId: string;
	stage: { id: string; name: string } | null;
	category: FileCategory;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	caption: string | null;
	uploadedBy: { id: string; name: string | null };
	uploadedAt: number | null;
	thumbUrl: string | null;
	extraction: { id: string; status: ExtractionStatus; detectedType: string | null } | null;
}

export interface UploadTicket {
	fileId: string;
	uploadUrl: string;
	/** Headers the browser must send with the PUT (they are part of the signature). */
	uploadHeaders: Record<string, string>;
	thumbUploadUrl: string | null;
	thumbUploadHeaders: Record<string, string> | null;
	expiresAt: number;
}

export interface SignedUrl {
	url: string;
	expiresAt: number;
}

// ── Extraction & quotes ──────────────────────────────────────────────────────

export type ExtractionStatus = "queued" | "processing" | "needs_review" | "confirmed" | "failed";
export type DocumentType = "quote" | "invoice" | "certificate" | "plan" | "contract" | "other";

export interface ValidationCheck {
	id: string;
	ok: boolean;
	message: string;
}

export interface ValidationResult {
	checks: ValidationCheck[];
	warnings: string[];
}

export interface SupplierMatch {
	id: string;
	name: string;
	abn: string | null;
	trade: string | null;
	score: number;
}

export interface ExtractionFields {
	documentType: DocumentType;
	suggestedStage: string | null;
	quote?: QuoteFields;
	generic?: GenericFields;
	supplierMatch?: SupplierMatch | null;
}

export interface ExtractionSummary {
	id: string;
	status: ExtractionStatus;
	detectedType: DocumentType | null;
	confidence: number | null;
	provider: string | null;
	model: string | null;
	error: string | null;
	createdAt: number;
	updatedAt: number;
	file: { id: string; filename: string; mimeType: string; category: FileCategory };
	project: { id: string; name: string };
}

export interface ExtractionDetail extends ExtractionSummary {
	fields: ExtractionFields | null;
	validation: ValidationResult | null;
	reviewedBy: { id: string; name: string | null } | null;
	reviewedAt: number | null;
	quoteId: string | null;
	stages: StageLite[];
}

export type QuoteStatus = "pending" | "accepted" | "rejected";

export interface QuoteEntry {
	id: string;
	projectId: string;
	supplier: { id: string; name: string; abn: string | null } | null;
	trade: string | null;
	quoteNumber: string | null;
	quoteDate: string | null;
	validUntil: string | null;
	amountExGstCents: number;
	gstCents: number;
	amountIncGstCents: number;
	status: QuoteStatus;
	decidedBy: { id: string; name: string | null } | null;
	decidedAt: number | null;
	fileId: string | null;
	extractionId: string | null;
}

export interface MoneyTotals {
	exGstCents: number;
	gstCents: number;
	incGstCents: number;
	count: number;
}

export interface QuoteTotals {
	byStatus: Record<QuoteStatus, MoneyTotals>;
	byTrade: ({ trade: string } & MoneyTotals & { acceptedIncGstCents: number })[];
}

export interface ProjectQuotes {
	quotes: QuoteEntry[];
	totals: QuoteTotals;
}

export interface Supplier {
	id: string;
	name: string;
	abn: string | null;
	trade: string | null;
	email: string | null;
	phone: string | null;
}

// ── Team ─────────────────────────────────────────────────────────────────────

export interface TeamMember {
	id: string;
	email: string;
	name: string | null;
	role: Role;
	imageUrl: string | null;
	lastSignInAt: number | null;
	createdAt: number;
}

export interface TeamInvitation {
	id: string;
	email: string;
	role: Role;
	status: string;
	createdAt: number;
}

export interface Team {
	members: TeamMember[];
	invitations: TeamInvitation[];
}

// ── AI model ─────────────────────────────────────────────────────────────────

export type AiProtocol = "openai" | "anthropic";

/** GET /admin/ai. The API key itself never leaves the Worker; `keyHint` is its last 4 characters. */
export interface AiSettings {
	/** What every AI call uses right now. */
	active: { provider: string; model: string; custom: boolean };
	custom: {
		protocol: AiProtocol;
		baseUrl: string;
		model: string;
		keyHint: string;
		updatedAt: number;
	} | null;
	/** False until the SETTINGS_ENCRYPTION_KEY secret is set; keys can't be saved without it. */
	canStoreKeys: boolean;
}

export interface AiModel {
	id: string;
	name: string | null;
}

export interface AiTestResult {
	ok: true;
	model: string;
	latencyMs: number;
	reply: string;
}

// ── Queue ────────────────────────────────────────────────────────────────────

/** Messages carried on the `sitemate-jobs` queue. */
export type JobMessage =
	| { type: "ping"; requestedBy: string; at: number }
	| { type: "extract"; extractionId: string }
	| { type: "notify"; kind: "stage_completed"; projectId: string; stageId: string; actorId: string }
	| { type: "notify"; kind: "extraction_ready"; extractionId: string }
	| { type: "notify"; kind: "test"; to: string; requestedBy: string; at: number };
