/**
 * Stand-in for @clerk/react in UI tests (aliased in vite.e2e.config.ts). Always signed in; the API
 * fixtures decide whether that user is an admin or a viewer.
 */
import type { ReactNode } from "react";

export const ClerkProvider = ({ children }: { children: ReactNode }) => <>{children}</>;
export const useAuth = () => ({ isLoaded: true, isSignedIn: true, getToken: async () => "e2e-token" });
export const useUser = () => ({
	isLoaded: true,
	user: {
		fullName: "Sam Site",
		hasImage: false,
		imageUrl: "",
		primaryEmailAddress: { emailAddress: "sam@example.com" },
	},
});
export const useClerk = () => ({ signOut: async () => {}, openUserProfile: () => {} });
export const SignIn = () => <div data-testid="clerk-sign-in">Clerk sign-in</div>;
export const SignUp = () => <div data-testid="clerk-sign-up">Clerk sign-up</div>;
