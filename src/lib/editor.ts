/**
 * Prompt editor public surface (REFACTOR §7).
 *
 * The textarea composer (`textarea-editor`) is the only editor, on
 * desktop and phone alike. This module keeps the shared contract —
 * the `PromptEditor` interface, placeholders, and the pure helpers
 * re-exported from their real homes (`editorPaste` for paste/tag
 * math, `fences` for fence math) — so importers (`+page`, tests)
 * keep their paths. `createPromptEditor` stays as the desktop name
 * for the same constructor.
 */
import { createTextareaEditor } from "./textarea-editor";
import type { PasteSpan, RemovedMarkerTags } from "./editorPaste";

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

export type SubmitKind = "send" | "stage";

/** Composer hint in edit mode. */
export const PROMPT_PLACEHOLDER = "ctrl+g message scroll";
/** Composer hint while scrolled out hopping messages. */
export const SCROLL_PLACEHOLDER = "ctrl+g to hop back in";
/**
 * Touch variants: no Ctrl key to name, and shortcuts keep working (a
 * keyboard may be attached) — only the hint text changes.
 */
export const ANDROID_PROMPT_PLACEHOLDER = "Type a message";
export const ANDROID_SCROLL_PLACEHOLDER = "Tap to write again";

export interface PromptEditor {
	getText(): string;
	/** Collapsed-paste spans in document coordinates (for send-time folds). */
	getPastes(): PasteSpan[];
	/** Collapsed caret offset (paste-adjacent marker placement reads it). */
	selectionHead(): number;
	/** Ctrl+O: expand every paste tag, or re-collapse expanded ones.
	 * True when it did anything (the caller then owns the keystroke). */
	togglePastes(): boolean;
	/** Remove one attachment marker tag through a minimal cut, keeping
	 * paste folds (a full setText rewrite would unfold them). False
	 * when the tag is absent. */
	exciseMarker(marker: string): boolean;
	/** Remove the index-th tag of a kind (a pill drops its own tag,
	 * not the first of its kind): same minimal cut, anchored at that
	 * occurrence. False when out of range. */
	exciseMarkerAt(marker: string, index: number): boolean;
	/** Remove the index-th pasted-text tag (`[Pasted N chars]`) in
	 * document order: a pasted-text pill drops its own tag. False
	 * when out of range. */
	excisePastedAt(index: number): boolean;
	setText(text: string): void;
	/** Insert text at the cursor (used for pasted-image markers). */
	insertText(text: string): void;
	/** Move the caret to the document end (loading a note for editing). */
	caretToEnd(): void;
	clear(): void;
	focus(): void;
	/** Drop the caret (scroll mode must show no cursor in the prompt). */
	blur(): void;
	/** Swap the empty-prompt hint (edit vs scroll mode). */
	setPlaceholder(text: string): void;
	/** Re-run layout measurement (stale caches after occlusion/DPR change). */
	remeasure(): void;
	destroy(): void;
}

export interface PromptEditorOptions {
	initialDoc?: string;
	onSubmit: (kind: SubmitKind) => void;
	/** Ctrl+G: leave the editor for J/K message-scroll mode. */
	onHopOut: () => void;
	/** Images were pasted or dropped; the host turns each into an attachment. */
	onImagesPasted?: (files: File[]) => void;
	/**
	 * Plain text pasted over PASTE_THRESHOLD (already tail-trimmed);
	 * the host turns it into a pasted-text attachment. Without a host
	 * the text inserts inline and sends unfolded.
	 */
	onLongTextPasted?: (text: string) => void;
	/**
	 * A composer selection holding image tags is copied/cut: the host
	 * supplies the image attachments at these document-order indexes
	 * as blobs (Nth tag pairs with the Nth attachment, so a middle cut
	 * carries its own pictures), read synchronously so a cut's own
	 * deletion can't race it. Absent, tags copy as plain text.
	 */
	onCopyImageTags?: (indexes: number[]) => Promise<Blob[]>;
	/**
	 * Document text changed (drives the submit button's faded state).
	 * `removed` carries the deleted tag occurrences' document-order
	 * indexes so the host drops the matching attachments; undefined
	 * where change ranges are unavailable (the plain textarea), where
	 * the host falls back to newest-first.
	 */
	onDocChange?: (text: string, removed?: RemovedMarkerTags) => void;
}

/** Desktop constructor: the same textarea editor under its old name. */
export function createPromptEditor(
	parent: HTMLElement,
	options: PromptEditorOptions
): PromptEditor {
	return createTextareaEditor(parent, options);
}
