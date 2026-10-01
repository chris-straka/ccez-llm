/**
 * Quote matching: locating a quote in rendered text nodes, occurrence
 * counting, and quote-to-message routing. Split out of annotations.ts
 * (section C); matching folds case, typographic punctuation, and
 * tashkeel/bidi marks so rendered text matches stored quotes.
 */
import type { ChatMsgId } from "./chat";
import type { AnnotationId } from "./annotations";

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
export function locateQuote(
	nodeTexts: string[],
	quote: string,
	occurrence = 0
): QuoteLocation | null {
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
 * Paragraph holding a quote: the annotation answer's original
 * context. Blank-line paragraphs split prose; a quote spanning the
 * split (or missing) falls back to the quote itself, never the whole
 * message — the request stays small either way.
 */
export function paragraphForQuote(
	text: string,
	quote: string,
	occurrence = 0
): string {
	const clean = quote.trim();
	if (!clean) return "";
	// Occurrence-aware like locateQuote: a quote living in two
	// paragraphs (Japanese 旅行 and Chinese 旅行 in one reply)
	// resolves to the paragraph holding its nth match, so speech
	// and readings inherit the right language. Counting uses the
	// same stripped matching, and an overrun falls back to the
	// first match — the old behavior.
	const q = stripForMatch(clean).stripped;
	if (!q) return "";
	let seen = 0;
	let first = "";
	for (const para of text.split(/\n\s*\n/)) {
		const hay = stripForMatch(para).stripped;
		if (!hay.includes(q)) continue;
		if (!first) first = para.trim();
		let from = 0;
		for (;;) {
			const at = hay.indexOf(q, from);
			if (at === -1) break;
			if (seen === occurrence) return para.trim();
			seen++;
			from = at + q.length;
		}
	}
	return first || clean;
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
	const hit = messages.find(
		(m) => m.id !== senderId && locateQuote([m.content], quote) !== null
	);
	return hit?.id ?? null;
}

/**
 * Sent-annotation landing target: a still-live annotation jumps to
 * the badge, a quote surviving in its owner's text jumps there, an
 * everywhere-edited quote falls back to the sending message, and a
 * sender edited away too reports gone. Pure (lists in, target out)
 * so the component shell only performs the landing.
 */
export type SentRefTarget =
	| { kind: "live"; id: AnnotationId; messageId: ChatMsgId }
	| { kind: "quoted"; messageId: ChatMsgId }
	| { kind: "sender"; index: number }
	| { kind: "gone" };

export function resolveSentRefTarget(
	live: { id: AnnotationId; messageId?: ChatMsgId; quote: string }[],
	messages: { id: ChatMsgId; content: string }[],
	messageId: ChatMsgId,
	quote: string
): SentRefTarget {
	const hit = live.find(
		(a) => a.messageId === messageId && a.quote === quote
	);
	if (hit) return { kind: "live", id: hit.id, messageId };
	const quotedId = findQuotedMessage(messages, messageId, quote);
	if (quotedId) return { kind: "quoted", messageId: quotedId };
	const index = messages.findIndex((m) => m.id === messageId);
	return index < 0 ? { kind: "gone" } : { kind: "sender", index };
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
