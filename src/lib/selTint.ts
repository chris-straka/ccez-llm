import { firstContentRect } from "$lib/annotations";
import {
	slicePoint,
	spanSliceOverlap,
	type SelSlice
} from "$lib/selSlices";

/**
 * Selection tint slice ( REFACTOR: tintSelectionSpans and friends).
 *
 * The furigana overlay tints the selected kanji spans in the document
 * (backwards wraps, so offsets hold) and restores the highlight over
 * the same characters. The walks are DOM-bound and stay here; offset
 * math lives in `selSlices`. Tauri-free, jsdom-tested in
 * `selTint.test.ts`.
 */

/** Chrome elements whose text never counts toward highlight offsets
(element form of quoteFragmentText's skip set): ruby readings,
annotation badges, math/code UI. */
export const SEL_TEXT_SKIP =
	"rt, rp, .frt, [data-ann-badge], .ccez-math-head, .ccez-code-head," +
	" .ccez-math-tex, .ccez-math-copy, .ccez-math-foldedlabel, .ccez-code-foldedlabel";

/** Text slices of a range with highlight offsets: one entry per text
node, clamped to the range, chrome skipped. The concatenated slice
texts equal the quote when the range is the highlight. */
export function selectionSlices(range: Range): SelSlice[] | null {
	try {
		const root = range.commonAncestorContainer;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const out: SelSlice[] = [];
		let base = 0;
		// The walker descends from the container: when the range sits
		// inside a single text node (short highlights), the container
		// IS the node and descent finds nothing.
		const first: Node[] =
			root instanceof Text && range.intersectsNode(root) ? [root] : [];
		const rest: Node[] = [];
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			rest.push(node);
		}
		for (const node of [...first, ...rest]) {
			if (!(node instanceof Text)) continue;
			if (!range.intersectsNode(node)) continue;
			if (node.parentElement?.closest(SEL_TEXT_SKIP)) continue;
			const text = node.textContent ?? "";
			let start = 0;
			let end = text.length;
			if (node === range.startContainer) start = range.startOffset;
			if (node === range.endContainer) end = range.endOffset;
			if (end <= start) continue;
			out.push({ node, start, end, base });
			base += end - start;
		}
		return out;
	} catch {
		return null;
	}
}

/** Screen rect of a highlight span, or null: the span's first line
fragment, never the union box — a group wrapping across lines centers
mid-column and stacks onto its siblings (see firstContentRect). Each
furigana group anchors on its own kanji this way. */
export function spanRect(
	slices: SelSlice[],
	start: number,
	end: number
): DOMRect | null {
	try {
		const a = slicePoint(slices, start);
		const b = slicePoint(slices, end);
		if (!a || !b) return null;
		const range = document.createRange();
		range.setStart(a.node, Math.min(a.offset, a.node.length));
		range.setEnd(b.node, Math.min(b.offset, b.node.length));
		const first = firstContentRect([...range.getClientRects()]);
		const rect = first ?? range.getBoundingClientRect();
		range.detach();
		if (rect.width === 0 && rect.height === 0) return null;
		return rect;
	} catch {
		return null;
	}
}

/** Whole-scope text slices (no range clamp): re-resolving offsets
after surgery, when the live range is gone. */
export function scopeSlices(scope: ParentNode): SelSlice[] {
	const out: SelSlice[] = [];
	try {
		const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
		let base = 0;
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!(node instanceof Text)) continue;
			if (node.parentElement?.closest(SEL_TEXT_SKIP)) continue;
			const len = (node.textContent ?? "").length;
			if (len === 0) continue;
			out.push({ node, start: 0, end: len, base });
			base += len;
		}
	} catch {
		// Partial walk still resolves.
	}
	return out;
}

/** Block elements whose boundaries count as paragraph breaks when
speech chords flatten scope slices to plain text. */
const SPEECH_BLOCK_SEL =
	"p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,dt,dd";

/** Nearest speech-block ancestor of a text node, confined to the
scope (a match above the scope belongs to outer chrome). */
export function speechBlockOf(
	node: Text,
	scope: ParentNode
): Element | null {
	try {
		const block = node.parentElement?.closest(SPEECH_BLOCK_SEL) ?? null;
		return block && scope.contains(block) ? block : null;
	} catch {
		return null;
	}
}

