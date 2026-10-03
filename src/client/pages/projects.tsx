import { FolderKanban, Plus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe } from "@/hooks/use-me";

/** Disabled until step 2. aria-disabled keeps it focusable so the tooltip works by keyboard and touch. */
function NewProjectButton() {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button aria-disabled="true" className="opacity-60" onClick={(e) => e.preventDefault()}>
					<Plus aria-hidden /> New project
				</Button>
			</TooltipTrigger>
			<TooltipContent>Coming soon</TooltipContent>
		</Tooltip>
	);
}

export function ProjectsPage() {
	const { data: me, isPending } = useMe();

	if (isPending) return <ProjectsSkeleton />;

	const isAdmin = me?.role === "admin";
	return (
		<>
			{/* With no projects, the empty state owns the single primary action. Step 2 moves it to the header. */}
			<PageHeader title="Projects" />
			<EmptyState
				icon={FolderKanban}
				title="No projects yet"
				description={
					isAdmin
						? "Create a project to start tracking a build from pre-construction to handover."
						: "Projects you can view will appear here once an admin creates them."
				}
				action={isAdmin ? <NewProjectButton /> : undefined}
			/>
		</>
	);
}

export function ProjectsSkeleton() {
	return (
		<div role="status" aria-busy="true">
			<span className="sr-only">Loading projects</span>
			<div className="mb-6 flex items-center justify-between">
				<Skeleton className="h-8 w-40" />
				<Skeleton className="h-11 w-36" />
			</div>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{[0, 1, 2].map((i) => (
					<Skeleton key={i} className="h-36 rounded-lg" />
				))}
			</div>
		</div>
	);
}
