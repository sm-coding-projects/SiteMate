import type { CSSProperties } from "react";
import { Link } from "react-router";
import { StageBar } from "@/components/brand/stage-bar";
import { StatusBadge } from "@/components/status-badge";
import { nbHyphen, stageCode, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectSummary } from "../../shared/api-types";
import { currentStageNumber } from "../../shared/progress";

/** Stage code + 8-segment bar + check count. Shared by project cards and the project page header. */
export function StageSummary({
	stages,
	itemsDone,
	itemsTotal,
	className,
}: {
	stages: { name: string; status: "not_started" | "in_progress" | "complete" }[];
	itemsDone: number;
	itemsTotal: number;
	className?: string;
}) {
	const current = currentStageNumber(stages);
	const total = stages.length;
	const stage = stages[current - 1];
	return (
		<div className={className}>
			<div className="flex items-baseline justify-between gap-4">
				<span className="label-mono min-w-0 truncate">
					{total === 0 ? (
						<span className="text-muted-foreground">No stages</span>
					) : stage ? (
						<>
							<span className="text-muted-foreground">STAGE {stageCode(current, total)} · </span>
							{nbHyphen(stage.name)}
						</>
					) : (
						<span>All {total} stages complete</span>
					)}
				</span>
				<span className="label-mono shrink-0 text-muted-foreground">
					{itemsDone}/{itemsTotal}
					<span className="sr-only"> checks done</span>
				</span>
			</div>
			{total > 0 && <StageBar current={current} total={total} className="mt-2" />}
			<span className="sr-only">
				{stage ? `Current stage ${current} of ${total}: ${stage.name}` : `All ${total} stages complete`}
			</span>
		</div>
	);
}

export function ProjectCard({ project, index = 0 }: { project: ProjectSummary; index?: number }) {
	const place = [project.siteAddress, project.suburb].filter(Boolean).join(", ");
	return (
		<li
			className="animate-row-in"
			style={{ animationDelay: `${Math.min(index, 8) * 40}ms` } as CSSProperties}
		>
			<Link
				to={`/projects/${project.id}`}
				className="block rounded-md border bg-card p-5 transition-colors duration-[120ms] ease-enter hover:border-input md:p-6"
			>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="truncate text-lg font-semibold">{project.name}</h2>
						<p className="truncate text-sm text-muted-foreground">
							{[place, project.clientName].filter(Boolean).join(" · ") || "No site details yet"}
						</p>
					</div>
					<StatusBadge status={project.status === "complete" ? "complete" : project.status} />
				</div>

				<StageSummary
					stages={project.stages}
					itemsDone={project.itemsDone}
					itemsTotal={project.itemsTotal}
					className="mt-5"
				/>

				<div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
					{project.photoCount > 0 && (
						<div className="flex gap-1.5" aria-hidden>
							{project.recentPhotos.map((p) =>
								p.thumbUrl ? (
									<img
										key={p.id}
										src={p.thumbUrl}
										alt=""
										loading="lazy"
										className="size-12 rounded-[3px] border object-cover"
									/>
								) : (
									<span
										key={p.id}
										className={cn("bg-hatch size-12 rounded-[3px] border text-muted-foreground")}
									/>
								),
							)}
						</div>
					)}
					<span className="text-sm whitespace-nowrap text-muted-foreground">
						<span className="tabular">{project.photoCount}</span>{" "}
						{project.photoCount === 1 ? "photo" : "photos"} · updated {timeAgo(project.updatedAt)}
					</span>
				</div>
			</Link>
		</li>
	);
}
