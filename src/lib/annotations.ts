/**
 * Annotation: a quoted selection from a message plus an optional comment,
 * wrapped into the next query. Composer-scoped (like attachments): sending
 * bakes them into the message text. Unsent drafts persist per chat across
 * restarts (see load/saveDraftAnnotations); the baked blocks never do.
 */
import type { ChatMsgId } from "./chat";

/** Opaque annotation identifier (see ChatId/ChatMsgId in chat.ts). */
export type AnnotationId = string & { readonly kind: "annotation" };

export interface Annotation {
	id: AnnotationId;
	/** Message the selection came from (drives badge placement). */
	messageId: ChatMsgId;
	quote: string;
	comment: string;
	/**
	 * Which repeat of the quote was selected (0-based, default 0):
	 * annotating the last "c" in "ccc" stores 2, so the badge lands
	 * where the selection was instead of the first match. Memory-only
	 * (never baked into message text) — badges stamp from live
	 * annotations, cleared on send.
	 */
	at?: number;
}

export function newAnnotationId(): AnnotationId {
	return crypto.randomUUID() as AnnotationId;
}

export function addAnnotation(
	list: Annotation[],
	messageId: ChatMsgId,
	quote: string,
	comment = ""
): Annotation[] {
	const trimmed = quote.trim();
	if (!trimmed) return list;
	return [...list, { id: newAnnotationId(), messageId, quote: trimmed, comment }];
}

/**
 * Id of the saved annotation already quoting the same span of the same
 * message (same text, same repeat), if any: annotating it again would
 * stack two badges on one anchor, and hovering them oscillates as the
 * re-stamp swaps which badge sits under the cursor. Null when the
 * quote is blank or unquoted yet.
 */
export function duplicateAnnotationId(
	list: Annotation[],
	messageId: ChatMsgId,
	quote: string,
	at = 0
): AnnotationId | null {
	const trimmed = quote.trim();
	if (!trimmed) return null;
	const found = list.find(
		(a) => a.messageId === messageId && a.quote === trimmed && (a.at ?? 0) === at
	);
	return found ? found.id : null;
}

export function editAnnotationComment(
	list: Annotation[],
	id: string,
	comment: string
): Annotation[] {
	return list.map((a) => (a.id === id ? { ...a, comment } : a));
}

export function deleteAnnotation(list: Annotation[], id: string): Annotation[] {
	return list.filter((a) => a.id !== id);
}

export function clearAnnotations(): Annotation[] {
	return [];
}

/** 1-based badge number of an annotation within the composer list. */
export function annotationNumber(list: Annotation[], id: AnnotationId): number {
	return list.findIndex((a) => a.id === id) + 1;
}

/**
 * Single-character typographic folds so quotes match across markdown
 * reshaping (straight quotes typed by the user vs curly quotes rendered).
 * Same-length replacements keep node offsets aligned.
 */
const TYPO_FOLD: Record<string, string> = {
	"“": '"',
	"”": '"',
	"‘": "'",
	"’": "'",
	"–": "-",
	"—": "-",
	"…": "."
};

function foldChar(ch: string): string {
	return TYPO_FOLD[ch] ?? ch;
}

/**
 * Arabic vocalization marks (tashkeel/harakat): FATHATAN..SUKUN, superscript
 * ALEF, and the extended Arabic diacritic blocks. A quote taken while the
 * aid is pinned carries them; the bare body (or vice versa) does not.
 */
const TASHKEEL_RE =
	/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED]/;

/** Strip ALL whitespace for matching: selections and DOM text nodes routinely
 * disagree on newlines/indentation (full-paragraph and multi-line quotes).
 * Tashkeel strips too, so markers anchor to the base text and survive the
 * aid toggle either way (annotated vocalized, viewed bare, or the reverse).
 * Same-length typo folds keep node offsets aligned; stripped marks simply
 * map both sides onto the same base offsets. */
