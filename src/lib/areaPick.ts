/**
 * Set-area overlay geometry (the Shift+Cmd+U route): pure rect math
 * over explicit points, so the overlay route stays thin and the
 * decisions are unit-tested.
 *
 * Units are screen points throughout: `screencapture -R` takes
 * points, never device pixels (verified on a 2x display: `-R0,0,100,100`
 * yields a 200x200px shot). The overlay sends viewport-relative
 * rects and the backend adds the window's true frame origin itself
 * (`window.screenY` in the webview reports a display height too
 * much, so the overlay never maps to global) — no
 * `devicePixelRatio` multiply anywhere.
 */

export interface AreaPoint {
	x: number;
	y: number;
}

export interface AreaRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Normalize a drag to a viewport-relative rect. Null until both
 * endpoints exist (pointer is up). Pure.
 */
export function dragRect(
	start: AreaPoint | null,
	current: AreaPoint | null
): AreaRect | null {
	if (start === null || current === null) return null;
	return {
		x: Math.min(start.x, current.x),
		y: Math.min(start.y, current.y),
		width: Math.abs(current.x - start.x),
		height: Math.abs(current.y - start.y)
	};
}

/**
 * Drag threshold under which a press-release counts as a click and
 * takes the whole display (the overlay hint reads "Click for
 * fullscreen"). Matches the overlay's long-standing behavior.
 */
export const CLICK_PICK_PX = 5;

/**
 * True for a press-release without a real drag. Pure.
 */
export function isClickPick(rect: AreaRect): boolean {
	return rect.width < CLICK_PICK_PX && rect.height < CLICK_PICK_PX;
}

/**
 * Round a viewport-relative rect to integer points for the backend
 * (which adds the overlay window's true frame origin). Pure.
 */
export function roundRect(rect: AreaRect): AreaRect {
	return {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		width: Math.round(rect.width),
		height: Math.round(rect.height)
	};
}
