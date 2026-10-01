/**
 * Annotation DOM stamping: badges, washes, and selection helpers.
 * Split from annotations.ts (pure data: grouping, numbering, marks
 * builders, quote math) — this module owns everything touching the
 * rendered DOM. Behavior-preserving: same functions, new address.
 */
import {
	badgeAnswerClass,
	badgeFace,
	hasRtlQuote,
	quoteDirection,
	type AnnotationId,
	type AnnotationMark
} from "./annotations";
import {
	locateQuote,
	type QuoteLocation
} from "./quote-match";
import {
	edgeOffsetForAnchor,
	gapOffsetForAnchor,
	isWordChar,
	splitSafeOffset
} from "./sel-geometry";
import {
	ANN_HIGHLIGHT_D1,
	ANN_HIGHLIGHT_D2,
	ANN_HIGHLIGHT_D3,
	ANN_HIGHLIGHT_NAME,
	clearAnnotationWash,
	clearAnnotationWashes,
	highlightsSupported,
	liveWashRanges,
	paintAnnotationWash,
	sameWashRanges,
	washRampSchedule
} from "./annHighlights";

/** Minimal grapheme-segment view (Intl.Segmenter when present). */
interface GraphemeSegment {
	index: number;
	segment: string;
}
interface GraphemeSegmenter {
	segment(text: string): Iterable<GraphemeSegment>;
}

function loadGraphemeSegmenter(): GraphemeSegmenter | null {
	try {
		const Ctor = (
			Intl as unknown as {
				Segmenter?: new (
					locales?: string | string[],
					options?: { granularity?: string }
				) => GraphemeSegmenter;
			}
		).Segmenter;
		if (!Ctor) return null;
		return new Ctor(undefined, { granularity: "grapheme" });
	} catch {
		return null;
	}
}

const graphemeSegmenter: GraphemeSegmenter | null = loadGraphemeSegmenter();

/** Combining marks the fallback treats as part of the base's cluster. */
const CLUSTER_MARK_RE = /[\p{Mn}\p{Me}\u200D]/u;
const LOW_SURROGATE_RE = /[\uDC00-\uDFFF]/;
const HIGH_SURROGATE_RE = /[\uD800-\uDBFF]/;

/**
 * Bounds of the grapheme cluster holding `offset` (a UTF-16 index into
 * `text`; the end position pins to the last cluster). Stamping must never
 * split a cluster: wrapping a base letter apart from its tashkeel breaks
 * Arabic joining/shaping, and the split survives the rebuild as shifted
 * words across lines.
 */
function clusterBounds(
	text: string,
	offset: number
): { start: number; end: number } {
	const at = Math.max(0, Math.min(offset, text.length));
	if (graphemeSegmenter) {
		let prev = { start: 0, end: 0 };
		for (const part of graphemeSegmenter.segment(text)) {
			const start = part.index;
			const end = start + part.segment.length;
			if (at >= start && at < end) return { start, end };
			prev = { start, end };
		}
		if (text.length > 0 && at >= text.length && prev.end > 0) return prev;
		return { start: at, end: Math.min(at + 1, text.length) };
	}
	let start = at;
	while (start > 0) {
		const ch = text[start - 1] ?? "";
		if (CLUSTER_MARK_RE.test(ch)) {
			start -= 1;
			continue;
		}
		if (
			LOW_SURROGATE_RE.test(ch) &&
			HIGH_SURROGATE_RE.test(text[start - 2] ?? "")
		) {
			start -= 2;
			continue;
		}
		break;
	}
	let end = Math.min(Math.max(at + 1, start + 1), text.length);
	while (end < text.length) {
		const ch = text[end] ?? "";
		if (!CLUSTER_MARK_RE.test(ch)) break;
		end += 1;
	}
	return { start, end: Math.max(end, start + 1) };
}

/** Move an inclusive wrap start back to its cluster's start. */
function expandWrapStart(text: string, from: number): number {
	if (from <= 0 || from >= text.length) return from;
	const bounds = clusterBounds(text, from);
	return bounds.start < from ? bounds.start : from;
}

/** Move an exclusive wrap end forward past its cluster's trailing marks. */
function expandWrapEnd(text: string, to: number): number {
	if (to <= 0 || to >= text.length) return to;
	const bounds = clusterBounds(text, to);
	return bounds.start < to ? bounds.end : to;
}
/**
 * DOM Range for a quote inside a rendered root (sent-annotation jumps):
 * same node collection and matching as badge stamping (badges, ruby,
 * and readings stay out via quoteTextNodes), but no DOM mutation — the
 * caller scrolls to the rect and flashes it via the Highlight API.
 * Null when the quote isn't in this root (folded, edited away).
 */
export function quoteRange(
	root: HTMLElement,
	quote: string,
	occurrence = 0
): Range | null {
	try {
		const nodes = quoteTextNodes(root);
		const loc = locateQuote(
			nodes.map((n) => n.textContent ?? ""),
			quote,
			occurrence
		);
		if (!loc) return null;
		const first = nodes[loc.startNode];
		const last = nodes[loc.endNode];
		if (!first || !last) return null;
		const from = Math.min(loc.startOffset, first.textContent?.length ?? 0);
		const to = Math.min(loc.endOffset, last.textContent?.length ?? 0);
		const range = document.createRange();
		range.setStart(first, from);
		// Same-node only: an end before its start inverts, so pin it.
		// Across nodes the offsets live in different texts (a badge
		// anchor splitting a quote leaves the last node short while
		// the first runs long) — maxing there overshoots the last
		// node and throws.
		range.setEnd(last, first === last ? Math.max(to, from) : to);
		return range.collapsed ? null : range;
	} catch {
		return null;
	}
}
/**
 * Wrap a range in a highlight mark (sent-jump destination flash):
 * extract handles every boundary shape (mid-node, cross-element),
 * so callers never juggle split points. Returns the mark, or null
 * when the range can't extract. The mark is transient — the caller
 * unwraps it after the blink.
 */
export function wrapRangeInMark(range: Range, cls: string): HTMLElement | null {
	try {
		// A removal collapses ranges to (parent, index): wrapping those
		// would plant an empty live mark, so collapsed ranges refuse.
		// Fresh ranges come from locate() each phase, so they are current
		// by construction; any other detached shape still extracts
		// harmlessly (mutating a dead tree), and the next phase wraps fresh.
		if (range.collapsed) return null;
		const doc = range.startContainer.ownerDocument;
		if (!doc) return null;
		const mark = doc.createElement("mark");
		mark.className = cls;
		mark.appendChild(range.extractContents());
		range.insertNode(mark);
		return mark;
	} catch {
		return null;
	}
}

/**
 * Wrap a range in highlight marks, carving out badge anchors: the
 * jump flash must never move the marker — a whole-range extract
 * would pull the mid-quote anchor (button included) into the mark
 * and back out, shaking the badge once per blink phase. Text runs
 * around each intersecting badge wrap separately while the anchor
 * subtree is never touched. Returns the painted marks (empty when
 * nothing painted). Never throws.
 */
export function wrapRangeExcludingBadges(
	range: Range,
	cls: string
): HTMLElement[] {
	const painted: HTMLElement[] = [];
	try {
		if (range.collapsed) return painted;
		const doc = range.startContainer.ownerDocument ?? null;
		if (!doc) return painted;
		const scope =
			range.commonAncestorContainer instanceof Element
				? range.commonAncestorContainer
				: range.commonAncestorContainer.parentElement;
		if (!scope) return painted;
		// Snapshot the endpoints up front: later wraps split nodes
		// after these points, never the points themselves.
		const startNode = range.startContainer;
		const startOff = range.startOffset;
		const endNode = range.endContainer;
		const endOff = range.endOffset;
		const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
		const runs: Text[][] = [];
		let current: Text[] | null = null;
		const flush = (): void => {
			if (current !== null && current.length > 0) runs.push(current);
			current = null;
		};
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (!(node instanceof Text)) continue;
			let inside = false;
			try {
				inside = range.intersectsNode(node);
			} catch {
				inside = false;
			}
			// Badge labels are UI, never flash: skipping them also
			// splits the runs around the anchor, which stays put.
			if (!inside || node.parentElement?.closest("[data-ann-badge]") !== null) {
				flush();
				continue;
			}
			if (!current) current = [];
			current.push(node);
		}
		flush();
		// Back-to-front: wrapping a later run splits nodes no earlier
		// run's points at or after.
		const textLen = (node: Text): number => node.textContent?.length ?? 0;
		for (let i = runs.length - 1; i >= 0; i--) {
			const run = runs[i]!;
			const first = run[0]!;
			const last = run[run.length - 1]!;
			const sub = doc.createRange();
			sub.setStart(
				first,
				first === startNode ? Math.min(startOff, textLen(first)) : 0
			);
			sub.setEnd(
				last,
				last === endNode ? Math.min(endOff, textLen(last)) : textLen(last)
			);
			if (sub.collapsed) continue;
			const mark = wrapRangeInMark(sub, cls);
			if (mark) painted.push(mark);
		}
	} catch {
		// Transient cosmetic: partial paints clear with the blink.
	}
	return painted;
}

