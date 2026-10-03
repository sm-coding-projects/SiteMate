import { cn } from "@/lib/utils";

/** The mark: an ink plate carrying the 8-segment bar, stage 4 in hi-vis. Works on paper and ink. */
export function Mark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 40 20" className={cn("h-5 w-10 shrink-0", className)} aria-hidden>
			<rect width="40" height="20" rx="3" fill="#0f1214" />
			<rect
				x="0.5"
				y="0.5"
				width="39"
				height="19"
				rx="2.5"
				fill="none"
				stroke="#ffffff"
				strokeOpacity="0.14"
			/>
			{Array.from({ length: 8 }, (_, i) => (
				<rect
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length, positional
					key={i}
					x={4 + i * 4.125}
					y="6"
					width="3.25"
					height="8"
					rx="0.5"
					fill={i === 3 ? "#e8ff3c" : "#eef0ec"}
					fillOpacity={i < 3 || i === 3 ? 1 : 0.28}
				/>
			))}
		</svg>
	);
}

export function Wordmark({ className, tone = "paper" }: { className?: string; tone?: "paper" | "ink" }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-2.5 font-heading text-[1.0625rem] font-bold tracking-tight stretch-expanded",
				tone === "ink" ? "text-[#eef0ec]" : "text-foreground",
				className,
			)}
		>
			<Mark />
			SiteMate
		</span>
	);
}
