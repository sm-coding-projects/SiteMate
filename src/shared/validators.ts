/**
 * Code-side checks on AI-extracted quotes (docs/DESIGN.md §5). The model suggests; these rules decide what
 * the reviewer is warned about. Pure functions, shared by the Queue consumer, the confirm route and the
 * review screen (so warnings update live as the reviewer edits).
 */
import type { SupplierMatch, ValidationCheck, ValidationResult } from "./api-types";
import type { QuoteFields } from "./schemas";

// ── ABN ──────────────────────────────────────────────────────────────────────

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export const normalizeAbn = (abn: string | null | undefined) => (abn ? abn.replace(/\D/g, "") : "");

/** ATO algorithm: subtract 1 from the first digit, weight the digits, the sum must be divisible by 89. */
export function isValidAbn(abn: string | null | undefined) {
	const digits = normalizeAbn(abn);
	if (!/^\d{11}$/.test(digits) || digits[0] === "0") return false;
	let sum = 0;
	for (let i = 0; i < 11; i++) {
		const d = Number(digits[i]) - (i === 0 ? 1 : 0);
		sum += d * (ABN_WEIGHTS[i] as number);
	}
	return sum % 89 === 0;
}

export const formatAbn = (abn: string) => {
	const d = normalizeAbn(abn);
	return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : abn;
};

// ── Money ────────────────────────────────────────────────────────────────────

