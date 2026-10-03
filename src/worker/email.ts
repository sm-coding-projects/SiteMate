/**
 * Notification email via Resend, sent only from the Queue consumer (never inline in a request).
 * EMAIL_MODE=sandbox (default, no verified domain): every email goes to EMAIL_SANDBOX_TO with the intended
 * recipient in the subject. A rolling 24 h cap (EMAIL_DAILY_LIMIT, default 90) keeps us under Resend's 100/day.
 */
import { and, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import { ulid } from "ulid";
import {
	documentExtractions,
	emailLog,
	files,
	projectAccess,
	projectStages,
	projects,
	users,
} from "../db/schema";
import type { ExtractionFields, JobMessage } from "../shared/api-types";
import { createDb, type Db } from "./db";
import type { Bindings } from "./types";

type NotifyMessage = Extract<JobMessage, { type: "notify" }>;

interface Email {
	kind: string;
	/** Stable per event + recipient, so a queue retry never sends twice. */
	key: string;
	to: string;
	subject: string;
	heading: string;
	lines: string[];
	cta: { label: string; url: string };
}

const esc = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
	);
const aud = (cents: number | null | undefined) =>
	cents == null ? "" : (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** Plain, brand-consistent HTML: ink header with the 8-segment bar, one hi-vis button with ink text. */
export function renderEmail(e: Pick<Email, "heading" | "lines" | "cta">, footer: string) {
	const bar = Array.from(
		{ length: 8 },
		(_, i) =>
			`<td style="height:6px;width:12.5%;background:${i < 3 ? "#eef0ec" : i === 3 ? "#e8ff3c" : "#2a2f33"};border-right:2px solid #0f1214"></td>`,
	).join("");
	const html = `<!doctype html><html><body style="margin:0;background:#f4f5f2;font-family:Arial,Helvetica,sans-serif;color:#0f1214">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto">
<tr><td style="background:#0f1214;padding:20px 24px"><div style="color:#eef0ec;font-weight:700;font-size:18px;letter-spacing:0.5px">BFH App</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>${bar}</tr></table></td></tr>
<tr><td style="background:#ffffff;padding:24px;border:1px solid #d9dcd6;border-top:0">
<h1 style="font-size:20px;margin:0 0 12px">${esc(e.heading)}</h1>
${e.lines.map((l) => `<p style="margin:0 0 8px;font-size:15px;line-height:1.5">${esc(l)}</p>`).join("")}
<p style="margin:20px 0 0"><a href="${esc(e.cta.url)}" style="display:inline-block;background:#e8ff3c;color:#0f1214;border:1px solid #0f1214;border-radius:6px;padding:12px 18px;font-weight:700;text-decoration:none">${esc(e.cta.label)}</a></p>
</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:#5b6168">${esc(footer)}</td></tr>
</table></body></html>`;
	const text = `${e.heading}\n\n${e.lines.join("\n")}\n\n${e.cta.label}: ${e.cta.url}\n\n${footer}`;
	return { html, text };
}

/** Admins, plus (unless adminsOnly) viewers who can see `projectId`. */
async function recipients(db: Db, opts: { adminsOnly: boolean; projectId?: string; exclude?: string }) {
	const where = [eq(users.emailNotifications, true), isNull(users.accessRevokedAt)];
	if (opts.adminsOnly || !opts.projectId) where.push(eq(users.role, "admin"));
	else {
		const viewer = and(
			eq(users.role, "viewer"),
			sql`exists (select 1 from ${projectAccess} where ${projectAccess.userId} = ${users.id} and ${projectAccess.projectId} = ${opts.projectId})`,
		);
		const either = or(eq(users.role, "admin"), viewer);
		if (either) where.push(either);
	}
	if (opts.exclude) where.push(ne(users.id, opts.exclude));
	return db
		.select({ email: users.email, name: users.name })
		.from(users)
		.where(and(...where))
		.limit(50);
}

async function buildEmails(env: Bindings, db: Db, msg: NotifyMessage): Promise<Email[]> {
	const app = (env.APP_URL || "").replace(/\/$/, "");
	if (msg.kind === "test") {
		return [
			{
				kind: "test",
				key: `test:${msg.requestedBy}:${msg.at}`,
				to: msg.to,
				subject: "BFH App test email",
				heading: "Email is working",
				lines: [
					"This is a test notification from BFH App.",
					`Mode: ${(env.EMAIL_MODE || "sandbox") === "live" ? "live" : "sandbox (redirected to the Resend account owner)"}.`,
				],
				cta: { label: "Open BFH App", url: `${app}/projects` },
			},
		];
	}
	if (msg.kind === "stage_completed") {
		const row = await db
			.select({
				stage: projectStages.name,
				project: projects.name,
				projectId: projects.id,
				actor: users.name,
			})
			.from(projectStages)
			.innerJoin(projects, eq(projectStages.projectId, projects.id))
			.leftJoin(users, eq(users.id, msg.actorId))
			.where(eq(projectStages.id, msg.stageId))
			.get();
		if (!row) return [];
		const counts = await db.all<{ done: number; total: number }>(
			sql`select sum(status = 'complete') as done, count(*) as total from project_stages where project_id = ${row.projectId}`,
		);
		const c = counts[0];
		const to = await recipients(db, { adminsOnly: false, projectId: row.projectId, exclude: msg.actorId });
		return to.map((r) => ({
			kind: "stage_completed",
			key: `stage_completed:${msg.stageId}:${r.email}`,
			to: r.email,
			subject: `${row.stage} complete — ${row.project}`,
			heading: `${row.stage} is complete`,
			lines: [
				`${row.actor ?? "Someone"} marked ${row.stage} complete on ${row.project}.`,
				c ? `${c.done} of ${c.total} stages are now done.` : "",
			].filter(Boolean),
			cta: { label: "Open the project", url: `${app}/projects/${row.projectId}` },
		}));
	}

	const row = await db
		.select({ ex: documentExtractions, filename: files.filename, project: projects.name })
		.from(documentExtractions)
		.innerJoin(files, eq(documentExtractions.fileId, files.id))
		.innerJoin(projects, eq(files.projectId, projects.id))
		.where(eq(documentExtractions.id, msg.extractionId))
		.get();
	if (row?.ex.status !== "needs_review") return [];
	const fields = row.ex.fields as unknown as ExtractionFields | null;
	const q = fields?.quote;
	const warnings = row.ex.validation?.warnings.length ?? 0;
	const to = await recipients(db, { adminsOnly: true });
	const what = q?.supplierName ? `Quote from ${q.supplierName}` : (row.filename ?? "A document");
	return to.map((r) => ({
		kind: "extraction_ready",
		key: `extraction_ready:${msg.extractionId}:${r.email}`,
		to: r.email,
		subject: `Ready for review: ${what} — ${row.project}`,
		heading: `${what} is ready for review`,
		lines: [
			`BFH App read ${row.filename} on ${row.project}.`,
			q?.amountIncGstCents != null ? `Total ${aud(q.amountIncGstCents)} inc GST.` : "",
			warnings
				? `${warnings} check${warnings === 1 ? "" : "s"} need a look before you confirm.`
				: "All checks passed.",
		].filter(Boolean),
		cta: { label: "Review and confirm", url: `${app}/review/${msg.extractionId}` },
	}));
}

/** Sends (or skips, with a reason in email_log) each email. Throws only on transient provider errors. */
export async function deliver(env: Bindings, db: Db, emails: Email[]) {
	// Loaded lazily: only the queue consumer sends email.
	const resend = env.RESEND_API_KEY ? new (await import("resend")).Resend(env.RESEND_API_KEY) : null;
	const limit = Number(env.EMAIL_DAILY_LIMIT || 90);
	const sandbox = (env.EMAIL_MODE || "sandbox") !== "live";
	const from = env.EMAIL_FROM || "BFH App <onboarding@resend.dev>";
	const footer = "You're getting this because email notifications are on in BFH App → Account.";

	for (const e of emails) {
		const log = (
			status: "sent" | "skipped" | "failed",
			extra: { sentTo?: string; providerId?: string; error?: string },
		) =>
			db.insert(emailLog).values({
				id: ulid(),
				kind: e.kind,
				intendedTo: e.to,
				subject: e.subject,
				status,
				sentTo: extra.sentTo ?? null,
				providerId: extra.providerId ?? null,
				error: extra.error ?? null,
			});

		// One email per event and recipient per day, even if the queue retries (test emails always send).
		const already =
			e.kind !== "test" &&
			(await db
				.select({ id: emailLog.id })
				.from(emailLog)
				.where(
					and(
						eq(emailLog.kind, e.kind),
						eq(emailLog.intendedTo, e.to),
						eq(emailLog.subject, e.subject),
						eq(emailLog.status, "sent"),
						gte(emailLog.createdAt, Date.now() - 86_400_000),
					),
				)
				.get());
		if (already) continue;
		if (!resend) {
			await log("skipped", { error: "RESEND_API_KEY not set" });
			continue;
		}
		const sentToday = await db
			.select({ n: sql<number>`count(*)` })
			.from(emailLog)
			.where(and(eq(emailLog.status, "sent"), gte(emailLog.createdAt, Date.now() - 86_400_000)))
			.get();
		if ((sentToday?.n ?? 0) >= limit) {
			await log("skipped", { error: `Daily email limit (${limit}) reached` });
			continue;
		}
		const sentTo = sandbox ? env.EMAIL_SANDBOX_TO : e.to;
		if (!sentTo) {
			await log("skipped", { error: "EMAIL_SANDBOX_TO not set" });
			continue;
		}
		const subject = sandbox ? `[to ${e.to}] ${e.subject}` : e.subject;
		const { html, text } = renderEmail(e, sandbox ? `${footer} (Sandbox: intended for ${e.to}.)` : footer);
		const res = await resend.emails.send(
			{ from, to: sentTo, subject, html, text },
			{ idempotencyKey: e.key },
		);
		if (res.error) {
			const retryable =
				res.error.statusCode == null || res.error.statusCode >= 500 || res.error.statusCode === 429;
			await log("failed", { sentTo, error: `${res.error.name}: ${res.error.message}` });
			if (retryable) throw new Error(`Resend: ${res.error.message}`);
			continue;
		}
		await log("sent", { sentTo, providerId: res.data.id });
	}
}

export async function sendNotification(env: Bindings, msg: NotifyMessage) {
	const db = createDb(env.DB);
	await deliver(env, db, await buildEmails(env, db, msg));
}

export type { Email };
