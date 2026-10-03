import { type ActivityItem, type ActivityKind, ActivityRow } from "@/components/activity-row";
import { LoadMore, QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivity } from "@/hooks/use-data";
import { formatCents, formatWhen, nbHyphen } from "@/lib/format";
import type { ActivityEntry } from "../../shared/api-types";

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const quoted = (s: string) => `“${s}”`;
const STATUS_WORD: Record<string, string> = {
	not_started: "not started",
	in_progress: "in progress",
	complete: "complete",
	active: "active",
	on_hold: "on hold",
	archived: "archived",
	accepted: "accepted",
	rejected: "rejected",
	pending: "pending",
};

/** Turns an activity row into the sentence the timeline shows. Unknown actions still render sensibly. */
export function describeActivity(e: ActivityEntry): { kind: ActivityKind; tag: string; what: string } {
	const m = e.meta ?? {};
	const stage = str(m.stage);
	const tag = stage ? nbHyphen(stage).toUpperCase() : e.entityType.toUpperCase();
	const kindOf: Record<string, ActivityKind> = {
		project: "project",
		stage: "stage",
		item: "check",
		note: "note",
		file: "file",
		quote: "quote",
		extraction: "extraction",
		user: "team",
		invitation: "team",
		system: "project",
	};
	let kind = kindOf[e.entityType] ?? "project";
	let what: string;
	switch (e.action) {
		case "project.created":
			what = `created the project from ${str(m.template) || "a template"}`;
			break;
		case "project.updated":
			what = "updated the project details";
			break;
		case "project.status_changed":
		case "project.archived":
			what = `marked the project ${STATUS_WORD[str(m.to)] ?? str(m.to)}`;
			break;
		case "stage.added":
			what = `added the stage ${quoted(stage)}`;
			break;
		case "stage.renamed":
			what = `renamed ${quoted(str(m.from))} to ${quoted(stage)}`;
			break;
		case "stage.removed":
			what = `removed the stage ${quoted(stage)}`;
			break;
		case "stage.reordered":
			what = "reordered the stages";
			break;
		case "stage.completed":
			what = `completed ${stage}`;
			break;
		case "stage.status_changed":
			what = `set ${stage} to ${STATUS_WORD[str(m.to)] ?? str(m.to)}`;
			break;
		case "item.completed":
			what = `ticked off ${str(m.item)}`;
			break;
		case "item.reopened":
			what = `unticked ${str(m.item)}`;
			break;
		case "item.added":
			what = `added the check ${quoted(str(m.item))}`;
			break;
		case "item.renamed":
			what = `renamed the check ${quoted(str(m.from))} to ${quoted(str(m.item))}`;
			break;
		case "item.files_attached":
			what =
				Number(m.count) === 1
					? `attached ${str(m.file)} to ${quoted(str(m.item))}`
					: `attached ${Number(m.count)} files to ${quoted(str(m.item))}`;
			break;
		case "item.files_detached":
			what = `removed ${Number(m.count) === 1 ? "a file" : `${Number(m.count)} files`} from ${quoted(str(m.item))}`;
			break;
		case "item.removed":
			what = `removed the check ${quoted(str(m.item))}`;
			break;
		case "note.added":
			what = `noted ${quoted(str(m.excerpt))}`;
			break;
		case "note.edited":
			what = `edited a note: ${quoted(str(m.excerpt))}`;
			break;
		case "note.deleted":
			what = "deleted a note";
			break;
		case "file.uploaded":
			kind = m.category === "photo" ? "photo" : "file";
			what =
				m.category === "photo"
					? `added a photo${m.caption ? `: ${str(m.caption)}` : ""}`
					: `uploaded ${str(m.filename)}`;
			break;
		case "file.deleted":
			what = `removed ${str(m.filename)}`;
			break;
		case "file.updated":
			what = `updated ${str(m.filename)}`;
			break;
		case "extraction.ready":
			what = `${str(m.filename)} is ready for review`;
			break;
		case "extraction.failed":
			what = `couldn't read ${str(m.filename)}`;
			break;
		case "extraction.confirmed":
			what = `confirmed ${str(m.documentType) || "document"} details from ${str(m.filename)}`;
			break;
		case "quote.created":
			what = `added a quote from ${str(m.supplier)} (${formatCents(Number(m.incGstCents))} inc GST)`;
			break;
		case "quote.status_changed":
			what = `${STATUS_WORD[str(m.to)] ?? str(m.to)} the ${str(m.supplier)} quote`;
			break;
		case "user.invited":
			what = `invited ${str(m.email)} as ${str(m.role)}`;
			break;
		case "user.role_changed":
			what = `made ${str(m.email)} ${m.role === "admin" ? "an admin" : "a viewer"}`;
			break;
		case "ai.model_changed":
			what = m.host
				? `switched the AI model to ${str(m.model)} (${str(m.host)})`
				: `switched the AI model back to the default (${str(m.model)})`;
			break;
		default:
			what = e.action.replace(/[._]/g, " ");
	}
	return { kind, tag, what };
}

export function toActivityItem(e: ActivityEntry, showProject: boolean): ActivityItem {
	const d = describeActivity(e);
	return {
		kind: d.kind,
		stage: d.tag,
		who: e.actor.name ?? e.actor.email,
		what: d.what,
		where: showProject ? (e.project?.name ?? "Workspace") : "",
		when: formatWhen(e.createdAt),
	};
}

/** Newest-first timeline, for one project or the whole workspace. */
export function ActivityFeed({ projectId, empty }: { projectId?: string; empty: React.ReactNode }) {
	const q = useActivity(projectId);
	const items = q.data?.pages.flatMap((p) => p.items) ?? [];
	if (q.isPending) return <FeedSkeleton />;
	if (q.isError && items.length === 0) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
	if (items.length === 0) return <>{empty}</>;
	return (
		<>
			<div className="rounded-md border bg-card">
				<ol className="divide-y">
					{items.map((e, i) => (
						<ActivityRow key={e.id} item={toActivityItem(e, !projectId)} index={Math.min(i, 10)} />
					))}
				</ol>
			</div>
			<LoadMore {...q} />
		</>
	);
}

function FeedSkeleton() {
	return (
		<div role="status" aria-busy="true" className="divide-y rounded-md border bg-card">
			<span className="sr-only">Loading activity</span>
			{[0, 1, 2, 3].map((i) => (
				<div key={i} className="flex gap-3 px-6 py-4">
					<Skeleton className="size-5" />
					<div className="flex-1 space-y-2">
						<Skeleton className="h-4 w-3/4" />
						<Skeleton className="h-4 w-1/3" />
					</div>
				</div>
			))}
		</div>
	);
}