const money = (cents: number) =>
	(cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** GST is 10% of the ex-GST amount; allow rounding (per-line GST) of 5c or 0.1%. */
export function gstTolerance(exGstCents: number) {
	return Math.max(5, Math.round(exGstCents * 0.001));
}

export function expectedGst(exGstCents: number) {
	return Math.round(exGstCents * 0.1);
}

// ── Dates ────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const parseDay = (s: string) => Date.parse(`${s}T00:00:00Z`);

// ── Supplier fuzzy match ─────────────────────────────────────────────────────

const STOPWORDS =
	/\b(pty|ltd|limited|proprietary|the|and|co|company|group|services|australia|aust|nsw|trading as|t\/as|atf|trust)\b/g;

export function normalizeName(name: string) {
	return name
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(STOPWORDS, " ")
		.replace(/[^a-z0-9 ]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function bigrams(s: string) {
	const t = s.replace(/ /g, "");
	const out = new Map<string, number>();
	for (let i = 0; i < t.length - 1; i++) {
		const g = t.slice(i, i + 2);
		out.set(g, (out.get(g) ?? 0) + 1);
	}
	return out;
}

/** Sørensen–Dice similarity on character bigrams of the normalised names, 0–1. */
export function nameSimilarity(a: string, b: string) {
	const na = normalizeName(a);
	const nb = normalizeName(b);
	if (!na || !nb) return 0;
	if (na === nb) return 1;
	const A = bigrams(na);
	const B = bigrams(nb);
	let overlap = 0;
	let total = 0;
	for (const [g, n] of A) {
		overlap += Math.min(n, B.get(g) ?? 0);
		total += n;
	}
	for (const n of B.values()) total += n;
	return total ? (2 * overlap) / total : 0;
}

export const SUPPLIER_MATCH_THRESHOLD = 0.8;

export function matchSupplier(
	candidate: { name: string | null; abn: string | null },
	suppliers: readonly { id: string; name: string; abn: string | null; trade: string | null }[],
): SupplierMatch | null {
	const abn = normalizeAbn(candidate.abn);
	if (abn) {
		const byAbn = suppliers.find((s) => normalizeAbn(s.abn) === abn);
		if (byAbn) return { ...byAbn, score: 1 };
	}
	if (!candidate.name) return null;
	let best: SupplierMatch | null = null;
	for (const s of suppliers) {
		const score = nameSimilarity(candidate.name, s.name);
		if (score >= SUPPLIER_MATCH_THRESHOLD && (!best || score > best.score)) best = { ...s, score };
	}
	return best;
}

// ── The full check ───────────────────────────────────────────────────────────

export function validateQuote(
	q: QuoteFields,
	opts: {
		today?: number;
		suppliers?: readonly { id: string; name: string; abn: string | null; trade: string | null }[];
	} = {},
): ValidationResult & { supplierMatch: SupplierMatch | null } {
	const today = opts.today ?? Date.now();
	const checks: ValidationCheck[] = [];
	const add = (id: string, ok: boolean, message: string) => checks.push({ id, ok, message });

	// Amounts present
	const { amountExGstCents: ex, gstCents: gst, amountIncGstCents: inc } = q;
	if (ex == null || gst == null || inc == null) {
		add("amounts", false, "Ex‑GST, GST and inc‑GST totals are all needed");
	}

	// GST ≈ 10%
	if (ex != null && gst != null) {
		const expected = expectedGst(ex);
		const ok = Math.abs(gst - expected) <= gstTolerance(ex);
		add(
			"gst_rate",
			ok,
			ok
				? `GST is 10% of the ex‑GST amount`
				: gst === 0
					? `No GST charged — check whether the supplier is registered for GST (10% would be ${money(expected)})`
					: `GST is ${money(gst)} but 10% of ${money(ex)} is ${money(expected)}`,
		);
	}

	// ex + GST = inc
	if (ex != null && gst != null && inc != null) {
		const ok = Math.abs(ex + gst - inc) <= 2;
		add(
			"total",
			ok,
			ok ? "Ex‑GST + GST = total" : `${money(ex)} + ${money(gst)} = ${money(ex + gst)}, not ${money(inc)}`,
		);
	}

	// Line items sum to the subtotal
	const lines = q.lineItems ?? [];
	if (lines.length > 0 && ex != null) {
		const sum = lines.reduce((n, l) => n + l.amountCents, 0);
		const tol = Math.max(5, Math.round(ex * 0.001));
		if (Math.abs(sum - ex) <= tol) {
			add("line_items", true, `${lines.length} line items add up to the ex‑GST subtotal`);
		} else if (inc != null && Math.abs(sum - inc) <= tol) {
			add("line_items", true, `${lines.length} line items add up to the total (they include GST)`);
		} else {
			add("line_items", false, `Line items add up to ${money(sum)}, not the ${money(ex)} subtotal`);
		}
	}

	// ABN
	if (!q.abn) {
		add("abn", false, "No ABN found on the quote");
	} else {
		const ok = isValidAbn(q.abn);
		add(
			"abn",
			ok,
			ok ? `ABN ${formatAbn(q.abn)} passes the checksum` : `ABN ${q.abn} fails the ATO checksum`,
		);
	}

	// Dates
	if (q.quoteDate) {
		const d = parseDay(q.quoteDate);
		if (d > today + DAY) add("quote_date", false, `Quote date ${q.quoteDate} is in the future`);
		else if (d < today - 3 * 365 * DAY)
			add("quote_date", false, `Quote date ${q.quoteDate} is over 3 years old`);
		else add("quote_date", true, "Quote date is plausible");
	} else {
		add("quote_date", false, "No quote date found");
	}
	if (q.validUntil) {
		const v = parseDay(q.validUntil);
		const d = q.quoteDate ? parseDay(q.quoteDate) : null;
		if (d !== null && v < d) add("valid_until", false, "Valid‑until is before the quote date");
		else if (d !== null && v > d + 2 * 365 * DAY)
			add("valid_until", false, "Valid‑until is over 2 years after the quote date");
		else if (v < today - DAY) add("valid_until", false, `Quote expired on ${q.validUntil}`);
		else add("valid_until", true, "Quote is still valid");
	}

	// Supplier
	const supplierMatch = q.supplierName
		? matchSupplier({ name: q.supplierName, abn: q.abn }, opts.suppliers ?? [])
		: null;
	if (!q.supplierName) add("supplier", false, "No supplier name found");
	else if (supplierMatch) {
		add(
			"supplier",
			true,
			supplierMatch.score === 1 && normalizeAbn(supplierMatch.abn) === normalizeAbn(q.abn)
				? `Matches existing supplier ${supplierMatch.name} by ABN`
				: `Looks like existing supplier ${supplierMatch.name} (${Math.round(supplierMatch.score * 100)}% match)`,
		);
	} else add("supplier", true, `New supplier: ${q.supplierName}`);

	return { checks, warnings: checks.filter((c) => !c.ok).map((c) => c.message), supplierMatch };
}
