/**
 * Presigned R2 URLs via R2's S3-compatible API (docs/DESIGN.md §4). The browser PUTs and GETs objects
 * directly, so file bytes never pass through the Worker. Server-side reads/HEADs use the FILES binding.
 */
import { AwsClient } from "aws4fetch";
import type { Bindings } from "../types";

export const UPLOAD_URL_TTL_S = 5 * 60;
/** Download links: signed for a time bucket so the same URL repeats for an hour and the browser caches it. */
const DOWNLOAD_BUCKET_S = 60 * 60;
const DOWNLOAD_URL_TTL_S = 2 * DOWNLOAD_BUCKET_S;

type R2Env = Pick<Bindings, "R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET">;

export const r2Configured = (env: R2Env) =>
	Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);

// One client per isolate and key: aws4fetch caches the derived signing key on the instance, so signing a
// page of thumbnails costs one HMAC chain instead of one per URL (Workers free plan: 10 ms CPU/request).
let cached: { id: string; client: AwsClient } | null = null;

function client(env: R2Env) {
	const id = env.R2_ACCESS_KEY_ID ?? "";
	if (cached?.id === id) return cached.client;
	const c = new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
		secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
		service: "s3",
		region: "auto",
	});
	cached = { id, client: c };
	return c;
}

const objectUrl = (env: R2Env, key: string) =>
	`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET || "sitemate-files"}/${key
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`;

/** aws4fetch wants a compact ISO-8601 timestamp: 20261003T040000Z. */
const amzDate = (ms: number) => new Date(ms).toISOString().replace(/[:-]|\.\d{3}/g, "");

/**
 * Presigned PUT. Content-Type and Content-Length are signed too (`allHeaders`), so R2 rejects
 * a different type or size from the one the server approved.
 */
export async function presignPut(env: R2Env, key: string, contentType: string, sizeBytes: number) {
	const url = new URL(objectUrl(env, key));
	url.searchParams.set("X-Amz-Expires", String(UPLOAD_URL_TTL_S));
	const headers = { "Content-Type": contentType, "Content-Length": String(sizeBytes) };
	const signed = await client(env).sign(url.toString(), {
		method: "PUT",
		headers,
		aws: { signQuery: true, allHeaders: true },
	});
	// Browsers set Content-Length themselves (and forbid setting it), so only Content-Type is sent explicitly.
	return { url: signed.url, headers: { "Content-Type": contentType } };
}

/** Presigned GET, stable for the current hour so thumbnails stay in the browser cache. */
export async function presignGet(
	env: R2Env,
	key: string,
	opts: { filename?: string; inline?: boolean } = {},
) {
	const now = Date.now();
	const bucketStart = Math.floor(now / 1000 / DOWNLOAD_BUCKET_S) * DOWNLOAD_BUCKET_S * 1000;
	const url = new URL(objectUrl(env, key));
	url.searchParams.set("X-Amz-Expires", String(DOWNLOAD_URL_TTL_S));
	if (opts.filename) {
		const disposition = opts.inline === false ? "attachment" : "inline";
		url.searchParams.set(
			"response-content-disposition",
			`${disposition}; filename*=UTF-8''${encodeURIComponent(opts.filename)}`,
		);
	}
	const signed = await client(env).sign(url.toString(), {
		method: "GET",
		aws: { signQuery: true, datetime: amzDate(bucketStart) },
	});
	return { url: signed.url, expiresAt: bucketStart + DOWNLOAD_URL_TTL_S * 1000 };
}

/** Signs a list of (possibly null) thumbnail keys; nulls and an unconfigured R2 yield null. */
export async function signThumbUrls(env: R2Env, keys: (string | null)[]) {
	if (!r2Configured(env)) return keys.map(() => null);
	return Promise.all(keys.map((k) => (k ? presignGet(env, k).then((s) => s.url) : null)));
}

/** R2 key layout from docs/DESIGN.md §4. The file name is sanitised; the server always builds the key. */
export function fileKeys(projectId: string, fileId: string, filename: string) {
	const safe =
		filename
			.normalize("NFKD")
			.replace(/[^\w.\- ]+/g, "")
			.replace(/\s+/g, "-")
			.replace(/^[.-]+/, "")
			.slice(-120) || "file";
	const base = `projects/${projectId}/${fileId}`;
	return { key: `${base}/${safe}`, thumbKey: `${base}/thumb.webp` };
}
