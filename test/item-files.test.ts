import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ActivityEntry, Page, ProjectDetail } from "../src/shared/api-types";
import { ADMIN, api, createProject, VIEWER } from "./helpers";

let seq = 0;
/** An uploaded file row, straight into D1 (the upload flow itself is covered in files.test.ts). */
async function addFile(
	projectId: string,
	category: string,
	filename: string,
	opts: { uploaded?: boolean } = {},
) {
	const id = `01JFILE${String(++seq).padStart(19, "0")}`;
	await env.DB.prepare(
		`INSERT INTO files (id, project_id, category, r2_key, filename, mime_type, size_bytes, upload_status, uploaded_by, uploaded_at)
		 VALUES (?, ?, ?, ?, ?, ?, 1000, ?, ?, ?)`,
	)
		.bind(
			id,
			projectId,
			category,
			`projects/${projectId}/${id}/${filename}`,
			filename,
			category === "photo" ? "image/jpeg" : "application/pdf",
			opts.uploaded === false ? "pending" : "uploaded",
			ADMIN.id,
			Date.now(),
		)
		.run();
	return id;
}

async function firstItem(projectId: string) {
	const p = await api<ProjectDetail>(`/projects/${projectId}`, { as: VIEWER });
	const item = p.body.stages[0]?.items[0];
	if (!item) throw new Error("project has no items");
	return item;
}

const attach = (itemId: string, fileIds: string[], as = ADMIN) =>
	api<{ changed: boolean; error?: string }>(`/items/${itemId}/files`, {
		as,
		method: "PUT",
		body: { fileIds },
	});

describe("checklist item attachments", () => {
	it("attaches existing photos and documents, shown to everyone on the project", async () => {
		const projectId = await createProject("Attach St");
		const photo = await addFile(projectId, "photo", "slab.jpg");
		const cert = await addFile(projectId, "certificate", "Termite cert.pdf");
		const item = await firstItem(projectId);
		expect(item.attachments).toEqual([]);

		const res = await attach(item.id, [photo, cert]);
		expect(res.status).toBe(200);
		expect(res.body.changed).toBe(true);

		const after = await firstItem(projectId);
		expect(after.attachments.map((a) => [a.fileId, a.filename, a.category])).toEqual([
			[photo, "slab.jpg", "photo"],
			[cert, "Termite cert.pdf", "certificate"],
		]);

		// Same set again is a no-op.
		expect((await attach(item.id, [cert, photo])).body.changed).toBe(false);
	});

	it("replaces the set, detaches, and logs both in the activity feed", async () => {
		const projectId = await createProject("Detach St");
		const a = await addFile(projectId, "photo", "a.jpg");
		const b = await addFile(projectId, "document", "b.pdf");
		const item = await firstItem(projectId);
		await attach(item.id, [a, b]);
		await attach(item.id, [b]);
		expect((await firstItem(projectId)).attachments.map((x) => x.fileId)).toEqual([b]);
		await attach(item.id, []);
		expect((await firstItem(projectId)).attachments).toEqual([]);

		const feed = await api<Page<ActivityEntry>>(`/projects/${projectId}/activity`, { as: VIEWER });
		const actions = feed.body.items.map((e) => [e.action, e.meta?.count]);
		expect(actions).toEqual(
			expect.arrayContaining([
				["item.files_attached", 2],
				["item.files_detached", 1],
			]),
		);
	});

	it("is admin-only", async () => {
		const projectId = await createProject("Viewer St");
		const f = await addFile(projectId, "photo", "v.jpg");
		const item = await firstItem(projectId);
		expect((await attach(item.id, [f], VIEWER)).status).toBe(403);
	});

	it("rejects files from another project, pending uploads and deleted files", async () => {
		const projectId = await createProject("Mine St");
		const other = await createProject("Theirs St");
		const foreign = await addFile(other, "photo", "theirs.jpg");
		const pending = await addFile(projectId, "photo", "half.jpg", { uploaded: false });
		const deleted = await addFile(projectId, "document", "gone.pdf");
		await env.DB.prepare("UPDATE files SET deleted_at = ? WHERE id = ?").bind(Date.now(), deleted).run();
		const item = await firstItem(projectId);
		for (const id of [foreign, pending, deleted]) {
			const res = await attach(item.id, [id]);
			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/aren't in this project/);
		}
		expect((await attach(item.id, ["not-a-real-id"])).status).toBe(400);
	});

	it("hides a file once it's deleted, and drops links when the item is removed", async () => {
		const projectId = await createProject("Cleanup St");
		const f = await addFile(projectId, "document", "spec.pdf");
		const item = await firstItem(projectId);
		await attach(item.id, [f]);

		expect((await api(`/files/${f}`, { as: ADMIN, method: "DELETE" })).status).toBe(200);
		expect((await firstItem(projectId)).attachments).toEqual([]);

		const g = await addFile(projectId, "photo", "keep.jpg");
		await attach(item.id, [g]);
		expect((await api(`/items/${item.id}`, { as: ADMIN, method: "DELETE" })).status).toBe(200);
		const links = await env.DB.prepare("SELECT count(*) AS n FROM item_files WHERE item_id = ?")
			.bind(item.id)
			.first<{ n: number }>();
		expect(links?.n).toBe(0);
	});
});
