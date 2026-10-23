/**
 * Saves that failed (storage full or blocked). Every store keeps
 * working in memory, but what it holds is gone on relaunch, so the
 * page says so once instead of losing work in silence.
 */
let handler: ((copy: string) => void) | null = null;

/** The page's one listener (a toast); replaces any earlier one. */
export function onSaveFailure(fn: ((copy: string) => void) | null): void {
	handler = fn;
}

/** What a full store means for the user. */
export const SAVE_FAILURE_COPY =
	"Storage is full, so new changes aren't being saved. Delete old chats or pasted images to make room.";

/** An API key the keychain (or storage) refused. */
export const KEY_SAVE_FAILURE_COPY =
	"Couldn't save the API key, so it lasts only until the app closes.";

/** A store's write threw. */
export function reportSaveFailure(copy = SAVE_FAILURE_COPY): void {
	handler?.(copy);
}
