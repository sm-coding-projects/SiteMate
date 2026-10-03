import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-base font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow] duration-[120ms] ease-enter outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:border-transparent aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				// Hi-vis is invisible on paper (1.02:1) without its ink edge.
				default: "border border-primary-edge bg-primary text-primary-foreground hover:bg-primary-hover",
				destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
				outline: "border border-input bg-card hover:bg-accent hover:text-accent-foreground",
				secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
				ghost: "hover:bg-accent hover:text-accent-foreground",
				link: "text-link underline-offset-4 hover:underline",
			},
			size: {
				// Every size is >= 44px tall: users may be outdoors, on a phone, wearing gloves.
				default: "h-11 px-5 has-[>svg]:px-4",
				sm: "h-11 gap-1.5 px-3 text-sm has-[>svg]:px-2.5",
				lg: "h-12 px-6 has-[>svg]:px-5",
				icon: "size-11 [&_svg:not([class*='size-'])]:size-5",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