/** Release a transient highlight mark, restoring its text in place.
Safe when a re-render already dropped it (nothing to restore). */
export function unwrapMark(mark: HTMLElement): void {
	try {
		if (mark.isConnected) mark.replaceWith(...[...mark.childNodes]);
	} catch {
		mark.remove();
	}
}
/**
 * Sync mounted badge faces to their marks (text and title only —
 * never nodes, never marks): renumbers must not move any text.
 * Writes only when the face differs, so steady re-stamps are DOM
 * no-ops. Unknown ids (deleted mid-flight) keep their last face.
 */
function syncBadgeFaces(root: ParentNode, items: AnnotationMark[]): void {
	const byId = new Map(items.map((i) => [i.id, i]));
	for (const badge of root.querySelectorAll<HTMLButtonElement>(
		"button[data-ann-badge]"
	)) {
		const item = byId.get(
			(badge.getAttribute("data-ann-badge") ?? "") as AnnotationId
		);
		if (!item) continue;
		const face = badgeFace(item);
		if (badge.textContent !== face.text) badge.textContent = face.text;
		if (badge.title !== face.title) badge.title = face.title;
	}
}
/**
 * Rendered text nodes eligible for quote location. Badge buttons stamped
 * earlier in the same pass are UI chrome, not message text: their number
 * text must stay out of the haystack, or any later quote spanning that
 * position (overlapping or nested selections) stops matching and its
 * badge never appears.
 */
/**
 * Plain text of a cloned selection fragment minus UI chrome and overlay
 * readings: annotation badge numbers would bake into the quote ("Kyoto1
 * in two sentences") and ruby readings would bake in too ("漢かん字じ"
 * for 漢字). Only the base text is content.
 */
export function quoteFragmentText(frag: DocumentFragment): string {
	frag
		.querySelectorAll(
			"[data-ann-badge], rt, rp, .frt, .ccez-math-head, .ccez-code-head," +
				// Chrome buttons and folded labels are UI, not message
				// text (a spanning drag still includes them in the range
				// even where user-select keeps them out of the paint).
				" .ccez-math-tex, .ccez-math-copy, .ccez-math-foldedlabel, .ccez-code-foldedlabel," +
				// Folded-away bodies quote nothing: their text is hidden.
				' .ccez-math[data-folded="1"] .ccez-math-body,' +
				` .ccez-math[data-folded="1"] .ccez-math-raw, .ccez-code[data-folded="1"] pre`
		)
		.forEach((el) => el.remove());
	return frag.textContent?.trim() ?? "";
}
/**
 * Equation body holding a node, when the node sits inside rendered
 * math (`[data-math-index]`): display blocks wash/quote their
 * `.ccez-math-body`, inline math its whole wrapper. Null outside math.
 * KaTeX splits glyphs across spans, so a partial pick inside an
 * equation quotes a fragment that never re-matches (and washes a
 * shard): callers expand the live range over this element first, and
 * the re-stamp unwraps the stale fragment wash with every other mark.
 */
export function equationBodyOf(node: Node | null): Element | null {
	const element = node instanceof Element ? node : node?.parentElement;
	// Raw source view selects as plain text: the `$` toggle shows the
	// TeX in a pre of whole text nodes (no KaTeX glyph shards), so the
	// expansion must not fire — it would move the highlight onto the
	// hidden rendered body, deleting it and stranding the menu.
	if (element?.closest?.(".ccez-math-raw")) return null;
	const wrap = element?.closest?.("[data-math-index]");
	if (!(wrap instanceof Element)) return null;
	// A folded label pick is already whole: expanding it onto the
	// folded-away body (display:none) moves the paint where nothing
	// can show and strands the menu the same way as the raw view.
	if (wrap instanceof HTMLElement && wrap.dataset.folded === "1") return null;
	const body = wrap.querySelector(".ccez-math-body");
	return body instanceof Element ? body : wrap;
}

/**
 * Triple-click paragraph picks grab the block's terminator newline,
 * painting the line beneath the highlight (the quote trims it anyway,
 * so only the visual suffers). Drop it from the live range; every
 * other pick passes through untouched. Two shapes: the end sits past
 * newline text, or parked at the next block's start (a triple-click
 * lands its focus there — often on chrome like the `$` button) — the
 * latter pulls back to the last text with real content, skipping the
 * empty paragraphs and newline glue between blocks. Returns true when
 * the range moved. Never throws (selection APIs disagree across
 * engines; paint must survive).
 */
