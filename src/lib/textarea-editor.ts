import {
	PASTE_THRESHOLD,
	dataUrlsToImageFiles,
	expandDeletionUnits,
	markerCut,
	markerCutAt,
	pastedCutAt,
	removedMarkerIndexes,
	tagCopyIndexes,
	tagCopyPlan,
	trimPasteTail,
	type PasteSpan,
	type RemovedMarkerTags
} from "./editorPaste";
import { attachEditContext, shouldDeferForComposition } from "./editContext";
import { fenceAtOffset, parseFences, shiftEnterAction } from "./fences";
import { blobToDataUrl, clipboardPngBlob } from "./attachments";
import { escapeHtml } from "./render";

/**
 * Plain-textarea PromptEditor, the only composer (desktop and phone).
 *
 * Why a native textarea: rich editors cache stale line-box measurements
 * (composer collapses to ~0 height on phone WebViews) and the
 * tap-to-reveal row fade never repaints the composer region
 * (stale-tile ghost). A textarea has no measurement cache and no
 * compositor layer games, so both failure modes disappear. What it
 * deliberately drops: markdown coloring while typing, undo history,
 * and collapsed-paste folds (long pastes become pasted-text pills via
 * `onLongTextPasted` — without a host they insert inline and send
 * unfolded). Image attach still works — the paperclip button and drop
 * handling live outside the editor — and pasted images still become
 * attachments via `onImagesPasted`.
 */
/** Marker heading the enriched clipboard HTML for an image-tag
copy/cut (same marker the paste read looks for). */
const IMAGE_SET_MARKER = "<!--ccez-image-set-->";

/**
 * In-app roundtrip for a tag copy/cut: the pictures as data URLs
 * beside the exact selected text. The clipboard HTML item carries
 * the same set for foreign apps, but runtimes whose clipboard
 * rejects rich writes (notably the app shell) would otherwise paste
 * dead tags — an exact-text paste in this session rehydrates from
 * here instead. One-shot: the first matching paste consumes it, and
 * a newer copy/cut overwrites it. Module-scoped on purpose (both
 * composer and inline editor share one clipboard).
 */
interface CutImageStash {
	text: string;
	urls: Promise<string[]>;
}

let cutImageStash: CutImageStash | null = null;

