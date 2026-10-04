import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A free-text input with a suggestion list under it (ARIA combobox, list autocomplete). Typing never
 * requires a pick: suggestions only fill fields. Arrow keys move, Enter picks, Escape closes.
 */
export function SuggestInput<T>({
	options,
	getKey,
	renderOption,
	onPick,
	footer,
	className,
	onKeyDown,
	onFocus,
	onBlur,
	...props
}: Omit<React.ComponentProps<typeof Input>, "role"> & {
	options: T[];
	getKey: (option: T) => string;
	renderOption: (option: T) => ReactNode;
	onPick: (option: T) => void;
	/** Small print under the options, e.g. data attribution. */
	footer?: ReactNode;
}) {
	const listId = useId();
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(-1);
	const shown = open && options.length > 0;
	// Options change as the query does; keep the highlight in range without an effect.
	const current = active < options.length ? active : -1;

	const pick = (option: T) => {
		onPick(option);
		setOpen(false);
		setActive(-1);
	};

	const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		onKeyDown?.(e);
		if (e.defaultPrevented) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (!options.length) return;
			e.preventDefault();
			setOpen(true);
			// Cycles none → first … last → none, so the typed text can be got back to.
			const last = options.length - 1;
			if (e.key === "ArrowDown") setActive(current >= last ? -1 : current + 1);
			else setActive(current === -1 ? last : current - 1);
		} else if (e.key === "Enter" && shown && current >= 0) {
			e.preventDefault();
			const option = options[current];
			if (option !== undefined) pick(option);
		} else if (e.key === "Escape" && shown) {
			// Close the list, not the dialog around it.
			e.preventDefault();
			e.stopPropagation();
			setOpen(false);
			setActive(-1);
		}
	};

	return (
		<div className="relative">
			<Input
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={shown}
				aria-controls={listId}
				aria-activedescendant={shown && current >= 0 ? `${listId}-${current}` : undefined}
				className={className}
				onKeyDown={keyDown}
				onFocus={(e) => {
					onFocus?.(e);
					setOpen(true);
				}}
				onBlur={(e) => {
					onBlur?.(e);
					setOpen(false);
					setActive(-1);
				}}
				onInput={() => {
					setOpen(true);
					setActive(-1);
				}}
				{...props}
			/>
			<div
				className={cn(
					"absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md",
					!shown && "hidden",
				)}
			>
				<div id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
					{options.map((option, i) => (
						// Keyboard selection is the input's (aria-activedescendant), so options take no focus.
						// biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled on the combobox input
						<div
							key={getKey(option)}
							id={`${listId}-${i}`}
							role="option"
							tabIndex={-1}
							aria-selected={i === current}
							// Keep focus in the input so blur doesn't close the list before the click lands.
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => pick(option)}
							onMouseEnter={() => setActive(i)}
							className="flex min-h-11 cursor-default items-center rounded-sm px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
						>
							{renderOption(option)}
						</div>
					))}
				</div>
				{footer && <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{footer}</p>}
			</div>
		</div>
	);
}
