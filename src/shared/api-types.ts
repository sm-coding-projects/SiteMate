/** Types shared between the Worker API and the SPA. */
export type Role = "admin" | "viewer";

export interface Me {
	id: string;
	email: string;
	name: string | null;
	role: Role;
}

export interface ApiError {
	error: string;
}

/** Messages carried on the `sitemate-jobs` queue. Extended in later build steps. */
export type JobMessage = { type: "ping"; requestedBy: string; at: number };
