/**
 * Shared double-blink driver (jump flashes, sent-row blinks): the
 * caller paints phase zero itself, then phases alternate clear/paint
 * on the 700/350 cadence and always end cleared. A false on-phase
 * paint aborts AND clears — a quote that no longer locates must
 * never strand yellow. Restarting (re-jump, re-press) stops the
 * previous run first; expiry self-stops. The returned stop is
 * idempotent, so a stale handle after expiry is harmless.
 */
export interface BlinkOptions {
	/** Total phases including the caller's phase zero (default 4). */
	phases?: number;
	/** Ms before the first (off) phase (default 700). */
	onMs?: number;
	/** Ms before the second (on) phase (default 350). */
	offMs?: number;
}

/**
 * Fade-out driver for highlight landings (jump flash): holds the
 * full grade, steps down the dim grades paint-before-clear (the
 * same pattern as the wash out-ramp — the registry never sits
 * empty mid-fade), then clears everything and reports done. A
 * failed locate mid-fade clears rather than stranding a grade.
 * Restarting stops the previous run first; the stop is idempotent.
 */
export interface HighlightFade {
	locate: () => Range | null;
	paint: (range: Range, name: string) => void;
	clear: (name: string) => void;
	/** Registry name holding full brightness (painted by the caller). */
	full: string;
	/** Dim grades in fade order, then terminal clear. */
	grades: string[];
	/** Ms of full-bright hold before the first step (default 700). */
	holdMs?: number;
	/** Ms between fade steps (default 50). */
	stepMs?: number;
	/** Runs after every grade paint (per-step repaint nudge). */
	onStep?: () => void;
	/** Runs once after the terminal clear (repaint nudge). */
	onDone?: () => void;
}

export function startHighlightFade(fade: HighlightFade): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;
	let step = 0;
	const stop = (): void => {
		stopped = true;
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};
	const clearAll = (): void => {
		fade.clear(fade.full);
		for (const grade of fade.grades) fade.clear(grade);
	};
	const tick = (delay: number): void => {
		timer = setTimeout(() => {
			timer = null;
			if (stopped) return;
			const range = fade.locate();
			if (!range) {
				clearAll();
				stop();
				fade.onDone?.();
				return;
			}
			if (step < fade.grades.length) {
				const name = fade.grades[step]!;
				fade.paint(range, name);
				fade.clear(step === 0 ? fade.full : fade.grades[step - 1]!);
				fade.onStep?.();
				step += 1;
				tick(fade.stepMs ?? 50);
			} else {
				clearAll();
				stop();
				fade.onDone?.();
			}
		}, delay);
	};
	tick(fade.holdMs ?? 700);
	return stop;
}

/**
 * Mark-element fade driver (jump flash where the highlight overlay
 * can't be trusted to repaint between registry writes): holds the
 * wrapped marks full-bright, adds the fade class, then reports done
 * (the caller unwraps). Reduced motion passes fadeMs 0 to skip the
 * animation and release after the hold. Restart safe via stop.
 */
export interface MarkFade {
	marks: HTMLElement[];
	/** Class starting the fade animation (default "fading"). */
	fadeClass?: string;
	/** Ms of full-bright hold (default 700). */
	holdMs?: number;
	/** Ms of fade before done; <= 0 skips the class (default 250). */
	fadeMs?: number;
	onDone?: () => void;
}

export function startMarkFade(fade: MarkFade): () => void {
	let hold: ReturnType<typeof setTimeout> | null = null;
	let tail: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;
	const stop = (): void => {
		stopped = true;
		if (hold !== null) clearTimeout(hold);
		if (tail !== null) clearTimeout(tail);
		hold = null;
		tail = null;
	};
	const finish = (): void => {
		stop();
		fade.onDone?.();
	};
	const fadeMs = fade.fadeMs ?? 250;
	hold = setTimeout(
		() => {
			hold = null;
			if (stopped) return;
			if (fadeMs <= 0) {
				finish();
				return;
			}
			for (const mark of fade.marks) {
				if (mark.isConnected) mark.classList.add(fade.fadeClass ?? "fading");
			}
			tail = setTimeout(finish, fadeMs);
		},
		fade.holdMs ?? 700
	);
	return stop;
}

export function startBlink(
	paint: () => boolean,
	clear: () => void,
	opts: BlinkOptions = {}
): () => void {
	const phases = opts.phases ?? 4;
	const onMs = opts.onMs ?? 700;
	const offMs = opts.offMs ?? 350;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;
	const stop = (): void => {
		stopped = true;
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};
	let phase = 0;
	const step = (): void => {
		if (stopped) return;
		phase += 1;
		if (phase >= phases) {
			clear();
			stop();
			return;
		}
		if (phase % 2 === 0) {
			if (!paint()) {
				clear();
				stop();
				return;
			}
		} else clear();
		timer = setTimeout(step, phase % 2 === 0 ? onMs : offMs);
	};
	timer = setTimeout(step, onMs);
	return stop;
}
