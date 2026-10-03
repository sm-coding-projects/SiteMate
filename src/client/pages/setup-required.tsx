import { KeyRound } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";

/** Shown instead of the app when the build has no Clerk publishable key. */
export function SetupRequired() {
	return (
		<main className="grid min-h-dvh place-items-center px-4 py-10">
			<div className="w-full max-w-md rounded-lg border bg-card p-6">
				<Wordmark />
				<h1 className="mt-6 flex items-center gap-2 text-xl font-semibold">
					<KeyRound className="size-5" aria-hidden /> Setup required
				</h1>
				<p className="mt-2 text-muted-foreground">
					<code className="font-mono text-sm text-foreground">VITE_CLERK_PUBLISHABLE_KEY</code> is not set.
					Copy <code className="font-mono text-sm text-foreground">.env.example</code> to{" "}
					<code className="font-mono text-sm text-foreground">.env</code>, add the key from Clerk → API keys,
					and restart the dev server. See the README for the full setup.
				</p>
			</div>
		</main>
	);
}
