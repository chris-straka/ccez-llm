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

/** Feed each viewport frame's open reading; pin only while armed. */
export function nextPinArm(state: PinArmState, open: boolean): PinArmState {
	if (!open) return { armed: false, sawOpen: false };
	if (state.armed) return state;
	if (state.sawOpen) return { armed: true, sawOpen: true };
	return { armed: false, sawOpen: true };
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
