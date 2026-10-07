/**
 * Scanned PDFs (phone scanner apps, office copiers) are one JPEG per page plus, at best, a machine OCR text
 * layer — which is junk for handwriting. `toMarkdown` only reads that layer, so these PDFs are spotted here
 * and their page images handed to the vision model instead, the same way an uploaded photo is.
 * No PDF library: scanned pages are stored as plain DCTDecode (JPEG) streams that can be copied out as-is.
 */

/** Below this, an embedded JPEG is a logo or stamp, not a scanned page. */
const MIN_PAGE_IMAGE_BYTES = 30 * 1024;

/** Full-page JPEGs embedded in the PDF, in file order. Images with any other filter (Flate, JBIG2…) are skipped. */
export function pdfPageJpegs(bytes: ArrayBuffer): Uint8Array[] {
	const data = new Uint8Array(bytes);
	// latin1 maps each byte to one char, so string offsets are byte offsets.
	const src = new TextDecoder("latin1").decode(data);
	const out: Uint8Array[] = [];
	let from = 0;
	for (;;) {
		const start = src.indexOf("stream", from);
		if (start < 0) break;
		const end = src.indexOf("endstream", start + 6);
		if (end < 0) break;
		from = end + 9;
		if (src.startsWith("end", start - 3)) continue; // matched the tail of a previous "endstream"
		const dictStart = src.lastIndexOf("<<", start);
		const dict = dictStart >= 0 ? src.slice(dictStart, start) : "";
		const filters = dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1] ?? "";
		if (!/\/Subtype\s*\/Image/.test(dict) || filters.replace(/[[\]\s]/g, "") !== "/DCTDecode") continue;
		let body = start + 6;
		if (src[body] === "\r") body++;
		if (src[body] === "\n") body++;
		const jpeg = data.subarray(body, end);
		if (jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg.byteLength >= MIN_PAGE_IMAGE_BYTES) out.push(jpeg);
	}
	return out;
}

/** Page objects in the PDF (`/Type /Page`, not the `/Pages` tree nodes). */
export function pdfPageCount(bytes: ArrayBuffer): number {
	const src = new TextDecoder("latin1").decode(bytes);
	return src.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
}

/**
 * True when the text layer is too thin to be the document: fewer than ~25 real words per page. Typed quotes
 * run to hundreds; a handwritten scan's OCR layer is stray symbols. `toMarkdown`'s metadata block is ignored.
 */
export function looksScanned(markdown: string, pages: number): boolean {
	const contents = markdown.split(/^## Contents\s*$/m)[1] ?? markdown;
	const words = contents.match(/\b[A-Za-z]{3,}\b/g)?.length ?? 0;
	return words < 25 * Math.max(1, pages);
}
