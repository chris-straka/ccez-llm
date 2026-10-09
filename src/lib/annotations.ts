/**
 * Annotation model: a quoted selection from a message plus an optional
 * comment, wrapped into the next query. Ids, add/delete/pin list verbs,
 * badge marks, and small UI helpers. Quote matching lives in
 * quote-match.ts, the baked text block in annotation-block.ts, draft
 * storage in annotation-drafts-store.ts, and menu/panel geometry in
 * sel-geometry.ts.
 */
import type { ChatMsgId } from "./chat";
import type { AnnotationRef } from "./annotation-block";

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
	 * Memory-only (badges stamp from live annotations).
	 */
	aidScope?: "tashkeel";
	/**
	 * Which repeat of the quote was selected (0-based, default 0):
	 * annotating the last "c" in "ccc" stores 2, so the badge lands
	 * where the selection was instead of the first match. Persisted
	 * with drafts, never baked into message text (the baked block
	 * carries quote, comment, and answer only).
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
	/**
	 * Filed by bare A (the instant path, no note): answered as a short
	 * gloss instead of the full lesson Shift+A and typed questions get.
	 */
	brief?: boolean;
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
 * Numbering/preview core behind buildMarksFor/buildStoryMarks: filed
 * notes take their filing order (per message or story, never
 * chat-global), plus the pending preview when it belongs here.
 */
function numberMarks(
	mine: Annotation[],
	pending: Annotation | null,
	pendingHere: boolean,
	withAidScope: boolean
): AnnotationMark[] {
	const saved: AnnotationMark[] = mine.map((a, i) => ({
		id: a.id,
		number: i + 1,
		quote: a.quote,
		at: a.at ?? 0,
		...(withAidScope && a.aidScope ? { aidScope: a.aidScope } : {}),
		answer: a.answer ? "ready" : "waiting"
	}));
	if (pending && pendingHere) {
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
 * Badge array for one message, unmemoized: aid-scoped
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
	return numberMarks(mine, pending, pending?.messageId === messageId, true);
}

/**
 * Badge array for one news headline: the story's own filing order,
 * pending preview included, no aid scope (headlines never carry
 * aids). Mirrors buildMarksFor.
 */
export function buildStoryMarks(
	list: Annotation[],
	link: string,
	pending: Annotation | null
): AnnotationMark[] {
	const mine = list.filter((a) => a.story?.link === link);
	return numberMarks(mine, pending, pending?.story?.link === link, false);
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
 * Pinned or hover-peeked model-aid text for a message:
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
 * Copy one annotation: quote plus comment, no numbers.
 */
export function annotationCopyText(quote: string, comment: string): string {
	return comment.trim() ? `"${quote}" — ${comment.trim()}` : `"${quote}"`;
}

/**
 * File a pending annotation with its draft comment:
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
 * Wash id for an in-prompt note edit: a pending
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
 * Toast for an in-prompt note commit: pending filings
 * save for the first time, a saved note's comment rewrites.
 */
export function annEditCommitToast(pending: boolean): string {
	return pending ? "Annotation sent" : "Annotation edited";
}
