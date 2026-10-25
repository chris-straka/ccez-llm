import {
	PROMPT_IDLE_ALWAYS,
	PROMPT_IDLE_MAX,
	PROMPT_IDLE_MIN,
	PROMPT_IDLE_NEVER
} from "./settings";

/**
 * App-chrome helpers (pure, DOM-free): prompt idle-hide and friends. The Svelte shells own listeners and classes; the
 * decisions live here so Vitest can pin them.
 */

/**
 * How long a press inside the composer counts as in flight: a
 * focusout to nowhere within it is the press (WebKit never focuses
 * the pressed button), not the user leaving.
 */
export const PROMPT_PRESS_GRACE_MS = 1500;

/**
 * Always-hide's backstop, checked by the idle ticker: a composer left
 * visible after a focusout was skipped as a press in flight (or a
 * summon whose focus never landed) gets re-parked once the press
 * grace runs out. The caller then applies the same hide rules as a
 * focusout to wherever focus is now.
 */
export function alwaysReparkDue(o: {
	alwaysMode: boolean;
	idle: boolean;
	sincePressMs: number;
}): boolean {
	return o.alwaysMode && !o.idle && o.sincePressMs >= PROMPT_PRESS_GRACE_MS;
}

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

/** Readout for the stored idle value: "always", seconds, or "never". */
export function formatIdleTimeout(sec: number): string {
	if (sec === PROMPT_IDLE_ALWAYS) return "always";
	return sec > 0 ? `${Math.round(sec)} s` : "never";
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
 * True when a point sits inside a rect: the send
 * button is absolutely positioned inside a display:contents span
 * (no box of its own) and disabled buttons eat their events — so
 * holds arm from the prompt's own handlers by geometry, never by
 * bubbling.
 */
export function pointInRect(
	x: number,
	y: number,
	rect:
		| { left: number; right: number; top: number; bottom: number }
		| null
		| undefined
): boolean {
	return (
		!!rect &&
		x >= rect.left &&
		x <= rect.right &&
		y >= rect.top &&
		y <= rect.bottom
	);
}

/**
 * What a send-button hold does. A reply in flight in this chat makes
 * the hold a stop; otherwise it swaps the reply language. Either way
 * the composer keeps what it holds (the release never sends). Nothing
 * arms with a timer already running or an in-prompt note edit owning
 * the gesture.
 */
export function sendHoldAction(facts: {
	timerRunning: boolean;
	promptNoteEditing: boolean;
	replyLive: boolean;
}): "stop-reply" | "swap-lang" | null {
	if (facts.timerRunning || facts.promptNoteEditing) return null;
	return facts.replyLive ? "stop-reply" : "swap-lang";
}

/**
 * Chat-column bounds for gutter clicks: min left and
 * max right across the message boxes (plus the empty state, which
 * holds the column alone). Null with nothing laid out. Pure and
 * unit-tested.
 */
export function columnBounds(
	boxes: Iterable<{ x: number; width: number }>
): { left: number; right: number } | null {
	let left = Infinity;
	let right = -Infinity;
	for (const box of boxes) {
		left = Math.min(left, box.x);
		right = Math.max(right, box.x + box.width);
	}
	return left === Infinity ? null : { left, right };
}

/**
 * Gutter side for a double-click: left of the column
 * opens the chat list, right of it opens settings, inside the
 * column summons the composer. Edges belong to the column.
 */
export function gutterSide(
	clientX: number,
	left: number,
	right: number
): "left" | "right" | "column" {
	if (clientX < left) return "left";
	if (clientX > right) return "right";
	return "column";
}

/**
 * Whether live work owns a message's action row: a
 * loading aid or running audio holds the row like a held press —
 * closing now would strand the spinner with no buttons, or the
 * stop button out of reach mid-utterance. The timer re-arms and a
 * later tick closes it after the work lands.
 */
export function rowWorkRunning(
	id: string,
	aidBusy: ReadonlySet<string>,
	vocalizing: ReadonlySet<string>,
	speakingId: string | null,
	speakingSelection: string | null
): boolean {
	return (
		aidBusy.has(id) ||
		vocalizing.has(id) ||
		speakingId === id ||
		speakingSelection === id
	);
}

/**
 * Whether a tap may toggle a message's action row:
 * both platforms honor the Messages checkbox (off removes the row
 * outright), then the reveal-style gates decide tap toggling.
 */
export function messageActionsTapAllowed(
	android: boolean,
	showMessageButtons: boolean,
	hideMessages: boolean,
	hideButtons: boolean
): boolean {
	if (!showMessageButtons) return false;
	if (!hideMessages && !(android && hideButtons)) return false;
	return true;
}

/**
 * Parked composer: idle-hidden OR a sidebar owns the
 * stage (chats list or settings). Parking is visual only — idle
 * keeps its own state, so closing the sidebar returns exactly the
 * prior idle state instead of summoning a hidden prompt. Phones
 * never park for drawers: the chats list and settings are overlays
 * above the composer, so hiding it under them only slid the thread
 * and flickered the card — only a real idle timeout parks.
 */
export function promptParkedFor(
	android: boolean,
	idle: boolean,
	settingsOpen: boolean,
	sidebarCollapsed: boolean
): boolean {
	if (android) return idle;
	return idle || settingsOpen || !sidebarCollapsed;
}
