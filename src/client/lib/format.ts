/** Sydney-local formatting. Mono labels are uppercased by CSS (`.label-mono`). */
const TZ = "Australia/Sydney";

const dateFmt = new Intl.DateTimeFormat("en-AU", {
	day: "numeric",
	month: "short",
	year: "numeric",
	timeZone: TZ,
});
const shortDateFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("en-AU", {
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
	timeZone: TZ,
});
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

/** "3 Oct 2026" from unix ms or a YYYY-MM-DD string. */
export function formatDate(v: number | string | null | undefined) {
	if (v == null || v === "") return null;
	const d = typeof v === "string" ? new Date(`${v}T00:00:00+10:00`) : new Date(v);
	return dateFmt.format(d);
}

/** Activity-style: "09:42" today, "Yesterday", "28 Sep" this year, else "3 Oct 2025". */
export function formatWhen(ms: number, now = Date.now()) {
	const day = dayKeyFmt.format(ms);
	if (day === dayKeyFmt.format(now)) return timeFmt.format(ms);
	if (day === dayKeyFmt.format(now - 86_400_000)) return "Yesterday";
	if (new Date(ms).getFullYear() === new Date(now).getFullYear()) return shortDateFmt.format(ms);
	return dateFmt.format(ms);
}

/** "2h ago", "3d ago" — for card footers. */
export function timeAgo(ms: number, now = Date.now()) {
	const s = Math.max(0, Math.round((now - ms) / 1000));
	if (s < 60) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.round(h / 24);
	if (d < 30) return `${d}d ago`;
	return formatDate(ms) ?? "";
}

const aud = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
export const formatCents = (cents: number | null | undefined) =>
	cents == null ? "—" : aud.format(cents / 100);

/** Dollars typed by a person ("1,234.50") → integer cents, or null if it isn't a number. */
export function parseDollars(input: string): number | null {
	const cleaned = input.replace(/[$,\s]/g, "");
	if (cleaned === "") return null;
	const n = Number(cleaned);
	return Number.isFinite(n) ? Math.round(n * 100) : null;
}
export const centsToInput = (cents: number | null | undefined) =>
	cents == null ? "" : (cents / 100).toFixed(2);

export function formatBytes(n: number) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Trade terms use U+2011 so "Pre‑construction" never splits across lines (MASTER.md). */
export const nbHyphen = (s: string) => s.replace(/-/g, "‑");

/** "04/08" */
export const stageCode = (n: number, total: number) =>
	`${String(n).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
