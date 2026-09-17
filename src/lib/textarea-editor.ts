import {
	trimPasteTail,
	type PromptEditor,
	type PromptEditorOptions
} from "./editor";
import { attachEditContext, shouldDeferForComposition } from "./editContext";
import { fenceAtOffset, parseFences, shiftEnterAction } from "./fences";
import { removeMarker, removeMarkerAt } from "./attachments";

/**
 * Plain-textarea PromptEditor for Android (see `createPromptEditor` in
 * `./editor` for the CodeMirror version used everywhere else).
 *
 * Why this exists: on phone WebViews CodeMirror can cache stale line-box
 * measurements (composer collapses to ~0 height) and the tap-to-reveal row
 * fade never repaints the composer region (stale-tile ghost). A native
 * textarea has no measurement cache and no compositor layer games, so both
 * failure modes disappear. What it deliberately drops: markdown coloring
 * while typing, undo history, and long-paste collapsing (pastes send
 * unfolded). Image attach still works — the paperclip button and drop
 * handling live outside the editor — and pasted images still become
 * attachments via `onImagesPasted`.
 */
export function createTextareaEditor(
	parent: HTMLElement,
	options: PromptEditorOptions
): PromptEditor {
	const ta = document.createElement("textarea");
	ta.className = "ta-input";
	ta.rows = 1;
	// Free on-device precision where supported; null elsewhere (fallback
	// is the isComposing guard above). Never throws.
	attachEditContext(ta);
	if (options.initialDoc) ta.value = options.initialDoc;
	parent.prepend(ta);

	// field-sizing: content (see .ta-input CSS) sizes the composer up to
	// its max-height where supported; only measure by hand elsewhere.
	const cssOwnsHeight =
		typeof CSS !== "undefined" && CSS.supports("field-sizing: content");
	const autogrow = (): void => {
		if (cssOwnsHeight) return;
		// Height follows content up to the CSS max-height, then scrolls.
		ta.style.height = "auto";
		ta.style.height = `${ta.scrollHeight}px`;
	};
	const notify = (): void => {
		autogrow();
		options.onDocChange?.(ta.value);
	};

	const onInput = (): void => {
		notify();
	};
	/**
	 * Fence Shift+Enter for the plain textarea: ```py + Shift+Enter
	 * completes the closing fence with the caret between, Shift+Enter
	 * in an empty body exits past the fence. Collapsed caret only —
	 * ranges keep native behavior. Returns true when handled.
	 */
	const fenceShiftEnter = (): boolean => {
		const start = ta.selectionStart ?? ta.value.length;
		const end = ta.selectionEnd ?? ta.value.length;
		if (start !== end) return false;
		const doc = ta.value;
		const action = shiftEnterAction(doc, start);
		if (action.kind === "newline") return false;
		if (action.kind === "close") {
			const nl = doc.indexOf("\n", start);
			const lineEnd = nl === -1 ? doc.length : nl;
			ta.value = `${doc.slice(0, lineEnd)}\n\n\`\`\`${doc.slice(lineEnd)}`;
			ta.setSelectionRange(lineEnd + 1, lineEnd + 1);
			notify();
			return true;
		}
		const fence = fenceAtOffset(parseFences(doc), start);
		if (!fence) return false;
		if (fence.closeLine !== -1) {
			if (fence.closeTo < doc.length) {
				ta.setSelectionRange(fence.closeTo + 1, fence.closeTo + 1);
			} else {
				ta.value = `${doc.slice(0, fence.closeTo)}\n${doc.slice(fence.closeTo)}`;
				ta.setSelectionRange(fence.closeTo + 1, fence.closeTo + 1);
				notify();
			}
			return true;
		}
		ta.value = `${doc.slice(0, fence.bodyFrom)}\`\`\`\n${doc.slice(fence.bodyTo)}`;
		ta.setSelectionRange(fence.bodyFrom + 4, fence.bodyFrom + 4);
		notify();
		return true;
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		// IME composition (notably pinyin) confirms with Enter — never
		// hijack that keystroke or typing CJK sends the message halfway.
		// An attached EditContext (where supported) sharpens the range
		// tracking behind this flag; the fallback is this check itself.
		if (shouldDeferForComposition({ isComposing: event.isComposing })) return;
		// Shift+Enter on a fence line closes/exits the fence (mirrors
		// the CodeMirror composer); anywhere else it is a newline.
		if (event.key === "Enter" && event.shiftKey && !event.altKey) {
			if (fenceShiftEnter()) event.preventDefault();
			return;
		}
		// Enter and Mod-Enter send; Shift-Enter falls through to newline.
		if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			options.onSubmit("send");
			return;
		}
		if (event.key === "Enter" && event.altKey) {
			event.preventDefault();
			options.onSubmit("stage");
			return;
		}
		if ((event.ctrlKey || event.metaKey) && (event.key === "g" || event.key === "G")) {
			event.preventDefault();
			ta.blur();
			options.onHopOut();
		}
	};
	const onPaste = (event: ClipboardEvent): void => {
		const clipboard = event.clipboardData;
		if (!clipboard) return;
		const images = [...clipboard.files].filter((f) => f.type.startsWith("image/"));
		if (images.length > 0 && options.onImagesPasted) {
			event.preventDefault();
			options.onImagesPasted(images);
			return;
		}
		const raw = clipboard.getData("text/plain");
		const text = trimPasteTail(raw);
		// Clean short paste: the default handler inserts it exactly.
		if (text === raw) return;
		// Newlines-only: swallow, don't grow an empty line.
		if (!text) {
			event.preventDefault();
			return;
		}
		event.preventDefault();
		const start = ta.selectionStart ?? ta.value.length;
		const end = ta.selectionEnd ?? ta.value.length;
		ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
		const caret = start + text.length;
		ta.setSelectionRange(caret, caret);
		notify();
	};

	ta.addEventListener("input", onInput);
	ta.addEventListener("keydown", onKeyDown);
	ta.addEventListener("paste", onPaste);
	autogrow();

	return {
		getText: () => ta.value,
		// No collapsing here: everything sends unfolded.
		getPastes: () => [],
		selectionHead: () => ta.selectionStart ?? ta.value.length,
		// No tags to toggle: Ctrl+O falls through to the thoughts toggle.
		togglePastes: () => false,
		// No collapsing here either: the plain rewrite loses nothing.
		exciseMarker: (marker: string) => {
			const next = removeMarker(ta.value, marker);
			if (next === ta.value) return false;
			ta.value = next;
			notify();
			return true;
		},
		// Same indexed cut as the CodeMirror path (a pill drops its
		// own tag); tag→pill here still reconciles newest-first (the
		// plain input event carries no change ranges).
		exciseMarkerAt: (marker: string, index: number) => {
			const next = removeMarkerAt(ta.value, marker, index);
			if (next === ta.value) return false;
			ta.value = next;
			notify();
			return true;
		},
		setText: (text: string) => {
			ta.value = text;
			notify();
		},
		insertText: (text: string) => {
			const start = ta.selectionStart ?? ta.value.length;
			const end = ta.selectionEnd ?? ta.value.length;
			ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
			const caret = start + text.length;
			ta.setSelectionRange(caret, caret);
			// Insertions (dictation, image markers) take the cursor
			// without yanking the messages list.
			ta.focus({ preventScroll: true });
			notify();
		},
		clear() {
			this.setText("");
		},
		caretToEnd() {
			ta.setSelectionRange(ta.value.length, ta.value.length);
		},
		// preventScroll: refocusing must never yank the messages list.
		focus: () => {
			ta.focus({ preventScroll: true });
		},
		blur: () => ta.blur(),
		setPlaceholder: (text: string) => {
			ta.placeholder = text;
		},
		// Nothing cached: there is no stale measurement to settle.
		remeasure: () => {},
		destroy() {
			ta.removeEventListener("input", onInput);
			ta.removeEventListener("keydown", onKeyDown);
			ta.removeEventListener("paste", onPaste);
			ta.remove();
		}
	};
}
