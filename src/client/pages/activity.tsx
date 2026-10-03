import { ActivityFeed } from "@/components/activity-feed";
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
		</section>
	);
}