/**
 * Rendered text block under a window point: the caret range's block
 * (paragraph, item, cell…), contained in a message body. Null off
 * text, without the API, or outside the thread. DOM-bound; the tap
 * selectors share it.
 */
export function textBlockAtPoint(
	clientX: number,
	clientY: number
): { block: Element; range: Range } | null {
	try {
		if (typeof document.caretRangeFromPoint !== "function") return null;
		const range = document.caretRangeFromPoint(clientX, clientY);
		const node = range?.startContainer;
		if (!range || !node) return null;
		const element = node instanceof Element ? node : node.parentElement;
		const rendered = element?.closest(".messages .rendered") ?? null;
		if (!(rendered instanceof Element)) return null;
		const block =
			element?.closest("p, li, pre, td, blockquote, h1, h2, h3, h4, div") ??
			null;
		if (!(block instanceof Element) || !rendered.contains(block))
			return rendered ? { block: rendered, range } : null;
		return { block, range };
	} catch {
		return null;
	}
}

/** One laid-out text fragment for the panel-narrowing pass. */
export interface LineFrag {
	top: number;
	left: number;
	width: number;
}

/** Longest laid-out line across fragments sharing a rounded top:
the width readings panels narrow to. Zero-width fragments never
count (collapsed whitespace, empty runs). */
export function longestLineWidth(frags: LineFrag[]): number {
	const lines = new Map<number, { l: number; r: number }>();
	for (const f of frags) {
		if (f.width <= 0) continue;
		const line = lines.get(f.top) ?? { l: Infinity, r: -Infinity };
		line.l = Math.min(line.l, f.left);
		line.r = Math.max(line.r, f.left + f.width);
		lines.set(f.top, line);
	}
	let longest = 0;
	for (const { l, r } of lines.values())
		longest = Math.max(longest, r - l);
	return longest;
}

/** Narrow a readings panel to its longest laid-out line plus side
padding (DOM-bound; the pure grouping is longestLineWidth). Returns
the effective width for the x-clamp: the narrowed width when the
glass was a slab, else the measured one. Zero when unmeasurable
(jsdom, display none) — callers keep their placed x. Explicit
widths are safe: panels are transient per selection, and the
translateX centering holds whatever the width. */
export function shrinkPanelToContent(node: Element): number {
	try {
		const w = node.getBoundingClientRect().width;
		if (w === 0) return 0;
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
		const frags: LineFrag[] = [];
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			if (!(n.textContent ?? "").trim()) continue;
			const range = document.createRange();
			range.selectNodeContents(n);
			for (const rect of range.getClientRects()) {
				if (rect.width === 0) continue;
				frags.push({
					top: Math.round(rect.top),
					left: rect.left,
					width: rect.width
				});
			}
			range.detach();
		}
		const longest = longestLineWidth(frags);
		const cs = getComputedStyle(node);
		const pad =
			(parseFloat(cs.paddingLeft) || 0) +
			(parseFloat(cs.paddingRight) || 0);
		if (longest > 0 && w > longest + pad + 1) {
			const narrowed = Math.ceil(longest + pad);
			if (node instanceof HTMLElement)
				node.style.width = `${narrowed}px`;
			return narrowed;
		}
		return w;
	} catch {
		return 0;
	}
}

/** Flatten scope slices to plain text with a blank line between
slices from different blocks, so paragraph speech stops at the
rendered paragraph (raw concatenation fuses "zeta." and "Second"
into one run-on). `caretOffset` is range-relative to the hit node;
the returned caret is clamped to the joined text. */
export function joinSlicesWithBlocks(
	slices: SelSlice[],
	scope: ParentNode,
	hit: SelSlice,
	caretOffset: number
): { full: string; at: number } {
	let full = "";
	let at = 0;
	let prev: Element | null = null;
	let started = false;
	try {
		for (const s of slices) {
			const block =
				s.node instanceof Text ? speechBlockOf(s.node, scope) : null;
			if (started && block !== prev) full += "\n\n";
			if (s === hit)
				at = full.length + Math.max(caretOffset - s.start, 0);
			full += (s.node.textContent ?? "").slice(s.start, s.end);
			prev = block;
			started = true;
		}
	} catch {
		// Partial join still resolves.
	}
	return { full, at: Math.min(Math.max(at, 0), full.length) };
}

