/**
 * Address suggestions for the project form, with no API key or account:
 * - street addresses from Photon (photon.komoot.io), a free public OpenStreetMap geocoder;
 * - suburb → state + postcode from a bundled list built out of G-NAF (scripts/build-suburbs.mjs).
 * Both are hints only: new estates are often in neither, so every field stays free text.
 */
import type { AuState } from "../../shared/api-types";
import { AU_STATES } from "../../shared/schemas";

export interface SuburbOption {
	suburb: string;
	state: AuState;
	postcode: string;
}

export interface AddressOption extends Partial<SuburbOption> {
	siteAddress: string;
	/** One line for the suggestion list. */
	label: string;
}

// ── Suburbs ──────────────────────────────────────────────────────────────────

let suburbs: Promise<SuburbOption[]> | null = null;

/** The suburb list (~115 KB gzipped), fetched once on first use as its own chunk. */
export function loadSuburbs() {
	suburbs ??= import("@/data/au-suburbs.json").then(({ default: rows }) =>
		rows.map((row) => {
			const [suburb, state, postcode] = row.split("|") as [string, AuState, string];
			return { suburb, state, postcode };
		}),
	);
	// A failed chunk load (offline) shouldn't stick: let the next focus retry.
	suburbs.catch(() => {
		suburbs = null;
	});
	return suburbs;
}

/** Expects the list sorted by name (as built). Name prefix matches first, then a word inside the name ("park" → "Marsden Park"); digits match postcodes. */
export function matchSuburbs(list: SuburbOption[], query: string, limit = 8): SuburbOption[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	if (/^\d+$/.test(q)) return list.filter((s) => s.postcode.startsWith(q)).slice(0, limit);
	const starts: SuburbOption[] = [];
	const words: SuburbOption[] = [];
	for (const s of list) {
		const name = s.suburb.toLowerCase();
		if (name.startsWith(q)) starts.push(s);
		else if (words.length < limit && name.includes(` ${q}`)) words.push(s);
		if (starts.length >= limit) break;
	}
	return [...starts, ...words].slice(0, limit);
}

// ── Street addresses (Photon) ────────────────────────────────────────────────

const PHOTON = "https://photon.komoot.io/api/";
/** Mainland Australia and Tasmania. */
const AU_BBOX = "112.9,-43.7,153.7,-10.6";

const STATE_NAMES: Record<string, AuState> = {
	"australian capital territory": "ACT",
	"new south wales": "NSW",
	"northern territory": "NT",
	queensland: "QLD",
	"south australia": "SA",
	tasmania: "TAS",
	victoria: "VIC",
	"western australia": "WA",
};

interface PhotonProps {
	type?: string;
	name?: string;
	housenumber?: string;
	street?: string;
	locality?: string;
	district?: string;
	city?: string;
	state?: string;
	postcode?: string;
	countrycode?: string;
}

/**
 * Up to 6 Australian street/house matches. Throws on network errors and aborts; callers ignore both.
 * OSM often knows a street but not each house on it (new estates especially), so a house number typed at
 * the start is put on every street it matched, and those come first.
 */
export async function searchAddresses(query: string, signal?: AbortSignal): Promise<AddressOption[]> {
	const params = new URLSearchParams({ q: query, limit: "8", lang: "en", bbox: AU_BBOX });
	params.append("layer", "house");
	params.append("layer", "street");
	const [res, list] = await Promise.all([fetch(`${PHOTON}?${params}`, { signal }), loadSuburbs()]);
	if (!res.ok) throw new Error(`Photon ${res.status}`);
	const body = (await res.json()) as { features?: { properties: PhotonProps }[] };
	const typed = houseNumber(query);
	const seen = new Set<string>();
	const withTyped: AddressOption[] = [];
	const others: AddressOption[] = [];
	const add = (option: AddressOption | null, to: AddressOption[]) => {
		if (!option || seen.has(option.label)) return;
		seen.add(option.label);
		to.push(option);
	};
	for (const { properties } of body.features ?? []) {
		if (typed) add(toOption(properties, list, typed), withTyped);
		// A bare street is no use once a number is typed; other house numbers may be a typo, so keep them.
		if (!typed || properties.type !== "street") add(toOption(properties, list), others);
	}
	return [...withTyped, ...others].slice(0, 6);
}

/** The house number a query starts with: "31", "31A", "3/31", "12-14", "Lot 5". */
export function houseNumber(query: string): string | undefined {
	const m = /^\s*((?:lot\s+)?\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?)(?=[\s,]|$)/i.exec(query);
	if (!m?.[1] || m[1] === query.trim()) return undefined;
	return m[1]
		.replace(/\s*([-/])\s*/g, "$1")
		.replace(/^lot\s+/i, "Lot ")
		.replace(/[a-z]$/, (c) => c.toUpperCase());
}

/**
 * OSM's idea of "suburb" varies by area: Photon puts it in `district`, `locality` (sometimes an estate) or
 * `city` (sometimes the whole metro, "Sydney"). The first candidate that is a real suburb in the G-NAF
 * list wins, which also fills a missing postcode. `number` replaces the house number (or adds one to a street).
 */
export function toOption(p: PhotonProps, list: SuburbOption[], number?: string): AddressOption | null {
	if (p.countrycode && p.countrycode !== "AU") return null;
	const street = p.type === "street" ? p.name : p.street;
	const siteAddress = [number ?? p.housenumber, street].filter(Boolean).join(" ");
	if (!street) return null;
	const state = p.state ? (STATE_NAMES[p.state.toLowerCase()] ?? toState(p.state)) : undefined;
	const candidates = [p.district, p.locality, p.city].filter((c): c is string => Boolean(c));
	const inState = (s: SuburbOption) => !state || s.state === state;
	let known: SuburbOption | undefined;
	for (const c of candidates) {
		const name = c.toLowerCase();
		const matches = list.filter((s) => s.suburb.toLowerCase() === name && inState(s));
		known = matches.find((s) => s.postcode === p.postcode) ?? matches[0];
		if (known) break;
	}
	const suburb = known?.suburb ?? candidates[0];
	const postcode = p.postcode && /^\d{4}$/.test(p.postcode) ? p.postcode : known?.postcode;
	return {
		siteAddress,
		suburb,
		state: state ?? known?.state,
		postcode,
		label: [siteAddress, [suburb, state ?? known?.state, postcode].filter(Boolean).join(" ")]
			.filter(Boolean)
			.join(", "),
	};
}

function toState(s: string): AuState | undefined {
	const upper = s.toUpperCase();
	return (AU_STATES as readonly string[]).includes(upper) ? (upper as AuState) : undefined;
}

/** "14 Banksia Street, Marsden Park NSW 2765" from whichever parts a project has. */
export function formatAddress(p: {
	siteAddress: string | null;
	suburb: string | null;
	state: string | null;
	postcode: string | null;
}) {
	const locality = [p.suburb, p.state, p.postcode].filter(Boolean).join(" ");
	return [p.siteAddress, locality].filter(Boolean).join(", ");
}
