import { useCountUp } from "@/hooks/use-motion";
import { BUILD_STAGES } from "@/lib/build-stages";
import { cn } from "@/lib/utils";

export type RailState = "done" | "current" | "todo";
type State = RailState;

/** Survey-line node: done = solid ink, current = hi-vis with a soft pulse, to come = dashed outline. */
export function RailNode({ state, tone = "paper" }: { state: State; tone?: "paper" | "ink" }) {
	return (
		<span
			className={cn(
				"relative z-10 block size-3 shrink-0 rounded-full transition-colors duration-200 ease-enter",
				state === "done" && "bg-foreground",
				state === "current" && "animate-hivis-pulse bg-hivis",
				state === "current" && tone === "paper" && "shadow-[inset_0_0_0_1px_var(--ink)]",
				state === "todo" && "border-[1.5px] border-dashed border-input bg-background",
			)}
		/>
	);
}

function Checks({ n, active }: { n: number; active: boolean }) {
	const shown = useCountUp(n, active);
	return (
		<span className="label-mono text-muted-foreground">
			{active ? shown : n} {n === 1 ? "check" : "checks"}
		</span>
	);
}

/**
 * The 8 template stages as a survey line. `current` is 1-based (0 = nothing started).
 * `countUp`: check counts roll up as each stage is reached (landing page).
 */
export function StageRail({
	current,
	orientation = "vertical",
	tone = "paper",
	countUp = false,
	className,
}: {
	current: number;
	orientation?: "vertical" | "horizontal";
	tone?: "paper" | "ink";
	countUp?: boolean;
	className?: string;
}) {
	const stateOf = (i: number): State => (i + 1 < current ? "done" : i + 1 === current ? "current" : "todo");
	const horizontal = orientation === "horizontal";

	return (
		<ol className={cn(horizontal ? "grid grid-cols-8" : "flex flex-col", className)}>
			{BUILD_STAGES.map((s, i) => {
				const state = stateOf(i);
				const last = i === BUILD_STAGES.length - 1;
				const solid = state === "done" && stateOf(i + 1) !== "todo";
				return (
					<li
						key={s.label}
						className={cn("relative", horizontal ? "pr-3" : "flex gap-3 pb-5 last:pb-0")}
						aria-current={state === "current" ? "step" : undefined}
					>
						{!last && (
							<span
								aria-hidden
								className={cn(
									"absolute",
									horizontal ? "top-[5px] right-0 left-3 border-t" : "top-3 bottom-0 left-[5px] border-l",
									solid ? "border-solid border-foreground" : "border-dashed border-input",
								)}
							/>
						)}
						<span className={cn(!horizontal && "pt-1")}>
							<RailNode state={state} tone={tone} />
						</span>
						<span
							className={cn(
								"min-w-0",
								horizontal ? "mt-4 block pr-1" : "flex flex-1 items-baseline justify-between gap-2",
							)}
						>
							<span className={cn("block", horizontal && "space-y-1")}>
								{horizontal && (
									<span className="label-mono block text-muted-foreground">
										{String(i + 1).padStart(2, "0")}
									</span>
								)}
								<span
									className={cn("block text-sm", state === "todo" ? "text-muted-foreground" : "font-medium")}
								>
									{s.label}
								</span>
							</span>
							<Checks n={s.items} active={!countUp || state !== "todo"} />
						</span>
						<span className="sr-only">
							{state === "done" ? "(complete)" : state === "current" ? "(current)" : ""}
						</span>
					</li>
				);
			})}
		</ol>
	);
}
