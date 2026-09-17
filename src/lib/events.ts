/**
 * Shared DOM-event idioms for page-level handlers.
 */

const FIELD_SELECTOR = "input, textarea, select";
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable]";
/** The prompt's editor subtree (the plain-textarea composer). */
const PROMPT_EDITOR_SELECTOR = ".prompt .ta-input";
/** Any composer editor, prompt or message-edit. */
const COMPOSER_SELECTOR = ".ta-input";
const FILTER_SELECTOR = ".shortcuts-filter";
const FIND_BAR_SELECTOR = ".find-bar";
const SIDEBAR_SELECTOR = "aside";
const PROMPT_SELECTOR = ".prompt";
/**
 * Shift+D's wider selector: buttons and links keep their own keys too,
 * on top of every field and rich editor.
 */
const INTERACTIVE_SELECTOR = "input, textarea, select, button, a, [contenteditable]";
/**
 * The Inspect field guard (also the Esc+f filter carve-out): typing in
 * the shortcuts filter must not step the preview or exit fullscreen.
 */
const INSPECT_FIELD_SELECTOR = "input, textarea, select, [contenteditable], .shortcuts-filter";
/** Fields and buttons keep their native Space (empty-chat summon check). */
const SPACE_INTERACTIVE_SELECTOR = "input, textarea, select, [contenteditable], button, a";
/**
 * Idle-restore owned stage: an open overlay, sidebar, or panel owns bare
 * keys, so Space out there never summons the prompt from behind it.
 */
const IDLE_OWNED_SELECTOR =
	"input, textarea, select, [contenteditable], button, a, summary, aside, .modal, .modal-veil, .find-bar, .search-palette, .sel-menu, .review, .lang-menu";
/**
 * Ctrl+G entry owned stage: same idea one branch below, minus summary
 * and the language menu — the two spellings differ on purpose, so they
 * stay separate predicates instead of sharing one.
 */
const SCROLL_ENTER_OWNED_SELECTOR =
	"input, textarea, select, [contenteditable], button, a, aside, .modal, .modal-veil, .find-bar, .search-palette, .sel-menu, .review";

/**
 * Closest matching ancestor for an event target (or the focused
 * element). The one `as HTMLElement` in the codebase: EventTarget has
 * no `.closest`, so every handler would repeat this assertion
 * (`closest` already answers `HTMLElement | null`, so no second
 * assertion is needed on the way out).
 */
export function closestFromTarget(
	target: EventTarget | null | undefined,
	selector: string
): HTMLElement | null {
	const el = target as HTMLElement | null;
	return el?.closest?.(selector) ?? null;
}

/**
 * Mark a bubbling event fully handled: no default action, no further
 * listeners. Use only where both lines already run together — some
 * paths (right-click speak) deliberately let the native menu open and
 * must keep preventDefault alone.
 */
export function consumeEvent(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}

/** True when the event target sits in a plain form field. */
export function isFieldTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, FIELD_SELECTOR) !== null;
}

/**
 * True for form fields plus rich editors (the composer is
 * contenteditable). Bare fields and editors route differently, so this
 * stays a separate predicate rather than a flag.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, EDITABLE_SELECTOR) !== null;
}

/** True inside the prompt's editor subtree. */
export function isPromptEditorTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, PROMPT_EDITOR_SELECTOR) !== null;
}

/** True inside any composer editor (prompt or message-edit). */
export function isComposerTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, COMPOSER_SELECTOR) !== null;
}

/** True inside the shortcuts-modal filter input. */
export function isFilterTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, FILTER_SELECTOR) !== null;
}

/** True inside the in-chat find bar. */
export function isFindBarTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, FIND_BAR_SELECTOR) !== null;
}

/** True inside a sidebar drawer (chat list or settings panel). */
export function isSidebarTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, SIDEBAR_SELECTOR) !== null;
}

/** True anywhere inside the prompt subtree (editor or chrome). */
export function isPromptTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, PROMPT_SELECTOR) !== null;
}

/**
 * True for Shift+D's wider keep-out: fields, rich editors, buttons,
 * and links all keep their own keys.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, INTERACTIVE_SELECTOR) !== null;
}

/** True where Inspect stepping must not fire (fields and modal filter). */
export function isInspectFieldTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, INSPECT_FIELD_SELECTOR) !== null;
}

