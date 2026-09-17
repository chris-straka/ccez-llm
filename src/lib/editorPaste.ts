/**
 * Paste-collapse extensions (editor slice, REFACTOR §7).
 *
 * Long pastes stay in the document but render as one collapsed marker
 * line (click to expand). The full text is always what gets sent.
 * Verbatim move out of `editor.ts`: the marker widget, the
 * paste-decoration field, the paste hook, the Ctrl+O toggle, and the
 * send-time fold math (`sendPasteFolds`, `trimPasteTail`,
 * `pasteToggleAction` — the already-extracted pure cluster moves with
 * its wiring so the group stays cohesive). Effects come from
 * `editorEffects`; `editor.ts` re-exports the names its importers use.
 */
import {
	EditorState,
	StateField,
	Range,
	Prec,
	Transaction,
	type Extension
} from "@codemirror/state";
import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import {
	addPaste,
	expandPaste,
	expandAllPastes,
	collapseAllPastes,
	collapsePaste,
	type PasteCollapse
} from "./editorEffects";
import {
	FILE_MARKER,
	IMAGE_MARKER,
	blobToDataUrl,
	clipboardPngBlob,
	countMarkers,
	removeTags
} from "./attachments";
import { closestFromTarget } from "./events";

/** Pastes longer than this collapse to a `[Pasted content N chars]` marker. */
export const PASTE_THRESHOLD = 100;

export function pastedLabel(chars: number): string {
	return `[Pasted content ${chars} chars]`;
}

/**
 * Long pastes stay in the document but render as one collapsed marker line
 * (click to expand). The full text is always what gets sent.
 */
class PasteMarker extends WidgetType {
	constructor(
		readonly pasteId: number,
		private readonly chars: number
	) {
		super();
	}

	get charCount(): number {
		return this.chars;
	}

	eq(other: PasteMarker): boolean {
		return other.pasteId === this.pasteId && other.chars === this.chars;
	}

	override ignoreEvent(): boolean {
		return false;
	}

	toDOM(): HTMLElement {
		const marker = document.createElement("span");
		marker.className = "cm-paste-marker";
		marker.dataset.pasteExpand = String(this.pasteId);
		marker.textContent = pastedLabel(this.chars);
		return marker;
	}
}

/**
 * Collapse bracket for one expanded paste (the sent-message twin of
 * history's fold brackets: same blue, same ride-high nudge, clicking
 * either contracts the paste back to its marker). Brackets are derived
 * at provide time from the open spans — never stored — so they track
 * edits and expand/collapse transitions for free.
 */
class PasteBracket extends WidgetType {
	constructor(
		readonly pasteId: number,
		readonly glyph: "[" | "]"
	) {
		super();
	}

	eq(other: PasteBracket): boolean {
		return other.pasteId === this.pasteId && other.glyph === this.glyph;
	}

	override ignoreEvent(): boolean {
		return false;
	}

	toDOM(): HTMLElement {
		const bracket = document.createElement("span");
		bracket.className = "cm-paste-bracket";
		bracket.dataset.pasteCollapse = String(this.pasteId);
		bracket.textContent = this.glyph;
		return bracket;
	}
}

/** Merge open-span brackets over the stored decorations (pure). */
function withPasteBrackets(field: PasteField): DecorationSet {
	if (field.open.length === 0) return field.deco;
	const extra: Range<Decoration>[] = [];
	for (const rec of field.open) {
		if (rec.from >= rec.to) continue;
		extra.push(Decoration.widget({ widget: new PasteBracket(rec.id, "["), side: -1 }).range(rec.from));
		extra.push(Decoration.widget({ widget: new PasteBracket(rec.id, "]"), side: 1 }).range(rec.to));
	}
	return field.deco.update({ add: extra });
}

/**
 * The paste-decoration field of the live composer (single instance).
 * Read it with pasteSpans — never touch it directly.
 */
let pasteFieldRef: StateField<PasteField> | null = null;

/**
 * Paste-tag field: collapsed markers as decorations, plus the spans
 * expanded out of them (single click or Ctrl+O) so a later collapse can
 * put the tags back. Positions on both sides remap through edits; a span
 * that stops being a valid range is forgotten, never re-marked.
 */
interface PasteField {
	deco: DecorationSet;
	open: PasteCollapse[];
}

