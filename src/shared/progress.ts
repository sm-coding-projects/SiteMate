/** Stage status and project progress rules, shared by the API and the SPA (optimistic updates). */

export type StageStatus = "not_started" | "in_progress" | "complete";

export interface StageState {
	status: StageStatus;
	startedAt: number | null;
	completedAt: number | null;
}

/**
 * Status after a checklist change. All ticked → complete; some ticked → in progress.
 * Nothing ticked keeps a manual "in progress", and a completed stage that loses ticks reopens.
 */
export function deriveStageStatus(prev: StageState, done: number, total: number, now: number): StageState {
	if (total > 0 && done === total) {
		return {
			status: "complete",
			startedAt: prev.startedAt ?? now,
			completedAt: prev.status === "complete" ? (prev.completedAt ?? now) : now,
		};
	}
	if (done > 0 || (prev.status === "complete" && total > 0)) {
		return { status: "in_progress", startedAt: prev.startedAt ?? now, completedAt: null };
	}
	return prev;
}

/** Status set by hand (admin "Start stage" / "Mark complete" / "Reset"). */
export function applyManualStatus(prev: StageState, status: StageStatus, now: number): StageState {
	switch (status) {
		case "complete":
			return {
				status,
				startedAt: prev.startedAt ?? now,
				completedAt: prev.status === "complete" ? prev.completedAt : now,
			};
		case "in_progress":
			return { status, startedAt: prev.startedAt ?? now, completedAt: null };
		case "not_started":
			return { status, startedAt: null, completedAt: null };
	}
}

/**
 * "Where you are now": the first stage (by position) that isn't complete. 1-based, so it plugs straight
 * into <StageBar current>. All complete → total + 1 (every segment done, none hi-vis). No stages → 0.
 */
export function currentStageNumber(stages: readonly { status: StageStatus }[]) {
	if (stages.length === 0) return 0;
	const i = stages.findIndex((s) => s.status !== "complete");
	return i === -1 ? stages.length + 1 : i + 1;
}

export function stageProgress(stages: readonly { status: StageStatus }[]) {
	const complete = stages.filter((s) => s.status === "complete").length;
	return { complete, total: stages.length, ratio: stages.length ? complete / stages.length : 0 };
}
