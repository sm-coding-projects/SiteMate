import { Plus, Search } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { StageRail } from "@/components/brand/stage-rail";
import { PageHeader } from "@/components/page-header";
import { ProjectCard } from "@/components/project-card";
import { ProjectFormDialog } from "@/components/project-form-dialog";
import { LoadMore, QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/hooks/use-data";
import { useMe } from "@/hooks/use-me";
import { BUILD_STAGES, TEMPLATE_ITEM_COUNT, TEMPLATE_NAME } from "@/lib/build-stages";
import { cn } from "@/lib/utils";

const FILTERS = [
	{ value: "open", label: "Open" },
	{ value: "active", label: "Active" },
	{ value: "on_hold", label: "On hold" },
	{ value: "complete", label: "Complete" },
	{ value: "archived", label: "Archived" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

function useDebounced<T>(value: T, ms: number) {
	const [v, setV] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setV(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return v;
}

export function ProjectsPage() {
	const { data: me, isPending: mePending } = useMe();
	const [params, setParams] = useSearchParams();
	const status = (FILTERS.find((f) => f.value === params.get("status"))?.value ?? "open") as Filter;
	const [search, setSearch] = useState(params.get("q") ?? "");
	const q = useDebounced(search.trim(), 300);
	const [creating, setCreating] = useState(false);
	const projects = useProjects({ status, q: q || undefined });

	useEffect(() => {
		setParams(
			(p) => {
				if (q) p.set("q", q);
				else p.delete("q");
				return p;
			},
			{ replace: true },
		);
	}, [q, setParams]);

	if (mePending) return <ProjectsSkeleton />;

	const isAdmin = me?.role === "admin";
	const items = projects.data?.pages.flatMap((p) => p.items) ?? [];
	const unfiltered = status === "open" && !q;
	const nothingYet = projects.isSuccess && items.length === 0 && unfiltered;

	return (
		<>
			<PageHeader
				title="Projects"
				description={
					isAdmin
						? "Every build you're running, from pre‑construction to handover."
						: "The builds shared with you. You have view‑only access."
				}
				actions={
					isAdmin ? (
						<Button onClick={() => setCreating(true)}>
							<Plus aria-hidden /> New project
						</Button>
					) : undefined
				}
			/>
			{isAdmin && <ProjectFormDialog open={creating} onOpenChange={setCreating} />}

			{!nothingYet && (
				<div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<div className="relative md:w-80">
						<Search
							className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted-foreground"
							aria-hidden
						/>
						<Input
							type="search"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search name, suburb or address"
							aria-label="Search projects"
							className="pl-10"
						/>
					</div>
					<div
						role="radiogroup"
						aria-label="Filter by status"
						className="grid grid-cols-5 rounded-md border bg-muted p-0.5 md:inline-flex"
					>
						{FILTERS.map((f) => (
							// biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons
							<button
								key={f.value}
								type="button"
								role="radio"
								aria-checked={status === f.value}
								onClick={() =>
									setParams(
										(p) => {
											if (f.value === "open") p.delete("status");
											else p.set("status", f.value);
											return p;
										},
										{ replace: true },
									)
								}
								className={cn(
									"inline-flex h-11 items-center justify-center rounded-[calc(var(--radius)-2px)] px-1 text-sm font-medium whitespace-nowrap transition-colors duration-[120ms] ease-enter sm:px-3 pointer-fine:h-8",
									status === f.value
										? "bg-card text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{f.label}
							</button>
						))}
					</div>
				</div>
			)}

			{projects.isPending ? (
				<CardsSkeleton />
			) : projects.isError && items.length === 0 ? (
				<QueryError error={projects.error} onRetry={() => projects.refetch()} />
			) : nothingYet ? (
				<EmptyProjects isAdmin={isAdmin} onCreate={() => setCreating(true)} />
			) : items.length === 0 ? (
				<p className="py-10 text-muted-foreground">
					No {status === "open" ? "" : `${FILTERS.find((f) => f.value === status)?.label.toLowerCase()} `}
					projects{q ? ` match “${q}”` : ""}.
				</p>
			) : (
				<>
					<ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
						{items.map((p, i) => (
							<ProjectCard key={p.id} project={p} index={i} />
						))}
					</ul>
					<LoadMore {...projects} />
				</>
			)}
		</>
	);
}

/** First run: no projects yet, with the template's stages alongside. */
function EmptyProjects({ isAdmin, onCreate }: { isAdmin: boolean; onCreate: () => void }) {
	return (
		<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
			<div className="space-y-12">
				<section aria-labelledby="empty-h">
					<h2 id="empty-h" className="text-lg font-semibold">
						No projects yet
					</h2>
					<p className="mt-1 max-w-[60ch] text-muted-foreground">
						{isAdmin
							? "Create the first one to start tracking photos, checklists and notes as the build moves along."
							: "Nothing has been shared with you yet. Your builder will add you to your project."}
					</p>
					{isAdmin && (
						<Button variant="outline" className="mt-6" onClick={onCreate}>
							<Plus aria-hidden /> Create the first project
						</Button>
					)}
				</section>

				{isAdmin && (
					<section aria-labelledby="start-h">
						<h2 id="start-h" className="text-lg font-semibold">
							Setting up a project
						</h2>
						<ol className="mt-4 grid gap-6 sm:grid-cols-2">
							<SetupStep n={1} title={`Start from the ${TEMPLATE_NAME} template`}>
								{BUILD_STAGES.length} stages and {TEMPLATE_ITEM_COUNT} checklist items are copied in. Rename,
								reorder or add your own per project.
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
				<StageRail current={0} className="mt-5" />
			</aside>
		</div>
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

function CardsSkeleton() {
	return (
		<div role="status" aria-busy="true" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
			<span className="sr-only">Loading projects</span>
			{[0, 1, 2].map((i) => (
				<Skeleton key={i} className="h-52 rounded-md" />
			))}
		</div>
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