/** Drop one collapsed marker, remembering its span for re-collapse. */
function openMarker(deco: DecorationSet, open: PasteCollapse[], pasteId: number): PasteField {
	const ranges: Range<Decoration>[] = [];
	let opened: PasteCollapse | null = null;
	const cursor = deco.iter();
	while (cursor.value) {
		const widget = (cursor.value.spec as { widget?: unknown }).widget;
		if (widget instanceof PasteMarker && widget.pasteId === pasteId) {
			opened = { id: pasteId, from: cursor.from, to: cursor.to, chars: widget.charCount };
		} else {
			ranges.push(cursor.value.range(cursor.from, cursor.to));
		}
		cursor.next();
	}
	return {
		deco: Decoration.set(ranges),
		open: opened ? [...open, opened] : open
	};
}

export function pastePlaceholders(): Extension {
	const field = StateField.define<PasteField>({
		create: () => ({ deco: Decoration.none, open: [] }),
		update: (value, tr) => {
			let deco = value.deco.map(tr.changes);
			// A cut through a collapsed span (marker excision, or typing
			// across it) degenerates its widget: forget it rather than
			// pinning the label over nothing.
			const kept: Range<Decoration>[] = [];
			let degenerated = false;
			const probe = deco.iter();
			while (probe.value) {
				const widget = (probe.value.spec as { widget?: unknown }).widget;
				if (widget instanceof PasteMarker && !(probe.from < probe.to)) degenerated = true;
				else kept.push(probe.value.range(probe.from, probe.to));
				probe.next();
			}
			if (degenerated) deco = Decoration.set(kept);
			let open = value.open;
			if (open.length > 0) {
				const mapped: PasteCollapse[] = [];
				for (const rec of open) {
					const from = tr.changes.mapPos(rec.from, 1);
					const to = tr.changes.mapPos(rec.to, -1);
					if (from < to) mapped.push({ ...rec, from, to });
				}
				open = mapped;
			}
			for (const effect of tr.effects) {
				if (effect.is(addPaste)) {
					const { id, from, to, chars } = effect.value;
					const marker = Decoration.replace({ widget: new PasteMarker(id, chars) });
					deco = deco.update({ add: [marker.range(from, to)] });
				} else if (effect.is(expandPaste)) {
					({ deco, open } = openMarker(deco, open, effect.value));
				} else if (effect.is(expandAllPastes)) {
					const ids: number[] = [];
					const cursor = deco.iter();
					while (cursor.value) {
						const widget = (cursor.value.spec as { widget?: unknown }).widget;
						if (widget instanceof PasteMarker) ids.push(widget.pasteId);
						cursor.next();
					}
					for (const id of ids) ({ deco, open } = openMarker(deco, open, id));
				} else if (effect.is(collapseAllPastes)) {
					for (const rec of open) {
						if (rec.from < 0 || rec.to > tr.newDoc.length || rec.from >= rec.to) continue;
						const marker = Decoration.replace({
							widget: new PasteMarker(rec.id, rec.chars)
						});
						deco = deco.update({ add: [marker.range(rec.from, rec.to)] });
					}
					open = [];
				} else if (effect.is(collapsePaste)) {
					const rec = open.find((span) => span.id === effect.value);
					if (rec && rec.from >= 0 && rec.to <= tr.newDoc.length && rec.from < rec.to) {
						const marker = Decoration.replace({
							widget: new PasteMarker(rec.id, rec.chars)
						});
						deco = deco.update({ add: [marker.range(rec.from, rec.to)] });
						open = open.filter((span) => span.id !== rec.id);
					}
				}
			}
			return { deco, open };
		},
		provide: (f) => EditorView.decorations.from(f, withPasteBrackets)
	});
	const clicks = Prec.high(
		EditorView.domEventHandlers({
			mousedown: (event) => {
				// Same guard as the fence bars: keep CodeMirror selection
				// from swallowing the marker/bracket click that follows.
				if (closestFromTarget(event.target, "[data-paste-expand],[data-paste-collapse]")) {
					event.preventDefault();
					return true;
				}
				return false;
			},
			click: (event, view) => {
				const collapse = closestFromTarget(event.target, "[data-paste-collapse]");
				if (collapse) {
					view.dispatch({
						effects: collapsePaste.of(Number(collapse.getAttribute("data-paste-collapse")))
					});
					return true;
				}
				const target = closestFromTarget(event.target, "[data-paste-expand]");
				if (!target) return false;
				view.dispatch({ effects: expandPaste.of(Number(target.getAttribute("data-paste-expand"))) });
				return true;
			}
		})
	);
	pasteFieldRef = field;
	return [field, clicks];
}

