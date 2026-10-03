/**
 * Paste pure helpers.
 *
 * The textarea composer never collapses: long pastes become
 * pasted-text pills via `onLongTextPasted`, so everything sends
 * unfolded. What stays here is the pure math the composer, the send
 * path, and the pill/tag reconciliation share — thresholds, send
 * folds, deletion units, marker cuts, tag ranges, copy plans.
 * `editor.ts` re-exports the names its importers use.
 */
import {
	FILE_MARKER,
	IMAGE_MARKER,
	PASTED_TAG_RE,
	PASTE_CLOSE,
	PASTE_OPEN,
	appendImageMarkers,
	countMarkers,
	countPasteSlots,
	findPasteSlots,
	pasteSlotCut,
	removeTags
} from "./attachments";

/** Pastes longer than this become a pasted-text pill via `onLongTextPasted`. */
export const PASTE_THRESHOLD = 100;

export function pastedLabel(chars: number): string {
	return `[Pasted ${chars} chars]`;
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

/**
 * Ctrl+O target from tag counts alone (pure, unit-tested): tags still
 * collapsed expand first; with none left, expanded tags collapse back;
 * with no tags at all the keystroke belongs to someone else.
 */
export function pasteToggleAction(
	collapsed: number,
	open: number
): "expand" | "collapse" | "none" {
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
/**
 * Map document-coordinate paste spans into send-text coordinates, applying
 * exactly the send transforms (drop IMAGE_MARKER tags like
 * stripImageMarkers, then trim like composerText). A span touched by either
 * transform is dropped — sent unfolded — rather than misplaced. Pure and
 * unit-tested.
 */
export function sendPasteFolds(
	doc: string,
	spans: PasteSpan[]
): { text: string; folds: SendFold[] } {
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
		if (dropped.some((range) => span.from < range.end && range.start < span.to))
			continue;
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
 * unit-tested): Backspace/Delete touching an image/file marker tag, a
 * pasted-text tag, or a collapsed paste span takes the whole unit, so
 * edits never leave half-tags the reconciliation can't match (a
 * dropped half-tag reads as prose, stranding its attachment
 * accounting). Ranges touching only prose pass through; overlapping
 * expansions merge.
 */
export function expandDeletionUnits(
	docText: string,
	spans: PasteSpan[],
	deletions: DeletionRange[]
): DeletionRange[] {
	const units: DeletionRange[] = [];
	const tagRe = new RegExp(
		`${escapeRegExp(IMAGE_MARKER)}|${escapeRegExp(FILE_MARKER)}`,
		"g"
	);
	for (const match of docText.matchAll(tagRe)) {
		const from = match.index ?? 0;
		units.push({ from, to: from + match[0].length });
	}
	// Pasted-text tags delete atomically too, or Backspace leaves a
	// half-tag that reads as prose and strands its attachment. Tags
	// inside expanded regions are literal prose, never units.
	for (const slot of findPasteSlots(docText)) {
		if (slot.kind !== "tag") continue;
		units.push({ from: slot.start, to: slot.end });
	}
	for (const span of spans) {
		if (span.from < 0 || span.to > docText.length || span.from >= span.to)
			continue;
		units.push({ from: span.from, to: span.to });
	}
	units.sort((a, b) => a.from - b.from);
	// Expanded regions widen bracket-touching deletions to the whole
	// region (a half-deleted bracket would strand the slot as prose
	// with its attachment dropped); interior edits pass through
	// untouched, or the revealed prose could never change.
	const regions = findPasteSlots(docText).filter(
		(slot) => slot.kind === "region"
	);
	const widened = deletions.map((del) => {
		if (del.from >= del.to) return { ...del };
		let from = del.from;
		let to = del.to;
		for (const region of regions) {
			const touchesOpen = from < region.start + 1 && to > region.start;
			const touchesClose = from < region.end && to > region.end - 1;
			if (touchesOpen || touchesClose) {
				from = Math.min(from, region.start);
				to = Math.max(to, region.end);
			}
		}
		return { from, to };
	});
	const out: DeletionRange[] = [];
	for (const del of widened) {
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
	return markerCutAt(doc, marker, 0);
}

/**
 * Locate the cut `removeMarkerAt` would make for the index-th global
 * tag occurrence (pure, unit-tested): same line surgery as the
 * first-occurrence path, anchored at that occurrence's span. Null
 * when the occurrence is absent. Index 0 behaves exactly like
 * `markerCut` (the parity battery pins it).
 */
export function markerCutAt(
	doc: string,
	marker: string,
	index: number
): MarkerCut | null {
	if (index < 0) return null;
	const lines = doc.split("\n");
	let seen = -1;
	let at = -1;
	let tagAt = -1;
	let lineStart = 0;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		let from = 0;
		for (;;) {
			const found = raw.indexOf(marker, from);
			if (found < 0) break;
			seen++;
			if (seen === index) {
				at = i;
				tagAt = found;
				break;
			}
			from = found + marker.length;
		}
		if (at >= 0) break;
		lineStart += (lines[i] ?? "").length + 1;
	}
	if (at < 0) return null;
	const raw = lines[at] ?? "";
	const after = raw.slice(tagAt + marker.length);
	const cutLen = marker.length + (after.startsWith(" ") ? 1 : 0);
	return markerCutSpan(raw, tagAt, cutLen, lineStart, at, lines.length);
}

/**
 * Shared minimal-cut math for one tag excision (pure): the host line
 * loses the tag plus one following space (plus the trailing run,
 * like trimEnd), while a host line left blank drops with its newline.
 * `at` is the host line number, `lineCount` the document's.
 */
function markerCutSpan(
	raw: string,
	tagAt: number,
	cutLen: number,
	lineStart: number,
	at: number,
	lineCount: number
): MarkerCut {
	const rawTrimmedEnd = raw.trimEnd().length;
	const keepAfter = raw.slice(tagAt + cutLen, rawTrimmedEnd);
	if ((raw.slice(0, tagAt) + keepAfter).trim() === "") {
		const isLast = at === lineCount - 1;
		if (!isLast)
			return { from: lineStart, to: lineStart + raw.length + 1, insert: "" };
		if (at === 0) return { from: 0, to: raw.length, insert: "" };
		return { from: lineStart - 1, to: lineStart + raw.length, insert: "" };
	}
	// To the line end: trimEnd applies to the whole remainder, so a
	// pre-existing trailing run goes with the tag (between the cut end
	// and the line end is whitespace by trimmed-end construction).
	// With nothing after the tag, trimEnd eats into the pre-tag run too.
	const before = raw.slice(0, tagAt);
	if (keepAfter === "") {
		return {
			from: lineStart + before.trimEnd().length,
			to: lineStart + raw.length,
			insert: ""
		};
	}
	return {
		from: lineStart + tagAt,
		to: lineStart + raw.length,
		insert: keepAfter
	};
}

/**
 * Locate the cut `removePastedAt` would make for the index-th
 * paste slot in document order, tag or expanded region alike
 * (pure, unit-tested): computed in attachments so the locator and
 * the removal agree by construction. Null when absent.
 */
export function pastedCutAt(doc: string, index: number): MarkerCut | null {
	const cut = pasteSlotCut(doc, index);
	if (!cut) return null;
	return { from: cut.from, to: cut.to, insert: cut.insert };
}

/** Removed marker-tag occurrences in pre-change document order. */
export interface RemovedMarkerTags {
	image: number[];
	file: number[];
	/** Deleted pasted-text tag occurrences (present only when nonempty,
	 * so kind-separated assertions without pastes still hold). */
	pasted?: number[];
}

/**
 * Which tag occurrences a change set deleted (pure, unit-tested):
 * per-kind document-order indexes over the pre-change text, so the
 * host drops the matching attachments (Nth tag pairs with the Nth
 * attachment). Ranges arrive in pre-change coordinates. Pasted
 * slots (collapsed tags and expanded regions alike) index together,
 * so deleting an open region drops its own attachment.
 */
export function removedMarkerIndexes(
	beforeText: string,
	removed: { from: number; to: number }[]
): RemovedMarkerTags {
	const image: number[] = [];
	const file: number[] = [];
	const pasted: number[] = [];
	const tagRe = new RegExp(
		`${escapeRegExp(IMAGE_MARKER)}|${escapeRegExp(FILE_MARKER)}`,
		"g"
	);
	for (const { from, to } of removed) {
		if (to <= from) continue;
		const slice = beforeText.slice(from, to);
		let seenImage = countMarkers(beforeText.slice(0, from));
		let seenFile = countMarkers(beforeText.slice(0, from), FILE_MARKER);
		let seenPasted = countPasteSlots(beforeText.slice(0, from));
		for (const m of slice.matchAll(tagRe)) {
			if (m[0] === IMAGE_MARKER) image.push(seenImage++);
			else file.push(seenFile++);
		}
		const slots = findPasteSlots(slice).length;
		for (let i = 0; i < slots; i++) pasted.push(seenPasted++);
	}
	return pasted.length > 0 ? { image, file, pasted } : { image, file };
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
 * Collapsed-paste insertion shape (pure, unit-tested): the pasted text
 * lands with one trailing space, like attachment tags (`[Pasted image] `
 * inserts with its space), so continued typing starts separated from
 * the marker. The collapse span covers the pasted text only — never
 * the space — and the caret lands past the space.
 */
export interface CollapsedPaste {
	insert: string;
	pasteFrom: number;
	pasteTo: number;
	chars: number;
	anchor: number;
}

export function collapsedPasteInsert(
	from: number,
	text: string
): CollapsedPaste {
	return {
		insert: `${text} `,
		pasteFrom: from,
		pasteTo: from + text.length,
		chars: text.length,
		anchor: from + text.length + 1
	};
}

/**
 * Attachment-tag spans in a document (pure, unit-tested): every
 * IMAGE_MARKER / FILE_MARKER occurrence's range, in document order.
 * The composer styles them as one tag look (bold, never the markdown
 * link underline the raw `[Pasted image]` text would otherwise take).
 */
export interface AttachTagRange {
	from: number;
	to: number;
}

export function attachTagRanges(text: string): AttachTagRange[] {
	const ranges: AttachTagRange[] = [];
	const tagRe = new RegExp(
		`${escapeRegExp(IMAGE_MARKER)}|${escapeRegExp(FILE_MARKER)}`,
		"g"
	);
	for (const m of text.matchAll(tagRe)) {
		const from = m.index ?? 0;
		ranges.push({ from, to: from + m[0].length });
	}
	// Pasted-text tags read as the same bold tag look in the composer.
	for (const m of text.matchAll(PASTED_TAG_RE)) {
		const from = m.index ?? 0;
		ranges.push({ from, to: from + m[0].length });
	}
	ranges.sort((a, b) => a.from - b.from);
	return ranges;
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
 * the image-tag count. The host maps the count's global indexes (see
 * `tagCopyIndexes`) onto its attachments — Nth tag pairs with the Nth
 * attachment, so a middle cut carries its own pictures.
 */
export function tagCopyPlan(
	selectedText: string,
	clipboardWrite: boolean
): TagCopyPlan | null {
	if (selectedText === "" || !clipboardWrite) return null;
	const imageTags = countMarkers(selectedText);
	if (imageTags === 0) return null;
	return { text: selectedText, imageTags };
}

/**
 * Global document-order indexes of the image tags in `[from, to)`
 * (pure, unit-tested): the tags before the range set the base, so a
 * selection's tags address the host's attachments directly. Empty
 * when the range holds no image tags.
 */
export function tagCopyIndexes(
	doc: string,
	from: number,
	to: number
): number[] {
	if (from >= to) return [];
	const base = countMarkers(doc.slice(0, Math.max(0, from)));
	const count = countMarkers(doc.slice(from, to));
	return Array.from({ length: count }, (_, i) => base + i);
}

/**
 * Global document-order indexes of the pasted-text tags in `[from, to)`
 * (pure, unit-tested): the image-tag mirror above — the tags before
 * the range set the base, so a selection's tags address the host's
 * pasted-text attachments directly. Empty when the range holds no
 * pasted tags.
 */
export function pastedCopyIndexes(
	doc: string,
	from: number,
	to: number
): number[] {
	if (from >= to) return [];
	const base = countPasteSlots(doc.slice(0, Math.max(0, from)));
	const count = countPasteSlots(doc.slice(from, to));
	return Array.from({ length: count }, (_, i) => base + i);
}

/**
 * Splice stored pasted prose back at slot positions inside a copied
 * or cut selection (pure, unit-tested): the Nth slot in the
 * selection takes the Nth entry of `texts`, so the clipboard
 * carries content, never the tag label. Expanded regions splice
 * their current inner prose (edits included) with the brackets
 * stripped; null or missing entries keep their tags literal
 * (hand-typed, or resurrected by undo after the pill dropped).
 * Unlike send-time splicing, leftover texts never append — the
 * clipboard holds the selection only.
 */
export function expandPastedTags(
	selected: string,
	texts: (string | null)[]
): string {
	let at = 0;
	let out = "";
	let last = 0;
	for (const slot of findPasteSlots(selected)) {
		out += selected.slice(last, slot.start);
		if (slot.kind === "region") {
			out += slot.inner ?? "";
		} else {
			const prose = at < texts.length ? texts[at] : undefined;
			out += prose ?? selected.slice(slot.start, slot.end);
		}
		last = slot.end;
		at++;
	}
	out += selected.slice(last);
	return out;
}

/** A caret sitting on a paste slot (pure click target, unit-tested). */
export interface PasteSlotHit {
	index: number;
	kind: "tag" | "region";
}

/**
 * Which paste slot a collapsed caret hits (pure, unit-tested):
 * brackets trigger from either side of the glyph (a one-char mark
 * lands the caret before or after it); tags need the caret on the
 * label itself — the far edge belongs to the prose after it, or
 * every click past a tag would unfold it. Brackets win over tags
 * (more specific).
 */
export function pasteSlotHit(doc: string, caret: number): PasteSlotHit | null {
	const slots = findPasteSlots(doc);
	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i];
		if (!slot || slot.kind !== "region") continue;
		if (
			caret === slot.start ||
			caret === slot.start + 1 ||
			caret === slot.end - 1 ||
			caret === slot.end
		) {
			return { index: i, kind: "region" };
		}
	}
	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i];
		if (!slot || slot.kind !== "tag") continue;
		if (caret >= slot.start && caret < slot.end) {
			return { index: i, kind: "tag" };
		}
	}
	return null;
}

