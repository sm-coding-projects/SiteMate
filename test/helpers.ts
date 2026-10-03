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

export async function createProject(name = "14 Banksia St") {
	const res = await api<{ id: string }>("/projects", {
		as: ADMIN,
		method: "POST",
		body: { name, suburb: "Marsden Park", siteAddress: "14 Banksia Street" },
	});
	if (res.status !== 201) throw new Error(`createProject failed: ${res.status} ${JSON.stringify(res.body)}`);
	return res.body.id;
}