export interface PasteSpan {
	from: number;
	to: number;
	chars: number;
}

export interface SendFold {
	start: number;
	end: number;
	chars: number;
}

/** Current collapsed-paste spans in document coordinates. Never throws. */
export function pasteSpans(state: EditorState): PasteSpan[] {
	let set: DecorationSet;
	try {
		if (!pasteFieldRef) return [];
		set = state.field(pasteFieldRef).deco;
	} catch {
		return [];
	}
	const out: PasteSpan[] = [];
	const cursor = set.iter();
	while (cursor.value) {
		const widget = (cursor.value.spec as { widget?: unknown }).widget;
		if (widget instanceof PasteMarker) {
			out.push({ from: cursor.from, to: cursor.to, chars: widget.charCount });
		}
		cursor.next();
	}
	return out;
}

/**
 * Ctrl+O target from tag counts alone (pure, unit-tested): tags still
 * collapsed expand first; with none left, expanded tags collapse back;
 * with no tags at all the keystroke belongs to someone else.
 */
export function pasteToggleAction(collapsed: number, open: number): "expand" | "collapse" | "none" {
	if (collapsed > 0) return "expand";
	if (open > 0) return "collapse";
	return "none";
}

/**
 * Atomic tag/fold deletion: Backspace/Delete touching a marker tag or
 * a collapsed paste span takes the whole unit (see
 * expandDeletionUnits). Only the editor's own delete keystrokes filter
 * — programmatic edits, undo/redo, and replacements pass through, so
 * history stays exact and typing over a selection keeps its bounds.
 */
export function atomicMarkerDeletion(): Extension {
	return EditorState.transactionFilter.of((tr) => {
		if (!tr.docChanged) return tr;
		const userEvent = tr.annotation(Transaction.userEvent);
		if (typeof userEvent !== "string" || !userEvent.startsWith("delete")) return tr;
		let spans: PasteSpan[];
		try {
			spans = pasteSpans(tr.startState);
		} catch {
			return tr;
		}
		const deletions: DeletionRange[] = [];
		let pure = true;
		tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
			if (inserted.length > 0) pure = false;
			else deletions.push({ from: fromA, to: toA });
		});
		if (!pure || deletions.length === 0) return tr;
		const expanded = expandDeletionUnits(tr.startState.doc.toString(), spans, deletions);
		const same =
			expanded.length === deletions.length &&
			expanded.every((range, i) => range.from === deletions[i]?.from && range.to === deletions[i]?.to);
		if (same) return tr;
		return {
			changes: expanded.map((range) => ({ from: range.from, to: range.to })),
			annotations: Transaction.userEvent.of(userEvent)
		};
	});
}

/** Expand every paste tag, or re-collapse expanded ones. Never throws. */
export function togglePastes(view: EditorView): boolean {
	let field: PasteField | null;
	try {
		field = pasteFieldRef ? view.state.field(pasteFieldRef) : null;
	} catch {
		return false;
	}
	if (!field) return false;
	const action = pasteToggleAction(pasteSpans(view.state).length, field.open.length);
	if (action === "expand") view.dispatch({ effects: expandAllPastes.of(undefined) });
	else if (action === "collapse") view.dispatch({ effects: collapseAllPastes.of(undefined) });
	else return false;
	return true;
}

/**
 * Map document-coordinate paste spans into send-text coordinates, applying
 * exactly the send transforms (drop IMAGE_MARKER tags like
 * stripImageMarkers, then trim like composerText). A span touched by either
 * transform is dropped — sent unfolded — rather than misplaced. Pure and
 * unit-tested.
 */
