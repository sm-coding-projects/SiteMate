import { FolderKanban, History, ScanText, UserRound, UsersRound } from "lucide-react";

/**
 * Desktop shows the "workspace" group in the sidebar; Account lives in the user block at the bottom.
 * Mobile tab bar shows the `mobile` items (≤5); Team is reached from the user menu there.
 */
export const NAV = [
	{
		to: "/projects",
		label: "Projects",
		icon: FolderKanban,
		group: "workspace",
		mobile: true,
		adminOnly: false,
	},
	{ to: "/review", label: "Review", icon: ScanText, group: "workspace", mobile: true, adminOnly: false },
	{ to: "/activity", label: "Activity", icon: History, group: "workspace", mobile: true, adminOnly: false },
	{ to: "/team", label: "Team", icon: UsersRound, group: "workspace", mobile: false, adminOnly: true },
	{ to: "/account", label: "Account", icon: UserRound, group: "you", mobile: true, adminOnly: false },
] as const;

export const ICON_PROPS = {
	className: "size-[18px] shrink-0",
	strokeWidth: 1.5,
	"aria-hidden": true,
} as const;
