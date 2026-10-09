/**
 * Upload queue that survives a flaky connection: jobs (with their compressed blobs) are persisted in
 * IndexedDB, uploaded one at a time, retried with backoff, resumed on `online` and after a reload.
 * Flow per job (docs/DESIGN.md §4): presign → PUT to R2 (with progress) → PUT thumbnail → complete.
 */
import type { UploadTicket } from "../../shared/api-types";
import { ApiRequestError, apiFetch } from "./api";

export type UploadStatus = "queued" | "uploading" | "waiting" | "failed";

export interface UploadJob {
	id: string;
	/** Clerk user who queued it: only their session may see or send it. */
	ownerId: string;
	projectId: string;
	category: string;
	stageId: string | null;
	caption: string | null;
	filename: string;
	mimeType: string;
	blob: Blob;
	thumb: Blob | null;
	thumbMimeType: "image/webp" | "image/jpeg";
	fileId?: string;
	ticket?: UploadTicket;
	status: UploadStatus;
	progress: number;
	attempts: number;
	error?: string;
	createdAt: number;
}

export type NewUpload = Pick<
	UploadJob,
	| "projectId"
	| "category"
	| "stageId"
	| "caption"
	| "filename"
	| "mimeType"
	| "blob"
	| "thumb"
	| "thumbMimeType"
>;

// ── IndexedDB (tiny wrapper; no dependency) ─────────────────────────────────

const DB_NAME = "sitemate-uploads";
const STORE = "jobs";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, mode);
		const req = fn(tx.objectStore(STORE));
		tx.oncomplete = () => resolve(req.result);
		tx.onerror = () => reject(tx.error);
	});
}

const persist = (job: UploadJob) => idb("readwrite", (s) => s.put(job)).catch(() => undefined);
const forget = (id: string) => idb("readwrite", (s) => s.delete(id)).catch(() => undefined);

// ── Manager ─────────────────────────────────────────────────────────────────

type GetToken = () => Promise<string | null>;
let getToken: GetToken = async () => null;
let onUploaded: (projectId: string) => void = () => {};
let userId: string | null = null;
let jobs: UploadJob[] = [];
let snapshot: readonly UploadJob[] = [];
let running = false;
let listening = false;
let activeXhr: XMLHttpRequest | undefined;
let wakeTimer: ReturnType<typeof setTimeout> | undefined;
let ownerTimer: ReturnType<typeof setTimeout> | undefined;
const restored = new Set<string>();
const listeners = new Set<() => void>();

/** Jobs belong to whoever queued them: everyone else's stay hidden and unsent. */
const mine = (job: UploadJob) => job.ownerId === userId;

function emit() {
	snapshot = jobs.filter(mine);
	for (const l of listeners) l();
}

function update(job: UploadJob, patch: Partial<UploadJob>, save = true) {
	Object.assign(job, patch);
	emit();
	if (save) void persist(job);
}

export const uploadQueue = {
	subscribe(l: () => void) {
		listeners.add(l);
		return () => listeners.delete(l);
	},
	getSnapshot: () => snapshot,

	/** Called by the app shell with the signed-in user and Clerk's token getter. Restores their unfinished uploads. */
	async start(owner: string, tokenGetter: GetToken, uploaded: (projectId: string) => void) {
		if (owner !== userId) activeXhr?.abort();
		userId = owner;
		getToken = tokenGetter;
		onUploaded = uploaded;
		emit();
		if (!listening) {
			listening = true;
			window.addEventListener("online", () => uploadQueue.kick(true));
		}
		if (!restored.has(owner)) {
			restored.add(owner);
			try {
				const saved = await idb<UploadJob[]>("readonly", (s) => s.getAll() as IDBRequest<UploadJob[]>);
				for (const j of saved) {
					// Queued before jobs recorded their owner: whose it is can't be known, so drop it unsent.
					if (!j.ownerId) void forget(j.id);
					else if (j.ownerId === owner && !jobs.some((x) => x.id === j.id))
						jobs.push({ ...j, status: j.status === "failed" ? "failed" : "queued" });
				}
				jobs.sort((a, b) => a.createdAt - b.createdAt);
				emit();
			} catch {
				// Private browsing etc.: queue still works in memory for this session.
			}
		}
		uploadQueue.kick();
	},

	/** `owner` signed out or switched account: hide and pause their uploads until they're back. */
	stop(owner: string) {
		if (owner !== userId) return;
		userId = null;
		activeXhr?.abort();
		emit();
	},

	async add(items: NewUpload[]) {
		const owner = userId;
		if (!owner) throw new Error("You're signed out. Sign in again to upload.");
		const now = Date.now();
		for (const [i, item] of items.entries()) {
			const job: UploadJob = {
				...item,
				id: `${now}-${i}-${Math.random().toString(36).slice(2, 8)}`,
				ownerId: owner,
				status: "queued",
				progress: 0,
				attempts: 0,
				createdAt: now + i,
			};
			jobs.push(job);
			await persist(job);
		}
		emit();
		uploadQueue.kick();
	},

	retry(id: string) {
		const job = jobs.find((j) => j.id === id);
		if (job) update(job, { status: "queued", error: undefined, attempts: 0 });
		uploadQueue.kick(true);
	},

	dismiss(id: string) {
		jobs = jobs.filter((j) => j.id !== id);
		void forget(id);
		emit();
	},

	/** Process the queue. `now` skips any backoff wait (back online, manual retry). */
	kick(now = false) {
		if (now) {
			clearTimeout(wakeTimer);
			for (const j of jobs) if (j.status === "waiting") update(j, { status: "queued" }, false);
		}
		if (running) return;
		void run();
	},
};

