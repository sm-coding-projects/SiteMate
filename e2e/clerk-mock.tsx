/**
 * Stand-in for @clerk/react in UI tests (aliased in vite.e2e.config.ts). Always signed in; the API
 * fixtures decide whether that user is an admin or a viewer (installApi sets window.__E2E_ROLE to match).
 */
import type { ReactNode } from "react";

export const ClerkProvider = ({ children }: { children: ReactNode }) => <>{children}</>;
// One function for the whole session, as Clerk's own getToken is: hooks depend on its identity.
const getToken = async () => "e2e-token";
export const useAuth = () => ({ isLoaded: true, isSignedIn: true, userId: "user_e2e", getToken });
export const useUser = () => ({
	isLoaded: true,
	user: {
		fullName: "Sam Site",
		hasImage: false,
		imageUrl: "",
		primaryEmailAddress: { emailAddress: "sam@example.com" },
		publicMetadata: { role: (globalThis as { __E2E_ROLE?: string }).__E2E_ROLE ?? "admin" },
	},
});
// Stable, like the real Clerk instance: the upload tray's effect depends on its identity.
const clerk = { user: { id: "user_e2e" }, signOut: async () => {}, openUserProfile: () => {} };
export const useClerk = () => clerk;
export const SignIn = () => <div data-testid="clerk-sign-in">Clerk sign-in</div>;
export const SignUp = () => <div data-testid="clerk-sign-up">Clerk sign-up</div>;
