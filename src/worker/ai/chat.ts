/**
 * Ask AI (docs/DESIGN.md §5b): a per-project conversation. The model sees a snapshot of the one project the admin
 * picked — never the whole workspace — and can only *propose* changes through three tools. Proposals are checked
 * against that snapshot, described in plain English by the server, and wait for an admin to approve them.
 * There is deliberately no tool that deletes or detaches anything: documents and photos can't be removed this way.
 */
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { ulid } from "ulid";
import {
	aiChatMessages,
	documentExtractions,
	files,
	itemFiles,
	projectItems,
	projectStages,
	projects,
	users,
} from "../../db/schema";
import type { ChatAction, ChatActionType, ExtractionFields } from "../../shared/api-types";
import { CHAT_ACTION_TYPES, extractionConfirm } from "../../shared/schemas";
import { createDb, type Db } from "../db";
import { badRequest, conflict, notFound } from "../lib/validate";
import { confirmExtraction } from "../routes/extractions";
import { attachItemFile, moveItemFile } from "../routes/stages";
import type { Bindings } from "../types";
import type { ChatTurn, ToolCall, ToolDef } from "./endpoint";
import { resolveChatModel } from "./providers";

/** Keeps the prompt inside the model's context and the request fast. */
const MAX_DOCUMENTS = 150;
const MAX_PHOTOS = 60;
const HISTORY_MESSAGES = 20;

// ── Snapshot of one project ──────────────────────────────────────────────────

export interface Snapshot {
	project: { id: string; name: string; address: string; status: string };
	stages: {
		id: string;
		name: string;
		status: string;
		items: { id: string; title: string; done: boolean }[];
	}[];
	files: {
		id: string;
		filename: string;
		category: string;
		stage: string | null;
		uploadedAt: number | null;
	}[];
	/** fileId → item ids it's attached to. */
	attached: Map<string, Set<string>>;
	reviews: {
		id: string;
		fileId: string;
		filename: string;
		status: string;
		fields: ExtractionFields | null;
		warnings: string[];
	}[];
}

export async function loadSnapshot(db: Db, projectId: string): Promise<Snapshot> {
	const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
	if (!project) throw notFound("Project not found");
	const [stageRows, itemRows, fileRows, links, reviewRows] = await Promise.all([
		db
			.select({ id: projectStages.id, name: projectStages.name, status: projectStages.status })
			.from(projectStages)
			.where(eq(projectStages.projectId, projectId))
			.orderBy(asc(projectStages.position)),
		db
			.select({
				id: projectItems.id,
				title: projectItems.title,
				stageId: projectItems.projectStageId,
				completedAt: projectItems.completedAt,
			})
			.from(projectItems)
			.innerJoin(projectStages, eq(projectItems.projectStageId, projectStages.id))
			.where(eq(projectStages.projectId, projectId))
			.orderBy(asc(projectItems.position)),
		db
			.select({
				id: files.id,
				filename: files.filename,
				category: files.category,
				stage: projectStages.name,
				uploadedAt: files.uploadedAt,
			})
			.from(files)
			.leftJoin(projectStages, eq(files.projectStageId, projectStages.id))
			.where(and(eq(files.projectId, projectId), isNull(files.deletedAt), eq(files.uploadStatus, "uploaded")))
			.orderBy(desc(files.createdAt)),
		db
			.select({ itemId: itemFiles.itemId, fileId: itemFiles.fileId })
			.from(itemFiles)
			.innerJoin(files, eq(itemFiles.fileId, files.id))
			.where(and(eq(files.projectId, projectId), isNull(files.deletedAt))),
		db
			.select({
				id: documentExtractions.id,
				fileId: files.id,
				filename: files.filename,
				status: documentExtractions.status,
				fields: documentExtractions.fields,
				validation: documentExtractions.validation,
			})
			.from(documentExtractions)
			.innerJoin(files, eq(documentExtractions.fileId, files.id))
			.where(
				and(
					eq(files.projectId, projectId),
					isNull(files.deletedAt),
					inArray(documentExtractions.status, ["needs_review", "failed", "queued", "processing"]),
				),
			),
	]);
	const attached = new Map<string, Set<string>>();
	for (const l of links) {
		const set = attached.get(l.fileId) ?? new Set<string>();
		set.add(l.itemId);
		attached.set(l.fileId, set);
	}
	const address = [project.siteAddress, project.suburb, project.state, project.postcode]
		.filter(Boolean)
		.join(", ");
	return {
		project: { id: project.id, name: project.name, address, status: project.status },
		stages: stageRows.map((s) => ({
			...s,
			items: itemRows
				.filter((i) => i.stageId === s.id)
				.map((i) => ({ id: i.id, title: i.title, done: i.completedAt !== null })),
		})),
		files: fileRows,
		attached,
		reviews: reviewRows.map((r) => ({
			id: r.id,
			fileId: r.fileId,
			filename: r.filename,
			status: r.status,
			fields: (r.fields as unknown as ExtractionFields | null) ?? null,
			warnings: r.validation?.warnings ?? [],
		})),
	};
}

