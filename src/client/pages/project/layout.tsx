import { Archive, ArrowLeft, EllipsisVertical, Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StageSummary } from "@/components/project-card";
import { ProjectFormDialog } from "@/components/project-form-dialog";
import { QueryError } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useArchiveProject, useProject, useUpdateProject } from "@/hooks/use-data";
import { useIsAdmin } from "@/hooks/use-me";
import { formatAddress } from "@/lib/address";
import { ApiRequestError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectDetail, ProjectStatus } from "../../../shared/api-types";

export interface ProjectContext {
	project: ProjectDetail;
	isAdmin: boolean;
}
export const useProjectContext = () => useOutletContext<ProjectContext>();

const TABS = [
	{ to: "", label: "Stages", end: true },
	{ to: "photos", label: "Photos" },
	{ to: "documents", label: "Documents" },
	{ to: "quotes", label: "Quotes" },
	{ to: "notes", label: "Notes" },
	{ to: "activity", label: "Activity" },
] as const;

const PROJECT_STATUS_LABEL: Record<Exclude<ProjectStatus, "archived">, string> = {
	active: "Active",
	on_hold: "On hold",
	complete: "Complete",
};

export function ProjectLayout() {
	const { id } = useParams();
	const project = useProject(id);
	const isAdmin = useIsAdmin();

	if (project.isPending) return <ProjectSkeleton />;
	if (project.isError || !project.data) {
		const notFound = project.error instanceof ApiRequestError && project.error.status === 404;
		return (
			<>
				<BackLink />
				{notFound ? (
					<p className="mt-6 text-muted-foreground">This project doesn't exist or was removed.</p>
				) : (
					<QueryError className="mt-6" error={project.error} onRetry={() => project.refetch()} />
				)}
			</>
		);
	}

	const p = project.data;
	const items = p.stages.flatMap((s) => s.items);
	return (
		<>
			<BackLink />
			<header className="mt-4 mb-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0">
						<h1 className="text-2xl font-semibold break-words md:text-[1.75rem]">{p.name}</h1>
						<p className="mt-1 text-muted-foreground">
							{formatAddress(p) || "No site address"}
							{p.clientName && ` · ${p.clientName}`}
						</p>
						{(p.startDate || p.targetCompletion) && (
							<p className="label-mono mt-2 text-muted-foreground">
								{p.startDate && `Start ${formatDate(p.startDate)}`}
								{p.startDate && p.targetCompletion && " · "}
								{p.targetCompletion && `Target ${formatDate(p.targetCompletion)}`}
							</p>
						)}
					</div>
					<div className="flex items-center gap-2">
						<StatusBadge status={p.status} />
						{isAdmin && <ProjectMenu project={p} />}
					</div>
				</div>
				<StageSummary
					stages={p.stages}
					itemsDone={items.filter((i) => i.completedAt).length}
					itemsTotal={items.length}
					className="mt-6"
				/>
			</header>

			<nav aria-label="Project sections" className="-mx-4 mb-6 border-b px-4 md:mx-0 md:px-0">
				<ul className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
					{TABS.map((t) => (
						<li key={t.label} className="shrink-0">
							<NavLink
								to={t.to}
								end={"end" in t}
								className={({ isActive }) =>
									cn(
										"relative flex min-h-11 items-center px-3 text-[0.9375rem] font-medium transition-colors duration-[120ms] ease-enter",
										// Active tab = hi-vis underline with ink edge, like the bottom tab bar.
										isActive
											? "text-foreground shadow-[inset_0_-3px_0_var(--hivis),inset_0_-4px_0_var(--primary-edge)]"
											: "text-muted-foreground hover:text-foreground",
									)
								}
							>
								{t.label}
							</NavLink>
						</li>
					))}
				</ul>
			</nav>

			<Outlet context={{ project: p, isAdmin } satisfies ProjectContext} />
		</>
	);
}

function BackLink() {
	return (
		<Link
			to="/projects"
			className="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft className="size-[18px]" aria-hidden /> Projects
		</Link>
	);
}

function ProjectMenu({ project }: { project: ProjectDetail }) {
	const [editing, setEditing] = useState(false);
	const [archiving, setArchiving] = useState(false);
	const update = useUpdateProject(project.id);
	const archive = useArchiveProject(project.id);
	const archived = project.status === "archived";

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" size="icon" aria-label="Project actions">
						<EllipsisVertical aria-hidden />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-60">
					<DropdownMenuItem className="min-h-11" onSelect={() => setEditing(true)}>
						<Pencil aria-hidden /> Edit details
					</DropdownMenuItem>
					{!archived && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
								Status
							</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={project.status}
								onValueChange={(v) => update.mutate({ status: v as ProjectStatus })}
							>
								{Object.entries(PROJECT_STATUS_LABEL).map(([value, label]) => (
									<DropdownMenuRadioItem key={value} value={value} className="min-h-11">
										{label}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</>
					)}
					<DropdownMenuSeparator />
					{archived ? (
						<DropdownMenuItem className="min-h-11" onSelect={() => update.mutate({ status: "active" })}>
							<RotateCcw aria-hidden /> Restore project
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem className="min-h-11" onSelect={() => setArchiving(true)}>
							<Archive aria-hidden /> Archive project
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			<ProjectFormDialog open={editing} onOpenChange={setEditing} project={project} />
			<ConfirmDialog
				open={archiving}
				onOpenChange={setArchiving}
				title="Archive this project?"
				description="It leaves the projects list but nothing is deleted. You can restore it from the Archived filter."
				confirmLabel="Archive"
				pending={archive.isPending}
				onConfirm={() => archive.mutate(undefined, { onSuccess: () => setArchiving(false) })}
			/>
		</>
	);
}

function ProjectSkeleton() {
	return (
		<div role="status" aria-busy="true">
			<span className="sr-only">Loading project</span>
			<Skeleton className="h-11 w-28" />
			<Skeleton className="mt-4 h-9 w-72 max-w-full" />
			<Skeleton className="mt-2 h-5 w-56" />
			<Skeleton className="mt-6 h-6 w-full" />
			<Skeleton className="mt-6 h-11 w-full" />
			<div className="mt-6 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
				<Skeleton className="h-96" />
				<Skeleton className="h-96" />
			</div>
		</div>
	);
}
