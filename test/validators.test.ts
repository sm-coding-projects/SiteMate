import { describe, expect, it } from "vitest";
import type { QuoteFields } from "../src/shared/schemas";
import { isValidAbn, matchSupplier, nameSimilarity, validateQuote } from "../src/shared/validators";

const TODAY = Date.parse("2026-10-03T00:00:00Z");

const quote = (over: Partial<QuoteFields> = {}): QuoteFields => ({
	supplierName: "Harbour Frames Pty Ltd",
	abn: "51 824 753 556",
	trade: "Framing",
	quoteNumber: "Q-1042",
	quoteDate: "2026-09-20",
	validUntil: "2026-12-20",
	lineItems: [
		{ description: "Wall frames", amountCents: 1_850_000 },
		{ description: "Roof trusses", amountCents: 1_150_000 },
	],
	amountExGstCents: 3_000_000,
	gstCents: 300_000,
	amountIncGstCents: 3_300_000,
	...over,
});
const failed = (r: ReturnType<typeof validateQuote>) => r.checks.filter((c) => !c.ok).map((c) => c.id);

describe("ABN mod-89 checksum", () => {
	it("accepts valid ABNs with or without spaces", () => {
		expect(isValidAbn("51 824 753 556")).toBe(true); // ATO's published example
		expect(isValidAbn("51824753556")).toBe(true);
	});
	it("rejects wrong digits, wrong length and junk", () => {
		expect(isValidAbn("51 824 753 557")).toBe(false);
		expect(isValidAbn("1234567890")).toBe(false);
		expect(isValidAbn("")).toBe(false);
		expect(isValidAbn(null)).toBe(false);
		expect(isValidAbn("ABN 51 824 753 55X")).toBe(false);
	});
});

describe("validateQuote", () => {
	it("passes a consistent quote", () => {
		const r = validateQuote(quote(), { today: TODAY });
		expect(failed(r)).toEqual([]);
		expect(r.warnings).toEqual([]);
	});

	it("flags GST that isn't ~10%", () => {
		expect(
			failed(validateQuote(quote({ gstCents: 250_000, amountIncGstCents: 3_250_000 }), { today: TODAY })),
		).toEqual(["gst_rate"]);
		// Rounding of a few cents is fine.
		expect(
			failed(validateQuote(quote({ gstCents: 300_004, amountIncGstCents: 3_300_004 }), { today: TODAY })),
		).toEqual([]);
	});

	it("flags totals that don't add up", () => {
		expect(failed(validateQuote(quote({ amountIncGstCents: 3_400_000 }), { today: TODAY }))).toEqual([
			"total",
		]);
	});

	it("checks line items against the subtotal, accepting GST-inclusive lines", () => {
		const off = validateQuote(quote({ lineItems: [{ description: "x", amountCents: 100 }] }), {
			today: TODAY,
		});
		expect(failed(off)).toEqual(["line_items"]);
		const incl = validateQuote(quote({ lineItems: [{ description: "all", amountCents: 3_300_000 }] }), {
			today: TODAY,
		});
		expect(failed(incl)).toEqual([]);
	});

	it("flags an invalid or missing ABN", () => {
		expect(failed(validateQuote(quote({ abn: "51 824 753 557" }), { today: TODAY }))).toEqual(["abn"]);
		expect(failed(validateQuote(quote({ abn: null }), { today: TODAY }))).toEqual(["abn"]);
	});

	it("sanity-checks dates", () => {
		expect(
			failed(validateQuote(quote({ quoteDate: "2027-01-01", validUntil: "2027-02-01" }), { today: TODAY })),
		).toEqual(["quote_date"]);
		expect(failed(validateQuote(quote({ validUntil: "2026-09-01" }), { today: TODAY }))).toContain(
			"valid_until",
		);
		expect(failed(validateQuote(quote({ validUntil: "2026-09-30" }), { today: TODAY }))).toEqual([
			"valid_until",
		]);
		expect(
			failed(validateQuote(quote({ quoteDate: "2020-01-01", validUntil: null }), { today: TODAY })),
		).toEqual(["quote_date"]);
	});

	it("requires all three amounts", () => {
		expect(failed(validateQuote(quote({ gstCents: null }), { today: TODAY }))).toContain("amounts");
	});
});

describe("supplier fuzzy match", () => {
	const suppliers = [
		{ id: "s1", name: "Harbour Frames", abn: null, trade: "Framing" },
		{ id: "s2", name: "Coastal Plumbing Services Pty Ltd", abn: "51824753556", trade: "Plumbing" },
	];
	it("ignores company suffixes and punctuation", () => {
		expect(nameSimilarity("Harbour Frames Pty. Ltd.", "HARBOUR FRAMES")).toBe(1);
		expect(nameSimilarity("Harbour Frames", "Harbor Frames")).toBeGreaterThan(0.8);
		expect(nameSimilarity("Harbour Frames", "Westside Electrical")).toBeLessThan(0.4);
	});
	it("prefers an exact ABN match", () => {
		expect(matchSupplier({ name: "Totally different", abn: "51 824 753 556" }, suppliers)?.id).toBe("s2");
	});
	it("matches by name above the threshold only", () => {
		expect(matchSupplier({ name: "Harbor Frames P/L", abn: null }, suppliers)?.id).toBe("s1");
		expect(matchSupplier({ name: "Sydney Tiling", abn: null }, suppliers)).toBeNull();
	});
	it("reports the match in the validation result", () => {
		const r = validateQuote(quote({ abn: null }), { today: TODAY, suppliers });
		expect(r.supplierMatch?.id).toBe("s1");
	});
});
