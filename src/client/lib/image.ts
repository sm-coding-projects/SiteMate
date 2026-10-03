/**
 * Browser-side photo processing (docs/DESIGN.md §4): photos are resized to ~2000px on the longest edge and
 * re-encoded to ~400 KB, and a small WebP thumbnail is made. Runs on the phone, never in the Worker.
 */
const MAX_EDGE = 2000;
const TARGET_BYTES = 400 * 1024;
const THUMB_EDGE = 480;

export interface ProcessedImage {
	blob: Blob;
	mimeType: string;
	thumb: Blob | null;
	thumbMimeType: "image/webp" | "image/jpeg";
}

function canvasFor(w: number, h: number) {
	if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	return c;
}

async function encode(
	canvas: OffscreenCanvas | HTMLCanvasElement,
	type: string,
	quality: number,
): Promise<Blob> {
	if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
	return new Promise((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode image"))), type, quality),
	);
}

function draw(bitmap: ImageBitmap, maxEdge: number) {
	const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
	const w = Math.max(1, Math.round(bitmap.width * scale));
	const h = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = canvasFor(w, h);
	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
	if (!ctx) throw new Error("Canvas unavailable");
	ctx.drawImage(bitmap, 0, 0, w, h);
	return canvas;
}

async function makeThumb(bitmap: ImageBitmap) {
	const canvas = draw(bitmap, THUMB_EDGE);
	const webp = await encode(canvas, "image/webp", 0.72);
	// Older Safari silently falls back to PNG for unsupported types.
	if (webp.type === "image/webp") return { thumb: webp, thumbMimeType: "image/webp" as const };
	return { thumb: await encode(canvas, "image/jpeg", 0.72), thumbMimeType: "image/jpeg" as const };
}

/** Resize + compress a photo, with a thumbnail. Falls back to the original if the browser can't decode it. */
export async function processPhoto(file: File): Promise<ProcessedImage> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
	} catch {
		// e.g. HEIC on a desktop browser: upload as-is, no thumbnail.
		return { blob: file, mimeType: file.type, thumb: null, thumbMimeType: "image/webp" };
	}
	try {
		let edge = MAX_EDGE;
		let blob: Blob | null = null;
		for (let attempt = 0; attempt < 4 && (!blob || blob.size > TARGET_BYTES); attempt++) {
			const canvas = draw(bitmap, edge);
			for (const q of [0.82, 0.72, 0.62]) {
				blob = await encode(canvas, "image/jpeg", q);
				if (blob.size <= TARGET_BYTES) break;
			}
			edge = Math.round(edge * 0.8);
		}
		const { thumb, thumbMimeType } = await makeThumb(bitmap);
		// Never upload something bigger than the original (e.g. an already small JPEG).
		const out = blob && blob.size < file.size ? blob : file;
		return { blob: out, mimeType: out === file ? file.type : "image/jpeg", thumb, thumbMimeType };
	} finally {
		bitmap.close();
	}
}

/** Scanned documents that are images get a thumbnail too, but are uploaded untouched. */
export async function thumbFor(file: File) {
	try {
		const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
		try {
			return await makeThumb(bitmap);
		} finally {
			bitmap.close();
		}
	} catch {
		return null;
	}
}
