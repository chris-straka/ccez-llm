/**
 * Shared DOM-event idioms for page-level handlers.
 */

const FIELD_SELECTOR = "input, textarea, select";
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable]";

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
	return Boolean((target as HTMLElement | null)?.closest(FIELD_SELECTOR));
}

/**
 * True for form fields plus rich editors (the composer is
 * contenteditable). Bare fields and editors route differently, so this
 * stays a separate predicate rather than a flag.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
	return Boolean((target as HTMLElement | null)?.closest(EDITABLE_SELECTOR));
}
