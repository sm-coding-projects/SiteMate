import { type RefObject, useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion() {
	const [reduced, setReduced] = useState(() => window.matchMedia(QUERY).matches);
	useEffect(() => {
		const mq = window.matchMedia(QUERY);
		const on = () => setReduced(mq.matches);
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, []);
	return reduced;
}

/**
 * Counts completed stages 0 → total, one every `stepMs`, then holds.
 * With `replayEveryMs`, quietly redraws from 0 on that interval. Reduced motion: jumps to `total` and stays.
 */
export function useStageSequence({
	total = 8,
	stepMs = 850,
	startDelayMs = 400,
	replayEveryMs,
	start = true,
}: {
	total?: number;
	stepMs?: number;
	startDelayMs?: number;
	replayEveryMs?: number;
	start?: boolean;
} = {}) {
	const reduced = useReducedMotion();
	const [built, setBuilt] = useState(reduced ? total : 0);

	useEffect(() => {
		if (reduced) {
			setBuilt(total);
			return;
		}
		if (!start) return;
		const timers: ReturnType<typeof setTimeout>[] = [];
		const run = (from: number) => {
			setBuilt(from);
			for (let i = 1; i <= total; i++) timers.push(setTimeout(() => setBuilt(i), startDelayMs + i * stepMs));
		};
		run(0);
		const replay = replayEveryMs ? setInterval(() => run(0), replayEveryMs) : undefined;
		return () => {
			for (const t of timers) clearTimeout(t);
			if (replay) clearInterval(replay);
		};
	}, [reduced, start, total, stepMs, startDelayMs, replayEveryMs]);

	return built;
}

/** True once the element has scrolled into view (and stays true). */
export function useInView(ref: RefObject<Element | null>, threshold = 0.3) {
	const [inView, setInView] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el || inView) return;
		const io = new IntersectionObserver(
			([e]) => {
				if (e?.isIntersecting) {
					setInView(true);
					io.disconnect();
				}
			},
			{ threshold },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [ref, threshold, inView]);
	return inView;
}

/** 0 → 1 as the element travels from entering the bottom of the viewport to its middle. */
export function useScrollProgress(ref: RefObject<Element | null>) {
	const reduced = useReducedMotion();
	const [p, setP] = useState(reduced ? 1 : 0);
	useEffect(() => {
		if (reduced) {
			setP(1);
			return;
		}
		let raf = 0;
		const measure = () => {
			raf = 0;
			const el = ref.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			const vh = window.innerHeight;
			const start = vh * 0.9;
			const end = vh * 0.35;
			setP(Math.min(1, Math.max(0, (start - r.top) / (start - end))));
		};
		const onScroll = () => {
			if (!raf) raf = requestAnimationFrame(measure);
		};
		measure();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		};
	}, [ref, reduced]);
	return p;
}

/** Rolls a number up from 0 to `target` once `active` turns true. */
export function useCountUp(target: number, active: boolean, durationMs = 600) {
	const reduced = useReducedMotion();
	const [n, setN] = useState(0);
	useEffect(() => {
		if (!active) return;
		if (reduced) {
			setN(target);
			return;
		}
		let raf = 0;
		const t0 = performance.now();
		const tick = (t: number) => {
			const k = Math.min(1, (t - t0) / durationMs);
			setN(Math.round(target * (1 - (1 - k) ** 3)));
			if (k < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [target, active, durationMs, reduced]);
	return n;
}
