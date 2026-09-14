/**
 * Shared CodeMirror StateEffects (editor slice, REFACTOR §7).
 *
 * The paste-collapse and fence-fold fields each dispatch effects; both
 * effect groups live here so the per-group modules (`editorPaste`,
 * `editorFences`) never import from each other or back from the
 * `editor.ts` composer. Verbatim moves, no behavior change.
 */
import { StateEffect } from "@codemirror/state";

export interface PasteCollapse {
	id: number;
	from: number;
	to: number;
	chars: number;
}

export const addPaste = StateEffect.define<PasteCollapse>();
export const expandPaste = StateEffect.define<number>();
export const expandAllPastes = StateEffect.define<void>();
export const collapseAllPastes = StateEffect.define<void>();
export const toggleFence = StateEffect.define<string>();
