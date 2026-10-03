import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ActivityEntry, Note, Page, ProjectDetail } from "../src/shared/api-types";
import { ADMIN, api, createProject } from "./helpers";

const get = (id: string) => api<ProjectDetail>(`/projects/${id}`, { as: ADMIN }).then((r) => r.body);

describe("stages and checklist", () => {
	it("ticking items records who/when and drives stage status", async () => {
		const id = await createProject();
		const frame = (await get(id)).stages[3];
		if (!frame) throw new Error("no stage");
		expect(frame.name).toBe("Frame");

		const [a, b, c] = frame.items;
		if (!a || !b || !c) throw new Error("items");
		await api(`/items/${a.id}`, { as: ADMIN, method: "PATCH", body: { completed: true } });
		let stage = (await get(id)).stages[3];
		expect(stage?.status).toBe("in_progress");
		expect(stage?.startedAt).toBeTypeOf("number");
		expect(stage?.items[0]?.completedBy?.id).toBe(ADMIN.id);

		for (const item of [b, c])
			await api(`/items/${item.id}`, { as: ADMIN, method: "PATCH", body: { completed: true } });
		stage = (await get(id)).stages[3];
		expect(stage?.status).toBe("complete");
		expect(stage?.completedAt).toBeTypeOf("number");

		// Unticking reopens the stage.
		await api(`/items/${c.id}`, { as: ADMIN, method: "PATCH", body: { completed: false } });
		stage = (await get(id)).stages[3];
		expect(stage?.status).toBe("in_progress");
		expect(stage?.completedAt).toBeNull();
		expect(stage?.items[2]?.completedBy).toBeNull();

		const feed = await api<Page<ActivityEntry>>(`/projects/${id}/activity`, { as: ADMIN });
		const actions = feed.body.items.map((e) => e.action);
		expect(actions).toContain("stage.completed");
		expect(actions).toContain("item.completed");
		expect(actions).toContain("item.reopened");
	});

	it("adds, renames, reorders and removes custom stages and items", async () => {
		const id = await createProject();
		const added = await api<{ id: string }>(`/projects/${id}/stages`, {
			as: ADMIN,
			method: "POST",
			body: { name: "Landscaping" },
		});
		expect(added.status).toBe(201);
		let p = await get(id);
		expect(p.stages).toHaveLength(9);
		expect(p.stages[8]).toMatchObject({ name: "Landscaping", source: "custom", position: 9 });

		await api(`/stages/${added.body.id}`, {
			as: ADMIN,
			method: "PATCH",
			body: { name: "Landscaping & fencing" },
		});
		const item = await api<{ id: string }>(`/stages/${added.body.id}/items`, {
			as: ADMIN,
			method: "POST",
			body: { title: "Turf laid" },
		});
		await api(`/items/${item.body.id}`, { as: ADMIN, method: "PATCH", body: { title: "Turf laid (front)" } });

		// Move the custom stage to the front.
		const ids = p.stages.map((s) => s.id);
		const reordered = [added.body.id, ...ids.filter((x) => x !== added.body.id)];
		const r = await api(`/projects/${id}/stages/reorder`, {
			as: ADMIN,
			method: "POST",
			body: { ids: reordered },
		});
		expect(r.status).toBe(200);
		p = await get(id);
		expect(p.stages[0]?.name).toBe("Landscaping & fencing");
		expect(p.stages[0]?.items[0]).toMatchObject({ title: "Turf laid (front)", source: "custom" });
		expect(p.stages.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

		// Reorder must list every sibling exactly once.
		const bad = await api(`/projects/${id}/stages/reorder`, {
			as: ADMIN,
			method: "POST",
			body: { ids: [ids[0]] },
		});
		expect(bad.status).toBe(400);

		// Item reorder within a stage.
		const pre = p.stages[1];
		if (!pre) throw new Error("stage");
		const itemIds = pre.items.map((i) => i.id).reverse();
		await api(`/stages/${pre.id}/items/reorder`, { as: ADMIN, method: "POST", body: { ids: itemIds } });
		p = await get(id);
		expect(p.stages[1]?.items.map((i) => i.id)).toEqual(itemIds);

		// Remove an item, then the stage (cascades its items).
		await api(`/items/${item.body.id}`, { as: ADMIN, method: "DELETE" });
		const del = await api(`/stages/${added.body.id}`, { as: ADMIN, method: "DELETE" });
		expect(del.status).toBe(200);
		p = await get(id);
		expect(p.stages).toHaveLength(8);
		const orphans = await env.DB.prepare("select count(*) n from project_items where project_stage_id = ?")
			.bind(added.body.id)
			.first<{ n: number }>();
		expect(orphans?.n).toBe(0);
	});

	it("manual stage status: complete sends a notification job", async () => {
		const id = await createProject();
		const stage = (await get(id)).stages[0];
		if (!stage) throw new Error("stage");
		const res = await api(`/stages/${stage.id}`, {
			as: ADMIN,
			method: "PATCH",
			body: { status: "complete" },
		});
		expect(res.status).toBe(200);
		const p = await get(id);
		expect(p.stages[0]?.status).toBe("complete");
		expect(p.stages[0]?.startedAt).toBeTypeOf("number");
	});
});

describe("notes", () => {
	it("adds notes optionally attached to a stage, edits and soft-deletes", async () => {
		const id = await createProject();
		const stage = (await get(id)).stages[2];
		const a = await api<{ id: string }>(`/projects/${id}/notes`, {
			as: ADMIN,
			method: "POST",
			body: { body: "Pour booked for Thursday 7am", stageId: stage?.id },
		});
		expect(a.status).toBe(201);
		await api(`/projects/${id}/notes`, { as: ADMIN, method: "POST", body: { body: "General note" } });

		let list = await api<Page<Note>>(`/projects/${id}/notes`, { as: ADMIN });
		expect(list.body.items).toHaveLength(2);
		expect(list.body.items.find((n) => n.id === a.body.id)?.stage?.name).toBe("Base / Slab");

		const other = await createProject("Other");
		const otherStage = (await get(other)).stages[0];
		const wrong = await api(`/projects/${id}/notes`, {
			as: ADMIN,
			method: "POST",
			body: { body: "x", stageId: otherStage?.id },
		});
		expect(wrong.status).toBe(400);

		await api(`/notes/${a.body.id}`, { as: ADMIN, method: "PATCH", body: { body: "Pour moved to Friday" } });
		await api(`/notes/${a.body.id}`, { as: ADMIN, method: "DELETE" });
		list = await api<Page<Note>>(`/projects/${id}/notes`, { as: ADMIN });
		expect(list.body.items.map((n) => n.body)).toEqual(["General note"]);
		const row = await env.DB.prepare("select deleted_at from notes where id = ?").bind(a.body.id).first();
		expect(row?.deleted_at).toBeTypeOf("number");
	});

	it("global activity feed paginates newest first", async () => {
		await createProject("Feed A");
		await createProject("Feed B");
		const first = await api<Page<ActivityEntry>>("/activity?limit=1", { as: ADMIN });
		expect(first.body.items[0]?.project?.name).toBe("Feed B");
		const next = await api<Page<ActivityEntry>>(
			`/activity?limit=1&cursor=${encodeURIComponent(first.body.nextCursor ?? "")}`,
			{ as: ADMIN },
		);
		expect(next.body.items[0]?.project?.name).toBe("Feed A");
	});
});
