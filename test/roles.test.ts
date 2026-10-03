import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ProjectDetail, Team } from "../src/shared/api-types";
import { ADMIN, api, createProject, VIEWER } from "./helpers";
import { fakeClerk } from "./mock-clerk";

/** Every write route in the API. Viewers must get 403 on all of them, before validation or lookups. */
async function writeRoutes() {
	const projectId = await createProject();
	const p = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body;
	const stage = p.stages[0];
	const item = stage?.items[0];
	if (!stage || !item) throw new Error("fixture");
	const id = "01JAAAAAAAAAAAAAAAAAAAAAAA";
	return [
		["POST", "/projects", { name: "x" }],
		["PATCH", `/projects/${projectId}`, { name: "x" }],
		["POST", `/projects/${projectId}/archive`, {}],
		["POST", `/projects/${projectId}/stages`, { name: "x" }],
		["POST", `/projects/${projectId}/stages/reorder`, { ids: [stage.id] }],
		["PATCH", `/stages/${stage.id}`, { name: "x" }],
		["DELETE", `/stages/${stage.id}`, undefined],
		["POST", `/stages/${stage.id}/items`, { title: "x" }],
		["POST", `/stages/${stage.id}/items/reorder`, { ids: [item.id] }],
		["PATCH", `/items/${item.id}`, { completed: true }],
		["DELETE", `/items/${item.id}`, undefined],
		["POST", `/projects/${projectId}/notes`, { body: "x" }],
		["PATCH", `/notes/${id}`, { body: "x" }],
		["DELETE", `/notes/${id}`, undefined],
		[
			"POST",
			`/projects/${projectId}/files`,
			{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1, category: "photo" },
		],
		["POST", `/files/${id}/upload-urls`, {}],
		["POST", `/files/${id}/complete`, {}],
		["PATCH", `/files/${id}`, { caption: "x" }],
		["DELETE", `/files/${id}`, undefined],
		["POST", `/extractions/${id}/rerun`, {}],
		["POST", `/extractions/${id}/confirm`, { documentType: "other", fields: {} }],
		["PATCH", `/quotes/${id}/status`, { status: "accepted" }],
		["POST", "/admin/queue-ping", {}],
		["GET", "/admin/team", undefined],
		["POST", "/admin/invitations", { email: "a@b.co", role: "viewer" }],
		["DELETE", `/admin/invitations/${id}`, undefined],
		["PATCH", `/admin/users/${ADMIN.id}/role`, { role: "viewer" }],
		["POST", `/admin/users/${ADMIN.id}/remove-access`, undefined],
		["POST", `/admin/users/${ADMIN.id}/restore-access`, undefined],
		["DELETE", `/admin/users/${ADMIN.id}`, undefined],
	] as const;
}

describe("viewer role is read-only", () => {
	it("gets 403 on every write route and changes nothing", async () => {
		const routes = await writeRoutes();
		const before = await env.DB.prepare(
			"select (select count(*) from projects) p, (select count(*) from activity) a",
		).first();
		for (const [method, path, body] of routes) {
			const res = await api<{ error: string }>(path, { as: VIEWER, method, body });
			expect(res.status, `${method} ${path}`).toBe(403);
		}
		const after = await env.DB.prepare(
			"select (select count(*) from projects) p, (select count(*) from activity) a",
		).first();
		expect(after).toEqual(before);
		expect(fakeClerk.invitations.createInvitation).not.toHaveBeenCalled();
	});

	it("can still read everything and change their own preferences", async () => {
		const projectId = await createProject();
		for (const path of [
			"/projects",
			`/projects/${projectId}`,
			`/projects/${projectId}/notes`,
			`/projects/${projectId}/activity`,
			`/projects/${projectId}/files?kind=photos`,
			`/projects/${projectId}/quotes`,
			"/activity",
			"/extractions",
			"/suppliers",
			"/templates",
		]) {
			expect((await api(path, { as: VIEWER })).status, path).toBe(200);
		}
		const pref = await api<{ emailNotifications: boolean }>("/me/preferences", {
			as: VIEWER,
			method: "PATCH",
			body: { emailNotifications: false },
		});
		expect(pref.status).toBe(200);
		expect((await api<{ emailNotifications: boolean }>("/me", { as: VIEWER })).body.emailNotifications).toBe(
			false,
		);
	});

	it("unknown roles in the session token are treated as viewer", async () => {
		const odd = { ...VIEWER, id: "user_odd", email: "odd@example.com", role: "superuser" };
		expect((await api<{ role: string }>("/me", { as: odd })).body.role).toBe("viewer");
		expect((await api("/projects", { as: odd, method: "POST", body: { name: "x" } })).status).toBe(403);
	});
});

