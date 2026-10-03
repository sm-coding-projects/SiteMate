import type { ReactNode } from "react";

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
	return (
		<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
			<h1 className="text-2xl font-bold tracking-tight text-balance md:text-[1.75rem]">{title}</h1>
			{actions && <div className="flex items-center gap-2">{actions}</div>}
		</div>
	);
}