const q = (s: string) => JSON.stringify(s);
const day = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "?");
const dollars = (cents: number | null | undefined) =>
	cents == null ? "?" : `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;

/** The project as compact text for the system prompt. */
export function describeSnapshot(s: Snapshot): string {
	const items = new Map(s.stages.flatMap((st) => st.items.map((i) => [i.id, { ...i, stage: st.name }])));
	const checksOf = (fileId: string) =>
		[...(s.attached.get(fileId) ?? [])].map((id) => q(items.get(id)?.title ?? "?")).join(", ") || "none";
	const lines: string[] = [];
	lines.push(
		`PROJECT ${q(s.project.name)} (${s.project.status})${s.project.address ? ` at ${s.project.address}` : ""}`,
	);
	lines.push("", "STAGES AND CHECKLISTS ([x] = ticked off):");
	for (const st of s.stages) {
		lines.push(`Stage ${q(st.name)} (stage id ${st.id}, ${st.status.replace("_", " ")})`);
		for (const i of st.items) {
			const onIt = s.files.filter((f) => s.attached.get(f.id)?.has(i.id));
			lines.push(
				`  - [${i.done ? "x" : " "}] ${q(i.title)} (item id ${i.id})` +
					(onIt.length
						? ` — files: ${onIt.map((f) => `${q(f.filename)} (file id ${f.id})`).join(", ")}`
						: ""),
			);
		}
	}
	const docs = s.files.filter((f) => f.category !== "photo");
	const photos = s.files.filter((f) => f.category === "photo");
	lines.push(
		"",
		`DOCUMENTS (${docs.length}${docs.length > MAX_DOCUMENTS ? `, newest ${MAX_DOCUMENTS} shown` : ""}):`,
	);
	for (const f of docs.slice(0, MAX_DOCUMENTS)) {
		lines.push(
			`  - ${q(f.filename)} (file id ${f.id}) · ${f.category} · stage ${f.stage ? q(f.stage) : "none"} · uploaded ${day(f.uploadedAt)} · on checks: ${checksOf(f.id)}`,
		);
	}
	lines.push(
		"",
		`PHOTOS (${photos.length}${photos.length > MAX_PHOTOS ? `, newest ${MAX_PHOTOS} shown` : ""}):`,
	);
	for (const f of photos.slice(0, MAX_PHOTOS)) {
		lines.push(
			`  - ${q(f.filename)} (file id ${f.id}) · stage ${f.stage ? q(f.stage) : "none"} · on checks: ${checksOf(f.id)}`,
		);
	}
	lines.push("", "REVIEW QUEUE (documents read by AI, waiting for a person):");
	if (s.reviews.length === 0) lines.push("  (empty)");
	for (const r of s.reviews) {
		const f = r.fields;
		const parts = [`${q(r.filename)} (extraction id ${r.id}, file id ${r.fileId})`, r.status];
		if (f) {
			parts.push(`read as ${f.documentType}`);
			if (f.quote) {
				parts.push(
					`supplier ${f.quote.supplierName ? q(f.quote.supplierName) : "?"}, ex-GST ${dollars(f.quote.amountExGstCents)}, GST ${dollars(f.quote.gstCents)}, inc-GST ${dollars(f.quote.amountIncGstCents)}`,
				);
			}
			if (f.generic?.title) parts.push(`title ${q(f.generic.title)}`);
			if (f.generic?.summary) parts.push(`summary ${q(f.generic.summary)}`);
			if (f.suggestedStage) parts.push(`suggested stage ${q(f.suggestedStage)}`);
			if (f.suggestedItem) parts.push(`suggested check ${q(f.suggestedItem)}`);
		}
		if (r.warnings.length) parts.push(`warnings: ${r.warnings.join("; ")}`);
		lines.push(`  - ${parts.join(" · ")}`);
	}
	return lines.join("\n");
}

// ── Tools ────────────────────────────────────────────────────────────────────

const reason = { type: "string", description: "One short sentence: why, in the builder's terms" };

export const CHAT_TOOLS: ToolDef[] = [
	{
		name: "propose_move_file",
		description:
			"Propose moving a file that is on one checklist item to a different checklist item (any stage). A person must approve it.",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["fileId", "fromItemId", "toItemId", "reason"],
			properties: {
				fileId: { type: "string" },
				fromItemId: { type: "string", description: "Item id the file is on now" },
				toItemId: { type: "string", description: "Item id it should be on" },
				reason,
			},
		},
	},
	{
		name: "propose_attach_file",
		description:
			"Propose attaching an uploaded document or photo to a checklist item it isn't on yet. A person must approve it.",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["fileId", "itemId", "reason"],
			properties: { fileId: { type: "string" }, itemId: { type: "string" }, reason },
		},
	},
	{
		name: "propose_confirm_review",
		description:
			"Propose confirming a document in the review queue with the details already read from it, optionally filing it under a stage and attaching it to a checklist item. Only for documents whose details look right. A person must approve it.",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["extractionId", "stageId", "itemId", "reason"],
			properties: {
				extractionId: { type: "string" },
				stageId: { type: ["string", "null"], description: "Stage to file it under, or null" },
				itemId: {
					type: ["string", "null"],
					description: "Checklist item in that stage to attach it to, or null",
				},
				reason,
			},
		},
	},
];

const TOOL_TYPE: Record<string, ChatActionType> = {
	propose_move_file: "move_file",
	propose_attach_file: "attach_file",
	propose_confirm_review: "confirm_review",
};

export function systemPrompt(snapshot: Snapshot) {
	return `You are the assistant in BFH App, a site-management app for a Sydney residential builder (NSW, Australia).