export function sendPasteFolds(doc: string, spans: PasteSpan[]): { text: string; folds: SendFold[] } {
	// Drop marker tags, tracking dropped document ranges. Excisions come
	// from the shared removeTags primitive, so this mirrors
	// stripAttachmentMarkers by construction (a parity test still pins
	// the text output); a host line left blank drops with its newline.
	// Ranges stay ascending and disjoint so the fold shift below holds.
	const dropped: Array<{ start: number; end: number }> = [];
	const kept: string[] = [];
	let offset = 0;
	const lines = doc.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const newline = i < lines.length - 1 ? "\n" : "";
		const chunk = line + newline;
		if (!line.includes(IMAGE_MARKER) && !line.includes(FILE_MARKER)) {
			kept.push(chunk);
		} else {
			const { text: out, cuts } = removeTags(line);
			if (out.trim() === "") {
				dropped.push({ start: offset, end: offset + chunk.length });
			} else {
				for (const cut of cuts) {
					dropped.push({ start: offset + cut.start, end: offset + cut.end });
				}
				kept.push(out + newline);
			}
		}
		offset += chunk.length;
	}
	const joined = kept.join("");
	// Trim; every surviving position shifts left by the leading run.
	const leading = joined.length - joined.trimStart().length;
	const text = joined.trim();
	const shift = (pos: number): number => {
		let delta = 0;
		for (const range of dropped) {
			if (range.end <= pos) delta += range.end - range.start;
			else break;
		}
		return pos - delta - leading;
	};
	const folds: SendFold[] = [];
	for (const span of spans) {
		if (span.from < 0 || span.to > doc.length || span.from >= span.to) continue;
		if (dropped.some((range) => span.from < range.end && range.start < span.to)) continue;
		const start = shift(span.from);
		const end = shift(span.to);
		if (start < 0 || end > text.length || start >= end) continue;
		folds.push({ start, end, chars: end - start });
	}
	folds.sort((a, b) => a.start - b.start);
	return { text, folds };
}

/** One pure-deletion range in document coordinates. */
export interface DeletionRange {
	from: number;
	to: number;
}

/** Escape a literal for RegExp (marker tags carry brackets). */
function escapeRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Expand pure-deletion ranges over whole tag/fold units (pure,
 * unit-tested): Backspace/Delete touching an image/file marker tag or
 * a collapsed paste span takes the whole unit, so edits never leave
 * half-tags the reconciliation can't match (a dropped half-tag reads
 * as prose, stranding its attachment accounting). Ranges touching
 * only prose pass through; overlapping expansions merge.
 */
export function expandDeletionUnits(
	docText: string,
	spans: PasteSpan[],
	deletions: DeletionRange[]
): DeletionRange[] {
	const units: DeletionRange[] = [];
	const tagRe = new RegExp(`${escapeRegExp(IMAGE_MARKER)}|${escapeRegExp(FILE_MARKER)}`, "g");
	for (const match of docText.matchAll(tagRe)) {
		const from = match.index ?? 0;
		units.push({ from, to: from + match[0].length });
	}
	for (const span of spans) {
		if (span.from < 0 || span.to > docText.length || span.from >= span.to) continue;
		units.push({ from: span.from, to: span.to });
	}
	units.sort((a, b) => a.from - b.from);
	const out: DeletionRange[] = [];
	for (const del of deletions) {
		if (del.from >= del.to) {
			out.push({ ...del });
			continue;
		}
		let from = del.from;
		let to = del.to;
		for (const unit of units) {
			if (unit.to <= from || unit.from >= to) continue;
			if (unit.from < from) from = unit.from;
			if (unit.to > to) to = unit.to;
		}
		const last = out[out.length - 1];
		if (last && from <= last.to) {
			if (to > last.to) last.to = to;
		} else {
			out.push({ from, to });
		}
	}
	return out;
}

/** One marker-tag excision in document coordinates (pure). */
export interface MarkerCut {
	from: number;
	to: number;
	insert: string;
}

/**
 * Locate the cut `removeMarker` would make (pure, unit-tested): the
 * first line holding the tag loses the tag plus one following space
 * (plus the trailing run, like trimEnd), while a host line left blank
 * drops with its newline. Null when the tag is absent. A parity test
 * pins applying the cut equals `removeMarker` on every battery doc.
 */
