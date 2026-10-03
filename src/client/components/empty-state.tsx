import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon: LucideIcon;
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center rounded-lg border border-dashed bg-card px-6 py-12 text-center">
			<span className="mb-4 grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
				<Icon className="size-7" aria-hidden />
			</span>
			<h2 className="text-lg font-semibold">{title}</h2>
			{description && <p className="mt-1 max-w-sm text-muted-foreground">{description}</p>}
			{action && <div className="mt-6">{action}</div>}
		</div>
	);
}
