/**
 * Per-chat memory that must survive switching chats: when each send
 * started (so the thinking count shows the request's true age) and
 * the composer text left unsent in each chat. Session memory only.
 */
import type { ChatId } from "./chat";

/**
 * Keep one start time per sending chat: chats that just started
 * sending get `now`, chats that stopped drop out, and chats still
 * sending keep the time they started — looking at another chat in
 * between never resets it.
 */
export function syncSendStarts(
	starts: Map<ChatId, number>,
	live: Iterable<ChatId>,
	now: number
): void {
	const sending = new Set(live);
	for (const id of sending) if (!starts.has(id)) starts.set(id, now);
	for (const id of [...starts.keys()]) if (!sending.has(id)) starts.delete(id);
}

/** Whole seconds since the chat's send started; 0 when it is not sending. */
export function sendAgeSec(
	starts: ReadonlyMap<ChatId, number>,
	id: ChatId,
	now: number
): number {
	const at = starts.get(id);
	return at === undefined ? 0 : Math.max(0, Math.floor((now - at) / 1000));
}

/** What a chat's composer held when it was left. */
export interface ComposerDraft<A> {
	text: string;
	/** Pills (images, files, pasted text) whose tags sit in `text`. */
	attachments: A[];
}

/**
 * File the composer a chat is left with: a blank prompt with nothing
 * attached clears the entry, so an emptied prompt comes back empty.
 */
export function fileComposerDraft<A>(
	drafts: Map<ChatId, ComposerDraft<A>>,
	id: ChatId,
	draft: ComposerDraft<A>
): void {
	if (draft.text.trim() === "" && draft.attachments.length === 0)
		drafts.delete(id);
	else drafts.set(id, draft);
}
