/**
 * Viewport reflow helpers (search-mobile bucket): pure math for the
 * VisualViewport-based composer reflow above the Android keyboard.
 * Call sites feed `window.innerHeight` plus the visual viewport's
 * height; tests pass explicit values — Vitest runs in node, where no
 * viewport exists.
 */

/**
 * Pixels of the layout viewport covered by the keyboard (0 when
 * closed). Deliberately ignores the visual viewport's offset: on
 * phones the viewport only ever offsets as a focus pan *toward* the
 * just-opened keyboard, so subtracting it hides real opens and
 * strands the composer underneath.
 */
export function keyboardOverlapPx(
	innerHeight: number,
	viewportHeight: number
): number {
	return Math.max(0, innerHeight - viewportHeight);
}

/**
 * True when the overlap reads as an open soft keyboard rather than
 * rounding noise or a partially-visible viewport. Matches the 100px
 * floor the page already used before this helper existed.
 */
export function isKeyboardOpen(
	innerHeight: number,
	viewportHeight: number,
	minOverlap = 100
): boolean {
	return keyboardOverlapPx(innerHeight, viewportHeight) >= minOverlap;
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
export function nativeResizeActive(
	fullHeight: number,
	innerHeight: number,
	minShrink = 100
): boolean {
	return fullHeight - innerHeight >= minShrink;
}

export interface PinSettle {
	pin: PinArmState;
	fullHeight: number;
}

/**
 * Consecutive firmly-closed frames that mark the keyboard as really
 * gone between open episodes. A lone frame dipping under the open
 * gate mid-glide is noise, not a close — resetting the pin on it
 * would drop fallback tracking mid-flight and strand the composer
 * under the keyboard until the next settle.
 */
export const KB_EDGE_CLOSED_FRAMES = 2;

/**
 * True on the first open frame of a fresh keyboard episode: the
 * keyboard sat firmly closed (KB_EDGE_CLOSED_FRAMES consecutive
 * closed frames) before the gate crossed. The caller resets to the
 * clean disarmed state here, so every open starts like the first
 * tap; the settle step re-arms on stable geometry if truly needed.
 * Pure over the closed-frame count and the gate verdict so tests
 * can pin the edge.
 */
export function kbFreshOpen(closedFrames: number, open: boolean): boolean {
	return open && closedFrames >= KB_EDGE_CLOSED_FRAMES;
}

/**
 * Settle step, run with fresh geometry once viewport events stop — the
 * ONLY place the pin engages. Closed geometry releases the pin and
 * refreshes the baseline. Open geometry with a shrunken layout means
 * the native resize is gliding: stay disarmed. Open geometry with a
 * full layout is the no-shrink fallback (old WebViews, adjustPan):
 * arm here, on stable heights, never mid-animation.
 *
 * exactBaseline must be false while an editable is focused: with the
 * native resize gliding, open geometry reads closed (both viewports
 * shrink together), and stamping that shrunken height as the baseline
 * poisons the NEXT episode — a later transitional settle then reads
 * "full layout" and arms the pin mid-flight, the second pop. While
 * focused the baseline only ever grows (genuine resizes still track
 * up); the exact stamp returns once nothing is focused.
 */
export function settlePin(
	pin: PinArmState,
	fullHeight: number,
	innerHeight: number,
	open: boolean,
	minShrink = 100,
	exactBaseline = true
): PinSettle {
	if (!open) {
		const baseline = exactBaseline
			? innerHeight
			: Math.max(fullHeight, innerHeight);
		return { pin: pinArmStart(), fullHeight: baseline };
	}
	if (nativeResizeActive(fullHeight, innerHeight, minShrink)) {
		return { pin: pinArmStart(), fullHeight };
	}
	return { pin: pinNow(), fullHeight };
}
