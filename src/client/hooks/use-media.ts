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

/** ≥1024px: room for two columns beside the sidebar (stage rail + checklist, document + review form). */
export const useWide = () => useMediaQuery("(min-width: 1024px)");
/** Mouse or trackpad: drag-to-reorder is offered; touch gets up/down buttons instead. */
export const useFinePointer = () => useMediaQuery("(pointer: fine)");