/**
 * One tag↔region toggle as a cut plus caret: the editor applies it
 * through the editing engine (Cmd+Z restores the tag), the same
 * shape as the pill-drop cuts.
 */
export interface PasteSlotToggle {
	from: number;
	to: number;
	insert: string;
	caret: number;
}

/**
 * Swap the index-th tag for its expanded `⟦prose⟧` region (pure,
 * unit-tested): caret lands just inside, at the revealed prose.
 * Only tag slots expand — regions and missing slots return null.
 */
export function expandPasteSlot(
	doc: string,
	index: number,
	prose: string
): PasteSlotToggle | null {
	const slots = findPasteSlots(doc);
	const slot = slots[index];
	if (!slot || slot.kind !== "tag") return null;
	return {
		from: slot.start,
		to: slot.end,
		insert: `${PASTE_OPEN}${prose}${PASTE_CLOSE}`,
		caret: slot.start + PASTE_OPEN.length
	};
}

/**
 * Collapse the index-th region back to a fresh tag (pure,
 * unit-tested): the tag recounts the current inner prose (edits
 * included) and the caret lands past it. `inner` writes back to
 * the attachment — only regions collapse, anything else returns
 * null.
 */
export function collapsePasteSlot(
	doc: string,
	index: number
): (PasteSlotToggle & { inner: string }) | null {
	const slots = findPasteSlots(doc);
	const slot = slots[index];
	if (!slot || slot.kind !== "region") return null;
	const inner = slot.inner ?? "";
	const tag = pastedLabel(inner.length);
	return {
		from: slot.start,
		to: slot.end,
		insert: tag,
		caret: slot.start + tag.length,
		inner
	};
}

