import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * The 8-segment build bar — SiteMate's signature. Same element in the logo, hero, login card and project card.
 * `current` is 1-based: segments before it are done, it is hi-vis ("you are here"), the rest are to come.
 * `tone` is the surface it sits on: "ink" (dark hero/panels) or "paper" (app surfaces).
 */
export function StageBar({
	current,
	total = 8,
	tone = "paper",
	className,
	segmentClassName,
	transitionName,
}: {
	current: number;
	total?: number;
	tone?: "paper" | "ink";
	className?: string;
	segmentClassName?: string;
	/** view-transition-name, so the bar can morph between pages. */
	transitionName?: string;
}) {
	return (
		<div
			className={cn("grid gap-1", className)}
			style={
				{
					gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))`,
					viewTransitionName: transitionName,
				} as CSSProperties
			}
			aria-hidden
		>
			{Array.from({ length: total }, (_, i) => {
				const state = i + 1 < current ? "done" : i + 1 === current ? "current" : "todo";
				return (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length, positional
						key={i}
						data-state={state}
						className={cn(
							"h-1.5 rounded-[1px] transition-colors duration-200 ease-enter",
							state === "current" && "bg-hivis",
							// On paper, hi-vis needs an ink edge to be visible at all (1.02:1).
							state === "current" && tone === "paper" && "shadow-[inset_0_0_0_1px_var(--ink)]",
							state === "done" && (tone === "ink" ? "bg-[#eef0ec]" : "bg-foreground"),
							state === "todo" && (tone === "ink" ? "bg-white/15" : "bg-border"),
							segmentClassName,
						)}
					/>
				);
			})}
		</div>
	);
}
