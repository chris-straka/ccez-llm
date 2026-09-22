import {
	PROMPT_IDLE_ALWAYS,
	PROMPT_IDLE_MAX,
	PROMPT_IDLE_MIN,
	PROMPT_IDLE_NEVER
} from "./settings";

/**
 * App-chrome helpers (pure, DOM-free): prompt idle-hide and slider
 * drag-to-reset. The Svelte shells own listeners and classes; the
 * decisions live here so Vitest can pin them.
 */

/** Pixels a slider drag must travel upward past its start to count as a reset. */
export const SLIDER_DRAG_RESET_PX = 48;

/**
 * Whether the prompt should hide: the last input was at least
 * `idleSec` seconds before `now` (epoch millis both). A non-positive
 * timeout disables hiding entirely.
 */
export function isPromptIdle(
	lastInputAt: number,
	now: number,
	idleSec: number
): boolean {
	if (!(idleSec > 0)) return false;
	return now - lastInputAt >= idleSec * 1000;
}

/**
 * Clamp a raw idle-timeout value into the settings range (whole
 * seconds). 0 ("never hide") passes through; everything else outside
 * the range falls back to the range floor.
 */
export function clampPromptIdleSec(raw: number): number {
	if (typeof raw !== "number" || Number.isNaN(raw)) return PROMPT_IDLE_MIN;
	if (raw === PROMPT_IDLE_NEVER || raw === PROMPT_IDLE_ALWAYS) return raw;
	return Math.min(PROMPT_IDLE_MAX, Math.max(PROMPT_IDLE_MIN, Math.round(raw)));
}

/**
 * The idle slider's top tick sits one past the max and means "never":
 * the stored value is 0 (hiding disabled — see `isPromptIdle`).
 */
export const IDLE_SLIDER_TOP = PROMPT_IDLE_MAX + 1;
/** Bottom slider tick: "always hide when unfocused". */
export const IDLE_SLIDER_BOTTOM = 1;

/** Slider position -> stored value (bottom tick stores "always"). */
export function idleSliderToSetting(slider: number): number {
	if (slider <= IDLE_SLIDER_BOTTOM) return PROMPT_IDLE_ALWAYS;
	if (slider >= IDLE_SLIDER_TOP) return PROMPT_IDLE_NEVER;
	return clampPromptIdleSec(slider);
}

/** Stored value -> slider position ("always" rides the bottom tick). */
export function idleSettingToSlider(sec: number): number {
	if (sec === PROMPT_IDLE_ALWAYS) return IDLE_SLIDER_BOTTOM;
	if (!(sec > 0)) return IDLE_SLIDER_TOP;
	return clampPromptIdleSec(sec);
}

/** Readout for the stored idle value: "always", seconds, or "never". */
export function formatIdleTimeout(sec: number): string {
	if (sec === PROMPT_IDLE_ALWAYS) return "always";
	return sec > 0 ? `${Math.round(sec)} s` : "never";
}

/**
 * Whether a pointer gesture on a slider counts as "dragged upward past
 * its top": released at least SLIDER_DRAG_RESET_PX above where the
 * press began (clientY grows downward, so up means endY < startY).
 */
export function draggedSliderPastTop(startY: number, endY: number): boolean {
	return startY - endY >= SLIDER_DRAG_RESET_PX;
}

/**
 * Which chrome can own the stage: every modal, palette, panel, docked
 * view, and drawer that takes bare keys away from the main chat. One
 * predicate so the keyboard router can't forget a newcomer in one
 * guard list and remember it in another (a Space that summons the
 * prompt from behind settings is the classic leak).
 */
export interface StageOwnerFlags {
	shortcutsOpen: boolean;
	searchOpen: boolean;
	inspectOpen: boolean;
	findOpen: boolean;
	settingsOpen: boolean;
	sidebarOpen: boolean;
}

/** True when any stage owner is up: bare main-chat keys stand down. */
export function stageOwnedByOverlay(flags: StageOwnerFlags): boolean {
	return (
		flags.shortcutsOpen ||
		flags.searchOpen ||
		flags.inspectOpen ||
		flags.findOpen ||
		flags.settingsOpen ||
		flags.sidebarOpen
	);
}

/**
 * True when a point sits inside a rect (REFACTOR §6): the send
 * button is absolutely positioned inside a display:contents span
 * (no box of its own) and disabled buttons eat their events — so
 * holds arm from the prompt's own handlers by geometry, never by
 * bubbling.
 */
export function pointInRect(
	x: number,
	y: number,
	rect: { left: number; right: number; top: number; bottom: number } | null | undefined
): boolean {
	return (
		!!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
	);
}

/**
 * Whether a send-button hold may arm (REFACTOR §6): the composer
 * must read empty (no text, pills, or annotations) with no timer
 * already running and no in-prompt note edit owning the gesture.
 */
export function sendHoldArmed(
	timerRunning: boolean,
	promptNoteEditing: boolean,
	composerEmpty: boolean
): boolean {
	return !timerRunning && !promptNoteEditing && composerEmpty;
}
