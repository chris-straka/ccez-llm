/**
 * Prompt editor: CodeMirror composer wiring (REFACTOR §7).
 *
 * This is the composer and public surface: `createPromptEditor`
 * assembles the per-group extensions — paste-collapse
 * (`editorPaste`), fence fold/copy/run widgets (`editorFences`),
 * theme + languages (`editorTheme`) — over the shared StateEffects
 * (`editorEffects`). The pure paste/fold math lives with its wiring
 * in `editorPaste` and is re-exported here so importers (`+page`,
 * `textarea-editor`, tests) keep their paths.
 */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
	pastePlaceholders,
	pasteHandling,
	atomicMarkerDeletion,
	attachTagDecorations,
	imageTagClipboard,
	togglePastes,
	pasteSpans,
	exciseMarkerText,
	exciseMarkerTextAt,
	removedMarkerIndexes,
	type PasteSpan,
	type RemovedMarkerTags
} from "./editorPaste";
import { fenceWidgets, runFenceShiftEnter } from "./editorFences";
import { codeLanguages, appTheme } from "./editorTheme";
import { shouldDeferForComposition } from "./editContext";

export {
	PASTE_THRESHOLD,
	pastedLabel,
	pasteSpans,
	pasteToggleAction,
	sendPasteFolds,
	trimPasteTail,
	markerCut,
	markerCutAt,
	attachTagRanges,
	attachTagDecorations,
	tagCopyPlan,
	tagCopyIndexes,
	dataUrlsToImageFiles,
	exciseMarkerTextAt,
	removedMarkerIndexes,
	expandDeletionUnits,
	type AttachTagRange,
	type DeletionRange,
	type MarkerCut,
	type PasteSpan,
	type RemovedMarkerTags,
	type SendFold,
	type TagCopyPlan
} from "./editorPaste";

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
	 * indexes (CodeMirror path) so the host drops the matching
	 * attachments; undefined where change ranges are unavailable
	 * (plain textarea), where the host falls back to newest-first.
	 */
	onDocChange?: (text: string, removed?: RemovedMarkerTags) => void;
}

export function createPromptEditor(
	parent: HTMLElement,
	options: PromptEditorOptions
): PromptEditor {
	const submitKeys = keymap.of([
		{
			key: "Enter",
			run: (view) => {
				// IME composition (notably pinyin) confirms with Enter —
				// letting it through sends the message halfway. Defer to
				// the composition instead (textarea path guards
				// event.isComposing the same way).
				const composing = view.composing;
				if (shouldDeferForComposition({ viewComposing: composing ?? false })) return false;
				options.onSubmit("send");
				return true;
			}
		},
		{
			key: "Shift-Enter",
			run: (view) => runFenceShiftEnter(view) // fence close/exit, else newline
		},
		{
			key: "Mod-Enter",
			run: () => {
				options.onSubmit("send");
				return true;
			}
		},
		{
			key: "Alt-Enter",
			run: () => {
				options.onSubmit("stage");
				return true;
			}
		},
		{
			key: "Ctrl-g",
			run: (view) => {
				view.contentDOM.blur();
				options.onHopOut();
				return true;
			}
		}
	]);

	const placeholderCompartment = new Compartment();
	const state = EditorState.create({
		doc: options.initialDoc ?? "",
		extensions: [
			placeholderCompartment.of(placeholder(PROMPT_PLACEHOLDER)),
			submitKeys,
			EditorView.updateListener.of((update) => {
				if (!update.docChanged) return;
				// Deleted tag occurrences in pre-change coordinates, so
				// the host drops the matching attachments (a pill's own
				// tag, not the newest of its kind). Guarded: a range
				// walk must never break typing.
				let removed: RemovedMarkerTags | undefined;
				try {
					const ranges: { from: number; to: number }[] = [];
					update.changes.iterChanges((fromA, toA) => {
						if (toA > fromA) ranges.push({ from: fromA, to: toA });
					});
					if (ranges.length > 0) {
						removed = removedMarkerIndexes(update.startState.doc.toString(), ranges);
					}
				} catch {
					removed = undefined;
				}
				options.onDocChange?.(update.state.doc.toString(), removed);
			}),
			history(),
			keymap.of([...defaultKeymap, ...historyKeymap]),
			markdown({ codeLanguages }),
			syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
			fenceWidgets(),
			pastePlaceholders(),
			pasteHandling(options.onImagesPasted),
			atomicMarkerDeletion(),
			attachTagDecorations(),
			imageTagClipboard(options.onCopyImageTags),
			// Single CodeMirror-owned caret: the bare native caret's paint
			// can go stale when a visible-phase delete empties the box,
			// leaving a frozen second caret beside the live one. This also
			// lights up the .cm-cursor rules (empty-box, scroll mode, dark).
			drawSelection(),
			appTheme,
			EditorView.lineWrapping
		]
	});
	const view = new EditorView({ state, parent });
	// The prompt's buttons are absolutely positioned, so the editor node can
	// lead in DOM order: Tab reaches the prompt before Voice/Send.
	parent.prepend(view.dom);

	return {
		getText: () => view.state.doc.toString(),
		getPastes: () => pasteSpans(view.state),
		selectionHead: () => view.state.selection.main.head,
		togglePastes: () => togglePastes(view),
		exciseMarker: (marker: string) => exciseMarkerText(view, marker),
		exciseMarkerAt: (marker: string, index: number) => exciseMarkerTextAt(view, marker, index),
		setText: (text: string) =>
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
		insertText: (text: string) => {
			const { from, to } = view.state.selection.main;
			view.dispatch({
				changes: { from, to, insert: text },
				selection: { anchor: from + text.length }
			});
			// Insertions (dictation, image markers) take the cursor
			// without yanking the messages list.
			view.contentDOM.focus({ preventScroll: true });
		},
		clear() {
			this.setText("");
		},
		caretToEnd() {
			const end = view.state.doc.length;
			view.dispatch({ selection: { anchor: end } });
		},
		// preventScroll: refocusing (notably on window focus) must
		// never yank the messages list — view.focus() scrolls.
		focus: () => {
			view.contentDOM.focus({ preventScroll: true });
		},
		blur: () => view.contentDOM.blur(),
		setPlaceholder: (text: string) => {
			view.dispatch({
				effects: placeholderCompartment.reconfigure(placeholder(text))
			});
		},
		remeasure: () => {
			view.requestMeasure();
		},
		destroy() {
			view.destroy();
		}
	};
}