You are helping an admin with ONE project, described below. Answer questions about it, review its documents,
and suggest where documents and photos belong on the checklist.

Rules:
- Use only the project data below. If something isn't there, say so. Never invent files, checks or amounts.
- To change anything, call a propose_* tool. Calling a tool does not change anything: it shows the admin a
  proposal with Approve and Dismiss buttons. Never claim a change has been made.
- You can move files between checks, attach files to checks, and confirm documents in the review queue.
- You can NEVER delete, remove or detach documents or photos, and there is no tool for it. If asked, explain that
  a person has to do that themselves in the project.
- Only propose confirming a review when its details look complete and consistent (supplier and all three amounts
  for a quote, no unresolved warnings); otherwise point out what a person should check on the Review screen.
- Use ids exactly as given. One tool call per change. Keep replies short and plain (Australian English).

${describeSnapshot(snapshot)}`;
}

// ── Turning tool calls into checked proposals ───────────────────────────────

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Validates one tool call against the snapshot. Returns the proposal, or why it was refused. */
export function toProposal(call: ToolCall, s: Snapshot): ChatAction | { refused: string } {
	const type = TOOL_TYPE[call.name];
	if (!type || !CHAT_ACTION_TYPES.includes(type))
		return { refused: `"${call.name}" isn't something I can do` };
	const items = new Map(
		s.stages.flatMap((st) => st.items.map((i) => [i.id, { ...i, stageId: st.id, stage: st.name }])),
	);
	const fileById = new Map(s.files.map((f) => [f.id, f]));
	const label = (id: string) => {
		const i = items.get(id);
		return i ? `“${i.title}” (${i.stage})` : "?";
	};
	const base = { id: ulid(), reason: str(call.args.reason), status: "proposed" as const };

	if (type === "move_file" || type === "attach_file") {
		const fileId = str(call.args.fileId);
		const file = fileId ? fileById.get(fileId) : undefined;
		if (!fileId || !file) return { refused: "it named a file that isn't in this project" };
		if (type === "move_file") {
			const from = str(call.args.fromItemId);
			const to = str(call.args.toItemId);
			if (!from || !to || !items.has(from) || !items.has(to))
				return { refused: "it named a check that isn't in this project" };
			if (from === to) return { refused: `${file.filename} is already on that check` };
			if (!s.attached.get(fileId)?.has(from)) return { refused: `${file.filename} isn't on ${label(from)}` };
			return {
				...base,
				type,
				params: { fileId, fromItemId: from, itemId: to },
				summary: `Move ${file.filename} from ${label(from)} to ${label(to)}`,
			};
		}
		const itemId = str(call.args.itemId);
		if (!itemId || !items.has(itemId)) return { refused: "it named a check that isn't in this project" };
		if (s.attached.get(fileId)?.has(itemId))
			return { refused: `${file.filename} is already on ${label(itemId)}` };
		return {
			...base,
			type,
			params: { fileId, itemId },
			summary: `Attach ${file.filename} to ${label(itemId)}`,
		};
	}

	// confirm_review
	const extractionId = str(call.args.extractionId);
	const review = s.reviews.find((r) => r.id === extractionId);
	if (!extractionId || !review)
		return { refused: "it named a document that isn't in this project's review queue" };
	if (review.status !== "needs_review" || !review.fields)
		return { refused: `${review.filename} isn't ready to confirm (${review.status.replace("_", " ")})` };
	const stageId = str(call.args.stageId);
	const itemId = str(call.args.itemId);
	if (stageId && !s.stages.some((st) => st.id === stageId))
		return { refused: "it named a stage that isn't in this project" };
	if (itemId && (!items.has(itemId) || (stageId && items.get(itemId)?.stageId !== stageId)))
		return { refused: "it named a check that isn't in that stage" };
	const missing = missingForConfirm(review.fields);
	if (missing) return { refused: `${review.filename} needs a person to fill in ${missing} first` };
	const stage = s.stages.find((st) => st.id === (stageId ?? items.get(itemId ?? "")?.stageId));
	const what =
		review.fields.documentType === "quote" && review.fields.quote
			? `as a quote from ${review.fields.quote.supplierName} (${dollars(review.fields.quote.amountIncGstCents)} inc GST)`
			: `as ${review.fields.documentType === "other" ? "a document" : `a ${review.fields.documentType}`}`;
	return {
		...base,
		type,
		params: { extractionId, stageId: stage?.id ?? null, itemId: itemId ?? undefined },
		summary:
			`Confirm ${review.filename} ${what}` +
			(stage ? `, filed under ${stage.name}` : "") +
			(itemId ? ` and attached to “${items.get(itemId)?.title}”` : ""),
	};
}

