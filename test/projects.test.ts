import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ActivityEntry, Page, ProjectDetail, ProjectSummary } from "../src/shared/api-types";
import { ADMIN, api, createProject, VIEWER } from "./helpers";

describe("auth", () => {
	it("health is public", async () => {
		const res = await api<{ ok: boolean }>("/health");
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
	});

	it("rejects anonymous API calls with 401", async () => {
		expect((await api("/me")).status).toBe(401);
		expect((await api("/projects")).status).toBe(401);
	});

	it("/me reflects the session role and upserts the user", async () => {
		const res = await api<{ role: string; emailNotifications: boolean }>("/me", { as: ADMIN });
		expect(res.status).toBe(200);
		expect(res.body.role).toBe("admin");
		expect(res.body.emailNotifications).toBe(true);
		const row = await env.DB.prepare("select role from users where id = ?").bind(ADMIN.id).first();
		expect(row?.role).toBe("admin");
	});
});

describe("projects", () => {
	it("creates a project from the NSW template in one batch", async () => {
		const id = await createProject();
		const res = await api<ProjectDetail>(`/projects/${id}`, { as: VIEWER });
		expect(res.status).toBe(200);
		expect(res.body.stages.map((s) => s.name)).toEqual([
			"Pre-construction",
			"Site preparation",
			"Base / Slab",
			"Frame",
			"Lock-up",
			"Fixing",
			"Practical completion",
			"Handover & defects",
		]);
		expect(res.body.stages.flatMap((s) => s.items)).toHaveLength(30);
		expect(res.body.stages.every((s) => s.source === "template" && s.status === "not_started")).toBe(true);
		expect(res.body.stages[0]?.items.map((i) => i.title)).toContain("HBCF insurance certificate");

		const activity = await api<Page<ActivityEntry>>(`/projects/${id}/activity`, { as: ADMIN });
		expect(activity.body.items[0]?.action).toBe("project.created");
	});

	it("validates the body with the shared schema", async () => {
		const res = await api<{ error: string }>("/projects", { as: ADMIN, method: "POST", body: { name: "" } });
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/name/);
		const bad = await api("/projects", {
			as: ADMIN,
			method: "POST",
			body: { name: "X", startDate: "2026-02-30" },
		});
		expect(bad.status).toBe(400);
	});

	it("lists, filters, searches and paginates", async () => {
		const a = await createProject("Alpha House");
		await createProject("Bravo Duplex");
		const c = await createProject("Charlie Granny Flat");
		await api(`/projects/${c}/archive`, { as: ADMIN, method: "POST" });

		const open = await api<Page<ProjectSummary>>("/projects?q=a", { as: VIEWER });
		const names = open.body.items.map((p) => p.name);
		expect(names).toContain("Alpha House");
		expect(names).not.toContain("Charlie Granny Flat");

		const archived = await api<Page<ProjectSummary>>("/projects?status=archived", { as: VIEWER });
		expect(archived.body.items.map((p) => p.name)).toEqual(["Charlie Granny Flat"]);

		const search = await api<Page<ProjectSummary>>("/projects?q=Marsden", { as: VIEWER });
		expect(search.body.items.length).toBeGreaterThanOrEqual(2);

		const first = await api<Page<ProjectSummary>>("/projects?limit=1&status=all", { as: VIEWER });
		expect(first.body.items).toHaveLength(1);
		expect(first.body.nextCursor).toBeTruthy();
		const second = await api<Page<ProjectSummary>>(
			`/projects?limit=1&status=all&cursor=${encodeURIComponent(first.body.nextCursor ?? "")}`,
			{ as: VIEWER },
		);
		expect(second.body.items[0]?.id).not.toBe(first.body.items[0]?.id);

		const card = open.body.items.find((p) => p.id === a);
		expect(card?.stages).toHaveLength(8);
		expect(card?.itemsTotal).toBe(30);
	});

	it("edits and archives", async () => {
		const id = await createProject();
		const patch = await api(`/projects/${id}`, {
			as: ADMIN,
			method: "PATCH",
			body: { clientName: "Nguyen family", status: "on_hold" },
		});
		expect(patch.status).toBe(200);
		const res = await api<ProjectDetail>(`/projects/${id}`, { as: ADMIN });
		expect(res.body.clientName).toBe("Nguyen family");
		expect(res.body.status).toBe("on_hold");
	});
});
