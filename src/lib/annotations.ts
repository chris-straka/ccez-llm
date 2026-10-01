/**
 * Annotation: a quoted selection from a message plus an optional comment,
 * wrapped into the next query. Composer-scoped (like attachments): sending
 * bakes them into the message text. Unsent drafts persist per chat across
 * restarts (see load/saveDraftAnnotations); the baked blocks never do.
 */
import type { ChatMsgId } from "./chat";
import { touchPastSlop } from "./platform";

/** Opaque annotation identifier (see ChatId/ChatMsgId in chat.ts). */
export type AnnotationId = string & { readonly kind: "annotation" };

/** News-headline anchor: news lives in an empty chat, so the
 * story itself owns the note. Mutually exclusive with messageId. */
export interface StoryAnchor {
	link: string;
	title: string;
	outlet: string;
	lang: string;
}

export interface Annotation {
	id: AnnotationId;
	/** Message the selection came from (drives badge placement).
	 * Absent on story-anchored notes (no message row exists). */
	messageId?: ChatMsgId;
	/** News story the headline selection came from. */
	story?: StoryAnchor;
	quote: string;
	comment: string;
	/**
	 * Aid text the quote was selected from (tashkeel vocalization):
	 * the badge only shows while that aid is on for the message —
	 * the quote locates against vocalized text, never the bare form.
	 * Memory-only like `at` (badges stamp from live annotations).
	 */
	aidScope?: "tashkeel";
	/**
	 * Which repeat of the quote was selected (0-based, default 0):
	 * annotating the last "c" in "ccc" stores 2, so the badge lands
	 * where the selection was instead of the first match. Memory-only
	 * (never baked into message text) — badges stamp from live
	 * annotations, cleared on send.
	 */
	at?: number;
	/**
	 * Model answer to the annotation's question (the remodel): set
	 * when the separate request lands, persisted with drafts like the
	 * comment. Absent means unanswered — badges stay neutral.
	 */
	answer?: string;
	/**
	 * Pinned to the send prompt (the badge's plus on an answered
	 * annotation): the prompt overlay lists it as quote, question,
	 * and answer, and the next send bakes all three as context.
	 * Unpinned annotations never enter the prompt — creating one
	 * only files its badge. Absent means unpinned; consumed (reset)
	 * by the send that bakes it, and never persisted (fresh loads
	 * start unpinned, so a stale approval can't ride a later send).
	 */
	pinnedToPrompt?: boolean;
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
	return [
		...list,
		{ id: newAnnotationId(), messageId, quote: trimmed, comment }
	];
}

/**
 * True when an aid-scoped quote may stamp its badge: tashkeel quotes
 * locate against vocalized text, so on the bare form they'd badge the
 * wrong words — they show only while the aid is on for the message.
 * Unscoped quotes always show. Pure so the message-badge filter
 * unit-tests without the component.
 */
export function aidMarkVisible(
	aidScope: Annotation["aidScope"],
	tashkeelOn: boolean
): boolean {
	return aidScope !== "tashkeel" || tashkeelOn;
}

/** Anchor identity for grouping: the message, or the story link. Pure. */
function anchorKey(a: Pick<Annotation, "messageId" | "story">): string {
	return a.messageId ?? a.story?.link ?? "";
}

/**
 * Id of the saved annotation already quoting the same span of the same
 * anchor (same text, same repeat), if any: annotating it again would
 * stack two badges on one anchor, and hovering them oscillates as the
 * re-stamp swaps which badge sits under the cursor. Null when the
 * quote is blank or unquoted yet.
 */
export function duplicateAnnotationId(
	list: Annotation[],
	anchor: Pick<Annotation, "messageId" | "story">,
	quote: string,
	at = 0,
	aidScope?: "tashkeel"
): AnnotationId | null {
	const trimmed = quote.trim();
	if (!trimmed) return null;
	const key = anchorKey(anchor);
	const found = list.find(
		(a) =>
			anchorKey(a) === key &&
			a.quote === trimmed &&
			(a.at ?? 0) === at &&
			(a.aidScope ?? null) === (aidScope ?? null)
	);
	return found ? found.id : null;
}


