import { createExecutionContext, createMessageBatch, env, getQueueResult } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobMessage, ProjectDetail, ProjectSummary, Team } from "../src/shared/api-types";
import { handleQueue } from "../src/worker/queue";
import type { Bindings } from "../src/worker/types";
import { ADMIN, api, createProject, shareWith, VIEWER } from "./helpers";
import { fakeClerk } from "./mock-clerk";

const send = vi.fn(async (_payload: { to: string }, _opts?: unknown) => ({
	data: { id: `re_${crypto.randomUUID()}` },
	error: null,
}));
vi.mock("resend", () => ({
	Resend: class {
		emails = { send };
	},
}));

const asClerkUser = (role: string, extra: Record<string, unknown> = {}) =>
	({
		publicMetadata: { role, ...extra },
		primaryEmailAddress: { emailAddress: VIEWER.email },
		emailAddresses: [],
	}) as never;

/** An uploaded file row, so /files/:id/url has something to sign. */
async function uploadedFile(projectId: string) {
	const id = `file_${crypto.randomUUID().slice(0, 8)}`;
	await env.DB.prepare(
		`insert into files (id, project_id, category, r2_key, filename, mime_type, size_bytes, upload_status, uploaded_by)
		 values (?, ?, 'document', ?, 'plan.pdf', 'application/pdf', 1, 'uploaded', ?)`,
	)
		.bind(id, projectId, `projects/${projectId}/${id}`, ADMIN.id)
		.run();
	return id;
}

beforeEach(async () => {
	send.mockClear();
	await env.DB.prepare("delete from project_access").run();
	await env.DB.prepare("delete from email_log").run();
});

describe("viewers see only the projects shared with them", () => {
	it("lists only shared projects and answers 404 for the rest, however it's reached", async () => {
		const shared = await createProject("Shared House");
		const hidden = await createProject("Hidden House", { share: false });

		const list = await api<{ items: ProjectSummary[] }>("/projects?status=all", { as: VIEWER });
		const names = list.body.items.map((p) => p.name);
		expect(names).toContain("Shared House");
		expect(names).not.toContain("Hidden House");

		expect((await api(`/projects/${shared}`, { as: VIEWER })).status).toBe(200);
		const detail = (await api<ProjectDetail>(`/projects/${hidden}`, { as: ADMIN })).body;
		const fileId = await uploadedFile(hidden);
		for (const path of [
			`/projects/${hidden}`,
			`/projects/${hidden}/notes`,
			`/projects/${hidden}/activity`,
			`/projects/${hidden}/files?kind=photos`,
			`/projects/${hidden}/quotes`,
			`/stages/${detail.stages[0]?.id}/items`,
			`/files/${fileId}/url`,
		]) {
			expect((await api(path, { as: VIEWER })).status, path).toBe(404);
		}
		// Admins see everything without being listed.
		expect((await api(`/projects/${hidden}`, { as: ADMIN })).status).toBe(200);
		expect((await api(`/files/${fileId}/url`, { as: ADMIN })).status).toBe(200);
	});

	it("a viewer with nothing shared sees an empty list", async () => {
		await createProject("Unshared", { share: false });
		await api("/me", { as: VIEWER });
		const list = await api<{ items: ProjectSummary[] }>("/projects?status=all", { as: VIEWER });
		expect(list.status).toBe(200);
		expect(list.body.items).toEqual([]);
	});
});

describe("admins manage a viewer's projects", () => {
	it("replaces the set, shows it on Team, and logs it", async () => {
		const a = await createProject("Alpha", { share: false });
		const b = await createProject("Beta", { share: false });
		await shareWith(a);

		fakeClerk.users.getUser.mockResolvedValueOnce(asClerkUser("viewer"));
		const res = await api<{ projectIds: string[] }>(`/admin/users/${VIEWER.id}/projects`, {
			as: ADMIN,
			method: "PUT",
			body: { projectIds: [b, "not_a_project"] },
		});
		expect(res.status).toBe(200);
		expect(res.body.projectIds).toEqual([b]);

		const list = await api<{ items: ProjectSummary[] }>("/projects?status=all", { as: VIEWER });
		expect(list.body.items.map((p) => p.name)).toEqual(["Beta"]);

		fakeClerk.users.getUserList.mockResolvedValueOnce({
			data: [{ id: VIEWER.id, publicMetadata: { role: "viewer" }, emailAddresses: [], banned: false }],
			totalCount: 1,
		} as never);
		const team = await api<Team>("/admin/team", { as: ADMIN });
		expect(team.body.members[0]?.projectIds).toEqual([b]);
		expect(team.body.projects.map((p) => p.name)).toEqual(expect.arrayContaining(["Alpha", "Beta"]));

		const log = await env.DB.prepare(
			"select meta from activity where action = 'user.projects_changed'",
		).first<{
			meta: string;
		}>();
		expect(JSON.parse(log?.meta ?? "{}")).toEqual({ email: VIEWER.email, projects: 1 });
	});

	it("refuses to give an admin a project list", async () => {
		fakeClerk.users.getUser.mockResolvedValueOnce(asClerkUser("admin"));
		const res = await api(`/admin/users/user_other_admin/projects`, {
			as: ADMIN,
			method: "PUT",
			body: { projectIds: [] },
		});
		expect(res.status).toBe(400);
	});

	it("invites a viewer with projects, and their first sign-in turns them into access", async () => {
		const p = await createProject("Invited House", { share: false });
		const invite = await api("/admin/invitations", {
			as: ADMIN,
			method: "POST",
			body: { email: "new.viewer@example.com", role: "viewer", projectIds: [p, "gone"] },
		});
		expect(invite.status).toBe(201);
		expect(fakeClerk.invitations.createInvitation).toHaveBeenLastCalledWith(
			expect.objectContaining({ publicMetadata: { role: "viewer", projectIds: [p] } }),
		);

		// Clerk copies the invitation's metadata to the new user; their first request seeds project_access.
		const newViewer = { ...VIEWER, id: "user_new_viewer", email: "new.viewer@example.com" };
		fakeClerk.users.getUser.mockResolvedValueOnce(asClerkUser("viewer", { projectIds: [p, "gone"] }));
		const list = await api<{ items: ProjectSummary[] }>("/projects?status=all", { as: newViewer });
		expect(list.body.items.map((x) => x.name)).toEqual(["Invited House"]);
	});
});

describe("stage emails", () => {
	async function completeStage(projectId: string) {
		const stage = (await api<ProjectDetail>(`/projects/${projectId}`, { as: ADMIN })).body.stages[0];
		if (!stage) throw new Error("stage");
		const batch = createMessageBatch<JobMessage>("sitemate-jobs", [
			{
				id: crypto.randomUUID(),
				timestamp: new Date(),
				attempts: 1,
				body: { type: "notify", kind: "stage_completed", projectId, stageId: stage.id, actorId: ADMIN.id },
			},
		]);
		const e = { ...env, RESEND_API_KEY: "re_test", EMAIL_MODE: "live" } as Bindings;
		await handleQueue(batch, e);
		await getQueueResult(batch, createExecutionContext());
	}

	it("go to viewers only for projects shared with them", async () => {
		await api("/me", { as: VIEWER });
		await completeStage(await createProject("Not theirs", { share: false }));
		expect(send.mock.calls.map((c) => c[0].to)).not.toContain(VIEWER.email);

		await completeStage(await createProject("Theirs"));
		expect(send.mock.calls.map((c) => c[0].to)).toContain(VIEWER.email);
	});
});
