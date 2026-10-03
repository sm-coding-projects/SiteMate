import type { ApiError } from "../../shared/api-types";

export class ApiRequestError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

type GetToken = () => Promise<string | null>;

/** Same-origin fetch to /api with the Clerk session token as a Bearer header. */
export async function apiFetch<T>(path: string, getToken: GetToken, init?: RequestInit): Promise<T> {
	const token = await getToken();
	const headers = new Headers(init?.headers);
	if (token) headers.set("Authorization", `Bearer ${token}`);
	if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

	const res = await fetch(`/api${path}`, { ...init, headers });
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as ApiError | null;
		throw new ApiRequestError(res.status, body?.error ?? res.statusText);
	}
	return res.json() as Promise<T>;
}
