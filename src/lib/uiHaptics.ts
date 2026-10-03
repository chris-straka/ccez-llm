/**
 * Ambient touch haptics: every press on a control ticks, and sliders
 * click once per step. Explicit beats (send, copy, refusals) fire from
 * their own handlers first; an ambient tick right behind one stands
 * down so a single press never buzzes twice.
 */

/** Controls whose press ticks (closest match from the event target). */
export const PRESS_SELECTOR =
	'button, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], summary, select, label.check, input[type="checkbox"], input[type="radio"]';

/** Quiet window after any beat: an ambient tick inside it is a double. */
export const AMBIENT_GAP_MS = 90;

/** Slider steps tick at most this often (a fast drag stays a purr). */
export const STEP_GAP_MS = 35;

/** True when an ambient beat may fire `gap` ms after the last one. */
export function beatAllowed(
	now: number,
	lastBeatAt: number,
	gap: number
): boolean {
	return now - lastBeatAt >= gap;
}
