/**
 * Repeat ink: each annotated quote takes an ink colour, and the same
 * text later in the chat (further down its message, or in any later
 * message) takes that ink too, so a word annotated once reads as known
 * wherever it comes back. Underlines only, never recoloured text: the
 * annotated quote takes a thin solid line in its ink, a repeat a
 * dotted one, and the text keeps its own colour (reading tints
 * included). Inks cycle through REPEAT_INK_COUNT hues chosen clear of
 * the reading colours (`--pair*`) and own-message inks
 * (`docs/design/colors.md`). Pure: the page decides,
 * `ann-repeat-paint.ts` paints.
 */
import type { Annotation } from "./annotations";
import type { ChatMsgId } from "./chat";
import {
	locateQuote,
	locateQuoteRepeats,
	type QuoteLocation
} from "./quote-match";

/** Hues in the cycle (`--rep-ink0` … in app.css). */
export const REPEAT_INK_COUNT = 3;

/** One quote to ink in one message. */
export interface RepeatInk {
	quote: string;
	/** Ink index, 0 … REPEAT_INK_COUNT - 1. */
	ink: number;
	/** First occurrence to ink (Annotation.at in the annotated
	 * message, 0 in later ones). */
	from: number;
}

/** Same text for inking: whitespace-free and case-folded (the
 * locator matches the same way). */
function repeatKey(quote: string): string {
	return quote.replace(/\s+/g, "").toLowerCase();
}

/**
 * Inks per message for a chat. The first annotation of each distinct
 * quote (chat order, then filing order) picks the next ink; later
 * annotations of the same text share it. A quote inks from its first
 * annotation onward: its own message from the annotated occurrence,
 * every later message whole, earlier messages never. Story-anchored
 * notes, quotes without letters or digits, and messages outside the
 * chat are left out. Messages without inks are absent.
 */
export function repeatInksByMessage(
	messageIds: readonly ChatMsgId[],
	list: readonly Annotation[]
): Map<ChatMsgId, RepeatInk[]> {
	const order = new Map<ChatMsgId, number>();
	messageIds.forEach((id, i) => order.set(id, i));
	const firsts = new Map<
		string,
		{ quote: string; index: number; at: number }
	>();
	const keys: string[] = [];
	for (const a of list) {
		if (!a.messageId) continue;
		const index = order.get(a.messageId);
		if (index === undefined) continue;
		const key = repeatKey(a.quote);
		if (!key || !/[\p{L}\p{N}]/u.test(key)) continue;
		const at = a.at ?? 0;
		const prev = firsts.get(key);
		if (!prev) keys.push(key);
		if (!prev || index < prev.index || (index === prev.index && at < prev.at))
			firsts.set(key, { quote: a.quote, index, at });
	}
	// Ink order follows the chat, then filing order within a message
	// (a stable sort): the topmost message's notes take the first inks.
	keys.sort(
		(x, y) => (firsts.get(x)?.index ?? 0) - (firsts.get(y)?.index ?? 0)
	);
	const out = new Map<ChatMsgId, RepeatInk[]>();
	keys.forEach((key, n) => {
		const first = firsts.get(key);
		if (!first) return;
		const ink = n % REPEAT_INK_COUNT;
		for (let i = first.index; i < messageIds.length; i++) {
			const id = messageIds[i];
			if (id === undefined) continue;
			const inks = out.get(id) ?? [];
			inks.push({
				quote: first.quote,
				ink,
				from: i === first.index ? first.at : 0
			});
			out.set(id, inks);
		}
	});
	return out;
}

/** An annotated quote in one message (a badge's quote and repeat). */
export interface InkMark {
	quote: string;
	at?: number;
}

/** One underline to draw: an ink over a located match. */
export interface InkSpan {
	ink: number;
	/** A repeat (dotted) rather than an annotated quote (solid). */
	again: boolean;
	loc: QuoteLocation;
}

/** Document order of two node positions. */
function before(
	aNode: number,
	aOffset: number,
	bNode: number,
	bOffset: number
): boolean {
	return aNode < bNode || (aNode === bNode && aOffset < bOffset);
}

function overlaps(a: QuoteLocation, b: QuoteLocation): boolean {
	return (
		before(a.startNode, a.startOffset, b.endNode, b.endOffset) &&
		before(b.startNode, b.startOffset, a.endNode, a.endOffset)
	);
}

function sameLoc(a: QuoteLocation, b: QuoteLocation): boolean {
	return (
		a.startNode === b.startNode &&
		a.startOffset === b.startOffset &&
		a.endNode === b.endNode &&
		a.endOffset === b.endOffset
	);
}

/**
 * Underlines for one message body over its text nodes: every match
 * of each ink's quote, solid where it is an annotated quote here (a
 * badge sits on it), dotted elsewhere. A repeat inside another
 * annotated quote is left out, so an annotated quote reads as one
 * line in its own ink end to end, never broken by a nested repeat.
 * Pure: node texts in.
 */
export function inkSpans(
	nodeTexts: string[],
	inks: readonly RepeatInk[],
	marks: readonly InkMark[]
): InkSpan[] {
	if (inks.length === 0) return [];
	const marked: QuoteLocation[] = [];
	for (const mark of marks) {
		const loc = locateQuote(nodeTexts, mark.quote, mark.at ?? 0);
		if (loc) marked.push(loc);
	}
	const out: InkSpan[] = [];
	for (const { quote, ink, from } of inks) {
		for (const loc of locateQuoteRepeats(nodeTexts, quote, from)) {
			const solid = marked.some((m) => sameLoc(m, loc));
			if (!solid && marked.some((m) => overlaps(m, loc))) continue;
			out.push({ ink, again: !solid, loc });
		}
	}
	return out;
}
