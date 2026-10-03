import { useAuth } from "@clerk/react";
import { ArrowRight, Eye, PencilRuler } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ActivityRow, SAMPLE_ACTIVITY } from "@/components/activity-row";
import { HouseDrawing } from "@/components/brand/house-drawing";
import { StageBar } from "@/components/brand/stage-bar";
import { StageRail } from "@/components/brand/stage-rail";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { useInView, useReducedMotion, useScrollProgress, useStageSequence } from "@/hooks/use-motion";
import { BUILD_STAGES, stageNo } from "@/lib/build-stages";
import { cn } from "@/lib/utils";

/** Optional: where "Request access" emails go. Without it the button explains how invites work. */
const ACCESS_EMAIL = import.meta.env.VITE_ACCESS_REQUEST_EMAIL as string | undefined;
const accessHref = ACCESS_EMAIL
	? `mailto:${ACCESS_EMAIL}?subject=${encodeURIComponent("BFH App access request")}`
	: "#request-access";

const WRAP = "mx-auto w-full max-w-[1200px] px-4 md:px-10";

export function LandingPage() {
	return (
		<div className="min-h-dvh bg-background">
			<Hero />
			<HowItWorks />
			<SiteToOffice />
			<Roles />
			<Closing />
			<footer className={cn(WRAP, "flex items-center justify-between py-8 text-sm text-muted-foreground")}>
				<Wordmark className="text-sm" />
				<span className="label-mono">Built for NSW residential builders</span>
			</footer>
		</div>
	);
}

function SignInLink({ className, children = "Sign in" }: { className?: string; children?: ReactNode }) {
	const { isSignedIn } = useAuth();
	return (
		<Link
			to={isSignedIn ? "/projects" : "/sign-in"}
			viewTransition
			className={className}
			aria-label={isSignedIn ? "Open BFH App" : undefined}
		>
			{isSignedIn ? (
				<span>
					Open<span className="hidden sm:inline"> BFH App</span>
				</span>
			) : (
				children
			)}
		</Link>
	);
}

function TopBar() {
	return (
		<header className={cn(WRAP, "flex h-16 items-center justify-between gap-2")}>
			<Link to="/" aria-label="BFH App home" className="min-w-0">
				<Wordmark tone="ink" />
			</Link>
			<nav aria-label="Site" className="flex items-center gap-1 md:gap-2">
				<a
					href="#how-it-works"
					className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-[120ms] hover:text-foreground md:inline"
				>
					How it works
				</a>
				<a
					href="#for-builders"
					className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-[120ms] hover:text-foreground md:inline"
				>
					For builders
				</a>
				<SignInLink className="grid min-h-11 place-items-center rounded-md px-2 text-sm font-medium whitespace-nowrap sm:px-3 transition-colors duration-[120ms] hover:text-hivis" />
				<Button asChild size="sm">
					<a href={accessHref} aria-label="Request access">
						<span>
							Request<span className="hidden min-[360px]:inline"> access</span>
						</span>
					</a>
				</Button>
			</nav>
		</header>
	);
}

function Hero() {
	const built = useStageSequence();
	const at = Math.max(1, built);
	const stage = BUILD_STAGES[at - 1];
	return (
		<section className="theme-ink relative overflow-hidden">
			<div
				className="bg-grid pointer-events-none absolute inset-0 text-white [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
				aria-hidden
			/>
			<div className="relative">
				<TopBar />
				<div
					className={cn(
						WRAP,
						"grid items-center gap-12 pt-12 pb-20 md:pt-20 md:pb-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]",
					)}
				>
					<div>
						<p className="label-mono text-muted-foreground">Build‑progress tracking · Invite only</p>
						<h1 className="mt-4 text-[2.75rem] leading-[1.02] font-bold md:text-[4rem]">
							Every build, stage by stage.
						</h1>
						<p className="mt-6 max-w-[40ch] text-lg text-muted-foreground">
							Photos, checklists and sign‑offs from site to office — without the phone calls.
						</p>
						<div className="mt-8 flex flex-wrap gap-3">
							<Button asChild size="lg">
								<a href={accessHref}>Request access</a>
							</Button>
							<Button asChild size="lg" variant="outline" className="bg-transparent">
								<SignInLink>
									Sign in <ArrowRight aria-hidden />
								</SignInLink>
							</Button>
						</div>
					</div>

					<figure className="relative">
						<HouseDrawing built={built} className="text-survey" />
						<figcaption className="mt-4">
							<div className="flex items-baseline justify-between gap-4">
								<span key={at} className="label-mono animate-row-in">
									<span className="text-muted-foreground">STAGE {stageNo(at)} · </span>
									<span className={built >= 8 ? "text-hivis" : undefined}>{stage?.code}</span>
								</span>
								<span className="label-mono text-muted-foreground">14 BANKSIA ST</span>
							</div>
							<StageBar current={at} tone="ink" className="mt-3" transitionName="stage-bar" />
						</figcaption>
					</figure>
				</div>
			</div>
		</section>
	);
}

