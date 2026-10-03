import { SignIn, SignUp } from "@clerk/react";
import { HouseDrawing } from "@/components/brand/house-drawing";
import { StageBar } from "@/components/brand/stage-bar";
import { Wordmark } from "@/components/brand/wordmark";
import { useStageSequence } from "@/hooks/use-motion";
import { useIsDark } from "@/hooks/use-theme";
import { siteUrl } from "@/lib/hosts";

const INK = "#0f1214";
const HIVIS = "#e8ff3c";

/** The globals.css tokens Clerk needs, per theme. Hex because Clerk's variables can't read CSS variables. */
const PALETTE = {
	light: {
		fg: INK,
		muted: "#5b6168",
		card: "#ffffff",
		line: "#d9dcd6",
		danger: "#b91c1c",
		ring: INK,
	},
	dark: {
		fg: "#eef0ec",
		muted: "#9aa1a8",
		card: "#171b1e",
		line: "#2a2f33",
		danger: "#f87171",
		ring: HIVIS,
	},
};

/** Clerk flattened into our own card (MASTER.md → Components → Clerk), in the page's light or dark palette. */
function clerkAppearance(dark: boolean) {
	const c = dark ? PALETTE.dark : PALETTE.light;
	return {
		variables: {
			colorPrimary: HIVIS,
			colorPrimaryForeground: INK,
			colorForeground: c.fg,
			colorMutedForeground: c.muted,
			colorNeutral: c.fg,
			colorBackground: c.card,
			colorInput: c.card,
			colorInputForeground: c.fg,
			colorDanger: c.danger,
			colorBorder: c.line,
			colorRing: c.ring,
			colorShadow: "transparent",
			borderRadius: "0.375rem",
			fontFamily: "Archivo Variable, sans-serif",
		},
		// Token classes (not hex) so the borders and fills follow the theme with the rest of the page.
		elements: {
			rootBox: "w-full!",
			cardBox: "w-full! max-w-none! rounded-none! border-0! shadow-none!",
			card: "w-full! max-w-none! rounded-none! shadow-none! border-0! bg-transparent! px-6! pt-8! pb-6!",
			headerTitle: "font-heading text-xl! font-bold! [font-stretch:112.5%]",
			headerSubtitle: "text-sm!",
			socialButtonsBlockButton:
				"relative! min-h-11 border! border-border! shadow-none! transition-colors duration-[120ms] hover:bg-muted!",
			// Clerk draws the Apple and GitHub marks in black.
			socialButtonsProviderIcon__apple: "dark:invert",
			socialButtonsProviderIcon__github: "dark:invert",
			lastAuthenticationStrategyBadge:
				"absolute! top-1/2! right-2! left-auto! -translate-y-1/2! rounded-[3px]! border-0! bg-muted! px-1.5! py-0.5! font-mono! text-[0.6875rem]! font-medium! uppercase! tracking-wider! text-muted-foreground! shadow-none!",
			formButtonPrimary:
				"min-h-11 bg-none! shadow-none! border! border-primary-edge! font-semibold transition-colors duration-[120ms] after:hidden! hover:bg-primary-hover!",
			buttonArrowIcon: "hidden!",
			formFieldInput: "min-h-11 text-base shadow-none! border! border-solid! border-input!",
			footer: "bg-none! bg-transparent! border-t! border-border!",
			footerAction: "hidden",
		},
	};
}

/**
 * Sign-in only: BFH App is invite-only, so there is no sign-up route.
 * Clerk is flattened into our own card so the 8-segment bar can sit on its top edge
 * (and morph in from the landing hero via the View Transitions API).
 */
export function SignInPage({ mode = "sign-in" }: { mode?: "sign-in" | "sign-up" }) {
	const appearance = clerkAppearance(useIsDark());
	return (
		<div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
			<main className="flex flex-col px-4 py-6 md:px-10">
				<a href={siteUrl("/")} aria-label="BFH App home" className="self-start">
					<Wordmark />
				</a>
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
								appearance={appearance}
							/>
						) : (
							<SignIn
								routing="path"
								path="/sign-in"
								fallbackRedirectUrl="/projects"
								withSignUp={false}
								appearance={appearance}
							/>
						)}
					</div>
					<p className="mt-4 text-center text-sm text-muted-foreground">
						New to BFH App?{" "}
						<a
							href={siteUrl("/#request-access")}
							className="font-medium text-link underline-offset-4 hover:underline"
						>
							Request access
						</a>
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
