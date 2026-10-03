import { ActivityFeed } from "@/components/activity-feed";
import { useProjectContext } from "./layout";

export function ProjectActivityTab() {
	const { project } = useProjectContext();
	return (
		<div className="max-w-3xl">
			<ActivityFeed
				projectId={project.id}
				empty={<p className="text-muted-foreground">No activity yet.</p>}
			/>
		</div>
	);
}
