/**
 * Replaces Clerk in tests. The signed-in user comes from an `x-test-user` header (JSON), which only exists
 * because this module mock replaces @clerk/hono — production code never reads that header.
 */
import { vi } from "vitest";

export const fakeClerk = {
	users: {
		getUser: vi.fn(),
		getUserList: vi.fn(async () => ({ data: [], totalCount: 0 })),
		updateUserMetadata: vi.fn(async (id: string, params: unknown) => ({ id, ...(params as object) })),
		banUser: vi.fn(async (id: string) => ({ id, banned: true, emailAddresses: [] })),
		unbanUser: vi.fn(async (id: string) => ({ id, banned: false, emailAddresses: [] })),
	},
	invitations: {
		getInvitationList: vi.fn(async () => ({ data: [], totalCount: 0 })),
		createInvitation: vi.fn(async (params: { emailAddress: string; publicMetadata?: unknown }) => ({
			id: "inv_test",
			emailAddress: params.emailAddress,
			publicMetadata: params.publicMetadata,
			status: "pending",
			createdAt: Date.now(),
		})),
		revokeInvitation: vi.fn(async (id: string) => ({ id, status: "revoked" })),
	},
};

vi.mock("@clerk/hono", () => ({
	clerkMiddleware: () => async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
		c.set("clerk", fakeClerk);
		await next();
	},
	getAuth: (c: { req: { header: (n: string) => string | undefined } }) => {
		const raw = c.req.header("x-test-user");
		if (!raw) return { userId: null, sessionClaims: null };
		const u = JSON.parse(raw) as { id: string; email: string; name?: string; role?: string };
		return { userId: u.id, sessionClaims: { email: u.email, name: u.name, role: u.role } };
	},
}));
