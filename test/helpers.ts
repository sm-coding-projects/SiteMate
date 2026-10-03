import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";

export const ADMIN = { id: "user_admin", email: "admin@example.com", name: "Ada Admin", role: "admin" };
export const VIEWER = { id: "user_viewer", email: "viewer@example.com", name: "Vic Viewer", role: "viewer" };
export type TestUser = typeof ADMIN;

/** Calls the Worker's fetch handler as `as` (or anonymously). JSON in, JSON out. */
export async function api<T = unknown>(
	path: string,
	{ as, method = "GET", body }: { as?: TestUser; method?: string; body?: unknown } = {},
) {
	const headers = new Headers();
	if (as) headers.set("x-test-user", JSON.stringify(as));
	if (body !== undefined) headers.set("Content-Type", "application/json");
	const res = await exports.default.fetch(
		new Request(`http://localhost/api${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
	const text = await res.text();
	return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

/** Gives a viewer access to a project (what Team → Projects does), creating their users row first. */
export async function shareWith(projectId: string, user: TestUser = VIEWER) {
	await api("/me", { as: user });
	await env.DB.prepare("insert or ignore into project_access (project_id, user_id) values (?, ?)")
		.bind(projectId, user.id)
		.run();
}

/** Creates a project as ADMIN, shared with VIEWER unless `share` is false. */
export async function createProject(name = "14 Banksia St", { share = true } = {}) {
	const res = await api<{ id: string }>("/projects", {
		as: ADMIN,
		method: "POST",
		body: { name, suburb: "Marsden Park", siteAddress: "14 Banksia Street" },
	});
	if (res.status !== 201) throw new Error(`createProject failed: ${res.status} ${JSON.stringify(res.body)}`);
	if (share) await shareWith(res.body.id);
	return res.body.id;
}
