import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** One-field rename dialog (stages, checks). */
export function RenameDialog({
	open,
	onOpenChange,
	title,
	initial,
	maxLength,
	pending,
	onSave,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	title: string;
	initial: string;
	maxLength: number;
	pending: boolean;
	onSave: (value: string) => void;
}): ReactNode {
	const [value, setValue] = useState(initial);
	useEffect(() => {
		if (open) setValue(initial);
	}, [open, initial]);
	return (
		<RenameShell open={open} onOpenChange={onOpenChange} title={title}>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					if (value.trim()) onSave(value.trim());
				}}
				className="space-y-4"
			>
				<Input
					value={value}
					onChange={(e) => setValue(e.target.value)}
					maxLength={maxLength}
					autoFocus
					aria-label={title}
				/>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button type="submit" disabled={pending || !value.trim()}>
						{pending ? "Saving…" : "Save"}
					</Button>
				</div>
			</form>
		</RenameShell>
	);
}

function RenameShell({
	open,
	onOpenChange,
	title,
	children,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	title: string;
	children: ReactNode;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent aria-describedby={undefined}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<DialogBody>{children}</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
