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

/** Native select: the phone's own picker is the best touch UI there is. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
	return (
		<select
			data-slot="select"
			className={cn(
				"h-11 w-full rounded-md border border-input bg-card px-3 text-base outline-none transition-[border-color] duration-[120ms] ease-enter focus-visible:border-foreground disabled:opacity-50",
				className,
			)}
			{...props}
		/>
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
		<div className={cn("grid gap-1.5", className)}>
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
