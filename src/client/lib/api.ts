import type { ApiError } from "../../shared/api-types";

export class ApiRequestError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
	/** No response at all: offline, flaky 4G or a timeout. Safe to retry. */
	get offline() {
		return this.status === 0;
	}
}

const OFFLINE_MESSAGE = "Couldn't reach SiteMate. Check your signal — your change wasn't saved.";

type GetToken = () => Promise<string | null>;

/** Same-origin fetch to /api with the Clerk session token as a Bearer header. */
export async function apiFetch<T>(path: string, getToken: GetToken, init?: RequestInit): Promise<T> {
	const token = await getToken();
	const headers = new Headers(init?.headers);
	if (token) headers.set("Authorization", `Bearer ${token}`);
	if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

	let res: Response;
	try {
		res = await fetch(`/api${path}`, { ...init, headers });
	} catch {
		throw new ApiRequestError(0, OFFLINE_MESSAGE);
	}
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as ApiError | null;
		throw new ApiRequestError(res.status, body?.error ?? res.statusText);
	}
	return res.json() as Promise<T>;
}

/** A sentence for the user, whatever went wrong. */
export function errorMessage(err: unknown) {
	if (err instanceof ApiRequestError) {
		if (err.status === 403) return "You have view-only access. Ask an admin to make this change.";
		return err.message;
	}
	if (typeof navigator !== "undefined" && !navigator.onLine) return OFFLINE_MESSAGE;
	return err instanceof Error ? err.message : "Something went wrong";
}
