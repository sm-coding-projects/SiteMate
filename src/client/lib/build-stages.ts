/**
 * Stages of the default "NSW Residential New Build" template (docs/DESIGN.md §2).
 * Used to explain the product before any projects exist; step 2 seeds the real template from the DB.
 * Labels use U+2011 (non-breaking hyphen) so "Pre‑construction" never splits across lines.
 * `code` is the drawing-set label: STAGE 04/08 · FRAME.
 */
export const BUILD_STAGES = [
	{ label: "Pre‑construction", code: "PRE‑CONSTRUCTION", items: 6 },
	{ label: "Site preparation", code: "SITE PREP", items: 3 },
	{ label: "Base / Slab", code: "BASE/SLAB", items: 3 },
	{ label: "Frame", code: "FRAME", items: 3 },
	{ label: "Lock‑up", code: "LOCK‑UP", items: 4 },
	{ label: "Fixing", code: "FIXING", items: 5 },
	{ label: "Practical completion", code: "PRAC. COMPLETION", items: 3 },
	{ label: "Handover & defects", code: "HANDOVER", items: 3 },
] as const;

export const TEMPLATE_NAME = "NSW Residential New Build";
export const TEMPLATE_ITEM_COUNT = BUILD_STAGES.reduce((n, s) => n + s.items, 0);

/** "04/08" */
export const stageNo = (n: number) =>
	`${String(n).padStart(2, "0")}/${String(BUILD_STAGES.length).padStart(2, "0")}`;