export function trimParagraphTerminator(range: Range): boolean {
	try {
		// Nothing serialized past the content, nothing to drop: picks
		// already stopping at text pass through untouched.
		if (!/(\r\n|\n|\r)$/.test(range.toString())) return false;
		const trimTextTail = (): boolean => {
			const node = range.endContainer;
			if (!(node instanceof Text)) return false;
			const text = node.textContent ?? "";
			const head = text.slice(0, Math.min(range.endOffset, text.length));
			const cut = head.replace(/(\r\n|\n|\r)+$/, "");
			if (cut.length === head.length) return false;
			// Never collapse into the start: a pick that is only a
			// newline keeps its shape (nothing meaningful to drop).
			const startEdge = range.startContainer === node ? range.startOffset : -1;
			if (cut.length <= startEdge) return false;
			range.setEnd(node, cut.length);
			return true;
		};
		if (trimTextTail()) return true;
		// End parked at an element boundary (a triple-click lands its
		// focus at the next block's start — often on chrome like the
		// `$` button): pull back to the last text with real content at
		// or before the end. Empty paragraphs and newline-only glue
		// the pipeline leaves between blocks quote nothing, so the
		// walk skips them instead of landing inside them (landing
		// there repaints the line beneath). An end mid-text with no
		// tail is already clean. Never climbs above the common
		// ancestor; never collapses into the start.
		const endNode = range.endContainer;
		if (endNode instanceof Text && range.endOffset > 0) return false;
		const stop = range.commonAncestorContainer;
		const origEnd = { node: range.endContainer, offset: range.endOffset };
		const walker = document.createTreeWalker(stop, NodeFilter.SHOW_TEXT);
		const texts: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (node instanceof Text) texts.push(node);
		}
		for (let i = texts.length - 1; i >= 0; i--) {
			const text = texts[i];
			if (!text) continue;
			const content = text.textContent ?? "";
			if (content === "" || /^[\r\n]+$/.test(content)) continue;
			// Outside the pick (past its end, or before its start) is
			// another gesture's text.
			if (!range.intersectsNode(text)) continue;
			range.setEnd(text, content.length);
			if (range.collapsed) {
				range.setEnd(origEnd.node, origEnd.offset);
				return false;
			}
			// That text may itself end with newlines: trim those too.
			trimTextTail();
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * Whole-equation range for the quote expansion, trimmed of blank edge
 * text: the markdown pipeline's trailing newline inside the body would
 * otherwise paint the line beneath a one-line equation on
 * double-click select. Null when the range can't build (engines
 * disagree; the caller keeps the partial pick).
 */
export function equationBodyRange(body: Element): Range | null {
	try {
		const range = document.createRange();
		range.selectNodeContents(body);
		const kids = [...body.childNodes];
		const first = kids.find(
			(kid) => !(kid instanceof Text && /^\s*$/.test(kid.textContent ?? ""))
		);
		const last = [...kids]
			.reverse()
			.find(
				(kid) => !(kid instanceof Text && /^\s*$/.test(kid.textContent ?? ""))
			);
		if (first) range.setStartBefore(first);
		if (last) range.setEndAfter(last);
		return range;
	} catch {
		return null;
	}
}

export function quoteTextNodes(root: Node): Text[] {
	const nodes: Text[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode;
		if (!(node instanceof Text)) continue;
		const parent = node.parentNode;
		// Badge buttons are UI chrome, and ruby readings are overlay:
		// neither is message text. A reading left in the haystack
		// mis-anchors badges (or wraps the reading itself and corrupts
		// the ruby), so both stay out. Math `$`/copy buttons are the
		// same kind of chrome (their `$` text is never quotable).
		if (
			parent instanceof Element &&
			parent.closest(
				"[data-ann-badge], rt, rp, .frt, .ccez-math-tex, .ccez-math-copy"
			)
		)
			continue;
		nodes.push(node);
	}
	return nodes;
}
/**
 * Numbered badge on the first occurrence of each quoted span, plus the
 * yellow wash on the one annotation whose comment box is open. Badges
 * float above-right of their quote on a positioned anchor (never inline,
 * so stamping moves no text and overlays ruby instead of shoving it).
 * Old marks unwrap first so re-renders never accumulate. Quotes that no
 * longer match (edited messages, cross-message selections) stay
 * listed in the review panel without a badge — never an error.
 */
/** Wash fade-out length in ms — mirrors the ann-wash-out keyframes. */
export const WASH_FADE_MS = 180;

/**
 * A live selection as plain character offsets within a root, so a
 * stamp's unwrap/re-wrap (which replaces every text node the range
 * points at) can put the highlight back where it was. Null unless a
 * non-collapsed selection sits fully inside the root — carets and
 * outside selections restore nothing.
 */
export interface SavedSelection {
	/** Anchor end (where the selection started), as a root offset. */
	start: number;
	/** Focus end (where it ended), as a root offset. */
	end: number;
	/** True when the anchor sits after the focus (right-to-left drag). */
	backwards: boolean;
}

/** Snapshot the live selection's endpoints as root-relative offsets. */
export function saveSelection(root: Node): SavedSelection | null {
	try {
		const sel = document.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
		const anchorNode = sel.anchorNode;
		const focusNode = sel.focusNode;
		if (
			!anchorNode ||
			!focusNode ||
			!root.contains(anchorNode) ||
			!root.contains(focusNode)
		) {
			return null;
		}
		const toOffset = (node: Node, offset: number): number => {
			const probe = document.createRange();
			probe.selectNodeContents(root);
			probe.setEnd(node, offset);
			return probe.toString().length;
		};
		const start = toOffset(anchorNode, sel.anchorOffset);
		const end = toOffset(focusNode, sel.focusOffset);
		return { start, end, backwards: start > end };
	} catch {
		return null;
	}
}

function nodeAtOffset(
	root: Node,
	target: number
): { node: Text; offset: number } | null {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let chars = 0;
	let last: Text | null = null;
	while (walker.nextNode()) {
		const text = walker.currentNode;
		if (!(text instanceof Text)) continue;
		last = text;
		const length = text.textContent?.length ?? 0;
		if (chars + length >= target)
			return { node: text, offset: Math.max(0, target - chars) };
		chars += length;
	}
	if (!last) return null;
	return { node: last, offset: last.textContent?.length ?? 0 };
}

/**
 * Put back a snapshot taken by saveSelection, unconditionally: the
 * only caller is the synchronous stamp (save, re-wrap, restore in one
 * task), where no user redraw can land between snapshot and restore —
 * so a disturbed highlight is always ours to fix. Never throws
 * (selection APIs disagree across engines; paint must survive).
 */
export function restoreSelection(root: Node, saved: SavedSelection): void {
	try {
		const sel = document.getSelection();
		if (!sel) return;
		const lo = nodeAtOffset(root, Math.min(saved.start, saved.end));
		const hi = nodeAtOffset(root, Math.max(saved.start, saved.end));
		if (!lo || !hi) return;
		const anchor = saved.backwards ? hi : lo;
		const focus = saved.backwards ? lo : hi;
		sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
	} catch {
		// Selection restore is cosmetic: never break the stamp.
	}
}

export function applyMarks(
	root: HTMLElement,
	items: AnnotationMark[],
	skip: boolean,
	wash: string | null
): void {
	// Unwrap/re-wrap replaces the text nodes a live selection points
	// at, collapsing it: snapshot first so hovering a badge can't eat
	// the highlight the menu is about to annotate.
	const saved = saveSelection(root);
	try {
		stampMarks(root, items, skip, wash);
	} finally {
		if (saved) restoreSelection(root, saved);
	}
}

/**
 * Stamp signature: badge placement AND answer paint depend on filed
 * items + skip — never the wash id, which flips below without moving
 * a node, and never preview (unsaved) items, which stamp no badge:
 * opening or cancelling a draft must ride the wash-only path or
 * every open/ESC re-splits Arabic text nodes mid-word (reshape
 * flicker). The answer rides along or a landed answer never repaints
 * its waiting badge.
 */
function stampSignature(items: AnnotationMark[], skip: boolean): string {
	return `${skip ? 1 : 0}|${items
		.filter((i) => i.preview !== true)
		.map(
			(i) =>
				`${i.id}:${i.number}:${i.quote}:${i.at ?? 0}:${i.aidScope ?? ""}:${i.answer ?? ""}`
		)
		.join(",")}`;
}

/**
 * Re-wrap a cleared wash so CSS can ramp it to transparent; unwrap
 * once the fade plays out. Runs in the same task as the unwrap, so
 * no unwashed frame ever paints. A superseding stamp unwraps these
 * early and the sweep no-ops (replaceWith on a detached node does
 * nothing).
 */
function wrapLeaving(
	root: HTMLElement,
	items: AnnotationMark[],
	fading: string
): void {
	const gone = items.find((item) => item.id === fading);
	if (!gone) return;
	const fnodes = quoteTextNodes(root);
	const floc = locateQuote(
		fnodes.map((node) => node.textContent ?? ""),
		gone.quote,
		gone.at ?? 0
	);
	if (!floc) return;
	wrapRange(fnodes, floc, "leaving");
	const doomed = [...root.querySelectorAll("mark.ccez-ann.leaving")];
	setTimeout(() => {
		// A live highlight owns the DOM under it: unwrapping now would
		// pull the range's nodes out from under the cursor (and no
		// post-hoc check can tell our disturbance from a redraw the
		// user started in the meantime), so leave the transparent mark
		// for the next stamp, which unwraps it under save/restore like
		// any other mark.
		const live = document.getSelection();
		if (live && live.rangeCount > 0 && !live.isCollapsed) return;
		for (const mark of doomed) {
			if (mark.classList.contains("leaving")) {
				mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
			}
		}
	}, WASH_FADE_MS);
}

/**
 * DOM ranges for the washed quote (cluster-snapped, never through a
 * cluster): the Highlight-API wash paints these over the untouched
 * DOM — no wrapping, no text-node splits, no shaping breaks.
 */
/** Reading overlays a wash must never cover: native ruby (rt/rp)
 * and overlay readings (.frt) are paint, never content. */
const WASH_READING_SELECTOR = "rt, rp, .frt";

/**
 * Split a wash range around reading overlays. The Highlight registry
 * paints every text node a range touches — endpoints alone can't
 * exclude the readings physically between two base runs, so hovering
 * a Japanese or Chinese quote double-highlights its furigana/pinyin.
 * Returns sub-ranges covering exactly the non-reading text (empty
 * when nothing quotable lies inside). Falls back to the input range
 * rather than breaking the paint. Never throws.
 */
export function rangesExcludingReadings(range: Range): Range[] {
	try {
		if (range.collapsed) return [];
		const doc = range.startContainer.ownerDocument ?? null;
		if (!doc) return [range];
		const scope =
			range.commonAncestorContainer instanceof Element
				? range.commonAncestorContainer
				: range.commonAncestorContainer.parentElement;
		if (!scope) return [range];
		// Contiguous kept segments merge back into one range: splitting
		// at every node boundary strands badge digits as their own
		// ranges and fabricates spaces when readers join them. Only a
		// genuinely skipped node (a reading, or a whitespace-only gap)
		// breaks the run.
		const out: Range[] = [];
		let pending: Array<{ node: Text; from: number; to: number }> = [];
		const flush = (): void => {
			if (pending.length === 0) return;
			const first = pending[0]!;
			const last = pending[pending.length - 1]!;
			try {
				const merged = doc.createRange();
				merged.setStart(first.node, first.from);
				merged.setEnd(last.node, last.to);
				if (!merged.collapsed) out.push(merged);
			} catch {
				// Detached mid-walk: drop the run, keep the rest.
			}
			pending = [];
		};
		const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (!(node instanceof Text)) continue;
			let inside = false;
			try {
				inside = range.intersectsNode(node);
			} catch {
				inside = false;
			}
			if (!inside) continue;
			if (node.parentElement?.closest(WASH_READING_SELECTOR) !== null) {
				flush();
				continue;
			}
			// Badge chrome (the digit inside an anchor) is not quote
			// text, but cutting around it strands the digit as its own
			// range: bridge it instead — the merged range spans the
			// button like readers already expect (digits strip out).
			if (node.parentElement?.closest("[data-ann-badge]") !== null) continue;
			const len = node.textContent?.length ?? 0;
			let from = 0;
			let to = len;
			if (node === range.startContainer) from = range.startOffset;
			if (node === range.endContainer) to = range.endOffset;
			from = Math.max(0, Math.min(from, len));
			to = Math.max(0, Math.min(to, len));
			if (to <= from) continue;
			// Whitespace-only runs (inter-block newlines) never paint:
			// the wash covers quotes, not paragraph gaps.
			if (!/\S/.test((node.textContent ?? "").slice(from, to))) {
				flush();
				continue;
			}
			pending.push({ node, from, to });
		}
		flush();
		return out;
	} catch {
		return [range];
	}
}