/** What a quote still needs before it can be confirmed without a person editing it. */
function missingForConfirm(f: ExtractionFields): string | null {
	if (f.documentType !== "quote") return null;
	const qf = f.quote;
	if (!qf?.supplierName) return "the supplier";
	if (qf.amountExGstCents == null || qf.gstCents == null || qf.amountIncGstCents == null)
		return "the amounts";
	return null;
}

// ── Queue job: answer one message ────────────────────────────────────────────

export async function runChat(env: Bindings, messageId: string) {
	const db = createDb(env.DB);
	const msg = await db.query.aiChatMessages.findFirst({ where: eq(aiChatMessages.id, messageId) });
	if (msg?.role !== "assistant" || msg.status !== "pending") return;

	const [snapshot, history, model] = await Promise.all([
		loadSnapshot(db, msg.projectId),
		db
			.select()
			.from(aiChatMessages)
			.where(
				and(
					eq(aiChatMessages.projectId, msg.projectId),
					lt(aiChatMessages.createdAt, msg.createdAt + 1),
					eq(aiChatMessages.status, "done"),
				),
			)
			.orderBy(desc(aiChatMessages.createdAt))
			.limit(HISTORY_MESSAGES),
		resolveChatModel(env, db),
	]);
	const turns: ChatTurn[] = history
		.filter((m) => m.id !== msg.id)
		.reverse()
		.map((m) => ({
			role: m.role,
			content:
				m.role === "assistant" && m.actions?.length
					? `${m.content}\n\n${m.actions.map((a) => `[Proposed: ${a.summary} — ${a.status}]`).join("\n")}`.trim()
					: m.content,
		}));
	// The conversation must end with the question being answered.
	if (turns.at(-1)?.role !== "user") throw new Error("Nothing to answer");

	const out = await model.run({ system: systemPrompt(snapshot), turns, tools: CHAT_TOOLS });
	const actions: ChatAction[] = [];
	const refused: string[] = [];
	for (const call of out.calls) {
		const p = toProposal(call, snapshot);
		if ("refused" in p) refused.push(p.refused);
		else if (!actions.some((a) => a.summary === p.summary)) actions.push(p);
	}
	let content = out.text;
	if (refused.length) {
		content =
			`${content}\n\n(I left out ${refused.length === 1 ? "a suggestion" : `${refused.length} suggestions`}: ${refused.join("; ")}.)`.trim();
	}
	if (!content && actions.length === 0) content = "I don't have an answer for that.";
	await db
		.update(aiChatMessages)
		.set({ content, actions, status: "done", error: null, updatedAt: Date.now() })
		.where(eq(aiChatMessages.id, messageId));
}

