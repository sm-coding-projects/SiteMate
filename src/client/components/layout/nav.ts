import { FolderKanban, History, UserRound } from "lucide-react";

/** Desktop shows the "workspace" group in the sidebar; Account lives in the user block at the bottom. */
export const NAV = [
	{ to: "/projects", label: "Projects", icon: FolderKanban, group: "workspace" },
	{ to: "/activity", label: "Activity", icon: History, group: "workspace" },
	{ to: "/account", label: "Account", icon: UserRound, group: "you" },
] as const;

export const ICON_PROPS = {
	className: "size-[18px] shrink-0",
	strokeWidth: 1.5,
	"aria-hidden": true,
} as const;