function stripForMatch(text: string): { stripped: string; offsets: number[] } {
	let stripped = "";
	const offsets: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = foldChar(text[i] ?? "");
		if (/\s/.test(ch) || TASHKEEL_RE.test(ch)) continue;
		offsets.push(i);
		stripped += ch;
	}
	return { stripped, offsets };
}

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
function clusterBounds(text: string, offset: number): { start: number; end: number } {
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
		if (LOW_SURROGATE_RE.test(ch) && HIGH_SURROGATE_RE.test(text[start - 2] ?? "")) {
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

export interface QuoteLocation {
	startNode: number;
	startOffset: number;
	endNode: number;
	/** Exclusive end offset within endNode. */
	endOffset: number;
}

/**
 * Locate a quote across rendered text nodes (pure: takes node texts, no DOM).
 * Whitespace-insensitive on both sides, so quotes spanning element
 * boundaries, block breaks, or reshaped punctuation still match. Returns null
 * when the quote isn't contained in these nodes (e.g. cross-message
 * selections stay review-only). `occurrence` picks among repeats: the
 * nth full, non-overlapping match (0-based). Annotating the last "c" in
 * "ccc" stores occurrence 2 at creation, so the badge lands where the
 * selection was instead of always the first "c". Missing occurrences
 * fall back to the first match — same as before.
 */
export function locateQuote(nodeTexts: string[], quote: string, occurrence = 0): QuoteLocation | null {
	const q = stripForMatch(quote);
	if (!q.stripped) return null;
	let hay = "";
	const map: { node: number; offset: number }[] = [];
	nodeTexts.forEach((text, node) => {
		const s = stripForMatch(text);
		for (let i = 0; i < s.stripped.length; i++) {
			const offset = s.offsets[i];
			const ch = s.stripped[i];
			if (offset === undefined || ch === undefined) continue;
			map.push({ node, offset });
			hay += ch;
		}
	});
	let at = -1;
	let from = 0;
	for (let seen = 0; seen <= occurrence; seen++) {
		at = hay.indexOf(q.stripped, from);
		if (at === -1) break;
		from = at + q.stripped.length;
	}
	if (at === -1) {
		// Asked past the end (edited text): first match, like before.
		at = hay.indexOf(q.stripped);
		if (at === -1) return null;
	}
	const first = map[at];
	const last = map[at + q.stripped.length - 1];
	if (!first || !last) return null;
	return {
		startNode: first.node,
		startOffset: first.offset,
		endNode: last.node,
		endOffset: last.offset + 1
	};
}

/**
 * DOM Range for a quote inside a rendered root (sent-annotation jumps):
 * same node collection and matching as badge stamping (badges, ruby,
 * and readings stay out via quoteTextNodes), but no DOM mutation — the
 * caller scrolls to the rect and flashes it via the Highlight API.
 * Null when the quote isn't in this root (folded, edited away).
 */
export function quoteRange(root: HTMLElement, quote: string, occurrence = 0): Range | null {
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
		range.setEnd(last, Math.max(to, from));
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
 * Owner of a baked quote: first message (not the sender — its baked
 * block quotes it too, so including it lands every jump on the sender)
 * whose content holds the quote, badge-matching rules included.
 * Null when the quote was edited away everywhere: the caller falls
 * back to the sending message.
 */
export function findQuotedMessage(
	messages: { id: ChatMsgId; content: string }[],
	senderId: ChatMsgId,
	quote: string
): ChatMsgId | null {
	const hit = messages.find((m) => m.id !== senderId && locateQuote([m.content], quote) !== null);
	return hit?.id ?? null;
}

/**
 * Which occurrence of a quote holds a node position: counts full,
 * non-overlapping occurrences of the stripped quote in the stripped
 * haystack and returns the index of the one containing the stripped
 * offset of (`nodeIndex`, `nodeOffset`). Positions between matches —
 * or anything unresolvable — return 0, the historical behavior.
 * Pure (strings in, index out) so it unit-tests without a DOM.
 */
export function occurrenceAtPosition(
	nodeTexts: string[],
	quote: string,
	nodeIndex: number,
	nodeOffset: number
): number {
	const q = stripForMatch(quote);
	if (!q.stripped) return 0;
	let hay = "";
	let pos = -1;
	nodeTexts.forEach((text, node) => {
		const s = stripForMatch(text);
		for (let i = 0; i < s.stripped.length; i++) {
			const offset = s.offsets[i];
			if (offset === undefined) continue;
			if (node === nodeIndex && offset >= nodeOffset && pos === -1) {
				pos = hay.length;
			}
			hay += s.stripped[i];
		}
		if (node === nodeIndex && pos === -1) {
			// Offset past the node's last kept char (end of text):
			// the position sits at whatever the haystack holds now.
			pos = hay.length;
		}
	});
	if (pos === -1) return 0;
	const starts: number[] = [];
	let from = 0;
	for (;;) {
		const at = hay.indexOf(q.stripped, from);
		if (at === -1) break;
		starts.push(at);
		from = at + q.stripped.length;
	}
	for (let i = 0; i < starts.length; i++) {
		const at = starts[i];
		if (at !== undefined && at <= pos && pos < at + q.stripped.length) return i;
	}
	return 0;
}

/** Badge to stamp onto a message's quoted span. */
export interface AnnotationMark {
	id: AnnotationId;
	number: number;
	quote: string;
	/** Repeat of the quote to stamp (see Annotation.at). */
	at?: number;
	/**
	 * Preview (unsaved) annotation: washes like a real mark when it is
	 * the open one, but stamps no badge — badges appear on submit only.
	 */
	preview?: boolean;
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
		const first = kids.find((kid) => !(kid instanceof Text && /^\s*$/.test(kid.textContent ?? "")));
		const last = [...kids]
			.reverse()
			.find((kid) => !(kid instanceof Text && /^\s*$/.test(kid.textContent ?? "")));
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
		// the ruby), so both stay out.
		if (parent instanceof Element && parent.closest("[data-ann-badge], rt, rp, .frt")) continue;
		nodes.push(node);
	}
	return nodes;
}

/**
 * Prompt badge count for the annotation tracker: the number, capped at
 * 99+ so the badge never stretches the prompt tools.
 */
export function annotationCountLabel(count: number): string {
	return count > 99 ? "99+" : String(count);
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
		if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
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

function nodeAtOffset(root: Node, target: number): { node: Text; offset: number } | null {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let chars = 0;
	let last: Text | null = null;
	while (walker.nextNode()) {
		const text = walker.currentNode;
		if (!(text instanceof Text)) continue;
		last = text;
		const length = text.textContent?.length ?? 0;
		if (chars + length >= target) return { node: text, offset: Math.max(0, target - chars) };
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

function stampMarks(root: HTMLElement, items: AnnotationMark[], skip: boolean, wash: string | null): void {
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
		if (badge instanceof HTMLButtonElement) live.set(badge.dataset.annBadge ?? "", badge);
		badge.remove();
	}
	// The wash whose marks are currently mounted ("" when none): a steady
	// wash re-stamps without replaying its fade-in, like settled badges.
	const prevWash = root.dataset.washStamped || null;
	// A cleared wash fades out: unwrap now (badges need clean text to
	// anchor beside, never inside, a mark), stamp badges normally, then
	// re-wrap the old range as leaving marks below.
	const fading = !skip && !wash && prevWash ? prevWash : null;
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
	// washes span (and count) fragments instead of quotes.
	root.normalize();
	root.dataset.washStamped = wash ?? "";
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
		// Reuse the live button when one is already on screen: same
		// node, same anchor, same stacking — a hover can never catch
		// the swap mid-flight and oscillate.
		const badge = live.get(item.id) ?? document.createElement("button");
		badge.type = "button";
		badge.className = "ccez-ann-badge";
		if (!settled.has(item.id)) badge.classList.add("fresh");
		else badge.classList.remove("fresh");
		badge.dataset.annBadge = item.id;
		badge.textContent = String(item.number);
		badge.title = "Open annotation";
		anchor.append(badge);
	}
	if (fading) {
		// Re-wrap the cleared wash so CSS can ramp it to transparent;
		// unwrap once the fade plays out. Runs in the same task as the
		// unwrap above, so no unwashed frame ever paints. A superseding
		// stamp unwraps these early and the sweep no-ops (replaceWith on
		// a detached node does nothing).
		const gone = items.find((item) => item.id === fading);
		if (gone) {
			const fnodes = quoteTextNodes(root);
			const floc = locateQuote(
				fnodes.map((node) => node.textContent ?? ""),
				gone.quote,
				gone.at ?? 0
			);
			if (floc) {
				wrapRange(fnodes, floc, "leaving");
				const doomed = [...root.querySelectorAll("mark.ccez-ann.leaving")];
				setTimeout(() => {
					// A live highlight owns the DOM under it: unwrapping
					// now would pull the range's nodes out from under the
					// cursor (and no post-hoc check can tell our disturbance
					// from a redraw the user started in the meantime), so
					// leave the transparent mark for the next stamp, which
					// unwraps it under save/restore like any other mark.
					const live = document.getSelection();
					if (live && live.rangeCount > 0 && !live.isCollapsed) return;
					for (const mark of doomed) {
						if (mark.classList.contains("leaving")) {
							mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
						}
					}
				}, WASH_FADE_MS);
			}
		}
	}
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
		const walker = document.createTreeWalker(prose ?? anchorEl, NodeFilter.SHOW_TEXT);
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
		const to = i === loc.endNode ? Math.min(loc.endOffset, text.length) : text.length;
		for (let at = from; at < to; at++) chars.push({ node, at, ch: text[at] ?? "" });
	}
	if (chars.length === 0) return null;
	// Nearest non-space character to the middle: middle placement keeps
	// the badge over long wrapped quotes, and skipping whitespace never
	// anchors the gap between two words.
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
	if (parent instanceof Element && parent.classList.contains("ccez-ann-anchor")) {
		return parent;
	}
	try {
		// The whole grapheme cluster, never one unit: wrapping a base
		// letter apart from its tashkeel (or a surrogate pair apart)
		// breaks joining/shaping while mounted, and the split survives
		// the rebuild as words shifted across lines.
		const nodeText = pick.node.textContent ?? "";
		const bounds = clusterBounds(nodeText, Math.min(pick.at, Math.max(0, nodeText.length - 1)));
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
function wrapRange(nodes: Text[], loc: QuoteLocation, extraClass?: string): HTMLElement | null {
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
		const from = i === loc.startNode ? expandWrapStart(text, loc.startOffset) : 0;
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
 * Render annotations for the prompt tail, matching the review-panel shape:
 * numbered quote plus comment.
 */
export function formatAnnotations(list: { quote: string; comment: string }[]): string {
	return list
		.map((a, i) => {
			const head = `${i + 1}. "${a.quote}"`;
			// Empty comments file as "?" so the model sees the confusion
			// instead of a bare quote that reads as settled context.
			return a.comment.trim() ? `${head} — ${a.comment.trim()}` : `${head} — ?`;
		})
		.join("\n");
}

/** Append the annotation block to outgoing prompt text. */
export function withAnnotations(prompt: string, list: { quote: string; comment: string }[]): string {
	if (list.length === 0) return prompt;
	const block = `Annotated selections:\n${formatAnnotations(list)}`;
	return prompt ? `${prompt}\n\n${block}` : block;
}

/**
 * Rewrite one baked ref's comment (the previous-menu pencil save):
 * parse the trailing block, swap ref n's comment, rebake. Null when
 * the content holds no clean block or n isn't in it — the caller
 * treats that as gone. Numbering re-sequences from the kept order,
 * so an unchanged comment rebakes byte-for-byte.
 */
export function rewriteAnnotationComment(content: string, n: number, comment: string): string | null {
	const split = splitAnnotationBlock(content);
	if (!split) return null;
	if (!split.refs.some((ref) => ref.n === n)) return null;
	return withAnnotations(
		split.text,
		split.refs.map((ref) => (ref.n === n ? { quote: ref.quote, comment } : ref))
	);
}

/**
 * Draft annotations persist per chat across restarts (live extras, not
 * the baked blocks — sending still bakes and clears). Shape-checked on
 * the way back in: corrupt entries drop, valid ones restore; quotes
 * that no longer match simply list without a badge, never an error.
 */
const DRAFT_KEY = "ccez-llm-annotations-v1";
/** Pre-rename key (ccez-studio era): read once, then saves move to DRAFT_KEY. */
const LEGACY_DRAFT_KEY = "ccez-studio-annotations-v1";

function cleanDraftList(raw: unknown): Annotation[] {
	if (!Array.isArray(raw)) return [];
	const out: Annotation[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const a = item as Partial<Annotation>;
		if (typeof a.id !== "string" || typeof a.messageId !== "string") continue;
		if (typeof a.quote !== "string" || typeof a.comment !== "string") continue;
		out.push({
			id: a.id,
			messageId: a.messageId,
			quote: a.quote,
			comment: a.comment,
			at: typeof a.at === "number" ? a.at : 0
		});
	}
	return out;
}

export function loadDraftAnnotations(chatId: string): Annotation[] {
	try {
		if (typeof localStorage === "undefined") return [];
		const raw = localStorage.getItem(DRAFT_KEY) ?? localStorage.getItem(LEGACY_DRAFT_KEY);
		if (!raw) return [];
		const record = JSON.parse(raw) as Record<string, unknown>;
		return cleanDraftList(record?.[chatId]);
	} catch {
		return [];
	}
}

export function saveDraftAnnotations(chatId: string, list: Annotation[], knownIds: string[]): void {
	try {
		if (typeof localStorage === "undefined") return;
		let record: Record<string, unknown> = {};
		try {
			record = (JSON.parse(localStorage.getItem(DRAFT_KEY) ?? localStorage.getItem(LEGACY_DRAFT_KEY) ?? "{}") as Record<string, unknown>) ?? {};
		} catch {
			record = {};
		}
		if (list.length === 0) delete record[chatId];
		else record[chatId] = list;
		for (const key of Object.keys(record)) if (!knownIds.includes(key)) delete record[key];
		localStorage.setItem(DRAFT_KEY, JSON.stringify(record));
	} catch {
		// Storage full or blocked: drafts stay memory-only.
	}
}

/** One baked annotation reference, as displayed under its message. */
export interface AnnotationRef {
	n: number;
	quote: string;
	comment: string;
}

/**
 * Split a sent message into display text plus its baked annotation
 * block (see withAnnotations). The chat renders the text with a count
 * pill instead of the full block; hovering the pill reveals these refs.
 * Returns null when no clean trailing block is present — the message
 * then renders untouched (including user-typed lookalikes).
 */
export function splitAnnotationBlock(
	content: string
): { text: string; refs: AnnotationRef[] } | null {
	const marker = "\n\nAnnotated selections:\n";
	const head = "Annotated selections:\n";
	const at = content.lastIndexOf(marker);
	let text: string;
	let body: string;
	if (at !== -1) {
		text = content.slice(0, at);
		body = content.slice(at + marker.length);
	} else if (content.startsWith(head)) {
		// Annotations-only message: no prompt text ahead of the block.
		text = "";
		body = content.slice(head.length);
	} else return null;
	const refs: AnnotationRef[] = [];
	const entry = /(\d+)\.\s+"([\s\S]*?)"(?:\s+—\s+([^\n]*))?(?=\n\d+\.\s+"|$)/g;
	let m: RegExpExecArray | null;
	let covered = 0;
	while ((m = entry.exec(body)) !== null) {
		covered = m.index + m[0].length;
		refs.push({
			n: Number(m[1] ?? 0),
			quote: m[2] ?? "",
			comment: (m[3] ?? "").trim()
		});
	}
	if (refs.length === 0) return null;
	// Trailing garbage means this isn't our block (or a comment broke
	// the shape): fall back to full text rather than half a list.
	if (body.slice(covered).trim() !== "") return null;
	return { text, refs };
}

/**
 * Baked annotation refs by exact message content, memoized: sent
 * messages render redacted (count pill instead of the full block), so
 * this runs per render and must never re-parse. Display-only — results
 * are never fed back into reactive effects.
 */
const refsCache = new Map<string, { text: string; refs: AnnotationRef[] } | null>();
export function annRefsFor(content: string): { text: string; refs: AnnotationRef[] } | null {
	if (!content.includes("Annotated selections:")) return null;
	const hit = refsCache.get(content);
	if (hit !== undefined) return hit;
	const split = splitAnnotationBlock(content);
	if (refsCache.size > 200) refsCache.clear();
	refsCache.set(content, split);
	return split;
}

/**
 * Body shown for a message holding ONLY a baked annotation block: an
 * em-dash at normal text size, with the annotation count UI above it.
 * The stored content stays the full block (provider context is
 * unaffected) — only the display collapses to this.
 */
export const REFS_ONLY_BODY = "—";

/**
 * Display-copy text for a message body: the baked annotation block is
 * metadata, never prose, so message copy redacts it. A refs-only body
 * holds nothing else — copying an empty string would strand the
 * button, so it falls back to the quotes themselves (the message's
 * only substance). Pure and unit-tested.
 */
export function redactedCopyText(body: string): string {
	const split = annRefsFor(body);
	if (!split) return body;
	if (split.text.trim()) return split.text;
	return split.refs.map((ref) => ref.quote).join("\n");
}

/** True when a baked block is the message's whole content (redact to REFS_ONLY_BODY). */
export function isRefsOnly(content: string): boolean {
	const split = annRefsFor(content);
	return split !== null && split.text.trim() === "";
}

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;
/**
 * Spaceless scripts have no words to pick: every character is a
 * letter (Lo), so snapping would glue whole sentences together.
 * The native pick already stands for these (see the Japanese
 * double-click specs) and stays untouched.
 */
const SPACELESS_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function isWordChar(ch: string): boolean {
	return WORD_CHAR_RE.test(ch) && !SPACELESS_RE.test(ch);
}

/**
 * Snap a [start, end) range to word edges so the create-annotation
 * marker never splits a word in half: a boundary cut inside a word
 * expands outward to that word's edge, while a boundary already on
 * an edge (or beside non-word text) stays put. Spaceless scripts
 * (CJK) have no word characters, so they never snap. Out-of-range
 * inputs clamp; reversed inputs normalize.
 */
export function snapOffsetsToWordEdges(
	text: string,
	start: number,
	end: number
): { start: number; end: number } {
	const len = text.length;
	let s = Math.max(0, Math.min(start, len));
	let e = Math.max(0, Math.min(end, len));
	if (s > e) [s, e] = [e, s];
	if (s < e) {
		while (s > 0 && isWordChar(text[s - 1] ?? "") && isWordChar(text[s] ?? "")) s -= 1;
		while (e < len && isWordChar(text[e - 1] ?? "") && isWordChar(text[e] ?? "")) e += 1;
	}
	return { start: s, end: e };
}

/**
 * Expand a live selection to word edges (same rule as
 * snapOffsetsToWordEdges, applied per boundary text node so
 * multi-node selections snap too). Preserves the drag direction.
 * Returns true when the range moved. Never throws (selection APIs
 * disagree across engines; paint must survive).
 */
export function snapSelectionToWordEdges(selection: Selection): boolean {
	try {
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
		const range = selection.getRangeAt(0);
		const sc = range.startContainer;
		const ec = range.endContainer;
		const so0 = range.startOffset;
		const eo0 = range.endOffset;
		let so = so0;
		let eo = eo0;
		if (sc instanceof Text) {
			const text = sc.textContent ?? "";
			let s = Math.max(0, Math.min(so, text.length));
			while (s > 0 && isWordChar(text[s - 1] ?? "") && isWordChar(text[s] ?? "")) s -= 1;
			so = s;
		}
		if (ec instanceof Text) {
			const text = ec.textContent ?? "";
			let e = Math.max(0, Math.min(eo, text.length));
			while (e < text.length && isWordChar(text[e - 1] ?? "") && isWordChar(text[e] ?? "")) e += 1;
			eo = e;
		}
		if (so === so0 && eo === eo0) return false;
		const anchorFirst = selection.anchorNode === sc && selection.anchorOffset === so0;
		if (anchorFirst) selection.setBaseAndExtent(sc, so, ec, eo);
		else selection.setBaseAndExtent(ec, eo, sc, so);
		return true;
	} catch {
		return false;
	}
}

/**
 * Horizontal placement for the create-annotation textbox: centered
 * over the highlight when the highlight is narrower than the box,
 * otherwise the current end-of-selection (cursor) placement. Either
 * way clamped on screen. The Annotate button itself is unaffected —
 * it stays at the cursor end.
 */
export function placeAnnPopX(opts: {
	cursorX: number;
	highlightLeft: number;
	highlightWidth: number;
	popWidth: number;
	viewportWidth: number;
}): number {
	const { cursorX, highlightLeft, highlightWidth, popWidth, viewportWidth } = opts;
	const lo = 8;
	const hi = Math.max(lo, viewportWidth - popWidth - 8);
	if (highlightWidth < popWidth) {
		return Math.min(Math.max(lo, highlightLeft + (highlightWidth - popWidth) / 2), hi);
	}
	return Math.min(Math.max(lo, cursorX), hi);
}

/**
 * Selection-menu popup placement (pure): the menu docks near the
 * cursor that finished the gesture, not the selection's start — a
 * full-sentence pick shouldn't strand it lines above the pointer —
 * clamped to the viewport. The right clamp uses the caller's menu
 * width estimate (one button vs Annotate+Inspect), never a
 * one-size box: a wide phantom shoves the menu far left of picks
 * near the right edge. Phones dock around the native selection
 * bubble instead (above on Android, below on iOS). placeSelMenu uses
 * it at summon time; the scroll tracker re-runs it cursorless so the
 * menu follows its highlight instead of dying on scroll.
 */
export function selMenuPlacement(opts: {
	cursorX: number | undefined;
	cursorY: number | undefined;
	rectLeft: number;
	rectTop: number;
	rectBottom: number;
	viewportWidth: number;
	viewportHeight: number;
	androidUI: boolean;
	iosUI: boolean;
	/** Estimated menu width (px) for the right-edge clamp. */
	menuWidth: number;
}): { x: number; y: number } {
	const {
		cursorX,
		cursorY,
		rectLeft,
		rectTop,
		rectBottom,
		viewportWidth,
		viewportHeight,
		androidUI,
		iosUI,
		menuWidth
	} = opts;
	const at = cursorX ?? rectLeft;
	// The popup sits just below the cursor (never under it), still
	// clamped to the viewport.
	const x = Math.min(Math.max(8, at - 16), Math.max(8, viewportWidth - menuWidth - 8));
	// Android: the OS text toolbar (Copy / Translate / Read Aloud)
	// docks above the selection, so ours goes below it instead of
	// underneath it — except near the screen bottom, where above
	// wins and may share space with the OS bar. iOS docks its
	// bubble below the selection, so ours takes the above slot
	// like desktop — one popup on each side, never stacked.
	let y: number;
	if (androidUI && !iosUI) {
		// Well clear of the selection handles (~24px below text).
		y = rectBottom + 30;
		if (y + 44 > viewportHeight) y = Math.max(8, rectTop - 47);
	} else if (iosUI) {
		// Above slot (Apple's bubble owns below); only a cramped
		// top edge drops it below, still clear of the handles and
		// the native bubble, and clamped on screen.
		y = rectTop - 47;
		if (y < 8) y = rectBottom + 30;
		if (y + 44 > viewportHeight) y = Math.max(8, viewportHeight - 52);
	} else {
		// Desktop: always above the cursor that finished the
		// gesture (never below it), the menu riding just clear of
		// it (a breath of gap), clamped to the viewport top.
		const cy = cursorY ?? rectTop;
		y = Math.max(8, cy - 48);
	}
	return { x, y };
}

/**
 * Start offset of the visual line holding `offset`: the index just
 * past the nearest preceding newline (0 when none). Lines come from
 * text alone so the rule unit-tests without layout.
 */
export function lineStartOffset(text: string, offset: number): number {
	const at = Math.max(0, Math.min(offset, text.length));
	return text.lastIndexOf("\n", at - 1) + 1;
}

/**
 * Clamp an off-chat drag's anchor end to the focus (cursor) line:
 * a selection whose anchor sits above the cursor's current line
 * pins back to that line's start, so drags starting off-chat (or
 * running off-screen) never highlight above it. Anchors at or below
 * the line pass through untouched.
 */
export function clampDragAnchorToFocusLine(
	text: string,
	anchorOffset: number,
	focusOffset: number
): number {
	const lineStart = lineStartOffset(text, focusOffset);
	return anchorOffset < lineStart ? lineStart : anchorOffset;
}

/**
 * Key handling for the annotation review edit box: Enter saves
 * (Shift+Enter still newlines), Escape cancels. Anything else is
 * the textarea's own business.
 */
export function reviewEditKey(key: string, shiftKey: boolean): "save" | "cancel" | null {
	if (key === "Enter" && !shiftKey) return "save";
	if (key === "Escape") return "cancel";
	return null;
}
