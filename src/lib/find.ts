/**
 * In-chat find-bar domain (Cmd/Ctrl+F): the open flag, query text, and
 * hit cursor live in one plain object (never a class in `$state`), with
 * function updates. The hit list itself stays a component derived (it
 * reads the messages); focus, scroll-landing, and mode resets stay in
 * the component's open/step/close functions.
 */
export interface FindState {
	open: boolean;
	query: string;
	cursor: number;
}

/** Closed bar with a cleared query and cursor. */
export function emptyFind(): FindState {
	return { open: false, query: "", cursor: 0 };
}

/**
 * Cycle the hit cursor past either end. The total stays positive — the
 * body only steps with hits, so zero is not a case here.
 */
export function stepFindCursor(
	total: number,
	cursor: number,
	delta: 1 | -1
): number {
	return (((cursor + delta) % total) + total) % total;
}
