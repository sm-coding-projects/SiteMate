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

/** Up to 6 Australian street/house matches. Throws on network errors and aborts; callers ignore both. */
export async function searchAddresses(query: string, signal?: AbortSignal): Promise<AddressOption[]> {
	const params = new URLSearchParams({ q: query, limit: "8", lang: "en", bbox: AU_BBOX });
	params.append("layer", "house");
	params.append("layer", "street");
	const [res, list] = await Promise.all([fetch(`${PHOTON}?${params}`, { signal }), loadSuburbs()]);
	if (!res.ok) throw new Error(`Photon ${res.status}`);
	const body = (await res.json()) as { features?: { properties: PhotonProps }[] };
	const seen = new Set<string>();
	const out: AddressOption[] = [];
	for (const { properties } of body.features ?? []) {
		const option = toOption(properties, list);
		if (!option || seen.has(option.label)) continue;
		seen.add(option.label);
		out.push(option);
		if (out.length === 6) break;
	}
	return out;
}

/**
 * OSM's idea of "suburb" varies by area: Photon puts it in `district`, `locality` (sometimes an estate) or
 * `city` (sometimes the whole metro, "Sydney"). The first candidate that is a real suburb in the G-NAF
 * list wins, which also fills a missing postcode.
 */
export function toOption(p: PhotonProps, list: SuburbOption[]): AddressOption | null {
	if (p.countrycode && p.countrycode !== "AU") return null;
	const siteAddress =
		p.type === "street" ? (p.name ?? "") : [p.housenumber, p.street].filter(Boolean).join(" ");
	if (!siteAddress) return null;
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