async function run() {
	running = true;
	try {
		let job: UploadJob | undefined;
		// biome-ignore lint/suspicious/noAssignInExpressions: queue drain loop
		while ((job = jobs.find((j) => mine(j) && j.status === "queued"))) {
			if (!navigator.onLine) {
				update(job, { status: "waiting", error: "Waiting for signal" }, false);
				continue;
			}
			if (await process(job)) {
				// Clerk switched account but the app hasn't caught up yet: look again shortly, don't spin.
				clearTimeout(ownerTimer);
				ownerTimer = setTimeout(() => uploadQueue.kick(), 2000);
				break;
			}
		}
	} finally {
		running = false;
	}
}

class Retryable extends Error {}

/** Thrown by the token getter when Clerk has already switched away from the queue's user. */
export class OwnerChanged extends Error {}

async function process(job: UploadJob) {
	// Each step runs with whoever is signed in now: stop as soon as that's no longer the job's owner.
	const own = () => {
		if (!mine(job)) throw new Error("Signed out");
	};
	update(job, { status: "uploading", error: undefined }, false);
	const api = <T>(path: string, init?: RequestInit) => {
		own();
		return apiFetch<T>(path, getToken, init);
	};
	const thumbBody = job.thumb ? { thumbBytes: job.thumb.size, thumbMimeType: job.thumbMimeType } : {};
	try {
		if (!job.fileId || !job.ticket) {
			const ticket = await api<UploadTicket>(`/projects/${job.projectId}/files`, {
				method: "POST",
				body: JSON.stringify({
					filename: job.filename,
					mimeType: job.mimeType,
					sizeBytes: job.blob.size,
					category: job.category,
					stageId: job.stageId,
					caption: job.caption,
					withThumb: Boolean(job.thumb),
					...thumbBody,
				}),
			});
			update(job, { fileId: ticket.fileId, ticket });
		} else if (job.ticket.expiresAt - 30_000 < Date.now()) {
			const ticket = await api<UploadTicket>(`/files/${job.fileId}/upload-urls`, {
				method: "POST",
				body: JSON.stringify(thumbBody),
			});
			update(job, { ticket });
		}
		const ticket = job.ticket as UploadTicket;
		const thumbShare = job.thumb ? 0.1 : 0;
		own();
		await put(ticket.uploadUrl, ticket.uploadHeaders, job.blob, (p) =>
			update(job, { progress: p * (0.95 - thumbShare) }, false),
		);
		if (job.thumb && ticket.thumbUploadUrl) {
			own();
			await put(ticket.thumbUploadUrl, ticket.thumbUploadHeaders ?? {}, job.thumb, (p) =>
				update(job, { progress: 0.85 + p * 0.1 }, false),
			);
		}
		await api(`/files/${job.fileId}/complete`, { method: "POST" });
		update(job, { progress: 1 }, false);
		jobs = jobs.filter((j) => j !== job);
		void forget(job.id);
		emit();
		onUploaded(job.projectId);
	} catch (err) {
		if (!mine(job) || err instanceof OwnerChanged) {
			// Owner signed out or switched account mid-upload: park it, keeping its file and ticket, until they're back.
			update(job, { status: "queued", progress: 0 }, false);
			return mine(job);
		}
		const transient =
			err instanceof Retryable ||
			(err instanceof ApiRequestError &&
				(err.offline || err.status >= 500 || err.status === 409 || err.status === 429));
		if (transient) {
			const attempts = job.attempts + 1;
			const delay = Math.min(60_000, 2000 * 2 ** Math.min(attempts, 5));
			// Signature expired mid-way (403 from R2): drop the ticket so the next attempt gets fresh URLs.
			const patch: Partial<UploadJob> = {
				status: "waiting",
				attempts,
				error: "Connection dropped — will retry",
			};
			if (err instanceof Retryable && err.message === "expired")
				patch.ticket = { ...(job.ticket as UploadTicket), expiresAt: 0 };
			update(job, patch);
			clearTimeout(wakeTimer);
			wakeTimer = setTimeout(() => uploadQueue.kick(true), delay);
		} else {
			update(job, {
				status: "failed",
				error: err instanceof Error ? err.message : "Upload failed",
			});
		}
	}
}

/** XHR PUT straight to R2, for upload progress (fetch has none). */
function put(url: string, headers: Record<string, string>, body: Blob, onProgress: (p: number) => void) {
	return new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		activeXhr = xhr;
		xhr.open("PUT", url);
		for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
		xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) resolve();
			else if (xhr.status === 403) reject(new Retryable("expired"));
			else if (xhr.status >= 500) reject(new Retryable(`Storage error ${xhr.status}`));
			else reject(new Error(`Upload rejected by storage (${xhr.status})`));
		};
		xhr.onerror = () => reject(new Retryable("network"));
		xhr.ontimeout = () => reject(new Retryable("timeout"));
		xhr.onabort = () => reject(new Retryable("aborted"));
		xhr.onloadend = () => {
			if (activeXhr === xhr) activeXhr = undefined;
		};
		xhr.timeout = 5 * 60_000;
		xhr.send(body);
	});
}
