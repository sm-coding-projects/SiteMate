import { useCallback, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "sitemate-theme";

function read(): ThemePref {
	try {
		const v = localStorage.getItem(KEY);
		return v === "light" || v === "dark" ? v : "system";
	} catch {
		return "system";
	}
}

export function useTheme() {
	const [theme, setThemeState] = useState<ThemePref>(read);
	const setTheme = useCallback((next: ThemePref) => {
		const root = document.documentElement;
		if (next === "system") delete root.dataset.theme;
		else root.dataset.theme = next;
		try {
			if (next === "system") localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, next);
		} catch {}
		setThemeState(next);
	}, []);
	return { theme, setTheme };
}
