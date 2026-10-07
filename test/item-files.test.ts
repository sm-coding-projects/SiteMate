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

	it("moves a file to a check in another stage, and removes one from a check", async () => {
		const projectId = await createProject("Move St");
		const plan = await addFile(projectId, "plan", "Structural drawings.pdf");
		const quote = await addFile(projectId, "quote", "Concrete quote.pdf");
		const p = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body;
		const [contract, engineering] = [p.stages[0]?.items[0], p.stages[0]?.items.at(-1)];
		const frame = p.stages[3]?.items[0];
		if (!contract || !engineering || !frame) throw new Error("fixture");
		await attach(contract.id, [plan, quote]);

		const moved = await api(`/items/${contract.id}/files/${plan}/move`, {
			as: ADMIN,
			method: "POST",
			body: { itemId: engineering.id },
		});
		expect(moved.status).toBe(200);
		// Into a check that already has it: just leaves the source.
		await attach(frame.id, [quote]);
		expect(
			(
				await api(`/items/${contract.id}/files/${quote}/move`, {
					as: ADMIN,
					method: "POST",
					body: { itemId: frame.id },
				})
			).status,
		).toBe(200);

		const files = async (id: string) =>
			(await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body.stages
				.flatMap((s) => s.items)
				.find((i) => i.id === id)
				?.attachments.map((a) => a.fileId);
		expect(await files(contract.id)).toEqual([]);
		expect(await files(engineering.id)).toEqual([plan]);
		expect(await files(frame.id)).toEqual([quote]);

		const removed = await api(`/items/${engineering.id}/files/${plan}`, { as: ADMIN, method: "DELETE" });
		expect(removed.status).toBe(200);
		expect(await files(engineering.id)).toEqual([]);
		// The file itself stays in the project.
		const kept = await env.DB.prepare("SELECT deleted_at FROM files WHERE id = ?")
			.bind(plan)
			.first<{ deleted_at: number | null }>();
		expect(kept).toEqual({ deleted_at: null });

		const feed = await api<Page<ActivityEntry>>(`/projects/${projectId}/activity`, { as: VIEWER });
		expect(feed.body.items.map((e) => [e.action, e.meta?.file])).toEqual(
			expect.arrayContaining([
				["item.file_moved", "Structural drawings.pdf"],
				["item.files_detached", "Structural drawings.pdf"],
			]),
		);
	});

	it("only moves or removes files that are on the check, within the project, as an admin", async () => {
		const projectId = await createProject("Guard St");
		const other = await createProject("Elsewhere St");
		const f = await addFile(projectId, "document", "a.pdf");
		const item = await firstItem(projectId);
		const foreignItem = await firstItem(other);
		const p = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body;
		const second = p.stages[0]?.items[1];
		if (!second) throw new Error("fixture");

		expect((await api(`/items/${item.id}/files/${f}`, { as: ADMIN, method: "DELETE" })).status).toBe(404);
		await attach(item.id, [f]);
		const move = (to: string, as = ADMIN) =>
			api(`/items/${item.id}/files/${f}/move`, { as, method: "POST", body: { itemId: to } });
		expect((await move(foreignItem.id)).status).toBe(400);
		expect((await move(item.id)).status).toBe(400);
		expect((await move(second.id, VIEWER)).status).toBe(403);
		expect((await api(`/items/${item.id}/files/${f}`, { as: VIEWER, method: "DELETE" })).status).toBe(403);
		expect((await firstItem(projectId)).attachments.map((a) => a.fileId)).toEqual([f]);
	});
});
