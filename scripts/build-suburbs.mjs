#!/usr/bin/env node
/**
 * Builds src/client/data/au-suburbs.json, the offline suburb → state + postcode list the project form
 * suggests from, out of Geoscape G-NAF (data.gov.au, CC BY 4.0). Run it again to pick up a newer release.
 * Usage: node scripts/build-suburbs.mjs [G-NAF zip URL]
 *
 * The G-NAF zip is ~1.9 GB; only the LOCALITY and ADDRESS_DETAIL tables (~600 MB compressed) are read,
 * straight out of the remote zip with HTTP range requests. A locality's postcodes are the ones its live
 * addresses use; a postcode carrying under 2% of a locality's addresses is treated as noise.
 */
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";

const PACKAGE = "https://data.gov.au/data/api/3/action/package_show?id=geocoded-national-address-file-g-naf";
const OUT = new URL("../src/client/data/au-suburbs.json", import.meta.url);
const STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

const url = process.argv[2] ?? (await latestZip());
console.log(`G-NAF: ${url}`);

const range = async (start, end) => {
	const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
	if (res.status !== 206) throw new Error(`Range request failed: ${res.status}`);
	return res;
};
const bytes = async (start, end) => Buffer.from(await (await range(start, end)).arrayBuffer());

const entries = await centralDirectory();
const entry = (state, table) => {
	const e = entries.find((x) => x.name.endsWith(`/Standard/${state}_${table}_psv.psv`));
	if (!e) throw new Error(`No ${state} ${table} in the zip`);
	return e;
};

/** "suburb|STATE|postcode" rows; a locality with no live addresses yet keeps its primary postcode, if any. */
const rows = new Set();
for (const state of STATES) {
	const localities = new Map(); // pid → { name, postcode, counts }
	for await (const r of table(entry(state, "LOCALITY"))) {
		if (r.DATE_RETIRED) continue;
		localities.set(r.LOCALITY_PID, {
			name: titleCase(r.LOCALITY_NAME),
			postcode: r.PRIMARY_POSTCODE,
			counts: new Map(),
		});
	}
	for await (const r of table(entry(state, "ADDRESS_DETAIL"))) {
		if (r.DATE_RETIRED || !r.POSTCODE) continue;
		const counts = localities.get(r.LOCALITY_PID)?.counts;
		counts?.set(r.POSTCODE, (counts.get(r.POSTCODE) ?? 0) + 1);
	}
	const before = rows.size;
	for (const l of localities.values()) {
		const total = [...l.counts.values()].reduce((a, b) => a + b, 0);
		const postcodes = [...l.counts].filter(([, n]) => n / total >= 0.02).map(([p]) => p);
		if (!postcodes.length) postcodes.push(l.postcode ?? "");
		for (const p of postcodes) rows.add(`${l.name}|${state}|${p}`);
	}
	console.log(`${state}: ${rows.size - before} suburbs`);
}

// By suburb, then state and postcode, so "Box Hill" sorts before "Box Hill North" (the form relies on it).
const byParts = (a, b) => {
	const [x, y] = [a.toLowerCase().split("|"), b.toLowerCase().split("|")];
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
	return 0;
};
const sorted = [...rows].sort(byParts);
writeFileSync(OUT, `${JSON.stringify(sorted)}\n`);
console.log(`Wrote ${sorted.length} rows to ${OUT.pathname}`);

async function latestZip() {
	const { result } = await (await fetch(PACKAGE)).json();
	const zip = result.resources.find((r) => r.format === "ZIP" && r.name.includes("GDA2020"));
	if (!zip) throw new Error("Couldn't find the G-NAF zip on data.gov.au; pass its URL");
	return zip.url;
}

/** Reads the zip's central directory (no zip64: the archive is under 4 GB). */
async function centralDirectory() {
	const head = await fetch(url, { method: "HEAD" });
	const size = Number(head.headers.get("content-length"));
	const tail = await bytes(Math.max(0, size - 65_557), size - 1);
	const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (eocd < 0) throw new Error("Not a zip file");
	const cdSize = tail.readUInt32LE(eocd + 12);
	const cdOffset = tail.readUInt32LE(eocd + 16);
	const cd = await bytes(cdOffset, cdOffset + cdSize - 1);
	const out = [];
	for (let i = 0; i < cd.length; ) {
		const nameLen = cd.readUInt16LE(i + 28);
		const extraLen = cd.readUInt16LE(i + 30);
		const commentLen = cd.readUInt16LE(i + 32);
		out.push({
			name: cd.toString("utf8", i + 46, i + 46 + nameLen),
			method: cd.readUInt16LE(i + 10),
			compressedSize: cd.readUInt32LE(i + 20),
			offset: cd.readUInt32LE(i + 42),
		});
		i += 46 + nameLen + extraLen + commentLen;
	}
	return out;
}

/** Streams a pipe-separated table out of the zip as one object per row, keyed by the header. */
async function* table(e) {
	const local = await bytes(e.offset, e.offset + 29);
	const start = e.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
	const res = await range(start, start + e.compressedSize - 1);
	let stream = Readable.fromWeb(res.body);
	if (e.method === 8) stream = stream.pipe(createInflateRaw());
	let header;
	for await (const line of createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })) {
		const cells = line.split("|");
		if (!header) header = cells;
		else yield Object.fromEntries(header.map((h, i) => [h, cells[i]]));
	}
}

/** "MCMAHONS POINT" → "McMahons Point", "D'AGUILAR" → "D'Aguilar". */
function titleCase(s) {
	return s
		.toLowerCase()
		.replace(/(^|[\s'-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())
		.replace(/\bMc(\p{L})/gu, (_, c) => `Mc${c.toUpperCase()}`);
}
