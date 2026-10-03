import { Eye, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "../../shared/api-types";

const ROLE = {
	admin: { label: "Admin", Icon: ShieldCheck, cls: "border-foreground/20 bg-secondary text-foreground" },
	viewer: { label: "Viewer", Icon: Eye, cls: "border-border bg-muted text-muted-foreground" },
} as const;

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
	const { label, Icon, cls } = ROLE[role];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
				cls,
				className,
			)}
		>
			<Icon className="size-3.5" aria-hidden />
			{label}
		</span>
	);
}
