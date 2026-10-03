import { SignIn, SignUp } from "@clerk/react";
import { Link } from "react-router";
import { HouseDrawing } from "@/components/brand/house-drawing";
import { StageBar } from "@/components/brand/stage-bar";
import { Wordmark } from "@/components/brand/wordmark";
import { useStageSequence } from "@/hooks/use-motion";

const INK = "#0f1214";
const HIVIS = "#e8ff3c";

/** Clerk flattened into our own card (MASTER.md → Components → Clerk). Hex because Clerk can't read CSS variables. */
const CLERK_APPEARANCE = {
	variables: {
		colorPrimary: HIVIS,
		colorPrimaryForeground: INK,
		colorForeground: INK,
		colorMutedForeground: "#5b6168",
		colorBorder: "#d9dcd6",
		colorRing: INK,
		colorShadow: "transparent",
		borderRadius: "0.375rem",
		fontFamily: "Archivo Variable, sans-serif",
	},
	elements: {
		rootBox: "w-full!",
		cardBox: "w-full! max-w-none! rounded-none! border-0! shadow-none!",
		card: "w-full! max-w-none! rounded-none! shadow-none! border-0! bg-transparent! px-6! pt-8! pb-6!",
		headerTitle: "font-heading text-xl! font-bold! [font-stretch:112.5%]",
		headerSubtitle: "text-sm!",
		socialButtonsBlockButton:
			"relative! min-h-11 border! border-[#d9dcd6]! shadow-none! transition-colors duration-[120ms] hover:bg-[#eceee9]!",
		lastAuthenticationStrategyBadge:
			"absolute! top-1/2! right-2! left-auto! -translate-y-1/2! rounded-[3px]! border-0! bg-[#eceee9]! px-1.5! py-0.5! font-mono! text-[0.6875rem]! font-medium! uppercase! tracking-wider! text-[#5b6168]! shadow-none!",
		formButtonPrimary:
			"min-h-11 bg-none! shadow-none! border! border-[#0f1214]! font-semibold transition-colors duration-[120ms] after:hidden! hover:bg-[#d6f01f]!",
		buttonArrowIcon: "hidden!",
		formFieldInput: "min-h-11 text-base shadow-none! border! border-solid! border-[#8a9096]!",
		footer: "bg-none! bg-transparent! border-t! border-[#d9dcd6]!",
		footerAction: "hidden",
	},
};

/**
 * Sign-in only: BFH App is invite-only, so there is no sign-up route.
 * Clerk is flattened into our own card so the 8-segment bar can sit on its top edge
 * (and morph in from the landing hero via the View Transitions API).
 */
export function SignInPage({ mode = "sign-in" }: { mode?: "sign-in" | "sign-up" }) {
	return (
		<div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
			<main className="flex flex-col px-4 py-6 md:px-10">
				<Link to="/" viewTransition aria-label="BFH App home" className="self-start">
					<Wordmark />
				</Link>
				<div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
					<div className="overflow-hidden rounded-md border bg-card">
						<StageBar
							current={4}
							transitionName="stage-bar"
							segmentClassName="h-1 rounded-none"
							className="gap-px"
						/>
						{mode === "sign-up" ? (
							// Only reachable from a Clerk invitation link (sign-up is restricted to invitees).
							<SignUp
								routing="path"
								path="/sign-up"
								fallbackRedirectUrl="/projects"
								signInUrl="/sign-in"
								appearance={CLERK_APPEARANCE}
							/>
						) : (
							<SignIn
								routing="path"
								path="/sign-in"
								fallbackRedirectUrl="/projects"
								withSignUp={false}
								appearance={CLERK_APPEARANCE}
							/>
						)}
					</div>
					<p className="mt-4 text-center text-sm text-muted-foreground">
						New to BFH App?{" "}
						<Link to="/#request-access" className="font-medium text-link underline-offset-4 hover:underline">
							Request access
						</Link>
					</p>
				</div>
			</main>
			<DrawingPanel />
		</div>
	);
}

/** Ink panel with the finished house; quietly redraws every 20s. Static under reduced motion. */
function DrawingPanel() {
	const built = useStageSequence({ stepMs: 450, startDelayMs: 200, replayEveryMs: 20_000 });
	return (
		<aside
			className="theme-ink relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-center"
			aria-hidden
		>
			<div className="bg-grid absolute inset-0 text-white" />
			<div className="relative mx-auto w-full max-w-[560px] px-10">
				<HouseDrawing built={built} className="text-survey" />
				<div className="mt-6 flex items-baseline justify-between">
					<span className="label-mono text-muted-foreground">
						STAGE 08/08 · <span className="text-hivis">HANDOVER</span>
					</span>
					<span className="label-mono text-muted-foreground">14 BANKSIA ST</span>
				</div>
			</div>
		</aside>
	);
}
