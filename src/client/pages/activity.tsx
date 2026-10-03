import { History } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export function ActivityPage() {
	return (
		<>
			<PageHeader title="Activity" />
			<EmptyState
				icon={History}
				title="No activity yet"
				description="Uploads, checklist changes and notes across all projects will show up here."
			/>
		</>
	);
}
