import {
	Archive,
	Circle,
	CircleCheck,
	CircleDashed,
	CirclePause,
	CirclePlay,
	type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type Status = "not_started" | "in_progress" | "complete" | "on_hold" | "active" | "archived";

/** Status is always icon + label + colour — never colour alone (MASTER.md). */
const STATUS: Record<Status, { label: string; Icon: LucideIcon; cls: string }> = {
	not_started: {
		label: "Not started",
		Icon: Circle,
		cls: "bg-status-not-started-bg text-status-not-started",
	},
	in_progress: {
		label: "In progress",
		Icon: CircleDashed,
		cls: "bg-status-in-progress-bg text-status-in-progress",
	},
	complete: { label: "Complete", Icon: CircleCheck, cls: "bg-status-complete-bg text-status-complete" },
	on_hold: { label: "On hold", Icon: CirclePause, cls: "bg-status-on-hold-bg text-status-on-hold" },
	// Project statuses. "Active" stays neutral: on a list of projects, hi-vis would stop meaning "you are here".
	active: { label: "Active", Icon: CirclePlay, cls: "bg-status-not-started-bg text-status-not-started" },
	archived: { label: "Archived", Icon: Archive, cls: "bg-status-not-started-bg text-status-not-started" },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
	const { label, Icon, cls } = STATUS[status];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold",
				cls,
				className,
			)}
		>
			<Icon className="size-4" aria-hidden />
			{label}
		</span>
	);
}