function washRanges(
	root: HTMLElement,
	items: AnnotationMark[],
	wash: string
): Range[] {
	const item = items.find((i) => i.id === wash);
	if (!item) return [];
	return washRangesForText(
		quoteTextNodes(root),
		item.quote,
		item.at ?? 0,
		root.ownerDocument
	);
}
/** Wash ranges for a located quote under a root: the shared core of
 * washRanges above and the post-surgery repaint below. Pure DOM
 * reads, never throws. */
function washRangesForText(
	nodes: Text[],
	quote: string,
	at: number,
	doc: Document
): Range[] {
	const loc = locateQuote(
		nodes.map((n) => n.textContent ?? ""),
		quote,
		at
	);
	if (!loc) return [];
	try {
		const startNode = nodes[loc.startNode];
		const endNode = nodes[loc.endNode];
		if (!startNode || !endNode) return [];
		const startText = startNode.textContent ?? "";
		const endText = endNode.textContent ?? "";
		const range = doc.createRange();
		range.setStart(
			startNode,
			expandWrapStart(startText, Math.min(loc.startOffset, startText.length))
		);
		range.setEnd(
			endNode,
			expandWrapEnd(endText, Math.min(loc.endOffset, endText.length))
		);
		if (range.collapsed) return [];
		// One range spans every reading physically between the base
		// runs — split them out so the registry never paints overlay
		// text (readings stay gray while the base washes yellow).
		return rangesExcludingReadings(range);
	} catch {
		return [];
	}
}

/**
 * Wash id last painted into the shared registry, across all bodies: a
 * single wash id feeds every message, so one body's paint supersedes
 * every other's. A body clears only the wash it painted (see
 * paintWashHighlight) — without this, a body holding a stale painted
 * flag wipes a wash another body just painted, and cross-message
 * badge slides leave every quote dark.
 */
let liveWashId: string | null = null;
/** Location of the live wash paint: DOM surgery outside the stamp
 * (furigana tint wraps) yanks quoted text nodes out from under the
 * registered ranges — a removed endpoint collapses to its parent
 * and the paint goes blank — so the repair repaint below re-locates
 * from here. Set on every paint, valid only while liveWashId still
 * names the same wash. */
let liveWashPaint: {
	id: string;
	root: HTMLElement;
	quote: string;
	at: number;
} | null = null;
/** Record the live paint's location (same sites that own liveWashId). */
function noteLiveWash(
	root: HTMLElement,
	items: AnnotationMark[],
	wash: string
): void {
	const item = items.find((i) => i.id === wash);
	if (!item) return;
	liveWashPaint = { id: wash, root, quote: item.quote, at: item.at ?? 0 };
}
/**
 * Re-paint the live wash after external DOM surgery moved its quote
 * text (furigana tint wraps/unwraps): re-locates the recorded quote
 * under its root and replaces the registry ranges. Repairs instead
 * of replacing — a dead or foreign wash never conjures paint, and
 * an unresolvable quote keeps the dead ranges rather than painting
 * a wrong one. Cosmetic: never throws.
 */
export function repaintLiveWash(): void {
	try {
		const cur = liveWashPaint;
		if (!cur || liveWashId !== cur.id) return;
		if (!highlightsSupported()) return;
		if (!document.contains(cur.root)) return;
		const ranges = washRangesForText(
			quoteTextNodes(cur.root),
			cur.quote,
			cur.at,
			cur.root.ownerDocument
		);
		if (ranges.length === 0) return;
		paintAnnotationWash(ranges);
		invalidateWashPaint(cur.root);
	} catch {
		// The dead wash stays dead; the next stamp repaints anyway.
	}
}

/** Step interval for the wash fade ramp. The fade-in walks quick
(~105ms, same beat as the fade-out): hovering a marker must read
at once, and the old blink-over-blink rationale is gone with the
in-flight pulse. The fade-out stays quick (~140ms) so a leaving
pointer never trails paint. */
const WASH_FADE_IN_STEP_MS = 35;
const WASH_FADE_STEP_MS = 35;
/**
 * The one in-flight ramp, if any (a single wash id feeds every
 * body), tracked with its owning root: a preempting paint must
 * repaint the owner it displaces. Without this, a badge-to-badge
 * slide murders the old body's out-ramp mid-flight — its terminal
 * repaint never fires and the shell keeps the first wash's pixels
 * stuck under the second wash.
 */
let washRamp: {
	timer: ReturnType<typeof setTimeout>;
	root: HTMLElement;
	wash: string;
} | null = null;
/**
 * Drop the in-flight ramp. When another root preempts it, repaint
 * the displaced owner: its overlay would otherwise keep pixels the
 * registry no longer owns. Same-root restarts skip the nudge —
 * that root repaints through its own ops below.
 */
function cancelWashRamp(root?: HTMLElement): void {
	if (washRamp !== null) {
		clearTimeout(washRamp.timer);
		if (root !== undefined && washRamp.root !== root)
			invalidateWashPaint(washRamp.root);
		washRamp = null;
	}
}
/** Reduced-motion (or no matchMedia at all, e.g. tests) snaps instead of ramping. */
function washSnaps(): boolean {
	try {
		if (typeof matchMedia !== "function") return true;
		return matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return true;
	}
}
/**
 * Force a genuine repaint of a highlight-hosting message root after
 * a terminal clear. Shared by the wash ramp and the jump flash (both
 * delete registry names the shell may not repaint on its own).
 * Deleting registry names does not always invalidate the highlight
 * overlay paint in the shell (pixels stick until the next incidental
 * repaint: select, blur, tab-switch) — and a read-only flush
 * (`void root.offsetWidth`) dirties nothing, so the engine skips that
 * too. Toggle a visually identical property for exactly one frame:
 * the style mutation schedules real paint work (overlay included) and
 * the restore lands after that paint. Wash-clear paths only — never
 * on paint. Never throws.
 */
export function invalidateWashPaint(root: HTMLElement): void {
	try {
		root.style.setProperty("opacity", "0.999");
		void root.offsetWidth;
		const restore = (): void => {
			try {
				root.style.removeProperty("opacity");
				void root.offsetWidth;
			} catch {
				// Cosmetic: the 0.999 frame is invisible either way.
			}
		};
		if (typeof requestAnimationFrame === "function")
			requestAnimationFrame(restore);
		else setTimeout(restore, 16);
	} catch {
		// Clearing is cosmetic: never break the stamp.
	}
}

/**
 * Paint the wash through the Highlight API: ranges over the untouched
 * DOM — hovering a badge or opening a draft moves zero DOM nodes, so
 * markers never flicker and shaping never breaks. The fade walks
 * the graded registry names (D3 → D1 → live in, D1 → D2 → D3 →
 * clear out) because the pseudo itself can't transition; the
 * DOM-mark fallback below keeps its own keyframed fades.
 */
