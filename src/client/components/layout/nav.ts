import { FolderKanban, History, UserRound } from "lucide-react";

export const NAV = [
	{ to: "/projects", label: "Projects", icon: FolderKanban },
	{ to: "/activity", label: "Activity", icon: History },
	{ to: "/account", label: "Account", icon: UserRound },
] as const;
