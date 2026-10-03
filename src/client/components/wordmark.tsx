import { HardHat } from "lucide-react";
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
	return (
		<span className={cn("inline-flex items-center gap-2 font-bold tracking-tight", className)}>
			<span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
				<HardHat className="size-5" aria-hidden />
			</span>
			<span className="text-lg">SiteMate</span>
		</span>
	);
}