function paintWashHighlight(
	root: HTMLElement,
	items: AnnotationMark[],
	skip: boolean,
	wash: string | null
): void {
	root.dataset.washStamped = wash ?? "";
	// One wash shows at a time (a single wash id feeds every body):
	// a fresh paint owns the registry, so it drops any mid-ramp fade
	// first — otherwise the stale fade's last step wipes the new wash.
	if (!skip && wash) {
		const ranges = washRanges(root, items, wash);
		if (ranges.length > 0) {
			// Same wash, no ramp in flight: a refresh, not a
			// transition — snap the (possibly relocated) ranges live
			// with no ramp. Ramping here is the streaming flicker:
			// every token re-stamps, so the fade never settles and
			// hover catches it dim. Identical endpoints skip the
			// registry entirely.
			if (wash === liveWashId && washRamp === null) {
				// Sweep orphaned fade grades: a preempted ramp leaves
				// its dims registered (only its timer dies), and the
				// re-set below never touches them — the stale grade
				// twins the live wash as a dim offset band until
				// something else clears it. No ramp is in flight here,
				// so no live fade can own these names.
				clearAnnotationWash(ANN_HIGHLIGHT_D1);
				clearAnnotationWash(ANN_HIGHLIGHT_D2);
				clearAnnotationWash(ANN_HIGHLIGHT_D3);
				if (!sameWashRanges(ranges, liveWashRanges())) {
					// No clear first: Highlight.set replaces the named
					// ranges atomically, while a delete-then-set in one
					// task blinks off/on in engines that process the
					// registry writes separately (commit-save flicker).
					paintAnnotationWash(ranges);
				}
				root.dataset.washStamped = wash;
				root.dataset.washPainted = wash;
				noteLiveWash(root, items, wash);
				return;
			}
			cancelWashRamp(root);
			clearAnnotationWashes();
			root.dataset.washPainted = wash;
			liveWashId = wash;
			noteLiveWash(root, items, wash);
			if (washSnaps()) {
				paintAnnotationWash(ranges);
				// Same-body slides land here too: the clear above
				// drops the old id's ranges, which this paint never
				// repaints — force the whole root so no ghost survives.
				invalidateWashPaint(root);
			} else {
				// First grade lands now (no extra lag), the rest walk in.
				// Every step re-locates: a mid-ramp re-stamp (streaming
				// tokens) detaches the captured ranges, and repainting
				// dead ranges would blink nothing.
				const schedule = washRampSchedule("in");
				paintAnnotationWash(ranges, schedule[0]!);
				// The clear above drops the old id's ranges, which this
				// paint never repaints — force the whole root so a
				// same-body slide leaves no ghost of the old wash.
				invalidateWashPaint(root);
				// One grade on screen at a time: stacked twins overlap
				// each other and read as a stuck dim copy that blinks on
				// the next paint — each step drops the grade it replaces.
				let prev = schedule[0]!;
				let step = 1;
				const tick = (): void => {
					washRamp = {
						timer: setTimeout(() => {
							washRamp = null;
							// Re-hovered or cleared mid-step: the fresh paint owns it now.
							if (liveWashId !== wash) return;
							const fresh = washRanges(root, items, wash);
							if (fresh.length === 0) {
								liveWashId = null;
								clearAnnotationWashes();
								invalidateWashPaint(root);
								return;
							}
							const name = schedule[step++]!;
							paintAnnotationWash(fresh, name);
							if (prev !== name) clearAnnotationWash(prev);
							// Force every step to display: the shell
							// overlay repaints only on forced frames, so
							// un-nudged steps surface late and partial —
							// bottom-up bands, never a fade.
							invalidateWashPaint(root);
							prev = name;
							if (step < schedule.length) tick();
							else {
								// Settled on live: drop the twins so only the live
								// name holds ranges (a leftover twin reads as a
								// stuck wash and blinks on the next paint), then
								// force the repaint: registry deletes alone don't
								// invalidate the shell overlay, so a stale twin
								// sliver would stick above the wash until the next
								// incidental repaint (scroll, hover, selection).
								clearAnnotationWash(ANN_HIGHLIGHT_D3);
								clearAnnotationWash(ANN_HIGHLIGHT_D1);
								invalidateWashPaint(root);
							}
						}, WASH_FADE_IN_STEP_MS),
						root,
						wash
					};
				};
				tick();
			}
			return;
		}
	}
	// Nothing to show here: clear only while the registry still holds
	// the wash this body painted. A superseding paint (another body's
	// hover, a jump flash) already replaced it — clearing now would
	// wipe someone else's live wash.
	const painted = root.dataset.washPainted || null;
	root.dataset.washPainted = "";
	if (painted !== null && painted === liveWashId) {
		cancelWashRamp(root);
		// Terminal clears wipe every graded name: the ramp may have left
		// dim/faint twins behind, and an orphaned twin reads as a stuck
		// wash that blinks on the next paint.
		if (washSnaps()) {
			liveWashId = null;
			clearAnnotationWashes();
			invalidateWashPaint(root);
		} else {
			// Live is already on screen — step dim → faint → clear.
			// Every step re-locates (see the fade-in walker above).
			const ranges = washRanges(root, items, painted);
			if (ranges.length === 0) {
				liveWashId = null;
				clearAnnotationWashes();
				invalidateWashPaint(root);
			} else {
				// Each step paints its grade BEFORE dropping the
				// previous one: the registry never sits empty mid-fade
				// (an empty frame reads as a blink), and paint+clear
				// land in one task so no two grades visibly stack.
				let prev: string | null = ANN_HIGHLIGHT_NAME;
				const schedule = washRampSchedule("out");
				let step = 0;
				const tick = (): void => {
					washRamp = {
						timer: setTimeout(() => {
							washRamp = null;
							// A superseding paint already replaced it — stopping
							// now never wipes the live wash.
							if (liveWashId !== painted) return;
							const name = schedule[step++]!;
							if (name === null) {
								liveWashId = null;
								clearAnnotationWashes();
								invalidateWashPaint(root);
							} else {
								const fresh = washRanges(root, items, painted);
								if (fresh.length === 0) {
									liveWashId = null;
									clearAnnotationWashes();
									invalidateWashPaint(root);
								} else {
									paintAnnotationWash(fresh, name);
									if (prev !== null) clearAnnotationWash(prev);
									// Same forced display as the fade-in
									// walker above: un-nudged steps band.
									invalidateWashPaint(root);
									prev = name;
									tick();
								}
							}
						}, WASH_FADE_STEP_MS),
						root,
						wash: painted
					};
				};
				tick();
			}
		}
	}
}

/**
 * Badge + anchor re-stamp (placement depends on items + skip): unwrap
 * everything, relocate on clean text, reuse live button nodes. Runs
 * only when the badge set changed — wash-only changes never reach
 * here, so hovering can no longer drop every marker's :hover
 * mid-flight and flicker the row.
 */
/**
 * Mirror the badge for right-to-left quotes: the tail leans down-left
 * toward the quote in LTR, so RTL quotes get the mirrored geometry
 * (badge past the visual quote end, tail pointing back at it).
 * Resolved from the quote's first strong character first, else the
 * nearest explicit dir, else the computed direction (dir=auto
 * paragraphs resolve per content). Toggle, never add-only, so
 * reused buttons unmirror. Never throws.
 */
function mirrorBadgeForDirection(
	badge: HTMLButtonElement,
	anchor: HTMLElement,
	quote?: string
): void {
	if (quote !== undefined) {
		const directed = quoteDirection(quote);
		if (directed !== null) {
			badge.classList.toggle("rtl", directed === "rtl");
			return;
		}
	}
	let rtl = false;
	try {
		const explicit = anchor.closest("[dir]")?.getAttribute("dir");
		if (explicit === "rtl") rtl = true;
		else if (explicit !== "ltr")
			rtl = getComputedStyle(anchor).direction === "rtl";
	} catch {
		rtl = false;
	}
	badge.classList.toggle("rtl", rtl);
}
/**
 * Badge classes on stamp: the answer state first (the className
 * overwrite), then the transient marks. `fresh` only for new mounts
 * — re-stamps must not replay the mount fade. `arrived` only for a
 * settled badge flipping waiting-to-ready — the arrival glow's
 * single shot. The overwrite already clears it on any state change
 * (fresh mounts, re-asks), so while steady-ready it simply persists
 * in its finished state and never replays.
 */
function paintBadgeClasses(
	badge: HTMLButtonElement,
	answer: "waiting" | "ready" | undefined,
	id: string,
	settled: Set<string>
): void {
	const wasWaiting = badge.classList.contains("ans-waiting");
	badge.className = `ccez-ann-badge${badgeAnswerClass(answer)}`;
	if (!settled.has(id)) badge.classList.add("fresh");
	else badge.classList.remove("fresh");
	if (
		wasWaiting &&
		settled.has(id) &&
		badge.classList.contains("ans-ready")
	) {
		badge.classList.add("arrived");
	}
}