export async function markChatFailed(env: Bindings, messageId: string, error: string) {
	await createDb(env.DB)
		.update(aiChatMessages)
		.set({ status: "failed", error: error.slice(0, 500), updatedAt: Date.now() })
		.where(eq(aiChatMessages.id, messageId));
}

// ── Applying an approved proposal ────────────────────────────────────────────

async function itemProjectId(db: Db, itemId: string) {
	const row = await db
		.select({ projectId: projectStages.projectId })
		.from(projectItems)
		.innerJoin(projectStages, eq(projectItems.projectStageId, projectStages.id))
		.where(eq(projectItems.id, itemId))
		.get();
	return row?.projectId ?? null;
}

/**
 * Runs one approved proposal as the approving admin, through the same functions the buttons use. Only the three
 * proposal types exist; anything else (including any kind of delete) is refused.
 */
export async function applyChatAction(db: Db, user: { id: string }, projectId: string, action: ChatAction) {
	const p = action.params;
	switch (action.type) {
		case "move_file": {
			if (!p.fileId || !p.fromItemId || !p.itemId) throw badRequest("Incomplete proposal");
			if ((await itemProjectId(db, p.fromItemId)) !== projectId)
				throw badRequest("That check is in another project");
			return moveItemFile(db, user, p.fromItemId, p.fileId, p.itemId);
		}
		case "attach_file": {
			if (!p.fileId || !p.itemId) throw badRequest("Incomplete proposal");
			if ((await itemProjectId(db, p.itemId)) !== projectId)
				throw badRequest("That check is in another project");
			return attachItemFile(db, user, p.itemId, p.fileId);
		}
		case "confirm_review": {
			if (!p.extractionId) throw badRequest("Incomplete proposal");
			const row = await db
				.select({ ex: documentExtractions, projectId: files.projectId })
				.from(documentExtractions)
				.innerJoin(files, eq(documentExtractions.fileId, files.id))
				.where(eq(documentExtractions.id, p.extractionId))
				.get();
			if (!row || row.projectId !== projectId) throw notFound("That document isn't in this project");
			if (row.ex.status !== "needs_review") throw conflict("Someone has already dealt with this document");
			const f = row.ex.fields as unknown as ExtractionFields | null;
			if (!f) throw conflict("Nothing has been read from this document yet");
			const missing = missingForConfirm(f);
			if (missing) throw badRequest(`Fill in ${missing} on the Review screen first`);
			const body = extractionConfirm.parse(
				f.documentType === "quote"
					? {
							documentType: "quote",
							fields: f.quote,
							supplierId: f.supplierMatch?.id ?? null,
							stageId: p.stageId ?? null,
							itemId: p.itemId ?? null,
						}
					: {
							documentType: f.documentType,
							fields: f.generic ?? {},
							stageId: p.stageId ?? null,
							itemId: p.itemId ?? null,
						},
			);
			return confirmExtraction(db, user, p.extractionId, body);
		}
		default:
			throw badRequest("The assistant can't do that");
	}
}

/** Author names for a page of messages. */
export async function authorNames(db: Db, ids: string[]) {
	if (ids.length === 0) return new Map<string, string | null>();
	const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
	return new Map(rows.map((r) => [r.id, r.name]));
}
