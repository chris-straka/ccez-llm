import {
	Compartment,
	EditorState,
	StateEffect,
	StateField,
	Range,
	RangeSet,
	RangeSetBuilder,
	Prec,
	type Extension
} from "@codemirror/state";
import {
	EditorView,
	keymap,
	placeholder,
	Decoration,
	WidgetType,
	type DecorationSet
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
	LanguageDescription,
	defaultHighlightStyle,
	syntaxHighlighting
} from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import {
	parseFences,
	fenceBody,
	fenceAtOffset,
	shiftEnterAction,
	type FenceBlock
} from "./fences";
import { IMAGE_MARKER } from "./attachments";
import { shouldDeferForComposition } from "./editContext";

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
	/** Ctrl+O: expand every paste tag, or re-collapse expanded ones.
	 * True when it did anything (the caller then owns the keystroke). */
	togglePastes(): boolean;
	setText(text: string): void;
	/** Insert text at the cursor (used for pasted-image markers). */
	insertText(text: string): void;
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
	/** An image was pasted or dropped; the host turns it into an attachment. */
	onImagePaste?: (file: File) => void;
	/** Document text changed (drives the submit button's faded state). */
	onDocChange?: (text: string) => void;
}

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

interface PasteCollapse {
	id: number;
	from: number;
	to: number;
	chars: number;
}

const addPaste = StateEffect.define<PasteCollapse>();
const expandPaste = StateEffect.define<number>();
const expandAllPastes = StateEffect.define<void>();
const collapseAllPastes = StateEffect.define<void>();

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

