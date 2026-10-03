import { useEffect, useState } from "react";

export function useMediaQuery(query: string) {
	const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
	useEffect(() => {
		const mq = window.matchMedia(query);
		const on = () => setMatches(mq.matches);
		on();
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, [query]);
	return matches;
}

/** ≥768px: the sidebar layout (MASTER.md breakpoint). */
export const useDesktop = () => useMediaQuery("(min-width: 768px)");
/** Mouse or trackpad: drag-to-reorder is offered; touch gets up/down buttons instead. */
export const useFinePointer = () => useMediaQuery("(pointer: fine)");
