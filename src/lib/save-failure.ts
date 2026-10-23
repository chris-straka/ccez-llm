/**
 * Saves that failed (storage full or blocked). Every store keeps
 * working in memory, but what it holds is gone on relaunch, so the
 * page says so once instead of losing work in silence.
 */
let handler: (() => void) | null = null;

/** The page's one listener (a toast); replaces any earlier one. */
export function onSaveFailure(fn: (() => void) | null): void {
	handler = fn;
}

/** A store's write threw. */
export function reportSaveFailure(): void {
	handler?.();
}

/** The copy the page shows. */
export const SAVE_FAILURE_COPY =
	"Storage is full, so new changes aren't being saved. Delete old chats or pasted images to make room.";
