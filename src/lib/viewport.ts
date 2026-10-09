/**
 * Viewport state object.
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
	/** Scroll offset at the previous scroll event (direction reads). */
	lastTop: number;
	/** Reading anchor while unpinned: the message at the top of the
	view and its offset from the box top, held across re-renders. */
	anchor: ScrollAnchor | null;
}

/** A message the reader is looking at, by element id and offset. */
export interface ScrollAnchor {
	id: string;
	offset: number;
}

export function emptyViewport(): ViewportState {
	return {
		stick: false,
		holding: false,
		hold: null,
		holdSeq: 0,
		idleTimer: undefined,
		lastStreamLen: 0,
		lastTop: 0,
		anchor: null
	};
}

/**
 * Stickiness after a scroll event, by intent rather than position:
 * any upward move unpins at once (small trackpad nudges included, so
 * a stream never drags a reader back down); the true bottom always
 * pins; a downward move into the stick slop re-pins; anything else
 * keeps the previous state (an in-flight glide to the bottom stays
 * pinned). Content shrinking under a reader at the bottom clamps the
 * offset up but leaves the gap at zero, so it never reads as intent.
 */
export function stickAfterScroll(facts: {
	stick: boolean;
	top: number;
	lastTop: number;
	gap: number;
	slop: number;
}): boolean {
	if (facts.gap <= 1) return true;
	if (facts.top < facts.lastTop - 0.5) return false;
	if (facts.top > facts.lastTop + 0.5 && facts.gap <= facts.slop) return true;
	return facts.stick;
}

/**
 * The message a reader is looking at: the first whose bottom sits
 * below the box top, with its top's offset from the box top (negative
 * when it starts above the fold). Null with nothing measured.
 */
export function pickScrollAnchor(
	rects: Array<{ id: string; top: number; bottom: number }>,
	boxTop: number
): ScrollAnchor | null {
	for (const r of rects) {
		if (r.bottom > boxTop) return { id: r.id, offset: r.top - boxTop };
	}
	return null;
}

/**
 * True when a rect already reads in the clear viewport: inside the column and above the composer dock. The jump
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
 * Scroll delta landing a rect in the clear: covered
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