/** Wrap the selected kanji spans in tint spans (backwards, so offsets
hold), then put the highlight back over the same characters. The live
range is detached first: removing a node that holds range endpoints
collapses the range, and restoring from the wreckage selects the
wrong text. Tint spans carry no text of their own, so quotes,
context, and copy all read through them. */
export function tintSelectionSpans(
	slices: SelSlice[],
	spans: { start: number; end: number; color: number }[]
): boolean {
	try {
		const live = window.getSelection();
		if (!live || live.rangeCount === 0) return false;
		const total = slices.reduce((n, s) => n + (s.end - s.start), 0);
		const anchor = slices[0]?.node.parentElement?.closest(".rendered");
		const scope: ParentNode = anchor ?? document.body;
		// Highlight start in scope offsets (pre-surgery: splits keep
		// earlier text byte-identical, so it stays valid).
		const first = slices[0];
		let highlightBase = -1;
		if (first) {
			for (const s of scopeSlices(scope)) {
				if (s.node === first.node) {
					highlightBase = s.base + (first.start - s.start);
					break;
				}
			}
		}
		if (highlightBase < 0) return false;
		// The live range stays through the surgery below: splitText and
		// the wrap move endpoints along (same text nodes, new parents),
		// so the highlight — and on phones the native drag handles —
		// survive. removeAllRanges would tear the handles down, and the
		// programmatic restore never brings them back.
		const expected = slices
			.map((s) => (s.node.textContent ?? "").slice(s.start, s.end))
			.join("");
		try {
			// Latest spans first: each wrap shortens the working node
			// from the right, so earlier offsets keep resolving
			// (forward order walks off the shortened node and throws,
			// stranding the selection).
			const ordered = [...spans].sort((a, b) => b.start - a.start);
			for (let i = slices.length - 1; i >= 0; i--) {
				const s = slices[i];
				if (!s) continue;
				for (const span of ordered) {
					const overlap = spanSliceOverlap(span, s);
					if (!overlap) continue;
					const { relLo, relHi } = overlap;
					let target: Text = s.node;
					if (relHi < target.length) target.splitText(relHi);
					if (relLo > 0) target = target.splitText(relLo);
					const wrap = document.createElement("span");
					wrap.className = `frbt${span.color % 4}`;
					target.parentNode?.replaceChild(wrap, target);
					wrap.appendChild(target);
				}
			}
		} catch {
			// Partial tint still preserves every character: fall through
			// and restore the highlight regardless.
		}
		// Surgery keeps a live range tracking the same characters, so
		// an intact highlight is already correct — leave it (and the
		// native handles) alone. Only re-resolve when the engine lost
		// it mid-surgery.
		const kept = window.getSelection();
		if (
			kept &&
			kept.rangeCount > 0 &&
			!kept.isCollapsed &&
			kept.toString() === expected
		)
			return true;
		const fresh = scopeSlices(scope);
		const a = slicePoint(fresh, highlightBase);
		const b = slicePoint(fresh, highlightBase + total);
		if (!a || !b) return false;
		live.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
		return true;
	} catch {
		return false;
	}
}

/** Unwrap every tint span back to bare text (dismiss paths and
re-summons; a re-rendered message simply has none to find). */
export function unwrapFuriganaTint(): void {
	const spans = document.querySelectorAll(
		".frbt0, .frbt1, .frbt2, .frbt3"
	);
	const parents: ParentNode[] = [];
	spans.forEach((el) => {
		const parent = el.parentNode;
		if (!parent) return;
		if (!parents.includes(parent)) parents.push(parent);
		while (el.firstChild) parent.insertBefore(el.firstChild, el);
		parent.removeChild(el);
	});
	parents.forEach((parent) => parent.normalize());
}
