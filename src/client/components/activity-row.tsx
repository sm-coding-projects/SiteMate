import { Camera, CircleCheck, FileText, type LucideIcon, MessageSquareText } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type ActivityKind = "photo" | "check" | "file" | "note";
const ICON: Record<ActivityKind, LucideIcon> = {
	photo: Camera,
	check: CircleCheck,
	file: FileText,
	note: MessageSquareText,
};

export interface ActivityItem {
	kind: ActivityKind;
	stage: string;
	who: string;
	what: string;
	where: string;
	when: string;
}

export const SAMPLE_ACTIVITY: ActivityItem[] = [
	{
		kind: "photo",
		stage: "FRAME",
		who: "Sam",
		what: "added 6 photos",
		where: "14 Banksia St",
		when: "09:42",
	},
	{
		kind: "check",
		stage: "FRAME",
		who: "Priya",
		what: "ticked off Truss certification",
		where: "14 Banksia St",
		when: "09:15",
	},
	{
		kind: "file",
		stage: "FRAME",
		who: "Priya",
		what: "uploaded Frame inspection report.pdf",
		where: "14 Banksia St",
		when: "Yesterday",
	},
	{
		kind: "note",
		stage: "LOCK‑UP",
		who: "Sam",
		what: "noted “Roof sheets delivered, install Thu”",
		where: "8 Kurrajong Ave",
		when: "Yesterday",
	},
];

/** Stage tag + bare icon + sentence + right-aligned mono time. `index` staggers the slide-in by 40ms. */
export function ActivityRow({
	item,
	index = 0,
	animate = true,
}: {
	item: ActivityItem;
	index?: number;
	animate?: boolean;
}) {
	const Icon = ICON[item.kind];
	return (
		<li
			className={cn(
				"grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-6 py-4",
				animate && "animate-row-in",
			)}
			style={animate ? ({ animationDelay: `${index * 40}ms` } as CSSProperties) : undefined}
		>
			<Icon className="mt-0.5 size-[18px] text-muted-foreground" aria-hidden />
			<p className="min-w-0 text-sm">
				<span className="label-mono mr-2 inline-block rounded-[3px] bg-survey/10 px-1.5 py-px align-[1px] text-survey">
					{item.stage}
				</span>
				<span className="font-medium">{item.who}</span> {item.what}
				<span className="block text-muted-foreground">{item.where}</span>
			</p>
			<span className="label-mono pt-0.5 text-right text-muted-foreground">{item.when}</span>
		</li>
	);
}