/**
 * Data URLs back into paste-ready image files, unreadable entries
 * skipped (pure apart from fetch).
 */
export async function dataUrlsToImageFiles(urls: string[]): Promise<File[]> {
	const files: File[] = [];
	for (const [i, url] of urls.entries()) {
		if (!url.startsWith("data:")) continue;
		try {
			const blob = await (await fetch(url)).blob();
			files.push(
				new File([blob], `pasted-image-${i}.png`, {
					type: blob.type || "image/png"
				})
			);
		} catch {
			// Unreadable entry skipped; the rest land.
		}
	}
	return files;
}

/**
 * Bake an in-place edit for storage: paste folds from
 * the send transforms, image markers appended, annotations baked by
 * the caller. Untouched text keeps its stored folds — recomputing
 * from an empty span set would silently unfold the message's pasted
 * tags on a no-op save.
 */
export function bakeEditedMessage(
	raw: string,
	pastes: PasteSpan[],
	imageCount: number,
	seed: string,
	prevFolds?: SendFold[]
): { stored: string; folds: SendFold[] } {
	const { text, folds } = sendPasteFolds(raw, pastes);
	const stored = appendImageMarkers(text, imageCount);
	return { stored, folds: text === seed ? (prevFolds ?? folds) : folds };
}

/**
 * True when the caret sits right after a collapsed paste
 *: fresh marker tags then ride the same line, one
 * space apart, instead of taking the usual prefix.
 */
export function caretAfterPaste(
	pastes: PasteSpan[],
	caret: number
): boolean {
	return pastes.some((s) => caret === s.to);
}

/**
 * Merge two fold lists into send order: span folds
 * plus spliced-paste folds, ascending by start. Both send paths
 * (TypeScript and native) store the same order.
 */
export function mergeFolds<T extends { start: number }>(a: T[], b: T[]): T[] {
	return [...a, ...b].sort((x, y) => x.start - y.start);
}
