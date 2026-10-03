import type { ReactNode } from "react";

/** Title + one-line context on the left, the page's primary action top-right. */
export function PageHeader({
	title,
	description,
	actions,
}: {
	title: string;
	description?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div className="mb-8 flex flex-wrap items-end justify-between gap-4">
			<div className="min-w-0">
				<h1 className="text-2xl font-semibold md:text-[1.75rem]">{title}</h1>
				{description && <p className="mt-1 max-w-[60ch] text-muted-foreground">{description}</p>}
			</div>
			{actions && <div className="flex items-center gap-2">{actions}</div>}
		</div>
	);
}