describe("team management (admin)", () => {
	it("invites through Clerk with the role in publicMetadata", async () => {
		const res = await api("/admin/invitations", {
			as: ADMIN,
			method: "POST",
			body: { email: "new.viewer@example.com", role: "viewer" },
		});
		expect(res.status).toBe(201);
		expect(fakeClerk.invitations.createInvitation).toHaveBeenCalledWith(
			expect.objectContaining({
				emailAddress: "new.viewer@example.com",
				publicMetadata: { role: "viewer" },
				redirectUrl: "http://localhost:5173/sign-up",
			}),
		);
		const team = await api<Team>("/admin/team", { as: ADMIN });
		expect(team.status).toBe(200);
	});

	it("removes and restores access: banned in Clerk, blocked at the API, logged", async () => {
		await api("/me", { as: VIEWER }); // creates the local row
		const self = await api<{ error: string }>(`/admin/users/${ADMIN.id}/remove-access`, {
			as: ADMIN,
			method: "POST",
		});
		expect(self.status).toBe(400);
		expect(fakeClerk.users.banUser).not.toHaveBeenCalledWith(ADMIN.id);

		const removed = await api(`/admin/users/${VIEWER.id}/remove-access`, { as: ADMIN, method: "POST" });
		expect(removed.status).toBe(200);
		expect(fakeClerk.users.banUser).toHaveBeenCalledWith(VIEWER.id);
		// A session token issued before the ban is still valid for a minute; the API refuses it anyway.
		expect((await api("/projects", { as: VIEWER })).status).toBe(403);

		const restored = await api(`/admin/users/${VIEWER.id}/restore-access`, { as: ADMIN, method: "POST" });
		expect(restored.status).toBe(200);
		expect(fakeClerk.users.unbanUser).toHaveBeenCalledWith(VIEWER.id);
		expect((await api("/projects", { as: VIEWER })).status).toBe(200);

		const log = await env.DB.prepare(
			"select action from activity where entity_id = ? and action like 'user.access_%' order by id",
		)
			.bind(VIEWER.id)
			.all<{ action: string }>();
		expect(log.results.map((r) => r.action)).toEqual(["user.access_removed", "user.access_restored"]);
	});

	it("permanently deletes viewers only, and blocks their old session", async () => {
		await api("/me", { as: VIEWER });
		const asClerkUser = (role: string, email: string) =>
			({
				publicMetadata: { role },
				primaryEmailAddress: { emailAddress: email },
				emailAddresses: [],
			}) as never;

		fakeClerk.users.getUser.mockResolvedValueOnce(asClerkUser("admin", "other.admin@example.com"));
		const admin = await api<{ error: string }>("/admin/users/user_other_admin", {
			as: ADMIN,
			method: "DELETE",
		});
		expect(admin.status).toBe(400);
		expect(admin.body.error).toMatch(/only viewers/i);
		expect(fakeClerk.users.deleteUser).not.toHaveBeenCalled();

		expect((await api(`/admin/users/${ADMIN.id}`, { as: ADMIN, method: "DELETE" })).status).toBe(400);

		fakeClerk.users.getUser.mockResolvedValueOnce(asClerkUser("viewer", VIEWER.email));
		const res = await api(`/admin/users/${VIEWER.id}`, { as: ADMIN, method: "DELETE" });
		expect(res.status).toBe(200);
		expect(fakeClerk.users.deleteUser).toHaveBeenCalledWith(VIEWER.id);
		expect((await api("/projects", { as: VIEWER })).status).toBe(403);
		const log = await env.DB.prepare("select meta from activity where action = 'user.deleted'").first<{
			meta: string;
		}>();
		expect(JSON.parse(log?.meta ?? "{}")).toEqual({ email: VIEWER.email });

		await env.DB.prepare("update users set access_revoked_at = null where id = ?").bind(VIEWER.id).run();
	});

	it("changes roles but never lets an admin demote themselves", async () => {
		fakeClerk.users.updateUserMetadata.mockResolvedValueOnce({
			id: VIEWER.id,
			primaryEmailAddress: { emailAddress: VIEWER.email },
			emailAddresses: [],
		} as never);
		await api("/me", { as: VIEWER }); // creates the local row
		const promote = await api(`/admin/users/${VIEWER.id}/role`, {
			as: ADMIN,
			method: "PATCH",
			body: { role: "admin" },
		});
		expect(promote.status).toBe(200);
		expect(fakeClerk.users.updateUserMetadata).toHaveBeenCalledWith(VIEWER.id, {
			publicMetadata: { role: "admin" },
		});
		const row = await env.DB.prepare("select role from users where id = ?").bind(VIEWER.id).first();
		expect(row?.role).toBe("admin");

		const self = await api(`/admin/users/${ADMIN.id}/role`, {
			as: ADMIN,
			method: "PATCH",
			body: { role: "viewer" },
		});
		expect(self.status).toBe(400);
	});
});