export function markerCut(doc: string, marker: string): MarkerCut | null {
	const lines = doc.split("\n");
	const at = lines.findIndex((line) => line.includes(marker));
	if (at === -1) return null;
	let lineStart = 0;
	for (let i = 0; i < at; i++) lineStart += (lines[i] ?? "").length + 1;
	const raw = lines[at] ?? "";
	const tagged = `${marker} `;
	const cutStr = raw.includes(tagged) ? tagged : marker;
	const tagAt = raw.indexOf(cutStr);
	const rawTrimmedEnd = raw.trimEnd().length;
	const keepAfter = raw.slice(tagAt + cutStr.length, rawTrimmedEnd);
	if ((raw.slice(0, tagAt) + keepAfter).trim() === "") {
		const isLast = at === lines.length - 1;
		if (!isLast) return { from: lineStart, to: lineStart + raw.length + 1, insert: "" };
		if (at === 0) return { from: 0, to: raw.length, insert: "" };
		return { from: lineStart - 1, to: lineStart + raw.length, insert: "" };
	}
	// To the line end: trimEnd applies to the whole remainder, so a
	// pre-existing trailing run goes with the tag (between the cut end
	// and the line end is whitespace by trimmed-end construction).
	// With nothing after the tag, trimEnd eats into the pre-tag run too.
	const before = raw.slice(0, tagAt);
	if (keepAfter === "") {
		return { from: lineStart + before.trimEnd().length, to: lineStart + raw.length, insert: "" };
	}
	return { from: lineStart + tagAt, to: lineStart + raw.length, insert: keepAfter };
}

/**
 * Remove one attachment marker tag through a minimal cut (not a full
 * rewrite): collapsed paste markers and open spans map through the
 * change untouched, so deleting an image never unfolds the draft's
 * folds. False when the tag is absent (nothing dispatched). Never
 * throws.
 */
export function exciseMarkerText(view: EditorView, marker: string): boolean {
	let cut: MarkerCut | null;
	try {
		cut = markerCut(view.state.doc.toString(), marker);
	} catch {
		return false;
	}
	if (!cut) return false;
	try {
		view.dispatch({ changes: { from: cut.from, to: cut.to, insert: cut.insert } });
	} catch {
		return false;
	}
	return true;
}

/**
 * Strip trailing blank lines from pasted text. Block selections routinely
 * drag extra newlines along, and the prompt must not grow empty lines for
 * them. Pure and unit-tested. (Pasted-image markers are decoration-only
 * widgets — they never pad the document, so this isn't that.)
 */
export function trimPasteTail(text: string): string {
	return text.replace(/(\r\n|\r|\n)+$/, "");
}

/**
 * Marker comment in the copied HTML carrying a multi-tag cut's whole
 * image set as embedded data-URL pictures. One rich-text item holds
 * every picture (custom clipboard types don't survive a Chromium
 * paste read, and engines reject multi-item writes), while foreign
 * apps paste the same item as text plus images. Only HTML carrying
 * this marker is ever mined for pictures — web copies stay untouched.
 */
const IMAGE_SET_MARKER = "<!--ccez-image-set-->";

/** Escape selected text for the copied HTML paragraph. */
function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain-text paste insertion: short text, trimmed tails, long folds. */
function insertTextPaste(view: EditorView, raw: string): boolean {
	const text = trimPasteTail(raw);
	// Nothing but newlines: swallow, don't insert an empty line.
	if (!text) {
		return true;
	}
	if (text.length <= PASTE_THRESHOLD) {
		// Untrimmed short paste: the default handler is exact.
		// Trimmed: it would reinsert the raw tail, so insert here.
		if (text === raw) return false;
		const { from, to } = view.state.selection.main;
		view.dispatch({
			changes: { from, to, insert: text },
			selection: { anchor: from + text.length }
		});
		return true;
	}
	const { from, to } = view.state.selection.main;
	const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
	view.dispatch({
		changes: { from, to, insert: text },
		effects: addPaste.of({ id, from, to: from + text.length, chars: text.length }),
		selection: { anchor: from + text.length }
	});
	return true;
}

