/**
 * Repeat ink: each annotated quote takes an ink colour, and the same
 * text later in the chat (further down its message, or in any later
 * message) takes that ink too, so a word annotated once reads as known
 * wherever it comes back. Colour, never dimming or underlines: the
 * text stays as readable as the rest. Inks cycle through
 * REPEAT_INK_COUNT hues chosen clear of the reading colours
 * (`--pair*`) and own-message inks (`docs/design/colors.md`). Pure:
 * the page decides, `ann-repeat-paint.ts` paints.
 */
import type { Annotation } from "./annotations";
import type { ChatMsgId } from "./chat";

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