export function deleteAnnotation(list: Annotation[], id: string): Annotation[] {
	return list.filter((a) => a.id !== id);
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

/** Badge to stamp onto a message's quoted span. */
export interface AnnotationMark {
	id: AnnotationId;
	number: number;
	quote: string;
	/** Repeat of the quote to stamp (see Annotation.at). */
	at?: number;
	/** Aid text the quote locates against (see Annotation.aidScope). */
	aidScope?: "tashkeel";
	/** Answer state for the badge (see Annotation.answer). */
	answer?: "waiting" | "ready";
	/**
	 * Preview (unsaved) annotation: washes like a real mark when it is
	 * the open one, but stamps no badge — badges appear on submit only.
	 */
	preview?: boolean;
}

/**
 * Badge face for a mark: always its per-message number, always
 * titled to open. Pinning happens by double-click (badge or keyboard
 * Enter with the card open) and never rewrites the face — numbers
 * stay put from filing to delete.
 */
export function badgeFace(item: { number: number }): {
	text: string;
	title: string;
} {
	return { text: String(item.number), title: "Open annotation" };
}

/**
 * Prompt badge count for the annotation tracker: the number, capped at
 * 99+ so the badge never stretches the prompt tools.
 */
export function annotationCountLabel(count: number): string {
	return count > 99 ? "99+" : String(count);
}

/**
 * Answer-state badge class: waiting reads blue, ready reads slick
 * orange (both themes — see the MessageBody badge rules). Empty when
 * unanswered so neutral badges keep the accent.
 */
export function badgeAnswerClass(
	answer: "waiting" | "ready" | undefined
): string {
	if (answer === "waiting") return " ans-waiting";
	if (answer === "ready") return " ans-ready";
	return "";
}

/**
 * Right-to-left quote (Hebrew and Arabic blocks, presentation forms
 * included): the shell's highlight overlay paints a tight RTL registry
 * range past its end (probed in WebKit: a 2-word Arabic range paints
 * its line's rest while Latin stays tight), so registry washes stretch
 * on exactly the quotes the locator proves tight. DOM marks wrap the
 * located span itself (cluster-snapped, never through tashkeel), like
 * the reading-markup routing above. Pure (takes the quote, no DOM).
 */
const RTL_QUOTE_RE =
	/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
export function hasRtlQuote(quote: string): boolean {
	return RTL_QUOTE_RE.test(quote);
}

const LTR_LETTER_RE = /\p{L}/u;
/**
 * Quote direction from its first strong character: an Arabic
 * quote mirrors its badge even inside an LTR paragraph, and a
 * Latin quote inside an RTL paragraph stays unmirrored.
 * Neutral-only quotes (digits, punctuation) return null for the
 * paragraph fallback. Pure.
 */
export function quoteDirection(quote: string): "rtl" | "ltr" | null {
	for (const ch of quote) {
		if (RTL_QUOTE_RE.test(ch)) return "rtl";
		if (LTR_LETTER_RE.test(ch)) return "ltr";
	}
	return null;
}

/**
 * Render annotations for the prompt tail, matching the review-panel shape:
 * numbered quote plus comment.
 */
export function formatAnnotations(
	list: { quote: string; comment: string; answer?: string }[]
): string {
	return list
		.map((a, i) => {
			const head = `${i + 1}. "${a.quote}"`;
			// Empty comments file as "?" so the model sees the confusion
			// instead of a bare quote that reads as settled context.
			// Newlines collapse like the reply's: a Shift+Enter comment
			// would otherwise split the entry and corrupt the parse.
			const comment = a.comment.trim().replace(/\s+/g, " ");
			const asked = comment ? `${head} — ${comment}` : `${head} — ?`;
			// The reply rides on its own continuation line, newlines
			// collapsed: answers stay short (capped at ask time), and a
			// single line keeps the block line-parseable — a raw
			// multi-line reply could fake an entry boundary.
			const reply = a.answer?.trim().replace(/\s+/g, " ");
			return reply ? `${asked}\n   Answer: ${reply}` : asked;
		})
		.join("\n");
}

/**
 * Append the annotation block to outgoing prompt text. Only pinned
 * annotations ever reach here (see promptInclusions) — approval is
 * the pin, and deleting the annotation is the only removal.
 * Numbering sequences from the kept order with no gaps.
 */
export function withAnnotations(
	prompt: string,
	list: {
		quote: string;
		comment: string;
		answer?: string;
	}[]
): string {
	if (list.length === 0) return prompt;
	const block = `Annotated selections:\n${formatAnnotations(list)}`;
	return prompt ? `${prompt}\n\n${block}` : block;
}

/**
 * Prompt inclusions for a send: pinned annotations only. Creating
 * one never includes it — only the badge's plus pins it. The
 * dock lists the same pinned set; the message carries these
 * (quote, question, and answer each).
 */
export function promptInclusions(list: Annotation[]): Annotation[] {
	return list.filter((a) => a.pinnedToPrompt === true);
}

/**
 * Add-to-prompt eligibility: answered annotations only. Blue
 * (waiting) annotations are never asked, edited, or prompted —
 * creating one only files its badge until the reply lands.
 */
export function canPinAnnotation(ann: { answer?: string }): boolean {
	return ann.answer !== undefined;
}

/**
 * Hold-to-delete eligibility: every filed badge, blue (waiting)
 * or orange (answered) alike. Late answers landing after a
 * waiting badge's delete attach to nothing (see
 * attachAnnotationAnswer), so deleting early is safe. Pure.
 */
export function canHoldDeleteBadge(
	ann: { id: string } | undefined
): boolean {
	return ann !== undefined;
}

/**
 * Remove every prompt-pinned annotation, keeping the rest filed:
 * the dock's clear-all empties the prompt overlay, never the
 * badges. Pure — filed-but-unpinned notes survive the call.
 */
export function clearPromptPinned(list: Annotation[]): Annotation[] {
	return list.filter((a) => a.pinnedToPrompt !== true);
}

/** Pin one annotation to the send prompt (never deletes it). */
export function setPromptPinned(
	list: Annotation[],
	id: AnnotationId,
	pinned: boolean
): Annotation[] {
	let touched = false;
	const next = list.map((a) => {
		if (a.id !== id) return a;
		if (pinned) {
			if (a.pinnedToPrompt === true) return a;
			touched = true;
			return { ...a, pinnedToPrompt: true };
		}
		if (a.pinnedToPrompt !== true) return a;
		touched = true;
		const rest = { ...a };
		delete rest.pinnedToPrompt;
		return rest;
	});
	return touched ? next : list;
}

/** Ask one annotation right away (every filing asks its own
separate request): attach a fresh reply as its answer. A blank reply
attaches nothing — the annotation stays blue. Returns the list
unchanged when nothing attaches. */
export function attachAnnotationAnswer(
	list: Annotation[],
	id: AnnotationId,
	reply: string
): Annotation[] {
	if (!reply.trim()) return list;
	let touched = false;
	const next = list.map((a) => {
		if (a.id !== id || a.answer === reply) return a;
		touched = true;
		return { ...a, answer: reply };
	});
	return touched ? next : list;
}

/**
 * Filed annotations still waiting on their answer: persisted drafts
 * carry no request state (pending never reaches storage — only filed
 * notes do), so every answerless draft is a request the restart took
 * off the wire. Answered ones stay out. Pure — the boot/switch scan
 * refires exactly these.
 */
export function unansweredAnnotations(list: Annotation[]): Annotation[] {
	return list.filter((a) => a.answer === undefined);
}

/**
 * Rewrite one baked ref's comment (the previous-menu pencil save):
 * parse the trailing block, swap ref n's comment, rebake. Null when
 * the content holds no clean block or n isn't in it — the caller
 * treats that as gone. Numbering re-sequences from the kept order,
 * so an unchanged comment rebakes byte-for-byte.
 */
export function rewriteAnnotationComment(
	content: string,
	n: number,
	comment: string
): string | null {
	const split = splitAnnotationBlock(content);
	if (!split) return null;
	if (!split.refs.some((ref) => ref.n === n)) return null;
	return withAnnotations(
		split.text,
		// Rewording the note keeps the reply it already got (the pencil
		// never re-asks), so the Answer line survives the rebake.
		split.refs.map((ref) => (ref.n === n ? { ...ref, comment } : ref))
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

function validStoryAnchor(raw: unknown): StoryAnchor | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const s = raw as Partial<StoryAnchor>;
	if (typeof s.link !== "string" || !s.link) return undefined;
	if (
		typeof s.title !== "string" ||
		typeof s.outlet !== "string" ||
		typeof s.lang !== "string"
	)
		return undefined;
	return { link: s.link, title: s.title, outlet: s.outlet, lang: s.lang };
}

function cleanDraftList(raw: unknown): Annotation[] {
	if (!Array.isArray(raw)) return [];
	const out: Annotation[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const a = item as Partial<Annotation>;
		if (typeof a.id !== "string") continue;
		const messageId = typeof a.messageId === "string" ? a.messageId : undefined;
		const story = validStoryAnchor(a.story);
		if (!messageId && !story) continue;
		if (typeof a.quote !== "string" || typeof a.comment !== "string") continue;
		out.push({
			id: a.id,
			...(messageId ? { messageId } : {}),
			...(story ? { story } : {}),
			quote: a.quote,
			comment: a.comment,
			at: typeof a.at === "number" ? a.at : 0,
			// Answers persist with drafts like the comment: a reload
			// must not un-ask an answered annotation back to blue.
			// Pins never persist (fresh loads start unpinned, so a
			// stale approval can't ride a later send); there is no
			// omit state anymore — deleting is the only removal.
			...(typeof a.answer === "string" && a.answer
				? { answer: a.answer }
				: {})
		});
	}
	return out;
}

export function loadDraftAnnotations(chatId: string): Annotation[] {
	try {
		if (typeof localStorage === "undefined") return [];
		const raw =
			localStorage.getItem(DRAFT_KEY) ?? localStorage.getItem(LEGACY_DRAFT_KEY);
		if (!raw) return [];
		const record = JSON.parse(raw) as Record<string, unknown>;
		return cleanDraftList(record?.[chatId]);
	} catch {
		return [];
	}
}

export function saveDraftAnnotations(
	chatId: string,
	list: Annotation[],
	knownIds: string[]
): void {
	try {
		if (typeof localStorage === "undefined") return;
		let record: Record<string, unknown> = {};
		try {
			record =
				(JSON.parse(
					localStorage.getItem(DRAFT_KEY) ??
						localStorage.getItem(LEGACY_DRAFT_KEY) ??
						"{}"
				) as Record<string, unknown>) ?? {};
		} catch {
			record = {};
		}
		if (list.length === 0) delete record[chatId];
		else record[chatId] = list;
		for (const key of Object.keys(record))
			if (!knownIds.includes(key)) delete record[key];
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
	/** Baked reply (see formatAnnotations): absent on older blocks. */
	answer?: string;
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
	const entry =
		/(\d+)\.\s+"([\s\S]*?)"(?:\s+—\s+([^\n]*))?(?:\n[ \t]+Answer:[ \t]*([^\n]*))?(?=\n\d+\.\s+"|$)/g;
	let m: RegExpExecArray | null;
	let covered = 0;
	while ((m = entry.exec(body)) !== null) {
		covered = m.index + m[0].length;
		const reply = (m[4] ?? "").trim();
		refs.push({
			n: Number(m[1] ?? 0),
			quote: m[2] ?? "",
			comment: (m[3] ?? "").trim(),
			...(reply ? { answer: reply } : {})
		});
	}
	if (refs.length === 0) return null;
	// Trailing garbage means this isn't our block (or a comment broke
	// the shape): fall back to full text rather than half a list.
	if (body.slice(covered).trim() !== "") return null;
	return { text, refs };
}

/**
 * Strip every baked annotation from sent content, returning the bare
 * prompt text (or null when no clean block closes the content): the
 * sent-refs card's Clear-all. Refs-only content clears to "" — the
 * caller deletes that message instead of keeping an empty one.
 */
export function clearBakedAnnotations(content: string): string | null {
	const split = splitAnnotationBlock(content);
	if (!split) return null;
	return split.text;
}

/**
 * Baked annotation refs by exact message content, memoized: sent
 * messages render redacted (count pill instead of the full block), so
 * this runs per render and must never re-parse. Display-only — results
 * are never fed back into reactive effects.
 */
const refsCache = new Map<
	string,
	{ text: string; refs: AnnotationRef[] } | null
>();
export function annRefsFor(
	content: string
): { text: string; refs: AnnotationRef[] } | null {
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


const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;
const COMBINING_RE = /\p{M}/u;
const SURROGATE_RE = /[\uD800-\uDFFF]/u;
const PUNCT_RE = /\p{P}/u;
const SPACE_RE = /\s/;
/**
 * Spaceless scripts have no words to pick: every character is a
 * letter (Lo), so snapping would glue whole sentences together.
 * The native pick already stands for these (see the Japanese
 * double-click specs) and stays untouched.
 */
const SPACELESS_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function isWordChar(ch: string): boolean {
	return WORD_CHAR_RE.test(ch) && !SPACELESS_RE.test(ch);
}

/**
 * Split-safe offset into `nodeText`: a node split must never leave a
 * combining mark or a low surrogate first on the right side, so
 * advance past them. The slice a gap was picked on can end before its
 * node does (wash marks expand to the cluster end), and splitting
 * there would strand the mark. Anchors land on the true cluster edge,
 * still quote-adjacent. Pure and unit-tested via stamping.
 */
export function splitSafeOffset(nodeText: string, offset: number): number {
	let o = Math.min(Math.max(0, offset), nodeText.length);
	while (o < nodeText.length) {
		const ch = nodeText[o] ?? "";
		if (!COMBINING_RE.test(ch) && !/[\uDC00-\uDFFF]/u.test(ch)) break;
		o += 1;
	}
	return o;
}

/**
 * Offset (0..text.length) of the word gap nearest the middle of `text`:
 * a position touching a word character where words split (an edge or a
 * word/non-word transition), never beside a combining mark or a
 * surrogate half. Ties prefer the later gap, so a lone word parks
 * after itself with its tail pointing back at it. Null when no gap
 * qualifies (spaceless scripts, empty input). Pure and unit-tested.
 */
export function gapOffsetForAnchor(text: string): number | null {
	const len = text.length;
	if (len === 0) return null;
	const mid = len / 2;
	let best: number | null = null;
	let bestDist = Infinity;
	for (let k = 0; k <= len; k++) {
		const left = k > 0 ? (text[k - 1] ?? "") : "";
		const right = k < len ? (text[k] ?? "") : "";
		const touchesWord =
			(k > 0 && isWordChar(left)) || (k < len && isWordChar(right));
		const splitsWords =
			k === 0 || k === len || !isWordChar(left) || !isWordChar(right);
		if (!touchesWord || !splitsWords) continue;
		if (COMBINING_RE.test(left) || COMBINING_RE.test(right)) continue;
		if (SURROGATE_RE.test(left) || SURROGATE_RE.test(right)) continue;
		const dist = Math.abs(k - mid);
		if (dist < bestDist || (dist === bestDist && (best === null || k > best))) {
			best = k;
			bestDist = dist;
		}
	}
	return best;
}

/**
 * Fallback gap for spaceless scripts (CJK): word gaps don't exist,
 * but a letter-wrap paints one fragment short (the seam), so the
 * anchor still holds no text. Punctuation-adjacent boundaries nearest
 * the middle win (a fence beside 。、never splits a pick); otherwise
 * the quote's own end edge, so lone quotes park after themselves like
 * spaced words do. Combining marks and surrogate halves never border
 * the gap. Null when nothing qualifies. Pure and unit-tested.
 */
export function edgeOffsetForAnchor(text: string): number | null {
	const len = text.length;
	if (len === 0) return null;
	const mid = len / 2;
	let best: number | null = null;
	let bestDist = Infinity;
	for (let k = 0; k <= len; k++) {
		const left = k > 0 ? (text[k - 1] ?? "") : "";
		const right = k < len ? (text[k] ?? "") : "";
		const touchesContent =
			(k > 0 && !SPACE_RE.test(left)) || (k < len && !SPACE_RE.test(right));
		if (!touchesContent) continue;
		const punct = PUNCT_RE.test(left) || PUNCT_RE.test(right);
		if (k !== 0 && k !== len && !punct) continue;
		if (COMBINING_RE.test(left) || COMBINING_RE.test(right)) continue;
		if (SURROGATE_RE.test(left) || SURROGATE_RE.test(right)) continue;
		const dist = Math.abs(k - mid);
		if (dist < bestDist || (dist === bestDist && (best === null || k > best))) {
			best = k;
			bestDist = dist;
		}
	}
	return best;
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
		while (s > 0 && isWordChar(text[s - 1] ?? "") && isWordChar(text[s] ?? ""))
			s -= 1;
		while (
			e < len &&
			isWordChar(text[e - 1] ?? "") &&
			isWordChar(text[e] ?? "")
		)
			e += 1;
	}
	return { start: s, end: e };
}

/**
 * True when a press grew the live selection out of its press-time
 * snapshot: a right-press micro-drag extends the old highlight
 * instead of replacing it, so the click point sits inside a range
 * the user never picked. Steady presses (same text) and fresh
 * engine picks (a replacement, never containing the old text) both
 * read false — only growth repoints. Pure.
 */
export function pressExpandedSelection(prior: string, live: string): boolean {
	return prior !== "" && live !== prior && live.includes(prior);
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
	const { cursorX, highlightLeft, highlightWidth, popWidth, viewportWidth } =
		opts;
	const lo = 8;
	const hi = Math.max(lo, viewportWidth - popWidth - 8);
	if (highlightWidth < popWidth) {
		return Math.min(
			Math.max(lo, highlightLeft + (highlightWidth - popWidth) / 2),
			hi
		);
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
 * near the right edge. Phones take the above slot too (the native
 * callout is suppressed; readings dock below instead) — iOS keeps
 * it because its bubble owns below. placeSelMenu uses it at summon
 * time; the scroll tracker re-runs it cursorless so the menu
 * follows its highlight instead of dying on scroll.
 */
export function selMenuPlacement(opts: {
	cursorX: number | undefined;
	cursorY: number | undefined;
	rectLeft: number;
	rectTop: number;
	rectBottom: number;
	/** Selection width (px): phones center the menu over the text. */
	rectWidth: number;
	viewportWidth: number;
	viewportHeight: number;
	androidUI: boolean;
	iosUI: boolean;
	/** Estimated menu width (px) for the centering/clamp. */
	menuWidth: number;
	/** Message text scale: the menu tracks it, so clearance scales too. */
	fontScale: number;
}): { x: number; y: number } {
	const {
		cursorX,
		cursorY,
		rectLeft,
		rectTop,
		rectBottom,
		rectWidth,
		viewportWidth,
		viewportHeight,
		androidUI,
		iosUI,
		menuWidth,
		fontScale
	} = opts;
	// Phones center the menu over the selected text (a 2-button row
	// left-anchored like desktop reads off-center); desktop keeps the
	// cursor-anchored left edge. Either way clamped to the viewport.
	const at = cursorX ?? rectLeft;
	const phoneX = rectLeft + rectWidth / 2 - menuWidth / 2;
	const x = Math.min(
		Math.max(8, androidUI && !iosUI ? phoneX : at - 16),
		Math.max(8, viewportWidth - menuWidth - 8)
	);
	// Android: the OS text toolbar is suppressed (the app menu
	// replaces it), so ours takes the above slot like desktop —
	// clear of the highlight — except near the screen top, where
	// below wins. iOS docks its bubble below the selection, so
	// ours takes the above slot like desktop — one popup on each
	// side, never stacked.
	let y: number;
	if (androidUI && !iosUI) {
		// Above the highlight; only a cramped top edge drops it
		// below, still clear of the handles, and clamped on screen.
		y = rectTop - 47;
		if (y < 8) y = rectBottom + 30;
		if (y + 44 > viewportHeight) y = Math.max(8, viewportHeight - 52);
	} else if (iosUI) {
		// Above slot (Apple's bubble owns below); only a cramped
		// top edge drops it below, still clear of the handles and
		// the native bubble, and clamped on screen.
		y = rectTop - 47;
		if (y < 8) y = rectBottom + 30;
		if (y + 44 > viewportHeight) y = Math.max(8, viewportHeight - 52);
	} else {
		// Desktop: always above the cursor that finished the
		// gesture (never below it), riding clear of it by its own
		// scaled height plus a breath — a fixed 48px strands the
		// menu over the cursor once the button tracks huge type,
		// eating double/triple clicks. Clamped to the viewport top.
		const menuH = Math.round(24 + 16 * Math.max(1, fontScale));
		const cy = cursorY ?? rectTop;
		y = Math.max(8, cy - 8 - menuH);
	}
	return { x, y };
}

/** Minimal rect shape for reading-panel anchoring (DOMRect compatible). */
export interface AnchorRect {
	left: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}

/**
 * Anchor for one highlight span's readings panel: the span's first
 * line fragment, never the whole union box. A group wrapping across
 * lines reports a union rect whose center sits mid-column — every
 * wrapped group would anchor the same middle and stack. The first
 * fragment starts at the group's own kanji on every layout.
 */
export function firstContentRect<T extends AnchorRect>(rects: readonly T[]): T | null {
	for (const rect of rects) {
		if (rect.width > 0 && rect.height > 0) return rect;
	}
	return null;
}

/**
 * Readings-panel placement (pure): the panel centers on its
 * highlight span via CSS translateX, so the style left IS the
 * span's center — never the span's left edge, which would park
 * the panel half its width too far left. The center clamps only
 * to the viewport edges (never a fixed-pixel reserve): on a
 * narrow phone a wide reserve collapses every group's center to
 * one x and the panels stack exactly. A later width pass nudges
 * wide panels back inside; placement keeps them spread on their
 * own groups first.
 *
 * Above with headroom, else below (a tall highlight under the
 * keyboard can leave no room under it): the readings hang over
 * the highlight's top edge, and on phones the selection menu
 * rises above them instead of owning the above slot.
 */
export function readingPanelPlacement(opts: {
	rect: AnchorRect;
	viewportWidth: number;
	viewportHeight: number;
}): { x: number; y: number; above: boolean } {
	const { rect, viewportWidth, viewportHeight } = opts;
	const cx = rect.left + rect.width / 2;
	const x = Math.min(
		Math.max(8, cx),
		Math.max(8, viewportWidth - 8)
	);
	const headroom = rect.top >= 128;
	const footroom = rect.bottom + 44 <= viewportHeight;
	const above = headroom || !footroom;
	if (above) return { x, y: Math.max(8, rect.top), above: true };
	return { x, y: Math.min(rect.bottom, viewportHeight - 40), above: false };
}

/**
 * Menu top that clears a readings panel above the highlight: the
 * panel's visual top minus the menu height and a hair, never past
 * the screen edge. Pure — callers measure both rects.
 */
export function menuYAbovePanel(
	panelTop: number,
	menuHeight: number,
	gap = 4,
	minY = 8
): number {
	// A 4px hairline: the menu sits as close under the panel as it
	// can without ever touching it (menu bottom lands exactly
	// gap above the panel top).
	return Math.max(minY, Math.round(panelTop - menuHeight - gap));
}

/**
 * Width-pass center clamp for readings panels: the panel centers on
 * its highlight (CSS translateX), so the center keeps an 8px margin
 * on both sides. The upper bound never drops below the lower one —
 * on a very narrow phone a wide panel parks at the lower bound
 * instead of inverting to a negative x. Pure — callers measure the
 * true width a frame after placement.
 */
export function clampPanelCenterX(
	x: number,
	panelWidth: number,
	viewportWidth: number,
	margin = 8
): number {
	const lo = panelWidth / 2 + margin;
	return Math.min(
		Math.max(lo, x),
		Math.max(lo, viewportWidth - panelWidth - margin)
	);
}

/**
 * Settle check for the width pass: a sub-pixel-corrected center
 * within a pixel of the placed one needs no state write (and no
 * re-render). Pure.
 */
export function panelCenterMoved(
	x: number,
	placedX: number,
	tolerance = 1
): boolean {
	return Math.abs(x - placedX) > tolerance;
}

/**
 * Steadiness check before the width pass: the live highlight must
 * still sit where placement measured it (scrolls and selection
 * edits move it), else the corrected center belongs to a stale
 * rect. Pure.
 */
export function highlightSteady(
	now: { left: number; top: number },
	placed: { left: number; top: number },
	tolerance = 2
): boolean {
	return (
		Math.abs(now.left - placed.left) <= tolerance &&
		Math.abs(now.top - placed.top) <= tolerance
	);
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
 * Badge array for one message, unmemoized (REFACTOR §6): aid-scoped
 * quotes only show while the aid is on (they locate against aided
 * text), and a composed-but-unsubmitted annotation washes while its
 * pill is open with no badge. Filed-but-unasked annotations paint
 * steady blue (waiting), answered ones orange (ready) — there is no
 * separate request anymore, so nothing ever blinks. The page memos
 * the result by content (see marksFor) so renders keep array identity.
 */
export function buildMarksFor(
	list: Annotation[],
	messageId: ChatMsgId,
	tashkeelOn: boolean,
	pending: Annotation | null
): AnnotationMark[] {
	const mine = list.filter(
		(a) => a.messageId === messageId && aidMarkVisible(a.aidScope, tashkeelOn)
	);
	const saved: AnnotationMark[] = mine.map((a, i) => ({
		id: a.id,
		// Per-message numbers (see annotationNumber): the message's
		// own index, never the chat-global one.
		number: i + 1,
		quote: a.quote,
		at: a.at ?? 0,
		...(a.aidScope ? { aidScope: a.aidScope } : {}),
		answer: a.answer ? "ready" : "waiting"
	}));
	if (pending && pending.messageId === messageId) {
		saved.push({
			id: pending.id,
			number: mine.length + 1,
			quote: pending.quote,
			at: pending.at ?? 0,
			preview: true
		});
	}
	return saved;
}

/**
 * Badge array for one news headline: the story's own filing order
 * (see annotationNumber), pending preview included, no aid scope
 * (headlines never carry aids). Mirrors buildMarksFor.
 */
export function buildStoryMarks(
	list: Annotation[],
	link: string,
	pending: Annotation | null
): AnnotationMark[] {
	const mine = list.filter((a) => a.story?.link === link);
	const saved: AnnotationMark[] = mine.map((a, i) => ({
		id: a.id,
		number: i + 1,
		quote: a.quote,
		at: a.at ?? 0,
		answer: a.answer ? "ready" : "waiting"
	}));
	if (pending?.story?.link === link) {
		saved.push({
			id: pending.id,
			number: mine.length + 1,
			quote: pending.quote,
			at: pending.at ?? 0,
			preview: true
		});
	}
	return saved;
}

/** Headline marks grouped by story link (see buildStoryMarks). */
export function buildNewsMarks(
	list: Annotation[],
	pending: Annotation | null
): Record<string, AnnotationMark[]> {
	const links = new Set<string>();
	for (const a of list) {
		if (a.story?.link) links.add(a.story.link);
	}
	if (pending?.story?.link) links.add(pending.story.link);
	return Object.fromEntries(
		[...links].map((link) => [link, buildStoryMarks(list, link, pending)])
	);
}

/**
 * Pinned or hover-peeked model-aid text for a message (REFACTOR §6):
 * the peeked message reads its cached vocalization, otherwise the
 * model pin shows the cache when present. The cache survives unpin
 * for one click back (the page keeps it, this only reads).
 */
export function aidedTextForMsg(
	messageId: ChatMsgId,
	peekId: string | null,
	vocalized: Record<string, string>,
	modelPinned: ReadonlySet<string>
): string | null {
	if (peekId === messageId) {
		const cached = vocalized[messageId];
		if (cached !== undefined) return cached;
	}
	if (modelPinned.has(messageId)) return vocalized[messageId] ?? null;
	return null;
}

/** Row-edit commit outcome (REFACTOR §6): rebake, no-op, or gone. */
export type RefsEditCommit =
	| { kind: "rewrote"; content: string }
	| { kind: "untouched" }
	| { kind: "gone" };

/**
 * Row-edit commit decision: rebake the message with the one comment
 * swapped (see rewriteAnnotationComment) — history rewrites in place
 * with no resend. An unparseable block (or a missing message) reads
 * as gone; an untouched draft writes nothing. Toasts and the focus
 * park stay paged.
 */
export function commitRefsEdit(
	content: string | null,
	n: number,
	draft: string
): RefsEditCommit {
	if (content === null) return { kind: "gone" };
	const next = rewriteAnnotationComment(content, n, draft);
	if (next === null) return { kind: "gone" };
	if (next === content) return { kind: "untouched" };
	return { kind: "rewrote", content: next };
}

/** Sent-card Clear-all outcome (REFACTOR §6). */
export type ClearSentRefsPlan =
	| { kind: "skip" }
	| { kind: "gone" }
	| { kind: "delete" }
	| { kind: "rewrote"; bare: string };

/**
 * Sent-card Clear-all decision: strip the baked block, keeping the
 * bare prompt (see clearBakedAnnotations). A refs-only message
 * clears to nothing — delete it instead of keeping an empty one.
 * Own messages only (baked blocks ride the outgoing prompt), so
 * anything else skips silently. Toasts and the pop close stay paged.
 */
export function planClearSentRefs(
	role: string,
	content: string
): ClearSentRefsPlan {
	if (role !== "user") return { kind: "skip" };
	const bare = clearBakedAnnotations(content);
	if (bare === null) return { kind: "gone" };
	if (bare.trim() === "") return { kind: "delete" };
	return { kind: "rewrote", bare };
}

/**
 * Seed pending annotations from a message's baked refs: the baked
 * block is provider context, not edit text, so saving re-bakes the
 * same context from these seeds. They arrive pinned (already approved
 * once — unpinning or deleting one in the dock drops it from the
 * save) with their answers, so an untouched save rebakes the block
 * as it was. The bake's "?" placeholder reads back as no comment.
 */
export function seedAnnotationsFromRefs(
	messageId: ChatMsgId,
	refs: AnnotationRef[]
): Annotation[] {
	return refs.map((r) => ({
		id: newAnnotationId(),
		messageId,
		quote: r.quote,
		comment: r.comment === "?" ? "" : r.comment,
		...(r.answer ? { answer: r.answer } : {}),
		pinnedToPrompt: true
	}));
}

/**
 * The chat's annotations once an own-message edit ends. The edit
 * swaps the live list for the message's ref seeds, so the filed list
 * is stashed at entry and comes back here, plus anything filed during
 * the edit that the save didn't bake (seeds never survive: they live
 * in the message). Null stash (edit opened in another chat) keeps the
 * live extras only.
 */
export function annotationsAfterEdit(
	stash: Annotation[] | null,
	live: Annotation[],
	seedIds: ReadonlySet<string>,
	saved: boolean
): Annotation[] {
	const extras = live.filter(
		(a) => !seedIds.has(a.id) && !(saved && a.pinnedToPrompt === true)
	);
	return [...(stash ?? []), ...extras];
}

/**
 * Copy one annotation (REFACTOR §6): quote plus comment, no numbers.
 */
export function annotationCopyText(quote: string, comment: string): string {
	return comment.trim() ? `"${quote}" — ${comment.trim()}` : `"${quote}"`;
}

/**
 * File a pending annotation with its draft comment (REFACTOR §6):
 * the pill commit path. Null when nothing is pending.
 */
export function filePendingAnnotation(
	list: Annotation[],
	pending: Annotation | null,
	draft: string
): Annotation[] | null {
	if (!pending) return null;
	return [...list, { ...pending, comment: draft }];
}

/**
 * Wash id for an in-prompt note edit (REFACTOR §6): a pending
 * filing washes its preview, a saved note its quote.
 */
export function promptAnnWashIdFor(
	edit: { id: string } | { pending: true } | null,
	pendingId: AnnotationId | null
): string | null {
	if (!edit) return null;
	if ("pending" in edit) return pendingId;
	return edit.id;
}

/**
 * Clamp a dragged menu spot on screen (REFACTOR §6): the finger's
 * own stroke stays 1:1, pinned inside the viewport by a margin.
 */
export function clampMenuDrag(
	x: number,
	y: number,
	viewportWidth: number,
	viewportHeight: number,
	margin = 8
): { x: number; y: number } {
	return {
		x: Math.min(Math.max(margin, x), viewportWidth - margin),
		y: Math.min(Math.max(margin, y), viewportHeight - margin)
	};
}

/** A touch point in client pixels. */
export interface MenuTouchPoint {
	x: number;
	y: number;
}

/** `menuBtnTouch` outcome: eat the tap, or run the button action. */
export type MenuBtnTouchAction = "suppress-drag" | "ignore" | "run";

/**
 * What a selection-menu touchend does. Order is the contract: a drag
 * that just ended eats the synthesized tap (750ms drift guard), then
 * a missing endpoint or a finger that drifted past the 14px tap slop
 * (handle nudge, not a tap) drops silently — only a settled tap runs.
 */
export function menuBtnTouchAction(facts: {
	now: number;
	suppressAt: number;
	start: MenuTouchPoint | null;
	end: MenuTouchPoint | null;
}): MenuBtnTouchAction {
	if (facts.now - facts.suppressAt < 750) return "suppress-drag";
	if (!facts.start || !facts.end) return "ignore";
	if (touchPastSlop(facts.start.x, facts.start.y, facts.end.x, facts.end.y, 14))
		return "ignore";
	return "run";
}

/**
 * Where a selection-menu drag moves the menu, or null while the
 * finger stays inside the 12px tap slop (no move yet). The caller
 * owns the suppress stamp and the assignment; this only resolves
 * the clamped target from the drag anchor plus the finger delta.
 */
export function selMenuDragTarget(
	drag: { mx: number; my: number; x0: number; y0: number },
	at: MenuTouchPoint,
	viewportWidth: number,
	viewportHeight: number
): { x: number; y: number } | null {
	if (!touchPastSlop(drag.mx, drag.my, at.x, at.y, 12)) return null;
	return clampMenuDrag(
		drag.x0 + (at.x - drag.mx),
		drag.y0 + (at.y - drag.my),
		viewportWidth,
		viewportHeight
	);
}

/**
 * Toast for an in-prompt note commit (REFACTOR §6): pending filings
 * save for the first time, a saved note's comment rewrites.
 */
export function annEditCommitToast(pending: boolean): string {
	return pending ? "Annotation sent" : "Annotation edited";
}
