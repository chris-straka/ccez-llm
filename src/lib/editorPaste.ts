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
	type Extension
} from "@codemirror/state";
import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import {
	addPaste,
	expandPaste,
	expandAllPastes,
	collapseAllPastes,
	type PasteCollapse
} from "./editorEffects";
import { IMAGE_MARKER } from "./attachments";
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
				}
			}
			return { deco, open };
		},
		provide: (f) => EditorView.decorations.from(f, (value) => value.deco)
	});
	const clicks = Prec.high(
		EditorView.domEventHandlers({
			mousedown: (event) => {
				// Same guard as the fence bars: keep CodeMirror selection
				// from swallowing the marker click that follows.
				if (closestFromTarget(event.target, "[data-paste-expand]")) {
					event.preventDefault();
					return true;
				}
				return false;
			},
			click: (event, view) => {
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
 * exactly the send transforms (drop IMAGE_MARKER lines like
 * stripImageMarkers, then trim like composerText). A span touched by either
 * transform is dropped — sent unfolded — rather than misplaced. Pure and
 * unit-tested.
 */
export function sendPasteFolds(doc: string, spans: PasteSpan[]): { text: string; folds: SendFold[] } {
	// Drop marker lines, tracking dropped document ranges. Mirrors
	// stripImageMarkers line for line (split/filter/join); a parity test
	// below pins the text output to that function.
	const dropped: Array<{ start: number; end: number }> = [];
	const kept: string[] = [];
	let offset = 0;
	const lines = doc.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const chunk = line + (i < lines.length - 1 ? "\n" : "");
		if (line.trim() === IMAGE_MARKER) dropped.push({ start: offset, end: offset + chunk.length });
		else kept.push(chunk);
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

/**
 * Strip trailing blank lines from pasted text. Block selections routinely
 * drag extra newlines along, and the prompt must not grow empty lines for
 * them. Pure and unit-tested. (Pasted-image markers are decoration-only
 * widgets — they never pad the document, so this isn't that.)
 */
export function trimPasteTail(text: string): string {
	return text.replace(/(\r\n|\r|\n)+$/, "");
}

/** Paste hook: images become attachments, long text collapses to a marker. */
export function pasteHandling(onImage: ((file: File) => void) | undefined): Extension {
	return Prec.high(
		EditorView.domEventHandlers({
			paste: (event, view) => {
				const clipboard = event.clipboardData;
				if (!clipboard) return false;
				const image = [...clipboard.files].find((f) => f.type.startsWith("image/"));
				if (image && onImage) {
					event.preventDefault();
					onImage(image);
					return true;
				}
				const raw = clipboard.getData("text/plain");
				const text = trimPasteTail(raw);
				// Nothing but newlines: swallow, don't insert an empty line.
				if (!text) {
					event.preventDefault();
					return true;
				}
				if (text.length <= PASTE_THRESHOLD) {
					// Untrimmed short paste: the default handler is exact.
					// Trimmed: it would reinsert the raw tail, so insert here.
					if (text === raw) return false;
					event.preventDefault();
					const { from, to } = view.state.selection.main;
					view.dispatch({
						changes: { from, to, insert: text },
						selection: { anchor: from + text.length }
					});
					return true;
				}
				event.preventDefault();
				const { from, to } = view.state.selection.main;
				const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
				view.dispatch({
					changes: { from, to, insert: text },
					effects: addPaste.of({ id, from, to: from + text.length, chars: text.length }),
					selection: { anchor: from + text.length }
				});
				return true;
			}
		})
	);
}