function stampBadges(
	root: HTMLElement,
	items: AnnotationMark[],
	skip: boolean
): void {
	// Ids already on screen: re-stamping them (every render unwraps and
	// re-locates) must not replay the mount fade — only new badges are fresh.
	const settled = new Set(
		[...root.querySelectorAll("[data-ann-badge]")].map((el) =>
			el instanceof HTMLElement ? (el.dataset.annBadge ?? "") : ""
		)
	);
	// Badge buttons keep their DOM nodes across re-stamps: rebuilding
	// them swaps which of two stacked badges sits under the cursor, and
	// the hover oscillates between them. Re-appending the same node to
	// the same anchor changes nothing hit-testable.
	const live = new Map<string, HTMLButtonElement>();
	for (const badge of root.querySelectorAll("[data-ann-badge]")) {
		if (badge instanceof HTMLButtonElement)
			live.set(badge.dataset.annBadge ?? "", badge);
		badge.remove();
	}
	// Wash marks unwrap first (badges are already out, so textContent
	// is safe), then anchors: re-renders never nest or accumulate.
	for (const mark of root.querySelectorAll("mark.ccez-ann")) {
		mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
	}
	// Badge anchors are unstyled inline spans: unwrap them with the
	// marks so re-renders never nest or accumulate them. (Wash marks
	// doubling as anchors are marks, unwrapped above.)
	for (const anchor of root.querySelectorAll("span.ccez-ann-anchor")) {
		anchor.replaceWith(document.createTextNode(anchor.textContent ?? ""));
	}
	// Wrapping splits text nodes and unwrapping never merges them back:
	// without this, every re-stamp fragments the text further and later
	// locates span (and count) fragments instead of quotes.
	root.normalize();
	if (skip || items.length === 0) return;
	for (const item of items) {
		// Preview (unsaved) annotations wash when open but stamp no
		// badge: badges appear on submit only.
		if (item.preview) continue;
		// Fresh snapshot per item: the previous anchor splits text
		// nodes, so earlier indices go stale — nested quotes (a
		// sentence and its parts) only locate on the current DOM.
		const nodes = quoteTextNodes(root);
		const loc = locateQuote(
			nodes.map((node) => node.textContent ?? ""),
			item.quote,
			item.at ?? 0
		);
		if (!loc) continue;
		const anchor = anchorSpan(nodes, loc);
		if (!anchor) continue;
		// Reuse the live button when one is already on screen: same
		// node, same anchor, same stacking — a hover can never catch
		// the swap mid-flight and oscillate.
		const badge = live.get(item.id) ?? document.createElement("button");
		badge.type = "button";
		paintBadgeClasses(badge, item.answer, item.id, settled);
		badge.dataset.annBadge = item.id;
		const face = badgeFace(item);
		badge.textContent = face.text;
		badge.title = face.title;
		mirrorBadgeForDirection(badge, anchor, item.quote);
		anchor.append(badge);
	}
}

/**
 * Legacy full stamp (engines without the Highlight API): unwrap
 * everything, wrap the wash first, then anchor badges onto the washed
 * DOM. Frozen semantics — jsdom pins this path, so it never changes
 * out from under the unit suite.
 */
function stampLegacy(
	root: HTMLElement,
	items: AnnotationMark[],
	skip: boolean,
	wash: string | null
): void {
	const sig = stampSignature(items, skip);
	const prevWash = root.dataset.washStamped || null;
	// Wash-only change (badge hover, draft click): the badge set is
	// already current, so flip only the wash's own marks. Badges,
	// anchors, and every other quote's nodes stay mounted: the full
	// rebuild below re-inserts anchor spans (splitting text nodes
	// mid-word), which reshapes Arabic on every hover crossing and
	// reads as flicker. The badge count guards a DOM swap under the
	// dataset flag (aid pin/unpin replaces the text): wiped badges
	// need the full path to re-stamp them.
	const wantBadges = skip ? 0 : items.filter((i) => !i.preview).length;
	const haveBadges = root.querySelectorAll("[data-ann-badge]").length;
	// Faces sync ahead of every branch (steady returns below): a
	// renumber rewrites badge text/titles in place, never nodes,
	// never marks — hovering a badge moves nothing at all.
	syncBadgeFaces(root, items);
	if (!skip && root.dataset.legacyStamped === sig && haveBadges === wantBadges) {
		// A steady re-stamp drops the one-shot fades (marks and
		// badges alike) and moves nothing at all.
		if (prevWash === wash) {
			for (const mark of root.querySelectorAll("mark.ccez-ann")) {
				if (mark instanceof HTMLElement) mark.classList.remove("fresh");
			}
			for (const badge of root.querySelectorAll("[data-ann-badge]")) {
				if (badge instanceof HTMLElement) badge.classList.remove("fresh");
			}
			return;
		}
		// Badges ride out and back in on their still-mounted anchors:
		// unwrapping a mark over a live button would bake the
		// button's digit into text and destroy it.
		const riders = new Map<string, { badge: HTMLButtonElement; anchor: Element }>();
		for (const badge of root.querySelectorAll("[data-ann-badge]")) {
			if (!(badge instanceof HTMLButtonElement)) continue;
			const anchor = badge.parentElement;
			if (!anchor) continue;
			riders.set(badge.dataset.annBadge ?? "", { badge, anchor });
			badge.remove();
		}
		for (const mark of root.querySelectorAll("mark.ccez-ann")) {
			mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
		}
		root.normalize();
		root.dataset.washStamped = wash ?? "";
		if (wash) {
			const nodes = quoteTextNodes(root);
			const texts = nodes.map((n) => n.textContent ?? "");
			for (const item of items) {
				if (item.id !== wash) continue;
				const loc = locateQuote(texts, item.quote, item.at ?? 0);
				if (!loc) continue;
				wrapRange(nodes, loc, "fresh");
			}
		} else if (prevWash) {
			wrapLeaving(root, items, prevWash);
		}
		for (const { badge, anchor } of riders.values()) {
			// Settled badges never replay the mount fade (the full
			// path strips fresh the same way; there are no new
			// badges on this path to fade in).
			badge.classList.remove("fresh");
			// Contained in this root, not connected to the document:
			// unit roots are detached, and nothing on this path
			// removes anchors anyway.
			if (root.contains(anchor)) anchor.append(badge);
		}
		return;
	}
	const settled = new Set(
		[...root.querySelectorAll("[data-ann-badge]")].map((el) =>
			el instanceof HTMLElement ? (el.dataset.annBadge ?? "") : ""
		)
	);
	const live = new Map<string, HTMLButtonElement>();
	for (const badge of root.querySelectorAll("[data-ann-badge]")) {
		if (badge instanceof HTMLButtonElement)
			live.set(badge.dataset.annBadge ?? "", badge);
		badge.remove();
	}
	// A cleared wash fades out: unwrap now (badges need clean text to
	// anchor beside, never inside, a mark), stamp badges normally, then
	// re-wrap the old range as leaving marks below.
	const fading = !skip && !wash && prevWash ? prevWash : null;
	for (const mark of root.querySelectorAll("mark.ccez-ann")) {
		mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
	}
	for (const anchor of root.querySelectorAll("span.ccez-ann-anchor")) {
		anchor.replaceWith(document.createTextNode(anchor.textContent ?? ""));
	}
	root.normalize();
	root.dataset.washStamped = wash ?? "";
	root.dataset.legacyStamped = sig;
	if (skip || items.length === 0) return;
	// A newly arrived wash fades in; a steady one re-mounts silently.
	const freshWash = !!wash && wash !== prevWash;
	for (const item of items) {
		// Fresh snapshot per item: the previous wrap splits text nodes,
		// so earlier indices go stale — nested quotes (a sentence and
		// its parts) only locate on the current DOM.
		const nodes = quoteTextNodes(root);
		const texts = nodes.map((n) => n.textContent ?? "");
		const loc = locateQuote(texts, item.quote, item.at ?? 0);
		if (!loc) continue;
		// Preview (unsaved) annotations wash when open but stamp no
		// badge: badges appear on submit only.
		const washed = item.id === wash;
		if (washed) wrapRange(nodes, loc, freshWash ? "fresh" : undefined);
		if (item.preview) continue;
		// Fresh snapshot: the wash wrap above split text nodes, so the
		// badge anchors on the current DOM (same quote, same corner —
		// hovering the wash on and off can never move it).
		const freshNodes = quoteTextNodes(root);
		const freshLoc = locateQuote(
			freshNodes.map((node) => node.textContent ?? ""),
			item.quote,
			item.at ?? 0
		);
		if (!freshLoc) continue;
		const anchor = anchorSpan(freshNodes, freshLoc);
		if (!anchor) continue;
		const badge = live.get(item.id) ?? document.createElement("button");
		badge.type = "button";
		paintBadgeClasses(badge, item.answer, item.id, settled);
		badge.dataset.annBadge = item.id;
		const face = badgeFace(item);
		badge.textContent = face.text;
		badge.title = face.title;
		mirrorBadgeForDirection(badge, anchor, item.quote);
		anchor.append(badge);
	}
	if (fading) wrapLeaving(root, items, fading);
}