export type SubmitKind = "send" | "stage";

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
	/**
	 * Enter submits (send, Alt+Enter stages). False leaves Enter as a
	 * plain carriage return and Alt+Enter dead: the host's submit
	 * button alone sends. Phones set false — a software Enter must
	 * never fire a message. Defaults to true (desktop keymap).
	 */
	enterSubmits?: boolean;
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
	// Size to a seeded document on mount: input-driven growth never
	// fires for hosts that open with content (the in-place message
	// editor), which otherwise render one row tall until typed in.
	autogrow();

	const onInput = (): void => {
		// Keyboard/native deletion snapshot (see onBeforeInput):
		// report precise tag ranges so a middle delete drops its own
		// attachments instead of newest-first.
		const pending = pendingDelete;
		pendingDelete = null;
		if (!pending) {
			notify();
			return;
		}
		autogrow();
		let removed: RemovedMarkerTags | undefined;
		try {
			removed = removedMarkerIndexes(pending.before, pending.ranges);
		} catch {
			removed = undefined;
		}
		options.onDocChange?.(ta.value, removed);
	};
	/**
	 * Pending keyboard deletion: the input event carries no change
	 * ranges, so deletions snapshot their before-text + ranges here
	 * (target ranges where the engine reports them, the live
	 * selection otherwise). A canceled beforeinput leaves no input
	 * behind — the next keydown clears the stale snapshot first.
	 */
	/**
	 * Undo-safe replacement for tag edits: the editing engine's own
	 * delete/insert joins the native undo stack (Cmd+Z restores the
	 * tag), while value writes — and, in practice, setRangeText —
	 * break it. The nested input event owns notify/autogrow from
	 * there; where no editing engine exists (jsdom tests) it falls
	 * back to setRangeText with the manual notify. True when the
	 * engine ran.
	 */
	function undoableReplace(from: number, to: number, insert: string): boolean {
		if (typeof document.execCommand !== "function") return false;
		ta.setSelectionRange(from, to);
		try {
			if (insert === "") {
				if (!document.execCommand("delete")) return false;
			} else if (!document.execCommand("insertText", false, insert)) {
				return false;
			}
		} catch {
			return false;
		}
		return true;
	}

	let pendingDelete: {
		before: string;
		ranges: { from: number; to: number }[];
	} | null = null;
	const onBeforeInput = (event: InputEvent): void => {
		if (!event.inputType.startsWith("delete")) return;
		const before = ta.value;
		const ranges: { from: number; to: number }[] = [];
		try {
			const targets =
				typeof event.getTargetRanges === "function"
					? event.getTargetRanges()
					: [];
			for (const range of targets) {
				const from = range.startOffset;
				const to = range.endOffset;
				if (to > from) ranges.push({ from, to });
			}
		} catch {
			// Fall through to the selection-derived range below.
		}
		if (ranges.length === 0) {
			const start = ta.selectionStart ?? 0;
			const end = ta.selectionEnd ?? 0;
			if (start !== end) ranges.push({ from: start, to: end });
			else if (event.inputType === "deleteContentForward") {
				ranges.push({ from: start, to: start + 1 });
			} else {
				ranges.push({ from: Math.max(0, start - 1), to: start });
			}
		}
		// Atomic markers: a deletion touching a marker or pasted-text
		// tag takes the whole tag — Backspace nibbling one char leaves
		// a half-tag that reads as prose and strands its attachment.
		// Expanded ranges apply here (one undo step); untouched ones
		// ride the native path with its snapshot below.
		const expanded = expandDeletionUnits(before, [], ranges);
		const grown =
			expanded.length !== ranges.length ||
			expanded.some(
				(range, i) =>
					range.from !== ranges[i]?.from || range.to !== ranges[i]?.to
			);
		if (grown) {
			event.preventDefault();
			const ordered = [...expanded].sort((a, b) => b.from - a.from);
			let engine = true;
			for (const range of ordered) {
				// One undo step per range; the nested input events
				// own autogrow + the change report from here.
				engine = undoableReplace(range.from, range.to, "") && engine;
			}
			if (!engine) {
				for (const range of ordered) {
					ta.setRangeText("", range.from, range.to, "end");
				}
				const caret = expanded[0]?.from ?? 0;
				ta.setSelectionRange(caret, caret);
				autogrow();
				let removed: RemovedMarkerTags | undefined;
				try {
					removed = removedMarkerIndexes(before, expanded);
				} catch {
					removed = undefined;
				}
				options.onDocChange?.(ta.value, removed);
			} else {
				const caret = expanded[0]?.from ?? 0;
				ta.setSelectionRange(caret, caret);
			}
			return;
		}
		pendingDelete = { before, ranges };
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
		// A canceled delete leaves its snapshot with no input behind;
		// drop it here so the next keystroke never misattributes it
		// (its own beforeinput re-snapshots when it really deletes).
		pendingDelete = null;
		// IME composition (notably pinyin) confirms with Enter — never
		// hijack that keystroke or typing CJK sends the message halfway.
		// An attached EditContext (where supported) sharpens the range
		// tracking behind this flag; the fallback is this check itself.
		if (shouldDeferForComposition({ isComposing: event.isComposing })) return;
		// Shift+Enter on a fence line closes/exits the fence;
		// anywhere else it is a newline.
		if (event.key === "Enter" && event.shiftKey && !event.altKey) {
			if (fenceShiftEnter()) event.preventDefault();
			return;
		}
		// Enter and Alt+Enter send; Shift-Enter falls through to newline.
		// Where enterSubmits is false (phone composer) both fall through:
		// Enter is a carriage return there and the send button alone sends.
		if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
			if (options.enterSubmits === false) return;
			event.preventDefault();
			options.onSubmit("send");
			return;
		}
		if (event.key === "Enter" && event.altKey) {
			if (options.enterSubmits === false) return;
			event.preventDefault();
			options.onSubmit("stage");
			return;
		}
		if (
			(event.ctrlKey || event.metaKey) &&
			(event.key === "g" || event.key === "G")
		) {
			event.preventDefault();
			ta.blur();
			options.onHopOut();
		}
	};
	/**
	 * Copy/cut enrichment for image tags: the clipboard gets the
	 * pictures (one rich-text item with embedded images, then
	 * per-image items, then plain text) so pasting in another chat
	 * lands images, not dead tags. The host maps the selection's
	 * global tag indexes onto its attachments (Nth tag pairs with the
	 * Nth attachment); the read runs synchronously at call time so a
	 * cut's own deletion can't race it. An in-app stash carries the
	 * same pictures for pastes whose clipboard lost the rich item.
	 * Selections without image tags fall through to the default
	 * handler.
	 */
	/** Plain-text insert at a snapshot range (clipboard failure
	paths land the words; the host reconciles the tags). */
	const insertPlain = (text: string, start: number, end: number): void => {
		ta.setRangeText(text, start, end, "end");
		notify();
	};
	const onCopyCut =
		(isCut: boolean) =>
		(event: ClipboardEvent): void => {
			const takeImageBlobs = options.onCopyImageTags;
			if (!takeImageBlobs) return;
			const start = ta.selectionStart ?? 0;
			const end = ta.selectionEnd ?? 0;
			if (start >= end) return;
			const doc = ta.value;
			const clipboardWrite =
				typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;
			const plan = tagCopyPlan(doc.slice(start, end), clipboardWrite);
			if (!plan) return;
			// Snapshot the blobs before a cut deletes its own tags;
			// the stash resolves the same pictures to data URLs for
			// the in-app roundtrip (never rejects — an empty set just
			// falls through to the clipboard items at paste time).
			// First, before the ClipboardItem gate: the stash needs no
			// clipboard API, so runtimes without rich writes still
			// paste their previews back from a native cut.
			const pending = takeImageBlobs(tagCopyIndexes(doc, start, end));
			cutImageStash = {
				text: plan.text,
				urls: pending.then(
					(blobs) => Promise.all(blobs.map((blob) => blobToDataUrl(blob))),
					() => []
				)
			};
			if (!clipboardWrite) return;
			event.preventDefault();
			if (isCut) {
				// Precise tag indexes (the input event carries no change
				// ranges), so a middle cut drops its own attachments.
				const before = doc;
				ta.setRangeText("", start, end, "end");
				autogrow();
				let removed: RemovedMarkerTags | undefined;
				try {
					removed = removedMarkerIndexes(before, [{ from: start, to: end }]);
				} catch {
					removed = undefined;
				}
				options.onDocChange?.(ta.value, removed);
			}
			void (async () => {
				const textBlob = new Blob([plan.text], { type: "text/plain" });
				// 1. One rich-text item carrying text plus the whole
				// image set as embedded pictures: multi-tag cuts paste
				// back complete, and foreign apps get text plus images.
				try {
					const blobs = await pending;
					if (blobs.length === 0) throw new Error("no image data");
					const urls = await Promise.all(
						blobs.map((blob) => blobToDataUrl(blob))
					);
					const imgs = urls.map((url) => `<img src="${url}">`).join("");
					const html = new Blob(
						[`${IMAGE_SET_MARKER}<p>${escapeHtml(plan.text)}</p>${imgs}`],
						{ type: "text/html" }
					);
					await navigator.clipboard.write([
						new ClipboardItem({ "text/plain": textBlob, "text/html": html })
					]);
					return;
				} catch {
					// Fall through to per-image items below.
				}
				// 2. One item per image (single-image universal; several
				// items only where the engine allows them).
				try {
					const blobs = await pending;
					if (blobs.length === 0) throw new Error("no image data");
					const pngs = await Promise.all(
						blobs.map((blob) => clipboardPngBlob(blob))
					);
					await navigator.clipboard.write(
						pngs.map(
							(png) =>
								new ClipboardItem({
									"text/plain": textBlob,
									[png.type || "image/jpeg"]: png
								})
						)
					);
					return;
				} catch {
					// Fall through to plain text below.
				}
				// 3. Plain text, like any other copy.
				try {
					await navigator.clipboard.writeText(plan.text);
				} catch {
					// Clipboard unavailable: a cut already deleted (native
					// cut deletes the same way when its own write fails).
				}
			})();
		};
	const onPaste = (event: ClipboardEvent): void => {
		const clipboard = event.clipboardData;
		if (!clipboard) return;
		const raw = clipboard.getData("text/plain");
		// The in-app roundtrip first: an exact-text paste of a
		// session copy/cut rehydrates from the stash, so runtimes
		// whose clipboard dropped the rich item still land the
		// pictures (with their preview cards, via onImagesPasted) —
		// never dead tags. One-shot: the match consumes it.
		const stash = cutImageStash;
		const stashImages = options.onImagesPasted;
		if (stash && raw === stash.text && stashImages) {
			cutImageStash = null;
			event.preventDefault();
			const start = ta.selectionStart ?? ta.value.length;
			const end = ta.selectionEnd ?? ta.value.length;
			void (async () => {
				try {
					const files = await dataUrlsToImageFiles(await stash.urls);
					if (files.length === 0) insertPlain(raw, start, end);
					else stashImages(files);
				} catch {
					insertPlain(raw, start, end);
				}
			})();
			return;
		}
		// The cut's own image set next (every picture, one
		// rich-text item): data URLs survive the paste read
		// that custom clipboard types don't.
		const html = clipboard.getData("text/html");
		const htmlImages = options.onImagesPasted;
		if (html.includes(IMAGE_SET_MARKER) && htmlImages) {
			event.preventDefault();
			void (async () => {
				try {
					const doc = new DOMParser().parseFromString(html, "text/html");
					const urls = [...doc.querySelectorAll("img")]
						.map((img) => img.getAttribute("src") ?? "")
						.filter((src) => src.startsWith("data:"));
					const files = await dataUrlsToImageFiles(urls);
					if (files.length === 0) return;
					htmlImages(files);
				} catch {
					const start = ta.selectionStart ?? ta.value.length;
					const end = ta.selectionEnd ?? ta.value.length;
					insertPlain(raw, start, end);
				}
			})();
			return;
		}
		// Every image file, not just the first: pastes from
		// outside the app carry no set, but still land whole.
		const images = [...clipboard.files].filter((f) =>
			f.type.startsWith("image/")
		);
		if (images.length > 0 && options.onImagesPasted) {
			event.preventDefault();
			options.onImagesPasted(images);
			return;
		}
		const text = trimPasteTail(raw);
		// Newlines-only: swallow, don't grow an empty line.
		if (!text) {
			event.preventDefault();
			return;
		}
		// Over-threshold paste: the host turns it into a pasted-text
		// attachment. Without a host the text inserts inline — the
		// editor never collapses, so everything still sends unfolded.
		if (text.length > PASTE_THRESHOLD && options.onLongTextPasted) {
			event.preventDefault();
			options.onLongTextPasted(text);
			return;
		}
		// Clean short paste: the default handler inserts it exactly.
		if (text === raw) return;
		event.preventDefault();
		const start = ta.selectionStart ?? ta.value.length;
		const end = ta.selectionEnd ?? ta.value.length;
		if (!undoableReplace(start, end, text)) {
			ta.setRangeText(text, start, end, "end");
			notify();
		}
		// Engine path: the nested input event owns notify/autogrow.
	};

	ta.addEventListener("input", onInput);
	ta.addEventListener("keydown", onKeyDown);
	ta.addEventListener("beforeinput", onBeforeInput as EventListener);
	ta.addEventListener("paste", onPaste);
	const onCopy = onCopyCut(false);
	const onCut = onCopyCut(true);
	ta.addEventListener("copy", onCopy);
	ta.addEventListener("cut", onCut);
	autogrow();

	return {
		getText: () => ta.value,
		// No collapsing here: everything sends unfolded.
		getPastes: () => [],
		selectionHead: () => ta.selectionStart ?? ta.value.length,
		// No tags to toggle: Ctrl+O falls through to the thoughts toggle.
		togglePastes: () => false,
		// A pill drops its tag through the same cut the pure helpers
		// apply (parity-tested), through the editing engine so Cmd+Z
		// restores it; tag→pill still reconciles newest-first (the
		// input event carries no change ranges).
		exciseMarker: (marker: string) => {
			const cut = markerCut(ta.value, marker);
			if (!cut) return false;
			if (!undoableReplace(cut.from, cut.to, cut.insert)) {
				ta.setRangeText(cut.insert, cut.from, cut.to, "end");
				notify();
			}
			return true;
		},
		// Indexed cut (a pill drops its own tag); tag→pill still
		// reconciles newest-first (the input event carries no change
		// ranges).
		exciseMarkerAt: (marker: string, index: number) => {
			const cut = markerCutAt(ta.value, marker, index);
			if (!cut) return false;
			if (!undoableReplace(cut.from, cut.to, cut.insert)) {
				ta.setRangeText(cut.insert, cut.from, cut.to, "end");
				notify();
			}
			return true;
		},
		// Pasted-text pill drops its own `[Pasted N chars]` tag.
		excisePastedAt: (index: number) => {
			const cut = pastedCutAt(ta.value, index);
			if (!cut) return false;
			if (!undoableReplace(cut.from, cut.to, cut.insert)) {
				ta.setRangeText(cut.insert, cut.from, cut.to, "end");
				notify();
			}
			return true;
		},
		setText: (text: string) => {
			ta.value = text;
			notify();
		},
		insertText: (text: string) => {
			const start = ta.selectionStart ?? ta.value.length;
			const end = ta.selectionEnd ?? ta.value.length;
			// Image markers land here: the editing engine keeps
			// native undo so Cmd+Z takes the tag back out.
			if (undoableReplace(start, end, text)) {
				// Nested input owns the report; keep the messages
				// list steady all the same.
				ta.focus({ preventScroll: true });
				return;
			}
			ta.setRangeText(text, start, end, "end");
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
			ta.removeEventListener("beforeinput", onBeforeInput as EventListener);
			ta.removeEventListener("paste", onPaste);
			ta.removeEventListener("copy", onCopy);
			ta.removeEventListener("cut", onCut);
			ta.remove();
		}
	};
}
