/**
 * Composer height glide. The textarea sizes itself (field-sizing or
 * autogrow), which snaps the bottom-anchored card a full line at a
 * time; CSS transitions can't follow content-driven size changes. The
 * editor calls `measure()` synchronously after each content change,
 * and the card animates from its old height to the new one (Web
 * Animations, overflow clipped while it runs), so lines slide up as
 * the top edge rises. Measuring in the change itself, not from a
 * ResizeObserver, keeps the card's own observers out of a resize loop.
 */

export const GLIDE_MS = 140;

/**
 * Start height for one glide, or null when nothing should animate:
 * the first measure, an unchanged height, or reduced motion. A glide
 * already in flight restarts from where it is on screen, so fast
 * typing never jumps back to a stale height.
 */
export function glideFrom(
	last: number | null,
	next: number,
	onScreen: number | null,
	reduced: boolean
): number | null {
	if (last === null || reduced) return null;
	const from = onScreen ?? last;
	return Math.abs(from - next) < 0.5 ? null : from;
}

export interface PromptGlide {
	/** Glide to the card's new natural height (call after a resize). */
	measure: () => void;
	detach: () => void;
}

export function createPromptGlide(card: HTMLElement): PromptGlide {
	if (typeof card.animate !== "function") {
		return { measure: () => {}, detach: () => {} };
	}
	const motion =
		typeof matchMedia === "function"
			? matchMedia("(prefers-reduced-motion: reduce)")
			: null;
	let last: number | null = card.offsetHeight || null;
	let running: Animation | null = null;
	// Size changes with no content change (window resize, tools row,
	// font scale) only refresh the baseline; they never animate.
	const observer =
		typeof ResizeObserver === "undefined"
			? null
			: new ResizeObserver(() => {
					if (!running) last = card.offsetHeight;
				});
	observer?.observe(card);
	return {
		measure() {
			const onScreen = running ? card.getBoundingClientRect().height : null;
			running?.cancel();
			running = null;
			// Natural height, measured with no animation applied.
			const next = card.offsetHeight;
			const from = glideFrom(last, next, onScreen, motion?.matches === true);
			last = next;
			if (from === null) return;
			const anim = card.animate(
				[
					{ height: `${from}px`, overflow: "clip" },
					{ height: `${next}px`, overflow: "clip" }
				],
				{ duration: GLIDE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" }
			);
			running = anim;
			anim.onfinish = () => {
				if (running === anim) running = null;
			};
		},
		detach() {
			observer?.disconnect();
			running?.cancel();
		}
	};
}