function SectionHead({
	id,
	eyebrow,
	title,
	children,
}: {
	id: string;
	eyebrow: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="max-w-[60ch]">
			<p className="label-mono text-muted-foreground">{eyebrow}</p>
			<h2 id={id} className="mt-3 text-3xl font-bold md:text-4xl">
				{title}
			</h2>
			<p className="mt-4 text-lg text-muted-foreground">{children}</p>
		</div>
	);
}

function HowItWorks() {
	const ref = useRef<HTMLDivElement>(null);
	const p = useScrollProgress(ref);
	const current = Math.round(p * BUILD_STAGES.length);
	return (
		<section id="how-it-works" aria-labelledby="how-h" className={cn(WRAP, "scroll-mt-8 py-20 md:py-28")}>
			<SectionHead id="how-h" eyebrow="01 — How it works" title="How every build is tracked">
				Each project starts from the NSW residential template: eight stages, thirty checks. Tick them off on
				site; the office sees it as it happens.
			</SectionHead>
			<div ref={ref} className="mt-12">
				<StageRail current={current} orientation="horizontal" countUp className="hidden md:grid" />
				<StageRail current={current} countUp className="md:hidden" />
			</div>
		</section>
	);
}

function SiteToOffice() {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref);
	const reduced = useReducedMotion();
	const [shown, setShown] = useState(0);
	useEffect(() => {
		if (!inView) return;
		if (reduced) return setShown(SAMPLE_ACTIVITY.length);
		const id = setInterval(() => setShown((n) => (n >= SAMPLE_ACTIVITY.length ? n : n + 1)), 700);
		return () => clearInterval(id);
	}, [inView, reduced]);
	// Newest first: each new row slides in at the top.
	const rows = SAMPLE_ACTIVITY.slice(SAMPLE_ACTIVITY.length - shown);

	return (
		<section aria-labelledby="office-h" className="border-y bg-card">
			<div
				className={cn(
					WRAP,
					"grid gap-12 py-20 md:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center",
				)}
			>
				<SectionHead id="office-h" eyebrow="02 — Site to office" title="The site reports itself">
					A photo on the slab, a tick on the truss certificate, a note about the roof sheets. Every change
					lands in one feed, stamped with the stage and the time.
				</SectionHead>
				<div ref={ref} className="min-h-[22rem] rounded-md border bg-background">
					<div className="flex items-center justify-between border-b px-6 py-3">
						<span className="label-mono text-muted-foreground">Activity · all projects</span>
						<span className="label-mono text-muted-foreground">Today</span>
					</div>
					<ol className="divide-y">
						{rows.map((item) => (
							<ActivityRow key={item.what} item={item} />
						))}
					</ol>
				</div>
			</div>
		</section>
	);
}

function Roles() {
	return (
		<section id="for-builders" aria-labelledby="roles-h" className={cn(WRAP, "scroll-mt-8 py-20 md:py-28")}>
			<SectionHead id="roles-h" eyebrow="03 — For builders" title="Two roles. No training.">
				You invite people to each project. They either run it or follow it.
			</SectionHead>
			<div className="mt-12 grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-2">
				<Role icon={PencilRuler} name="Admin" verb="Edits">
					Creates projects, adjusts stages and checklists, uploads plans and quotes, invites the team.
				</Role>
				<Role icon={Eye} name="Viewer" verb="Follows along">
					Clients, certifiers and trades see progress, photos and documents — read‑only, always current.
				</Role>
			</div>
		</section>
	);
}

function Role({
	icon: Icon,
	name,
	verb,
	children,
}: {
	icon: typeof Eye;
	name: string;
	verb: string;
	children: ReactNode;
}) {
	return (
		<div className="bg-card p-8">
			<Icon className="size-6 text-survey" aria-hidden />
			<h3 className="mt-6 text-xl font-semibold">
				{name} <span className="font-normal text-muted-foreground">— {verb}</span>
			</h3>
			<p className="mt-2 max-w-[44ch] text-muted-foreground">{children}</p>
		</div>
	);
}

function Closing() {
	return (
		<section id="request-access" aria-labelledby="close-h" className="theme-ink scroll-mt-0">
			<div
				className={cn(
					WRAP,
					"flex flex-col items-start gap-8 py-20 md:flex-row md:items-end md:justify-between md:py-24",
				)}
			>
				<div className="max-w-[44ch]">
					<StageBar current={8} tone="ink" className="mb-8 w-48" />
					<h2 id="close-h" className="text-3xl font-bold md:text-4xl">
						Ready when your next slab is.
					</h2>
					<p className="mt-4 text-muted-foreground">
						BFH App is invite‑only.{" "}
						{ACCESS_EMAIL
							? "Request access and we'll set up your workspace."
							: "Ask the builder running your project to send you an invite to your email address."}
					</p>
				</div>
				<div className="flex flex-wrap gap-3">
					{ACCESS_EMAIL && (
						<Button asChild size="lg">
							<a href={accessHref}>Request access</a>
						</Button>
					)}
					<Button
						asChild
						size="lg"
						variant={ACCESS_EMAIL ? "outline" : "default"}
						className={ACCESS_EMAIL ? "bg-transparent" : undefined}
					>
						<SignInLink />
					</Button>
				</div>
			</div>
		</section>
	);
}
