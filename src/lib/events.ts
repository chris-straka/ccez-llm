/**
 * Shared DOM-event idioms for page-level handlers.
 */

const FIELD_SELECTOR = "input, textarea, select";
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable]";

/**
 * Closest matching ancestor for an event target (or the focused
 * element). The one `as HTMLElement` in the codebase: EventTarget has
 * no `.closest`, so every handler would repeat this assertion.
 */
export function closestFromTarget(
	target: EventTarget | null | undefined,
	selector: string
): HTMLElement | null {
	const el = target as HTMLElement | null;
	return (el?.closest?.(selector) ?? null) as HTMLElement | null;
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