function pastePlaceholders(): Extension {
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
				if ((event.target as HTMLElement).closest("[data-paste-expand]")) {
					event.preventDefault();
					return true;
				}
				return false;
			},
			click: (event, view) => {
				const target = (event.target as HTMLElement).closest("[data-paste-expand]");
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
function pasteHandling(onImage: ((file: File) => void) | undefined): Extension {
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

// --- Fenced code blocks --------------------------------------------------
// Glyphs match the message action row (ActionIcon.svelte): stroke icons,
// not text buttons.
const FENCE_FOLD_SVG =
	'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg>';
const FENCE_COPY_SVG =
	'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-3a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3"/></svg>';

/** Collapse key for a fence: opening line plus language (stable enough
for a draft; pruned whenever the lines stop being a fence). */
function fenceKey(fence: FenceBlock): string {
	return `${fence.openLine}:${fence.lang}`;
}

class FenceBar extends WidgetType {
	constructor(
		readonly fkey: string,
		readonly lang: string,
		readonly collapsed: boolean,
		readonly canCollapse: boolean
	) {
		super();
	}
	eq(other: FenceBar): boolean {
		return (
			other.fkey === this.fkey &&
			other.lang === this.lang &&
			other.collapsed === this.collapsed &&
			other.canCollapse === this.canCollapse
		);
	}
	ignoreEvent(): boolean {
		return false;
	}
	toDOM(): HTMLElement {
		const bar = document.createElement("div");
		bar.className = "cm-fence-bar";
		const label = document.createElement("span");
		label.className = "cm-fence-lang";
		label.textContent = this.lang || "text";
		bar.appendChild(label);
		const fold = document.createElement("button");
		fold.type = "button";
		fold.className = "cm-fence-btn" + (this.collapsed ? " folded" : "");
		fold.dataset.fenceToggle = this.fkey;
		fold.title = this.collapsed ? "Expand code" : "Collapse code";
		fold.setAttribute("aria-label", this.collapsed ? "Expand code block" : "Collapse code block");
		fold.disabled = !this.canCollapse;
		fold.innerHTML = FENCE_FOLD_SVG;
		const copy = document.createElement("button");
		copy.type = "button";
		copy.className = "cm-fence-btn";
		copy.dataset.fenceCopy = this.fkey;
		copy.title = "Copy code";
		copy.setAttribute("aria-label", "Copy code block");
		copy.innerHTML = FENCE_COPY_SVG;
		bar.append(fold, copy);
		return bar;
	}
}

/** Slim closing bar: the closing backticks read as a rule, mirroring the bar. */
class FenceEnd extends WidgetType {
	eq(): boolean {
		return true;
	}
	toDOM(): HTMLElement {
		const end = document.createElement("div");
		end.className = "cm-fence-end";
		end.setAttribute("aria-hidden", "true");
		return end;
	}
}

/** One widget standing in for a collapsed body (same single-replace
pattern as the paste markers — never one widget per line, which is
what dropped body rows in the parked attempt). */
class FenceCollapsed extends WidgetType {
	constructor(
		readonly fkey: string,
		readonly lines: number
	) {
		super();
	}
	eq(other: FenceCollapsed): boolean {
		return other.fkey === this.fkey && other.lines === this.lines;
	}
	ignoreEvent(): boolean {
		return false;
	}
	toDOM(): HTMLElement {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "cm-fence-collapsed";
		btn.dataset.fenceExpand = this.fkey;
		btn.setAttribute(
			"aria-label",
			`Expand code block (${String(this.lines)} ${this.lines === 1 ? "line" : "lines"} hidden)`
		);
		btn.textContent = `${String(this.lines)} ${this.lines === 1 ? "line" : "lines"} hidden — expand`;
		return btn;
	}
}

const toggleFence = StateEffect.define<string>();

interface FenceState {
	deco: DecorationSet;
	collapsed: Set<string>;
}

/** Decorations for a document snapshot, pruning collapsed keys whose
lines stopped being fence openers. */
function buildFences(docText: string, collapsed: Set<string>): FenceState {
	const builder = new RangeSetBuilder<Decoration>();
	const fences = parseFences(docText);
	const kept = new Set<string>();
	const starts: number[] = [];
	let offset = 0;
	for (const part of docText.split("\n")) {
		starts.push(offset);
		offset += part.length + 1;
	}
	const lineEnd = (line: number): number =>
		line + 1 < starts.length ? (starts[line + 1] ?? 0) - 1 : docText.length;
	for (const fence of fences) {
		const key = fenceKey(fence);
		const isCollapsed = collapsed.has(key);
		if (isCollapsed) kept.add(key);
		const canCollapse =
			fence.closeLine !== -1 && fence.bodyTo > fence.bodyFrom;
		builder.add(
			fence.openFrom,
			lineEnd(fence.openLine),
			Decoration.replace({ widget: new FenceBar(key, fence.lang, isCollapsed, canCollapse) })
		);
		if (fence.closeLine !== -1) {
			if (isCollapsed && canCollapse) {
				builder.add(
					fence.bodyFrom,
					fence.bodyTo,
					Decoration.replace({
						widget: new FenceCollapsed(key, fence.closeLine - fence.openLine - 1)
					})
				);
			}
			builder.add(fence.bodyTo, fence.closeTo, Decoration.replace({ widget: new FenceEnd() }));
		}
	}
	return { deco: builder.finish(), collapsed: kept };
}

/** Copy a fence body to the clipboard with a brief success tint. */
function copyFenceBody(view: EditorView, button: HTMLElement, key: string): void {
	const fence = parseFences(view.state.doc.toString()).find((f) => fenceKey(f) === key);
	if (!fence) return;
	try {
		const done = navigator.clipboard?.writeText(fenceBody(view.state.doc.toString(), fence));
		done?.then(
			() => {
				button.classList.add("copied");
				setTimeout(() => button.classList.remove("copied"), 900);
			},
			() => {}
		);
	} catch {
		// Clipboard unavailable (permissions): the text stays selected-able.
	}
}

function fenceWidgets(): Extension {
	const field = StateField.define<FenceState>({
		create: (state) => buildFences(state.doc.toString(), new Set()),
		update: (value, tr) => {
			let collapsed = value.collapsed;
			let toggled = false;
			for (const e of tr.effects) {
				if (e.is(toggleFence)) {
					collapsed = new Set(collapsed);
					if (collapsed.has(e.value)) collapsed.delete(e.value);
					else collapsed.add(e.value);
					toggled = true;
				}
			}
			// A bare toggle carries no doc change, but the decorations
			// still need a rebuild — mapping the old set would keep the
			// bar uncollapsed and drop the collapsed-body widget.
			if (!tr.docChanged && !toggled) {
				const deco = value.deco.map(tr.changes);
				return { deco, collapsed };
			}
			return buildFences(tr.newDoc.toString(), collapsed);
		},
		provide: (f) => EditorView.decorations.from(f, (v) => v.deco)
	});
	const guard: Extension = Prec.high(
		EditorView.domEventHandlers({
			mousedown: (event) => {
				const target = event.target instanceof Element ? event.target : null;
				if (!target?.closest("[data-fence-toggle],[data-fence-copy],[data-fence-expand]")) {
					return false;
				}
				// Same as the paste buttons: clicks must not move the caret.
				event.preventDefault();
				return true;
			},
			click: (event, view) => {
				const target = event.target instanceof Element ? event.target : null;
				const toggle = target?.closest<HTMLElement>("[data-fence-toggle],[data-fence-expand]");
				if (toggle) {
					const key =
						toggle.dataset.fenceToggle ?? toggle.dataset.fenceExpand ?? "";
					if (key) view.dispatch({ effects: toggleFence.of(key) });
					return true;
				}
				const copy = target?.closest<HTMLElement>("[data-fence-copy]");
				if (copy) {
					copyFenceBody(view, copy, copy.dataset.fenceCopy ?? "");
					return true;
				}
				return false;
			}
		})
	);
	return [field, guard];
}

/** Shift+Enter on a fence line: close an open fence, exit an empty
body, else fall through to a plain newline. */
function runFenceShiftEnter(view: EditorView): boolean {
	const doc = view.state.doc.toString();
	const cursor = view.state.selection.main.head;
	const action = shiftEnterAction(doc, cursor);
	if (action.kind === "newline") return false;
	if (action.kind === "close") {
		const line = view.state.doc.lineAt(cursor);
		view.dispatch({
			changes: { from: line.to, insert: "\n\n```" },
			selection: { anchor: line.to + 1 },
			scrollIntoView: true
		});
		return true;
	}
	const fence = fenceAtOffset(parseFences(doc), cursor);
	if (!fence) return false;
	if (fence.closeLine !== -1) {
		if (fence.closeTo < doc.length) {
			view.dispatch({
				selection: { anchor: fence.closeTo + 1 },
				scrollIntoView: true
			});
		} else {
			view.dispatch({
				changes: { from: fence.closeTo, insert: "\n" },
				selection: { anchor: fence.closeTo + 1 },
				scrollIntoView: true
			});
		}
		return true;
	}
	view.dispatch({
		changes: { from: fence.bodyFrom, to: fence.bodyTo, insert: "```\n" },
		selection: { anchor: fence.bodyFrom + 4 },
		scrollIntoView: true
	});
	return true;
}

const codeLanguages = [
	LanguageDescription.of({
		name: "javascript",
		alias: ["js", "jsx", "ts", "tsx", "mjs", "cjs"],
		load: async () => javascript()
	}),
	LanguageDescription.of({
		name: "python",
		alias: ["py", "pyw", "python"],
		load: async () => python()
	}),
	LanguageDescription.of({
		name: "rust",
		alias: ["rs"],
		load: async () => rust()
	}),
	LanguageDescription.of({
		name: "cpp",
		alias: ["c", "h", "cc", "cpp", "cxx", "hpp", "c++"],
		load: async () => cpp()
	})
];

const appTheme = EditorView.theme({
	"&": { fontSize: "0.95rem" },
	".cm-content": { fontFamily: "inherit", padding: "0.6rem 0" },
	// The prompt grows with the draft, then stops at ~8 lines and scrolls
	// inside instead of eating the messages list. overflow-y must ride
	// along: capped without it, long drafts clip with no way to reach
	// the hidden lines.
	".cm-scroller": { maxHeight: "12rem", overflowY: "auto" },
	".cm-focused": { outline: "none" },
	// Grey shade, never a code block: the tag carries no background or
	// border of its own, just muted text (Muse Code style).
	".cm-paste-marker": {
		display: "inline-block",
		fontSize: "0.78rem",
		color: "#6e6e73",
		cursor: "pointer"
	},
	// Fence bars echo the message code-head: label left, icon buttons
	// right. Only the two bar lines are widgets — body rows stay real
	// text so the caret and IME never sit on a replacement.
	".cm-fence-bar": {
		display: "flex",
		alignItems: "center",
		gap: "0.5rem",
		backgroundColor: "#f1f1f4",
		border: "1px solid #e5e5ea",
		borderRadius: "8px",
		padding: "0.15rem 0.5rem",
		fontSize: "0.75rem"
	},
	".cm-fence-lang": {
		fontFamily: "'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		fontWeight: "600",
		color: "#6e6e73"
	},
	".cm-fence-btn": {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		marginLeft: "auto",
		background: "none",
		border: "none",
		padding: "2px",
		color: "inherit",
		cursor: "pointer",
		borderRadius: "6px"
	},
	".cm-fence-btn + .cm-fence-btn": { marginLeft: "0" },
	".cm-fence-btn svg": { height: "0.95rem", width: "0.95rem" },
	".cm-fence-btn:disabled": { opacity: "0.35", cursor: "default" },
	".cm-fence-btn.folded svg": { transform: "rotate(180deg)" },
	".cm-fence-btn.copied": { color: "#1f7a4d" },
	".cm-fence-end": {
		height: "0.45rem",
		borderBottom: "1px solid #c7c7cc"
	},
	".cm-fence-collapsed": {
		display: "block",
		width: "100%",
		textAlign: "left",
		background: "none",
		border: "none",
		padding: "0.2rem 0",
		fontSize: "0.8rem",
		color: "#6e6e73",
		cursor: "pointer"
	},
	// Insert-mode caret (light scheme; dark lives in +page.svelte global
	// CSS because @media inside a CM theme object is unreliable).
	".cm-cursor": { borderLeftColor: "#1c1c1e" }
});

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
				if (update.docChanged) options.onDocChange?.(update.state.doc.toString());
			}),
			history(),
			keymap.of([...defaultKeymap, ...historyKeymap]),
			markdown({ codeLanguages }),
			syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
			fenceWidgets(),
			pastePlaceholders(),
			pasteHandling(options.onImagePaste),
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
		togglePastes: () => togglePastes(view),
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
