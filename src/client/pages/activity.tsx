import { ActivityFeed } from "@/components/activity-feed";
import { ActivityRow, SAMPLE_ACTIVITY } from "@/components/activity-row";
import { PageHeader } from "@/components/page-header";

export function ActivityPage() {
	return (
		<>
			<PageHeader title="Activity" description="Uploads, checklist changes and notes across every project." />
			<ActivityFeed empty={<ActivityEmpty />} />
		</>
	);
}

function ActivityEmpty() {
	return (
		<section aria-labelledby="activity-empty-h">
			<h2 id="activity-empty-h" className="text-lg font-semibold">
				Nothing has happened yet
			</h2>
			<p className="mt-1 max-w-[60ch] text-muted-foreground">
				Once a project is underway, every photo, tick and note lands here, newest first, so the office sees
				what's happening on site without a phone call.
			</p>

			<figure className="mt-6 rounded-md border bg-card">
				<div className="flex items-center justify-between border-b px-6 py-3">
					<span className="label-mono text-muted-foreground">All projects</span>
					<span className="label-mono text-muted-foreground">Today</span>
				</div>
				<ol className="pointer-events-none divide-y select-none" aria-hidden>
					{SAMPLE_ACTIVITY.map((item, i) => (
						<ActivityRow key={item.what} item={item} index={i} />
					))}
				</ol>
				<figcaption className="border-t px-6 py-3 label-mono text-muted-foreground">
					Example — not real data
				</figcaption>
			</figure>
		</section>
	);
}
