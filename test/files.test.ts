import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { FileEntry, Page, SignedUrl, UploadTicket } from "../src/shared/api-types";
import { ADMIN, api, createProject, VIEWER } from "./helpers";

/** The object key the server chose, read back from the presigned URL. */
const keyOf = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").slice(2).join("/"));

async function presign(projectId: string, body: Record<string, unknown>) {
	return api<UploadTicket>(`/projects/${projectId}/files`, { as: ADMIN, method: "POST", body });
}

describe("presigned uploads", () => {
	it("issues a signed PUT for a server-generated key, then completes and lists the photo", async () => {
		const projectId = await createProject();
		const bytes = new Uint8Array(1234);
		const res = await presign(projectId, {
			filename: "..<slab> pour?.jpg",
			mimeType: "image/jpeg",
			sizeBytes: bytes.length,
			category: "photo",
			caption: "Slab pour",
			withThumb: true,
			thumbBytes: 100,
		});
		expect(res.status).toBe(201);
		const url = new URL(res.body.uploadUrl);
		expect(url.hostname).toBe(`${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
		expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
		expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
		expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
		expect(res.body.uploadHeaders["Content-Type"]).toBe("image/jpeg");

		const key = keyOf(res.body.uploadUrl);
		// Client-supplied path segments never reach the key.
		expect(key).toBe(`projects/${projectId}/${res.body.fileId}/slab-pour.jpg`);
		expect(keyOf(res.body.thumbUploadUrl ?? "")).toBe(`projects/${projectId}/${res.body.fileId}/thumb.webp`);

		// Not uploaded yet → 409.
		const early = await api(`/files/${res.body.fileId}/complete`, { as: ADMIN, method: "POST" });
		expect(early.status).toBe(409);

		// Simulate the browser's PUTs.
		await env.FILES.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
		await env.FILES.put(keyOf(res.body.thumbUploadUrl ?? ""), new Uint8Array(100), {
			httpMetadata: { contentType: "image/webp" },
		});
		const done = await api<{ extractionId: string | null }>(`/files/${res.body.fileId}/complete`, {
			as: ADMIN,
			method: "POST",
		});
		expect(done.status).toBe(200);
		expect(done.body.extractionId).toBeNull(); // photos are not extracted

		const list = await api<Page<FileEntry>>(`/projects/${projectId}/files?kind=photos`, { as: VIEWER });
		expect(list.body.items).toHaveLength(1);
		expect(list.body.items[0]?.caption).toBe("Slab pour");
		expect(list.body.items[0]?.thumbUrl).toContain("X-Amz-Signature=");

		const dl = await api<SignedUrl>(`/files/${res.body.fileId}/url?download=1`, { as: VIEWER });
		expect(dl.status).toBe(200);
		expect(new URL(dl.body.url).searchParams.get("response-content-disposition")).toMatch(/^attachment/);
		// Download URLs are stable within the hour so the browser can cache them.
		const again = await api<SignedUrl>(`/files/${res.body.fileId}/url?download=1`, { as: VIEWER });
		expect(again.body.url).toBe(dl.body.url);
	});

	it("enforces type and size limits", async () => {
		const projectId = await createProject();
		const traversal = await presign(projectId, {
			filename: "../../etc/passwd",
			mimeType: "application/pdf",
			sizeBytes: 10,
			category: "document",
		});
		expect(traversal.status).toBe(400);
		const pdfAsPhoto = await presign(projectId, {
			filename: "a.pdf",
			mimeType: "application/pdf",
			sizeBytes: 10,
			category: "photo",
		});
		expect(pdfAsPhoto.status).toBe(400);
		const tooBig = await presign(projectId, {
			filename: "plans.pdf",
			mimeType: "application/pdf",
			sizeBytes: 26 * 1024 * 1024,
			category: "plan",
		});
		expect(tooBig.status).toBe(400);
		const exe = await presign(projectId, {
			filename: "x.exe",
			mimeType: "application/x-msdownload",
			sizeBytes: 10,
			category: "document",
		});
		expect(exe.status).toBe(400);
	});

	it("discards an upload whose size differs from what was approved", async () => {
		const projectId = await createProject();
		const res = await presign(projectId, {
			filename: "quote.pdf",
			mimeType: "application/pdf",
			sizeBytes: 100,
			category: "quote",
		});
		await env.FILES.put(keyOf(res.body.uploadUrl), new Uint8Array(5000), {
			httpMetadata: { contentType: "application/pdf" },
		});
		const done = await api(`/files/${res.body.fileId}/complete`, { as: ADMIN, method: "POST" });
		expect(done.status).toBe(400);
		expect(await env.FILES.head(keyOf(res.body.uploadUrl))).toBeNull();
	});

	it("completing a document queues an extraction", async () => {
		const projectId = await createProject();
		const pdf = new TextEncoder().encode("%PDF-1.4 test");
		const res = await presign(projectId, {
			filename: "Quote 1042.pdf",
			mimeType: "application/pdf",
			sizeBytes: pdf.length,
			category: "quote",
		});
		await env.FILES.put(keyOf(res.body.uploadUrl), pdf, { httpMetadata: { contentType: "application/pdf" } });
		const done = await api<{ extractionId: string }>(`/files/${res.body.fileId}/complete`, {
			as: ADMIN,
			method: "POST",
		});
		expect(done.body.extractionId).toBeTruthy();
		const row = await env.DB.prepare("select status from document_extractions where id = ?")
			.bind(done.body.extractionId)
			.first();
		expect(row?.status).toBeTypeOf("string");

		const docs = await api<Page<FileEntry>>(`/projects/${projectId}/files?kind=documents`, { as: ADMIN });
		expect(docs.body.items[0]?.extraction?.id).toBe(done.body.extractionId);

		// Soft delete hides it but keeps the row.
		await api(`/files/${res.body.fileId}`, { as: ADMIN, method: "DELETE" });
		const after = await api<Page<FileEntry>>(`/projects/${projectId}/files?kind=documents`, { as: ADMIN });
		expect(after.body.items).toHaveLength(0);
	});
});
