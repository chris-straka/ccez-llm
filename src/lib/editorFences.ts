/**
 * Fence fold/copy/run widgets (editor slice, REFACTOR §7).
 *
 * Fenced code blocks in the composer get a head bar (language label,
 * fold + copy buttons), a rule-style closing line, and a single
 * collapsed-body widget — plus Shift+Enter handling (close an open
 * fence, exit an empty body, else a plain newline). Verbatim move out
 * of `editor.ts`; the toggle effect comes from `editorEffects`, fence
 * parsing from `./fences`.
 */
import { StateField, RangeSetBuilder, Prec, type Extension } from "@codemirror/state";
import {
	EditorView,
	Decoration,
	WidgetType,
	type DecorationSet
} from "@codemirror/view";
import { toggleFence } from "./editorEffects";
import {
	parseFences,
	fenceBody,
	fenceAtOffset,
	shiftEnterAction,
	type FenceBlock
} from "./fences";

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

export function fenceWidgets(): Extension {
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
export function runFenceShiftEnter(view: EditorView): boolean {
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
