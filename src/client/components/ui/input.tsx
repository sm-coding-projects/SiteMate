import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** 44px tall (gloves), 16px text so iOS doesn't zoom on focus. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base transition-[border-color] duration-[120ms] ease-enter outline-none placeholder:text-muted-foreground focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
				"file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium",
				className,
			)}
			{...props}
		/>
	);
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"flex min-h-24 w-full rounded-md border border-input bg-card px-3 py-2.5 text-base transition-[border-color] duration-[120ms] ease-enter outline-none placeholder:text-muted-foreground focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Native select: the phone's own picker is the best touch UI there is. The browser's arrow is replaced by
 * our own chevron (Safari draws its arrow flush against the border). `className` sizes the wrapper.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
	return (
		<span data-slot="select-wrapper" className={cn("relative block w-full", className)}>
			<select
				data-slot="select"
				className="peer h-11 w-full appearance-none truncate rounded-md border border-input bg-card pr-10 pl-3 text-base outline-none transition-[border-color] duration-[120ms] ease-enter focus-visible:border-foreground disabled:opacity-50"
				{...props}
			/>
			<ChevronDown
				aria-hidden
				className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
			/>
		</span>
	);
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
	// biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is passed by callers
	return <label data-slot="label" className={cn("text-sm font-medium", className)} {...props} />;
}

/** Label + control + hint/error, wired with ids for screen readers. */
function Field({
	id,
	label,
	hint,
	error,
	children,
	className,
}: {
	id: string;
	label: React.ReactNode;
	hint?: React.ReactNode;
	error?: string | null;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		// content-start: beside a taller field (one with a hint), keep the label and control at the top
		// instead of spreading them over the stretched height.
		<div className={cn("grid content-start gap-1.5", className)}>
			<Label htmlFor={id}>{label}</Label>
			{children}
			{error ? (
				<p id={`${id}-error`} className="text-sm text-destructive">
					{error}
				</p>
			) : hint ? (
				<p id={`${id}-hint`} className="text-sm text-muted-foreground">
					{hint}
				</p>
			) : null}
		</div>
	);
}

export { Field, Input, Label, NativeSelect, Textarea };