/**
 * Full stamp driver: engines without the Highlight API take the frozen
 * legacy path; everywhere else badges re-stamp only when the badge set
 * changed (new/submitted/deleted annotation, fold/stream toggle, or an
 * html swap that wiped the DOM) while washes paint through the
 * registry — hovering a badge or opening a draft moves zero DOM nodes.
 */
/**
 * Reading markup under a wash (native ruby, overlay furigana): the
 * Highlight registry does not paint there in the app shell
 * (verified on device: badges stamp, locate succeeds, yet no wash
 * ever shows), while DOM marks wrap base runs per text node in every
 * engine. Route those washes through the frozen legacy path; bare
 * text keeps the registry with its fades.
 */
function hasReadingMarkup(root: HTMLElement): boolean {
	return root.querySelector("ruby, rt, rp, .frt") !== null;
}
function stampMarks(
	root: HTMLElement,
	items: AnnotationMark[],
	skip: boolean,
	wash: string | null
): void {
	// DOM marks still mounted (a legacy wash or its leaving fade)
	// unwind through the legacy path even when the new items route
	// to the registry: cancelling an Arabic draft with zero filed
	// items would otherwise strand its fresh mark — the registry
	// path skips stampBadges when badges are current, and the
	// registry never touches DOM marks. The unwind removes them,
	// so the next stamp routes normally. (A dataset flag can't say
	// this: the registry path records its own wash id in
	// washStamped too.)
	const legacyMarksMounted = root.querySelector("mark.ccez-ann") !== null;
	if (
		!highlightsSupported() ||
		hasReadingMarkup(root) ||
		items.some((i) => hasRtlQuote(i.quote)) ||
		legacyMarksMounted
	) {
		// Leaving the registry path: drop a wash this body painted, or
		// its pixels ghost under the marks (same stuck overlay behind
		// every terminal clear). Another body's live wash is untouched.
		const painted = root.dataset.washPainted || null;
		if (painted !== null && painted === liveWashId) {
			cancelWashRamp(root);
			liveWashId = null;
			clearAnnotationWashes();
			invalidateWashPaint(root);
		}
		root.dataset.washPainted = "";
		stampLegacy(root, items, skip, wash);
		return;
	}
	const sig = stampSignature(items, skip);
	const wantBadges = skip ? 0 : items.filter((i) => !i.preview).length;
	const badgesCurrent =
		root.dataset.marksStamped === sig &&
		root.querySelectorAll("[data-ann-badge]").length === wantBadges;
	if (!badgesCurrent) {
		root.dataset.marksStamped = sig;
		stampBadges(root, items, skip);
	} else {
		// Badges current but faces may have flipped (pin/arm): sync
		// text/titles in place, same no-node rule as legacy.
		syncBadgeFaces(root, items);
	}
	paintWashHighlight(root, items, skip, wash);
}

/**
 * Lock a live selection to the message holding its anchor: dragging
 * into another message pulls the focus end back to the anchor message's
 * edge instead of selecting across messages. A focus outside the
 * anchor's prose trims the same way — double-clicking blank space
 * past a line's end otherwise stretches the range into the prompt
 * editor, and the action row caught inside reads back as a phantom
 * quote whose menu lands under the cursor and eats the next click.
 * The walk stays inside the anchor's rendered prose, never the whole
 * article: the action row's text labels (aid names) must not become
 * quote text. Returns true when trimmed. Never throws (selection
 * APIs disagree across engines).
 */
