import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { StageBar } from "@/components/brand/stage-bar";
import { StageRail } from "@/components/brand/stage-rail";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe } from "@/hooks/use-me";
import { BUILD_STAGES, stageNo, TEMPLATE_ITEM_COUNT, TEMPLATE_NAME } from "@/lib/build-stages";
import { cn } from "@/lib/utils";

const SAMPLE_STAGE = 4; // Frame

/** Not wired up until build step 2. aria-disabled keeps it focusable so the reason is reachable by keyboard and touch. */
function NewProjectButton() {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-disabled="true"
					aria-describedby="new-project-reason"
					onClick={(e) => e.preventDefault()}
				>
					<Plus aria-hidden /> New project
				</Button>
			</TooltipTrigger>
			<TooltipContent id="new-project-reason">Coming in the next update</TooltipContent>
		</Tooltip>
	);
}

export function ProjectsPage() {
	const { data: me, isPending } = useMe();

	if (isPending) return <ProjectsSkeleton />;

	const isAdmin = me?.role === "admin";
	return (
		<>
			<PageHeader
				title="Projects"
				description={
					isAdmin
						? "Every build you're running, from pre‑construction to handover."
						: "Builds you've been given access to. An admin adds you to each project."
				}
				actions={isAdmin ? <NewProjectButton /> : undefined}
			/>

			<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
				<div className="space-y-12">
					<section aria-labelledby="empty-h">
						<h2 id="empty-h" className="text-lg font-semibold">
							No projects yet
						</h2>
						<p className="mt-1 max-w-[60ch] text-muted-foreground">
							{isAdmin
								? "Project creation is coming in the next update. Here's what each one will look like."
								: "Once an admin adds you to a project it'll appear here, like this."}
						</p>
						<SampleProjectCard className="mt-6" />
					</section>

					{isAdmin && (
						<section aria-labelledby="start-h">
							<h2 id="start-h" className="text-lg font-semibold">
								Setting up a project
							</h2>
							<ol className="mt-4 grid gap-6 sm:grid-cols-2">
								<SetupStep n={1} title={`Start from the ${TEMPLATE_NAME} template`}>
									{BUILD_STAGES.length} stages and {TEMPLATE_ITEM_COUNT} checklist items are copied in.
									Rename, reorder or add your own per project.
								</SetupStep>
								<SetupStep n={2} title="Invite your site team">
									Admins can edit; viewers follow progress, photos and documents read‑only.
								</SetupStep>
							</ol>
						</section>
					)}
				</div>

				<aside aria-labelledby="stages-h" className="lg:border-l lg:pl-8">
					<h2 id="stages-h" className="label-mono text-muted-foreground">
						How every build is tracked
					</h2>
					<StageRail current={SAMPLE_STAGE} className="mt-5" />
					<p className="mt-5 text-sm text-muted-foreground">
						Shown at stage {SAMPLE_STAGE}, like the example.
					</p>
				</aside>
			</div>
		</>
	);
}

/** Registration ticks at the corners — the crop marks on a drawing sheet. */
function RegistrationTicks() {
	const tick = "absolute size-2.5 border-foreground/50";
	return (
		<span aria-hidden className="pointer-events-none">
			<span className={cn(tick, "-top-px -left-px border-t border-l")} />
			<span className={cn(tick, "-top-px -right-px border-t border-r")} />
			<span className={cn(tick, "-bottom-px -left-px border-b border-l")} />
			<span className={cn(tick, "-right-px -bottom-px border-r border-b")} />
		</span>
	);
}

/** A ghost of a filled-in project, so the empty screen shows what the product does. */
function SampleProjectCard({ className }: { className?: string }) {
	const stage = BUILD_STAGES[SAMPLE_STAGE - 1];
	return (
		<figure className={cn("relative rounded-md border bg-card", className)}>
			<RegistrationTicks />
			<div className="pointer-events-none p-6 select-none" aria-hidden>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<p className="font-heading text-lg font-semibold stretch-semi">14 Banksia Street, Marsden Park</p>
						<p className="text-sm text-muted-foreground">Nguyen family · Single‑storey, 4 bed</p>
					</div>
					<StatusBadge status="in_progress" />
				</div>

				<div className="mt-6">
					<div className="flex items-baseline justify-between gap-4">
						<span className="label-mono">
							<span className="text-muted-foreground">STAGE {stageNo(SAMPLE_STAGE)} · </span>
							{stage?.code}
						</span>
						<span className="label-mono text-muted-foreground">11/{TEMPLATE_ITEM_COUNT}</span>
					</div>
					<StageBar current={SAMPLE_STAGE} className="mt-2" />
				</div>

				<div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
					<div className="flex gap-1.5">
						{[0, 1, 2, 3].map((i) => (
							<span key={i} className="bg-hatch relative size-12 rounded-[3px] border text-muted-foreground">
								<span className="label-mono absolute right-1 bottom-0.5 text-[0.625rem] leading-none">
									IMG
								</span>
							</span>
						))}
					</div>
					<span className="text-sm whitespace-nowrap text-muted-foreground">
						<span className="tabular">24</span> photos · 2h ago
					</span>
				</div>
			</div>
			<figcaption className="border-t px-6 py-3 label-mono text-muted-foreground">
				Example — not real data
			</figcaption>
		</figure>
	);
}

function SetupStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
	return (
		<li className="flex gap-4">
			<span className="label-mono pt-0.5 text-muted-foreground" aria-hidden>
				{String(n).padStart(2, "0")}
			</span>
			<div>
				<p className="font-medium">{title}</p>
				<p className="mt-1 text-sm text-muted-foreground">{children}</p>
			</div>
		</li>
	);
}

export function ProjectsSkeleton() {
	return (
		<div role="status" aria-busy="true">
			<span className="sr-only">Loading projects</span>
			<div className="mb-8 flex items-end justify-between">
				<div className="space-y-2">
					<Skeleton className="h-8 w-40" />
					<Skeleton className="h-5 w-72" />
				</div>
				<Skeleton className="h-11 w-36" />
			</div>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{[0, 1, 2].map((i) => (
					<Skeleton key={i} className="h-36 rounded-md" />
				))}
			</div>
		</div>
	);
}
