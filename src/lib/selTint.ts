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
