/**
 * Viewport reflow helpers (search-mobile bucket): pure math for the
 * VisualViewport-based composer reflow above the Android keyboard.
 * Call sites feed `window.innerHeight` plus the visual viewport's
 * height/offsetTop; tests pass explicit values — Vitest runs in node,
 * where no viewport exists.
 */

/** Pixels of the layout viewport covered by the keyboard (0 when closed). */
export function keyboardOverlapPx(
	innerHeight: number,
	viewportHeight: number,
	viewportOffsetTop = 0
): number {
	return Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
}

/**
 * True when the overlap reads as an open soft keyboard rather than
 * rounding noise or a partially-visible viewport. Matches the 100px
 * floor the page already used before this helper existed.
 */
export function isKeyboardOpen(
	innerHeight: number,
	viewportHeight: number,
	viewportOffsetTop = 0,
	minOverlap = 100
): boolean {
	return keyboardOverlapPx(innerHeight, viewportHeight, viewportOffsetTop) >= minOverlap;
}

/**
 * Arming state for the `.app` height pin. The pin must hold for two
 * consecutive open frames before engaging: mid-animation the layout
 * height and the visual viewport update at different rates, so a lone
 * frame can cross the open gate and flick the pin on for a frame
 * against the native resize. Release is always immediate.
 */
export interface PinArmState {
	armed: boolean;
	sawOpen: boolean;
}

export function pinArmStart(): PinArmState {
	return { armed: false, sawOpen: false };
}

/**
 * Arm immediately. Only the settle step calls this: engaging on
 * animation frames grabs a transitional height (the visual viewport
 * leads the layout for a few frames on warm opens), then releases
 * mid-flight — the composer visibly moves twice. Stable geometry
 * never has that problem.
 */
export function pinNow(): PinArmState {
	return { armed: true, sawOpen: true };
}

/**
 * True when the layout viewport itself shrank well below its
 * keyboard-closed height — i.e. the native resize (adjustResize) is
 * already gliding the layout and a JS height pin would only fight it
 * with coarser snapshots. The caller tracks the keyboard-closed
 * baseline and passes it as fullHeight.
 */
export function nativeResizeActive(fullHeight: number, innerHeight: number, minShrink = 100): boolean {
	return fullHeight - innerHeight >= minShrink;
}

export interface PinSettle {
	pin: PinArmState;
	fullHeight: number;
}

/**
 * Settle step, run with fresh geometry once viewport events stop — the
 * ONLY place the pin engages. Closed geometry releases the pin and
 * refreshes the baseline (rotation-safe). Open geometry with a shrunken
 * layout means the native resize is gliding: stay disarmed. Open
 * geometry with a full layout is the no-shrink fallback (old WebViews,
 * adjustPan): arm here, on stable heights, never mid-animation.
 */
export function settlePin(
	pin: PinArmState,
	fullHeight: number,
	innerHeight: number,
	open: boolean,
	minShrink = 100
): PinSettle {
	if (!open) return { pin: pinArmStart(), fullHeight: innerHeight };
	if (nativeResizeActive(fullHeight, innerHeight, minShrink)) {
		return { pin: pinArmStart(), fullHeight };
	}
	return { pin: pinNow(), fullHeight };
}

/**
 * Learn the keyboard height from live geometry. Under a native resize
 * the layout shrink IS the keyboard (the visual overlap reads near
 * zero there); without one the visual overlap is. Returns the running
 * max — a height once seen stays known for the focus prediction.
 */
export function learnKbHeight(
	prev: number,
	fullHeight: number,
	innerHeight: number,
	overlap: number,
	minLearn = 100
): number {
	const shrink = fullHeight - innerHeight;
	if (shrink > minLearn) return Math.max(prev, shrink);
	if (overlap > minLearn) return Math.max(prev, overlap);
	return prev;
}

/**
 * App height to pre-reserve when the composer focuses ahead of the
 * keyboard. The layout trails the keyboard window by a frame or two,
 * during which the keyboard covers the composer; reserving the last
 * known height up front closes that window. Null when the guess is
 * unsafe (nothing learned yet, or it would collapse the app) — the
 * caller then waits for real geometry.
 */
export function predictAppHeight(
	innerHeight: number,
	kbHeight: number,
	minAppHeight = 200
): number | null {
	if (kbHeight <= 0) return null;
	const predicted = innerHeight - kbHeight;
	return predicted >= minAppHeight ? predicted : null;
}