/** True where bare Space keeps its native behavior (fields, buttons). */
export function isSpaceInteractiveTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, SPACE_INTERACTIVE_SELECTOR) !== null;
}

/** True where a bare key must not summon the hidden idle prompt. */
export function isIdleOwnedTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, IDLE_OWNED_SELECTOR) !== null;
}

/** True where Ctrl+G must not enter scroll mode. */
export function isScrollEnterOwnedTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, SCROLL_ENTER_OWNED_SELECTOR) !== null;
}

/**
 * True when a plain (non-drag) mouseup must keep the window selection:
 * the press landed in an editable, or focus sits in one. Clicks into
 * editables already moved the selection there natively; a press that
 * kept field focus (buttons with mousedown-preventDefault) keeps a
 * live caret too — and that caret is never a stale message highlight.
 * Clearing under a focused field destroys the just-placed caret on
 * WebKit: later keystrokes dispatch yet never become text.
 */
export function mouseupKeepsSelection(
	target: EventTarget | null,
	active: EventTarget | null
): boolean {
	return isEditableTarget(target) || isEditableTarget(active);
}

/**
 * Press-start control check (also the tap-landing guard): buttons and
 * links, fields, summaries, rich editors, and code bodies keep their
 * own behavior while the prompt is hidden. Wider than the key path's
 * field guards on purpose — a mid-press re-render can retarget the
 * click onto an ancestor, but the press is still a control press.
 */
const CLICK_CONTROL_SELECTOR =
	"button, a, input, textarea, select, summary, [contenteditable], .ccez-code";

/** True on controls (see above). */
export function isClickControlTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, CLICK_CONTROL_SELECTOR) !== null;
}

/** True inside rendered math (taps there never summon). */
export function isMathTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, "[data-math-index]") !== null;
}

/** True where a summon restores without landing focus (overlay owns it). */
export function isTapOverlayTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, "aside, .modal, .modal-veil, .find-bar, .search-palette") !== null;
}

/**
 * True inside the annotation UI — the new-annotations composer card
 * (`.review`), the filing pill (`.ann-pop`), and the
 * previous-annotations sent-refs pop (`.ann-refs-pop`): picks rooted
 * there are never annotatable, and presses there never summon the
 * menu. Callers pass the selection anchor's element (text nodes
 * carry no `closest`).
 */
const ANNOTATION_UI_SELECTOR = ".review, .ann-pop, .ann-refs-pop";

/** True inside the annotation UI (see above). */
export function isAnnotationUiTarget(target: EventTarget | null): boolean {
	return closestFromTarget(target, ANNOTATION_UI_SELECTOR) !== null;
}

/** Middle-drag arming distance: below this a middle press is still a
click (the shortcuts toggle), never a gesture. Matches the left-drag
4px click-vs-drag precedent with room for wheel-button slop. */
export const MIDDLE_DRAG_PX = 8;

/** Horizontal run that folds a message once the dominant-axis test
passes. Past a word nudge, short of a sidebar stroke. */
export const MIDDLE_FOLD_PX = 28;

/** Vertical run that switches chats once the dominant-axis test
passes. Past a line nudge, short of a full swipe. */
export const MIDDLE_CHAT_PX = 36;

/** What a middle-drag displacement means, or null while still a
press. Pure over dx/dy so the gesture unit-tests without a mouse. */
export type MiddleDragGesture = "fold-message" | "older-chat" | "newer-chat";

export function middleDragGesture(dx: number, dy: number): MiddleDragGesture | null {
	const ax = Math.abs(dx);
	const ay = Math.abs(dy);
	if (ax < MIDDLE_DRAG_PX && ay < MIDDLE_DRAG_PX) return null;
	// Dominant axis wins with margin: diagonals near 45° stay a
	// press, so a shaky hand never folds and switches at once.
	if (ax > MIDDLE_FOLD_PX && ax > ay * 1.2) return "fold-message";
	if (ay > MIDDLE_CHAT_PX && ay > ax * 1.2) return dy < 0 ? "older-chat" : "newer-chat";
	return null;
}
