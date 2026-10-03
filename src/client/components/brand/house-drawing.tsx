import { cloneElement, type ReactElement } from "react";
import { cn } from "@/lib/utils";

/*
 * Line drawing of a house that builds itself in template order. Stroke colour = currentColor.
 * Every shape has pathLength="1" so the .draw utility can reveal it with one dash offset.
 * Geometry is precomputed (cladding skips the openings).
 */
const CLADDING =
	"M100 160H380M100 170H380M100 180H128M184 180H296M352 180H380M100 190H128M184 190H222M258 190H296M352 190H380M100 200H128M184 200H222M258 200H296M352 200H380M100 210H128M184 210H222M258 210H296M352 210H380M100 220H222M258 220H380M100 230H222M258 230H380M100 240H222M258 240H380";
const HATCH =
	"M96 276l10-10M108 276l10-10M120 276l10-10M132 276l10-10M144 276l10-10M156 276l10-10M168 276l10-10M180 276l10-10M192 276l10-10M204 276l10-10M216 276l10-10M228 276l10-10M240 276l10-10M252 276l10-10M264 276l10-10M276 276l10-10M288 276l10-10M300 276l10-10M312 276l10-10M324 276l10-10M336 276l10-10M348 276l10-10M360 276l10-10M372 276l10-10M384 276l10-10";
const STUDS =
	"M128 154v94M156 154v94M184 154v94M212 154v94M240 154v94M268 154v94M296 154v94M324 154v94M352 154v94";

/** Wraps one shape so it draws itself once `built` reaches stage `at`. */
function D({
	at,
	built,
	children,
}: {
	at: number;
	built: number;
	children: ReactElement<{ className?: string }>;
}) {
	return cloneElement(children, {
		pathLength: 1,
		className: cn("draw", children.props.className),
		"data-drawn": built >= at,
	} as object);
}

/** `built` = number of completed stages (0–8). */
export function HouseDrawing({ built, className }: { built: number; className?: string }) {
	const fade = (at: number) =>
		cn("transition-opacity duration-500 ease-enter", built >= at ? "opacity-100" : "opacity-0");
	return (
		<svg
			viewBox="16 60 452 240"
			className={cn("w-full", className)}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.25}
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Line drawing of a house, built stage by stage from slab to handover"
		>
			{/* 01 Pre-construction: set-out pegs + dimension line */}
			<D at={1} built={built}>
				<path d="M84 262h12M90 256v12M384 262h12M390 256v12" />
			</D>
			<D at={1} built={built}>
				<path d="M90 270v24M390 270v24M90 288H390M86 292l8-8M386 292l8-8" strokeWidth={1} />
			</D>
			<text
				x="150"
				y="284"
				textAnchor="middle"
				fill="currentColor"
				stroke="none"
				className={cn("font-mono text-[10px] tracking-wider", fade(1))}
			>
				12 000
			</text>

			{/* 02 Site preparation: ground line + excavation */}
			<D at={2} built={built}>
				<path d="M24 262H456" />
			</D>
			<D at={2} built={built}>
				<path d={HATCH} strokeWidth={0.75} opacity={0.6} />
			</D>

			{/* 03 Base / slab */}
			<D at={3} built={built}>
				<rect x="88" y="248" width="304" height="14" />
			</D>

			{/* 04 Frame: wall frame, plates, studs (fade back once clad) */}
			<D at={4} built={built}>
				<path d="M100 248V148H380V248M100 154H380" />
			</D>
			<g className={cn("transition-opacity duration-500", built >= 6 ? "opacity-30" : "opacity-100")}>
				<D at={4} built={built}>
					<path d={STUDS} strokeWidth={1} />
				</D>
			</g>

			{/* 05 Lock-up: roof, windows, door */}
			<D at={5} built={built}>
				<path d="M84 150L240 72L396 150" />
			</D>
			<D at={5} built={built}>
				<path d="M128 172h56v44h-56zM296 172h56v44h-56zM222 248v-58h36v58" />
			</D>

			{/* 06 Fixing: cladding, glazing bars, door hardware */}
			<D at={6} built={built}>
				<path d={CLADDING} strokeWidth={0.75} opacity={0.7} />
			</D>
			<D at={6} built={built}>
				<path d="M156 172v44M128 194h56M324 172v44M296 194h56M250 222h3" strokeWidth={1} />
			</D>

			{/* 07 Practical completion: flue, downpipe, front path */}
			<D at={7} built={built}>
				<path d="M312 108V88h16v28M380 150v98M230 262l-18 26M250 262l18 26" />
			</D>

			{/* 08 Handover: the keys, in hi-vis */}
			<g className="text-hivis">
				<D at={8} built={built}>
					<path d="M420 214a9 9 0 1 0 0.01 0M429 223h26M449 223v8M442 223v6" strokeWidth={1.75} />
				</D>
			</g>
		</svg>
	);
}