export function lockSelectionToMessage(
	selection: Selection,
	messageOf: (node: Node | null) => Element | null
): boolean {
	try {
		if (selection.isCollapsed || selection.rangeCount === 0) return false;
		const anchorNode = selection.anchorNode;
		const focusNode = selection.focusNode;
		if (!anchorNode || !focusNode) return false;
		const anchorEl = messageOf(anchorNode);
		if (!anchorEl) return false;
		if (messageOf(focusNode) === anchorEl) return false;
		const anchorOffset = selection.anchorOffset;
		// Prose scope, not the article: trimming to the article's end
		// would pin the focus past the action row, baking its button
		// labels into the quote. Outside rendered prose (or tests with
		// bare articles), the article itself stays the scope.
		const prose = (
			anchorNode instanceof Element ? anchorNode : anchorNode.parentElement
		)?.closest(".rendered");
		const walker = document.createTreeWalker(
			prose ?? anchorEl,
			NodeFilter.SHOW_TEXT
		);
		const texts: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (node instanceof Text && node.textContent) texts.push(node);
		}
		if (texts.length === 0) return false;
		// Sort by the focus node itself, not its message: a focus
		// outside every message still sits before or after the anchor.
		const order = anchorEl.compareDocumentPosition(focusNode);
		if (order & Node.DOCUMENT_POSITION_FOLLOWING) {
			// Focus ran past the anchor message's end (a later message
			// or the prompt below): pin it to the anchor message's
			// last text.
			const last = texts[texts.length - 1];
			if (!last) return false;
			selection.setBaseAndExtent(anchorNode, anchorOffset, last, last.length);
		} else {
			// Focus ran up past the anchor message's start: pin it to
			// the anchor message's first text.
			const first = texts[0];
			if (!first) return false;
			selection.setBaseAndExtent(anchorNode, anchorOffset, first, 0);
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Positioned anchor for a badge at its quote's middle: the middle
 * character wrapped in an unstyled span (reused when it already has
 * one, so duplicate quotes keep badge order). Middle placement keeps
 * the badge over what it annotates on long wrapped quotes, where an
 * end anchor can sit lines away from the start. Wash marks never double
 * as anchors — the badge corner stays identical whether the wash is on
 * or off. The badge floats above-right of the anchor in CSS — no text
 * ever moves.
 */
function anchorSpan(nodes: Text[], loc: QuoteLocation): HTMLElement | null {
	// Flat characters of the quote across (possibly several) text nodes.
	const chars: Array<{ node: Text; at: number; ch: string }> = [];
	for (let i = loc.startNode; i <= loc.endNode; i++) {
		const node = nodes[i];
		if (!node) continue;
		const text = node.textContent ?? "";
		const from = i === loc.startNode ? loc.startOffset : 0;
		const to =
			i === loc.endNode ? Math.min(loc.endOffset, text.length) : text.length;
		for (let at = from; at < to; at++)
			chars.push({ node, at, ch: text[at] ?? "" });
	}
	if (chars.length === 0) return null;
	// Gap parking: the anchor is an empty span at the word gap nearest
	// the quote's middle — never around a letter. Text inside the box
	// paints one highlight fragment short (the seam), so no text may
	// live in it; both fence edges land on word boundaries, so
	// double-clicks keep selecting whole words. Combining marks and
	// surrogate halves never border the gap (a base letter split from
	// its tashkeel, or a split pair, breaks shaping while mounted).
	// Spaceless scripts (CJK) have no word gaps: they fall back to
	// punctuation-adjacent boundaries, then the quote's own edge —
	// only a degenerate quote with no clean edge keeps the legacy
	// mid-character wrap below.
	const flat = chars.map((c) => c.ch).join("");
	const gap = gapOffsetForAnchor(flat) ?? edgeOffsetForAnchor(flat);
	if (gap !== null) {
		try {
			const anchor = document.createElement("span");
			anchor.className = "ccez-ann-anchor";
			let node: Text;
			let offset: number;
			if (gap === 0) {
				node = chars[0]!.node;
				offset = chars[0]!.at;
			} else if (gap >= chars.length) {
				const last = chars[chars.length - 1]!;
				node = last.node;
				offset = last.at + 1;
			} else {
				node = chars[gap]!.node;
				offset = chars[gap]!.at;
			}
			const range = document.createRange();
			range.setStart(node, splitSafeOffset(node.textContent ?? "", offset));
			range.collapse(true);
			range.insertNode(anchor);
			return anchor;
		} catch {
			return null;
		}
	}
	// Legacy mid-character wrap (degenerate quotes with no clean
	// edge): nearest non-space character to the middle keeps the
	// badge over long wrapped quotes.
	const mid = Math.floor(chars.length / 2);
	let pick: { node: Text; at: number } | null = null;
	for (let d = 0; d < chars.length && !pick; d++) {
		for (const i of [mid + d, mid - d]) {
			const c = chars[i];
			if (c && c.ch.trim() !== "") {
				pick = c;
				break;
			}
		}
	}
	if (!pick) return null;
	const parent = pick.node.parentElement;
	if (
		parent instanceof Element &&
		parent.classList.contains("ccez-ann-anchor")
	) {
		return parent;
	}
	try {
		// The whole grapheme cluster, never one unit: wrapping a base
		// letter apart from its tashkeel (or a surrogate pair apart)
		// breaks joining/shaping while mounted, and the split survives
		// the rebuild as words shifted across lines.
		const nodeText = pick.node.textContent ?? "";
		const bounds = clusterBounds(
			nodeText,
			Math.min(pick.at, Math.max(0, nodeText.length - 1))
		);
		const from = Math.min(bounds.start, pick.at);
		const to = Math.max(bounds.end, pick.at + 1);
		if (to <= from) return null;
		const range = document.createRange();
		range.setStart(pick.node, from);
		range.setEnd(pick.node, to);
		const anchor = document.createElement("span");
		anchor.className = "ccez-ann-anchor";
		range.surroundContents(anchor);
		return anchor;
	} catch {
		return null;
	}
}

/**
 * Wrap every text-node part of a located quote in its own highlight
 * (sub-ranges stay inside single text nodes, so splitting is safe).
 * Returns the last mark for badge placement. Out-of-range offsets
 * (stale indices, partial overlaps) skip instead of throwing.
 * Whitespace-only slices skip too: a multi-paragraph quote spans the
 * formatting text between block elements, and wrapping that gap in a
 * mark paints the paragraph break (and grows the message while the
 * wash is on, flying the badge to a new line).
 */
function wrapRange(
	nodes: Text[],
	loc: QuoteLocation,
	extraClass?: string
): HTMLElement | null {
	let last: HTMLElement | null = null;
	for (let i = loc.startNode; i <= loc.endNode; i++) {
		const node = nodes[i];
		if (!node) continue;
		const text = node.textContent ?? "";
		const length = text.length;
		// Stale indices (a superseded stamp's range) skip, as before.
		if (i === loc.endNode && loc.endOffset > length) continue;
		// Cluster edges, never through a cluster: a quote ending on a
		// bare base letter must still wrap its tashkeel, or the wash
		// cuts the cluster and shaping breaks until the rebuild.
		const from =
			i === loc.startNode ? expandWrapStart(text, loc.startOffset) : 0;
		const to = i === loc.endNode ? expandWrapEnd(text, loc.endOffset) : length;
		if (from >= to) continue;
		if (!/\S/.test(text.slice(from, to))) continue;
		try {
			const range = document.createRange();
			range.setStart(node, from);
			range.setEnd(node, to);
			const highlight = document.createElement("mark");
			highlight.className = extraClass ? `ccez-ann ${extraClass}` : "ccez-ann";
			range.surroundContents(highlight);
			last = highlight;
		} catch {
			continue;
		}
	}
	return last;
}
/**
 * Text node adjacent to `node` across badge-anchor chrome only: a
 * legacy anchor wraps one mid-word character (plus its button), so a
 * double-click pick stops at the anchor's node edge while the word
 * runs through it. This steps over the anchor (never into its
 * button) to the quotable text on the other side. Gap-parked anchors
 * hold no text, so the walk finds no quotable child and treats them
 * as walls — correct, since they sit on word boundaries the native
 * pick already honors. Every other element boundary — marks, blocks,
 * readings — stays a wall, as before. Null when no quotable neighbor
 * lies that way, or when `node` itself lives inside button/reading
 * chrome. Never throws.
 */
function anchorNeighborText(node: Text, dir: 1 | -1): Text | null {
	try {
		if (node.parentElement?.closest("button[data-ann-badge], rt, rp, .frt"))
			return null;
		// Badge buttons are UI chrome, never quotable text: step past them.
		const pastButtons = (n: Node | null): Node | null => {
			while (n instanceof Element && n.hasAttribute("data-ann-badge")) {
				n = dir === 1 ? n.nextSibling : n.previousSibling;
			}
			return n;
		};
		// First quotable text child of an anchor span (its wrapped
		// character); null for any other element. Buttons inside are
		// skipped, anything else stops the walk.
		const anchorText = (n: Node | null): Text | null => {
			if (!(n instanceof Element) || n.localName !== "span") return null;
			if (!n.classList.contains("ccez-ann-anchor")) return null;
			const kids = dir === 1 ? [...n.childNodes] : [...n.childNodes].reverse();
			for (const kid of kids) {
				if (kid instanceof Text) return kid;
				if (!(kid instanceof Element) || !kid.hasAttribute("data-ann-badge"))
					return null;
			}
			return null;
		};
		if (dir === 1) {
			let sib = pastButtons(node.nextSibling);
			if (!sib) {
				// At the edge of an anchor-wrapped character: climb
				// out through the anchor, never through anything else.
				const parent = node.parentNode;
				if (!(parent instanceof Element)) return null;
				const inner = anchorText(parent);
				if (!inner || inner !== node) return null;
				sib = pastButtons(parent.nextSibling);
				if (!sib) return null;
			}
			if (sib instanceof Text) return sib;
			return anchorText(sib);
		}
		let sib = pastButtons(node.previousSibling);
		if (!sib) {
			const parent = node.parentNode;
			if (!(parent instanceof Element)) return null;
			const inner = anchorText(parent);
			if (!inner || inner !== node) return null;
			sib = pastButtons(parent.previousSibling);
			if (!sib) return null;
		}
		if (sib instanceof Text) return sib;
		return anchorText(sib);
	} catch {
		return null;
	}
}

/**
 * Expand a live selection to word edges (same rule as
 * snapOffsetsToWordEdges, applied per boundary text node so
 * multi-node selections snap too). Boundaries parked at a
 * badge-anchor split keep walking while the word continues through
 * the anchor, so a double-click beside a marker still picks the
 * whole word (the button's number never joins: traversal never
 * enters it). Preserves the drag direction. Returns true when the
 * range moved. Never throws (selection APIs disagree across
 * engines; paint must survive).
 */
export function snapSelectionToWordEdges(selection: Selection): boolean {
	try {
		if (!selection || selection.isCollapsed || selection.rangeCount === 0)
			return false;
		const range = selection.getRangeAt(0);
		const sc = range.startContainer;
		const ec = range.endContainer;
		const so0 = range.startOffset;
		const eo0 = range.endOffset;
		let scN: Node | null = sc;
		let ecN: Node | null = ec;
		let so = so0;
		let eo = eo0;
		if (scN instanceof Text) {
			const text = scN.textContent ?? "";
			let s = Math.max(0, Math.min(so, text.length));
			while (
				s > 0 &&
				isWordChar(text[s - 1] ?? "") &&
				isWordChar(text[s] ?? "")
			)
				s -= 1;
			so = s;
		}
		if (ecN instanceof Text) {
			const text = ecN.textContent ?? "";
			let e = Math.max(0, Math.min(eo, text.length));
			while (
				e < text.length &&
				isWordChar(text[e - 1] ?? "") &&
				isWordChar(text[e] ?? "")
			)
				e += 1;
			eo = e;
		}
		let guard = 0;
		while (
			guard++ < 8 &&
			scN instanceof Text &&
			so === 0 &&
			ecN instanceof Text &&
			so < (scN.textContent ?? "").length
		) {
			const prev = anchorNeighborText(scN, -1);
			if (!prev) break;
			const left = prev.textContent ?? "";
			const right = scN.textContent ?? "";
			if (
				!isWordChar(left[left.length - 1] ?? "") ||
				!isWordChar(right[0] ?? "")
			)
				break;
			scN = prev;
			let s = left.length;
			while (
				s > 0 &&
				isWordChar(left[s - 1] ?? "") &&
				isWordChar(s === left.length ? (right[0] ?? "") : (left[s] ?? ""))
			)
				s -= 1;
			so = s;
		}
		while (
			guard++ < 16 &&
			ecN instanceof Text &&
			eo === (ecN.textContent ?? "").length &&
			scN instanceof Text &&
			eo > 0
		) {
			const next = anchorNeighborText(ecN, 1);
			if (!next) break;
			const left = ecN.textContent ?? "";
			const right = next.textContent ?? "";
			if (
				!isWordChar(left[left.length - 1] ?? "") ||
				!isWordChar(right[0] ?? "")
			)
				break;
			ecN = next;
			let e = 0;
			while (
				e < right.length &&
				isWordChar(
					e === 0 ? (left[left.length - 1] ?? "") : (right[e - 1] ?? "")
				) &&
				isWordChar(right[e] ?? "")
			)
				e += 1;
			eo = e;
		}
		if (scN === sc && ecN === ec && so === so0 && eo === eo0) return false;
		const anchorFirst =
			selection.anchorNode === sc && selection.anchorOffset === so0;
		if (anchorFirst) selection.setBaseAndExtent(scN, so, ecN, eo);
		else selection.setBaseAndExtent(ecN, eo, scN, so);
		return true;
	} catch {
		return false;
	}
}
