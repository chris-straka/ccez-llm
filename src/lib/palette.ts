/**
 * Search-palette domain (Ctrl+P / Cmd+P): the open flag, query text,
 * hits, busy flag, and cursor live in one plain object (never a class
 * in `$state`). Debounce timers, element bindings, the document store,
 * and focus effects stay in the component's open/query/close/step
 * functions. Resets are field-by-field on purpose: closing preserves
 * the cursor (reopen resets it), exactly like the scattered `$state`
 * did.
 */
import type { SearchHit } from "./chatSearch";

export interface PaletteState {
	open: boolean;
	query: string;
	hits: SearchHit[];
	busy: boolean;
	cursor: number;
}

/** Fresh palette: closed, cleared, idle, cursor at the top. */
export function emptyPalette(): PaletteState {
	return { open: false, query: "", hits: [], busy: false, cursor: 0 };
}
