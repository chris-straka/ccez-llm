/**
 * Listening drill chat operations over `ChatState`: start a drill,
 * show the next clip, answer one, land its grading, close with the
 * tally. Messages are replaced, never mutated (proxy signals need the
 * swap), and every change persists like the other chat ops.
 */

import {
	newChatMsgId,
	persistChats,
	type Chat,
	type ChatId,
	type ChatMsg,
	type ChatMsgId,
	type ChatState
} from "./chat";
import { answerClip, clipContent, type ClipNote, type ClipState, type ListenSession } from "./listen";
import type { KeyValueStore } from "./settings";

function chatById(state: ChatState, id: ChatId): Chat | undefined {
	return state.chats.find((c) => c.id === id);
}

function clipMessage(i: number): ChatMsg {
	return { id: newChatMsgId(), role: "assistant", content: "", usage: null, error: null, clip: { i } };
}

/** Turn an (empty) chat into a drill on `session`, clip 1 showing. */
export function startDrill(
	state: ChatState,
	chatId: ChatId,
	session: ListenSession,
	store?: KeyValueStore
): ChatMsgId | null {
	const chat = chatById(state, chatId);
	if (!chat || session.clips.length === 0) return null;
	const first = clipMessage(0);
	chat.listen = session;
	chat.replyLang = session.lang;
	chat.title = session.title;
	chat.titleBy = "user";
	chat.messages = [first];
	persistChats(state, store);
	return first.id;
}

/** The clip waiting for a guess (the newest unanswered one). */
export function openClip(chat: Chat): ChatMsg | null {
	const last = chat.messages.at(-1);
	return last?.clip && last.clip.heard === undefined ? last : null;
}

/** Clip number the drill shows next (count of clip rows so far). */
export function nextClipIndex(chat: Chat): number {
	return chat.messages.filter((m) => m.clip).length;
}

/**
 * Show the next clip; past the last one, the tally row instead.
 * Returns the new row's id (null when the drill already ended).
 */
export function advanceDrill(state: ChatState, chatId: ChatId, store?: KeyValueStore): ChatMsgId | null {
	const chat = chatById(state, chatId);
	if (!chat?.listen || chat.messages.some((m) => m.drillEnd)) return null;
	const i = nextClipIndex(chat);
	const row: ChatMsg =
		i < chat.listen.clips.length
			? clipMessage(i)
			: { id: newChatMsgId(), role: "assistant", content: "", usage: null, error: null, drillEnd: true };
	chat.messages = [...chat.messages, row];
	persistChats(state, store);
	return row.id;
}

function updateClip(
	state: ChatState,
	chatId: ChatId,
	match: (m: ChatMsg) => boolean,
	next: (clip: ClipState, text: string) => ClipState,
	store?: KeyValueStore
): ClipState | null {
	const chat = chatById(state, chatId);
	if (!chat?.listen) return null;
	const clips = chat.listen.clips;
	let updated: ClipState | null = null;
	chat.messages = chat.messages.map((m) => {
		if (!m.clip || !match(m)) return m;
		const text = clips[m.clip.i]?.text ?? "";
		const clip = next(m.clip, text);
		updated = clip;
		// The transcript shows once answered, never before.
		const content = clip.heard === undefined ? "" : clipContent(text, clip);
		return { ...m, clip, content };
	});
	if (updated) persistChats(state, store);
	return updated;
}

/** Answer a clip (`guess` null = "?" reveal). Instant: the diff is local. */
export function answerDrillClip(
	state: ChatState,
	chatId: ChatId,
	msgId: ChatMsgId,
	guess: string | null,
	store?: KeyValueStore
): ClipState | null {
	const lang = chatById(state, chatId)?.listen?.lang ?? "";
	return updateClip(
		state,
		chatId,
		(m) => m.id === msgId && m.clip?.heard === undefined,
		(clip, text) => answerClip(text, clip, guess, lang),
		store
	);
}

/** Mark clip `i`'s grading in flight. */
export function markGrading(state: ChatState, chatId: ChatId, i: number, store?: KeyValueStore): void {
	updateClip(state, chatId, (m) => m.clip?.i === i, (clip) => ({ ...clip, grade: "pending" }), store);
}

/** Land clip `i`'s translation and notes (null = it failed). */
export function landGrade(
	state: ChatState,
	chatId: ChatId,
	i: number,
	grade: { translation: string; notes: ClipNote[] } | null,
	store?: KeyValueStore
): void {
	updateClip(
		state,
		chatId,
		(m) => m.clip?.i === i,
		(clip) =>
			grade
				? { ...clip, translation: grade.translation, notes: grade.notes, grade: "done" }
				: { ...clip, grade: "error" },
		store
	);
}

/** Clip states in clip order (for the tally). */
export function drillStates(chat: Chat): ClipState[] {
	return chat.messages.flatMap((m) => (m.clip ? [m.clip] : []));
}

/** The session's spoken text before clip `i` (grading context). */
export function clipBefore(session: ListenSession, i: number): string | null {
	return i > 0 ? (session.clips[i - 1]?.text ?? null) : null;
}

export { type Chat };
