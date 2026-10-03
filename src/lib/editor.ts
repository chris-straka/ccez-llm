/**
 * Prompt editor helpers barrel.
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
	bakeEditedMessage,
	caretAfterPaste,
	mergeFolds,
	trimPasteTail,
	markerCut,
	markerCutAt,
	attachTagRanges,
	tagCopyPlan,
	tagCopyIndexes,
	pastedCopyIndexes,
	expandPastedTags,
	pasteSlotHit,
	expandPasteSlot,
	collapsePasteSlot,
	dataUrlsToImageFiles,
	pastedCutAt,
	expandDeletionUnits,
	removedMarkerIndexes,
	type AttachTagRange,
	type CollapsedPaste,
	type DeletionRange,
	type MarkerCut,
	type PasteSlotHit,
	type PasteSlotToggle,
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