/** Paste hook: images become attachments, long text collapses to a marker. */
export function pasteHandling(onImages: ((files: File[]) => void) | undefined): Extension {
	return Prec.high(
		EditorView.domEventHandlers({
			paste: (event, view) => {
				const clipboard = event.clipboardData;
				if (!clipboard) return false;
				// The cut's own image set first (every picture, one
				// rich-text item): data URLs survive the paste read
				// that custom clipboard types don't.
				const html = clipboard.getData("text/html");
				if (html.includes(IMAGE_SET_MARKER) && onImages) {
					event.preventDefault();
					const raw = clipboard.getData("text/plain");
					void (async () => {
						try {
							const doc = new DOMParser().parseFromString(html, "text/html");
							const urls = [...doc.querySelectorAll("img")]
								.map((img) => img.getAttribute("src") ?? "")
								.filter((src) => src.startsWith("data:"));
							const files: File[] = [];
							for (const [i, url] of urls.entries()) {
								try {
									const blob = await (await fetch(url)).blob();
									files.push(
										new File([blob], `pasted-image-${i}.png`, { type: blob.type || "image/png" })
									);
								} catch {
									// Unreadable entry skipped; the rest land.
								}
							}
							if (files.length === 0) return;
							onImages(files);
						} catch {
							insertTextPaste(view, raw);
						}
					})();
					return true;
				}
				// Every image file, not just the first: pastes from
				// outside the app carry no set, but still land whole.
				const images = [...clipboard.files].filter((f) => f.type.startsWith("image/"));
				if (images.length > 0 && onImages) {
					event.preventDefault();
					onImages(images);
					return true;
				}
				const raw = clipboard.getData("text/plain");
				const handled = insertTextPaste(view, raw);
				if (handled) event.preventDefault();
				return handled;
			}
		})
	);
}

/** Enriched tag copy/cut: the selected text plus its image-tag count. */
export interface TagCopyPlan {
	text: string;
	imageTags: number;
}

/**
 * Copy/cut plan for a composer selection (pure, unit-tested): null
 * when the default clipboard path owns it (empty selection, no image
 * tags, or no ClipboardItem support); otherwise the selected text plus
 * the image-tag count the host maps onto its newest image attachments.
 */
export function tagCopyPlan(selectedText: string, clipboardWrite: boolean): TagCopyPlan | null {
	if (selectedText === "" || !clipboardWrite) return null;
	const imageTags = countMarkers(selectedText);
	if (imageTags === 0) return null;
	return { text: selectedText, imageTags };
}

/**
 * Copy/cut enrichment for image tags: the clipboard gets the pictures
 * (one rich-text item with embedded images, then per-image items,
 * then plain text) so pasting in another chat lands images, not dead
 * tags. The host maps the tag count onto its newest image attachments
 * (mirroring the tag→pill reconciliation that drops the same end on
 * delete); the read happens synchronously at call time so a cut's own
 * deletion can't race it. Selections without image tags fall through
 * to the default handler.
 */
export function imageTagClipboard(
	takeImageBlobs: ((count: number) => Promise<Blob[]>) | undefined
): Extension {
	const handle =
		(isCut: boolean) =>
		(event: ClipboardEvent, view: EditorView): boolean => {
			if (!takeImageBlobs) return false;
			if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
			const sel = view.state.selection.main;
			if (sel.empty) return false;
			const plan = tagCopyPlan(view.state.sliceDoc(sel.from, sel.to), true);
			if (!plan) return false;
			event.preventDefault();
			// Snapshot the blobs before a cut deletes its own tags.
			const pending = takeImageBlobs(plan.imageTags);
			if (isCut) view.dispatch({ changes: { from: sel.from, to: sel.to } });
			void (async () => {
				const textBlob = new Blob([plan.text], { type: "text/plain" });
				// 1. One rich-text item carrying text plus the whole
				// image set as embedded pictures: multi-tag cuts paste
				// back complete, and foreign apps get text plus images.
				try {
					const blobs = await pending;
					if (blobs.length === 0) throw new Error("no image data");
					const urls = await Promise.all(blobs.map((blob) => blobToDataUrl(blob)));
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
					const pngs = await Promise.all(blobs.map((blob) => clipboardPngBlob(blob)));
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
					// 3. Plain text, like any other copy.
					try {
						await navigator.clipboard.writeText(plan.text);
					} catch {
						// Clipboard unavailable: a cut already deleted (native
						// cut deletes the same way when its own write fails).
					}
				}
			})();
			return true;
		};
	return Prec.high(
		EditorView.domEventHandlers({
			copy: handle(false),
			cut: handle(true)
		})
	);
}
