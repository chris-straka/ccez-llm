/**
 * Prompt editor helpers barrel (REFACTOR §7, done).
 *
 * The textarea composer (`textarea-editor`) is the only editor, on
 * desktop and phone alike, and owns the `PromptEditor` contract next
 * to its sole implementation. This module re-exports the pure
 * helpers from their real homes (`editorPaste` for paste/tag math,
 * `fences` for fence math, `textarea-editor` for the contract) so
 * importers (`+page`, tests) keep their paths. No locals: every name
 * below is a re-export.
 */
export {
	PASTE_THRESHOLD,
	collapsedPasteInsert,
	pastedLabel,
	pasteToggleAction,
	sendPasteFolds,
	trimPasteTail,
	markerCut,
	markerCutAt,
	attachTagRanges,
	tagCopyPlan,
	tagCopyIndexes,
	dataUrlsToImageFiles,
	pastedCutAt,
	expandDeletionUnits,
	removedMarkerIndexes,
	type AttachTagRange,
	type CollapsedPaste,
	type DeletionRange,
	type MarkerCut,
	type PasteSpan,
	type RemovedMarkerTags,
	type SendFold,
	type TagCopyPlan
} from "./editorPaste";

export {
	fenceAtOffset,
	parseFences,
	shiftEnterAction,
	type FenceBlock,
	type ShiftEnterAction
} from "./fences";

export type {
	PromptEditor,
	PromptEditorOptions,
	SubmitKind
} from "./textarea-editor";

/** Composer hint in edit mode. Leading U+00A0 nbsp (invisible in
the source — do not "fix" to a plain space, which collapses in
placeholder rendering) so the caret never sits under the glyphs. */
export const PROMPT_PLACEHOLDER = " Ctrl+G message scroll";
/** Composer hint while scrolled out hopping messages. */
export const SCROLL_PLACEHOLDER = " Ctrl+G to hop back in";
/**
 * Touch variants: no Ctrl key to name, and shortcuts keep working (a
 * keyboard may be attached) — only the hint text changes.
 */
export const ANDROID_PROMPT_PLACEHOLDER = "Type a message";
export const ANDROID_SCROLL_PLACEHOLDER = "Tap to write again";
