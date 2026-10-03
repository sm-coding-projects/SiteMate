import { type DragEvent, useState } from "react";

/**
 * Native HTML drag-and-drop reordering for desktop pointers. Returns props for each row and the id
 * currently hovered as a drop target. `onReorder` gets the complete new id order.
 */
export function useDragReorder(ids: string[], onReorder: (ids: string[]) => void, enabled: boolean) {
	const [dragging, setDragging] = useState<string | null>(null);
	const [over, setOver] = useState<string | null>(null);

	const rowProps = (id: string) =>
		enabled
			? {
					draggable: true,
					onDragStart: (e: DragEvent) => {
						setDragging(id);
						e.dataTransfer.effectAllowed = "move";
						e.dataTransfer.setData("text/plain", id);
					},
					onDragOver: (e: DragEvent) => {
						if (!dragging) return;
						e.preventDefault();
						e.dataTransfer.dropEffect = "move";
						if (over !== id) setOver(id);
					},
					onDragLeave: () => setOver((o) => (o === id ? null : o)),
					onDrop: (e: DragEvent) => {
						e.preventDefault();
						if (dragging && dragging !== id) {
							const next = ids.filter((x) => x !== dragging);
							next.splice(next.indexOf(id) + (ids.indexOf(dragging) < ids.indexOf(id) ? 1 : 0), 0, dragging);
							onReorder(next);
						}
						setDragging(null);
						setOver(null);
					},
					onDragEnd: () => {
						setDragging(null);
						setOver(null);
					},
				}
			: {};

	return { rowProps, dragging, over };
}

/** Move one id up (-1) or down (+1); null if it can't move. */
export function moveId(ids: string[], id: string, delta: -1 | 1) {
	const i = ids.indexOf(id);
	const j = i + delta;
	if (i < 0 || j < 0 || j >= ids.length) return null;
	const next = [...ids];
	[next[i], next[j]] = [next[j] as string, next[i] as string];
	return next;
}
