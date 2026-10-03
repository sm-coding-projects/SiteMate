import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

/**
 * Bottom sheet on phones (thumb reach), centred panel from 640px. Flat surface, hairline border,
 * shadow only because it's an overlay. No backdrop blur (MASTER.md anti-patterns).
 */
function DialogContent({
	className,
	children,
	wide = false,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { wide?: boolean }) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
			<DialogPrimitive.Content
				className={cn(
					"fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-lg border bg-card text-card-foreground shadow-lg outline-none",
					"pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
					"sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:pb-0 sm:data-[state=open]:slide-in-from-bottom-2",
					wide ? "sm:max-w-3xl" : "sm:max-w-lg",
					"duration-[320ms] ease-enter",
					className,
				)}
				{...props}
			>
				{children}
				<DialogPrimitive.Close
					className="absolute top-2 right-2 grid size-11 place-items-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
					aria-label="Close"
				>
					<X className="size-5" aria-hidden />
				</DialogPrimitive.Close>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("border-b px-6 pt-6 pb-4 pr-14", className)} {...props} />;
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end", className)}
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />;
}

function DialogDescription({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />
	);
}

export {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
};
