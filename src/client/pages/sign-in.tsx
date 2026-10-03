import { SignIn } from "@clerk/react";
import { Wordmark } from "@/components/wordmark";

/** Sign-in only: SiteMate is invite-only, so there is no sign-up route. */
export function SignInPage() {
	return (
		<main className="grid min-h-dvh place-items-center px-4 py-10">
			<div className="flex w-full max-w-sm flex-col items-center gap-6">
				<Wordmark className="text-xl" />
				<SignIn
					routing="path"
					path="/sign-in"
					fallbackRedirectUrl="/projects"
					withSignUp={false}
					appearance={{
						variables: {
							colorPrimary: "#ea580c",
							borderRadius: "0.5rem",
							fontFamily: "Inter Variable, sans-serif",
						},
						elements: {
							rootBox: "w-full",
							cardBox: "w-full border border-border shadow-none",
							formButtonPrimary: "min-h-11 text-[#0b0f14] font-semibold",
							formFieldInput: "min-h-11 text-base",
							footerAction: "hidden",
						},
					}}
				/>
				<p className="text-center text-sm text-muted-foreground">
					Access is by invitation. Ask your administrator for an invite.
				</p>
			</div>
		</main>
	);
}
