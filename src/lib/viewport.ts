/**
 * Viewport state object (scroll/viewport slice, REFACTOR §6).
 *
 * Stick-to-bottom, the held-finger freeze, the scroll-hold rAF loop,
 * the scrollbar fade timer, and the stream-follow cache lived as
 * scattered plain lets in the page. They group here as one
 * `ViewportState` (following the `FindState` / `PaletteState`
 * pilots): plain fields, nothing binds to them, so
 * scroll effects stop sharing subscription accidents with unrelated
 * domains. Element handles (`scrollBox`) and timer/frame wiring stay
 * in the component — only the values move. Unit-tested in
 * `viewport.test.ts`.
 */

/** One frame-paced scroll-hold glide (started by a held key). */
export interface ScrollHold {
	key: string;
	velocity: number;
	/** Discrete step total a sub-150ms tap lands (line for j/k, skip
	step for d/u, viewport-clamped at huge type): glide frames accrue
	from the first frame, so the release lands only the remainder
	(see tapReleaseRest) — never glide plus the full step. */
	tapDy: number;
	/** Signed px the glide has already applied: the release step
	subtracts this, so taps land exact totals and slow releases
	(which already covered the step) land nothing. */
	glided: number;
	downAt: number;
	/** rAF-clock start: the velocity ramp reads age off this, never the wall clock. */
	startT: number;
	/** rAF-clock of the first moving frame: the ramp ages from motion
	start, so a hold engages at ramp speed, never with a kick. */
	glideT: number | null;
	lastT: number;
	raf: number;
}

export interface ViewportState {
	/**
	 * Stick-to-bottom: submit/resend/stage pins the view to the newest
	 * content; scrolling up unpins (history never yanks), coming back
	 * to the bottom re-pins. Starts false: stuckness is established
	 * by geometry or scroll events, never assumed (an assumed-true
	 * yanks readers parked at the top before any scroll yet fired).
	 */
	stick: boolean;
	/**
	 * A finger held on the messages freezes all auto-scroll: the
	 * in-flight smooth scroll cancels in place and stream growth never
	 * yanks mid-hold.
	 */
	holding: boolean;
	/** Active key-hold glide, if any. */
	hold: ScrollHold | null;
	/**
	 * Glide generation: the rAF tick captures the count at start and
	 * exits when it changes. Identity comparison cannot work here —
	 * `$state` proxies never equal the raw object the tick closed
	 * over — so a primitive generation does the supersede check.
	 */
	holdSeq: number;
	/** Scrollbar fade timer handle (thumb shows while scrolling). */
	idleTimer: number | undefined;
	/** Stream-follow cache: last streamed length already pinned. */
	lastStreamLen: number;
}

export function emptyViewport(): ViewportState {
	return {
		stick: false,
		holding: false,
		hold: null,
		holdSeq: 0,
		idleTimer: undefined,
		lastStreamLen: 0
	};
}

/**
 * True when a rect already reads in the clear viewport (REFACTOR
 * §6): inside the column and above the composer dock. The jump
 * flash gates on this, so its hold only burns once the eye can
 * land on it.
 */
export function rectInClear(
	rectTop: number,
	rectBottom: number,
	boxTop: number,
	boxBottom: number,
	clear: number
): boolean {
	return rectTop >= boxTop && rectBottom <= boxBottom - clear;
}

/**
 * Scroll delta landing a rect in the clear (REFACTOR §6): covered
 * rects settle at a third of the clear height so the quote reads
 * with context around it.
 */
export function clearLandingDelta(
	rectTop: number,
	areaTop: number,
	areaHeight: number,
	dock: number
): number {
	const landing = areaTop + Math.max(0, areaHeight - dock) * 0.3;
	return rectTop - landing;
}

/**
 * Scroll delta landing a quote in the edit view (REFACTOR §6):
 * a fifth down the visible chat — the keyboard plus composer own
 * the bottom on phones, so the only visible space while typing is
 * at the top. Null when already there (8px dead zone).
 */
export function editViewDelta(
	rectTop: number,
	areaTop: number,
	visibleBottom: number
): number | null {
	const landing = areaTop + (visibleBottom - areaTop) * 0.2;
	const dy = rectTop - landing;
	return Math.abs(dy) > 8 ? dy : null;
}
