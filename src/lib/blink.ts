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
