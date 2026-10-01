import type {
	ChatMessage,
	ChatProvider,
	ContentPart,
	TokenUsage
} from "./providers/types";
import { messageText } from "./providers/types";
import type { Attachment } from "./attachments";
import { stripAttachmentMarkers } from "./attachments";
import type { KeyValueStore } from "./settings";
import { memoryStore } from "./settings";
import { replyLanguageFor } from "./languages";

/**
 * Opaque identifiers: still plain strings at runtime (comparisons,
 * template slots, and Map/Record keys all keep working), but a chat id
 * can never be passed where a message id is expected. The compiler, not
 * discipline, catches the swap.
 */
export type ChatId = string & { readonly kind: "chat" };
export type ChatMsgId = string & { readonly kind: "message" };

/**
 * A collapsed pasted span inside a user message: UTF-16 offsets into
 * `content` as sent. Display-only — the API always sees full content.
 */
export interface PasteFold {
	start: number;
	end: number;
	chars: number;
	/** True once the user unfolded it (persisted). Default: folded. */
	open?: boolean;
}

export interface ChatMsg {
	id: ChatMsgId;
	role: "user" | "assistant";
	content: string;
	usage: TokenUsage | null;
	/** Set when the assistant reply failed; the message is retryable. */
	error: string | null;
	/** Files/images sent with a user message (persisted with history). */
	attachments?: Attachment[];
	/** Collapsed pastes, captured at send time (persisted with history). */
	pasteFolds?: PasteFold[];
}

export interface Chat {
	id: ChatId;
	createdAt: number;
	messages: ChatMsg[];
	/** Reply-language pill code for this chat only (null = off). */
	replyLang: string | null;
	/**
	 * Correction mode for this chat only (default off): the model also
	 * corrects the user's last message into a ```correction block.
	 * False for every chat written before the toggle existed (see
	 * loadChats healing).
	 */
	correction: boolean;
	/**
	 * Voice-readback override for this chat only: true/false wins over
	 * the global default, null follows it. Null for every chat written
	 * before the override existed (see loadChats healing).
	 */
	voice: boolean | null;
	/**
	 * Rolling summary of this chat's compacted prefix (see
	 * selectHistoryWindow): what the model reads instead of the old
	 * turns. Absent until the first compaction; persisted with the
	 * chat, invisible plumbing (never rendered).
	 */
	summary?: string;
	/**
	 * Newest message id folded into `summary`: everything at or
	 * before it sends as summary, everything after sends verbatim.
	 * An id (not an index), so deletes and truncates can't silently
	 * shift it — a missing id heals by rebuilding from full history
	 * (lossless: compaction never deletes messages).
	 */
	summaryThrough?: ChatMsgId;
	/**
	 * Visual trim watermark: everything strictly above this message id
	 * hides behind the slim "N messages trimmed" marker (hover+T sets
	 * it, Undo clears it). Independent of the compaction watermark —
	 * a missing id heals to untrimmed (trimming never deletes).
	 */
	trimmedThrough?: ChatMsgId;
}

/**
 * Plain-object chat state. The UI holds this in `$state` (runes proxy plain
 * objects reliably); every function below mutates it in place so updates
 * always notify. All logic is UI-agnostic and unit-tested.
 */
export interface ChatState {
	chats: Chat[];
	activeChatId: ChatId;
	/** Any reply streaming anywhere (kept for global readers: ticker, edit gates). */
	sending: boolean;
	/**
	 * Chat that owns the in-flight reply (null when idle). A send keeps
	 * streaming into its own chat when the user looks elsewhere, so the
	 * Thinking indicator — and the tokens — never leak onto whatever
	 * chat replaces it. Never persisted: reloads always boot idle.
	 * With concurrent sends this tracks the most recent one; the full
	 * set lives in `sendingChatIds`.
	 */
	sendingChatId: ChatId | null;
	/**
	 * Every chat with a reply currently streaming. Sends lock per chat,
	 * not globally: chat B sends while chat A still streams. Never
	 * persisted: reloads always boot idle.
	 */
	sendingChatIds: ChatId[];
	/**
	 * Every sending chat whose reply visibly started (first token
	 * landed). The thinking chip shows only before this: once tokens
	 * print, thinking is over even though the send still runs. Never
	 * persisted, cleared with the send.
	 */
	replyStartedChatIds: ChatId[];
	/**
	 * Every sending chat with a page fetch in flight right now (the
	 * model's fetch_url tool). The Fetching chip shows while listed,
	 * even after tokens printed — a fetch gap after chatter would
	 * otherwise read as a stall. Never persisted, cleared with the
	 * send (and on every fetch end, so a failed fetch can't strand it).
	 */
	fetchActiveChatIds: ChatId[];
}

/** True when the given chat (default: active) has a reply streaming. */
export function isSending(state: ChatState, id?: ChatId): boolean {
	return state.sendingChatIds.includes(id ?? state.activeChatId);
}

/** True when the given chat's reply visibly started (first token landed). */
export function hasReplyStarted(state: ChatState, id?: ChatId): boolean {
	return state.replyStartedChatIds.includes(id ?? state.activeChatId);
}

/** Flag a chat's reply started (first token landed) — the thinking
chip reads this. Both engines (TypeScript stream, native turn events)
raise it the same way. */
export function markReplyStarted(state: ChatState, id?: ChatId): void {
	const chatId = id ?? state.activeChatId;
	if (!state.replyStartedChatIds.includes(chatId))
		state.replyStartedChatIds = [...state.replyStartedChatIds, chatId];
}

/** Clear a chat's reply-started flag — a retracted tool round (or a
retried native turn) goes back to thinking dots until tokens land
again. Both engines lower it the same way. */
export function unmarkReplyStarted(state: ChatState, id?: ChatId): void {
	const chatId = id ?? state.activeChatId;
	state.replyStartedChatIds = state.replyStartedChatIds.filter(
		(c) => c !== chatId
	);
}

/** True when the given chat has a page fetch in flight right now. */
export function hasFetchActive(state: ChatState, id?: ChatId): boolean {
	return state.fetchActiveChatIds.includes(id ?? state.activeChatId);
}

const STORAGE_KEY = "ccez-llm-chats-v1";
/** Pre-rename key (ccez-studio era): read once, then saves move to STORAGE_KEY. */
const LEGACY_STORAGE_KEY = "ccez-studio-chats-v1";

export function newChatId(): ChatId {
	return crypto.randomUUID() as ChatId;
}

export function newChatMsgId(): ChatMsgId {
	return crypto.randomUUID() as ChatMsgId;
}

function blankChat(): Chat {
	return {
		id: newChatId(),
		createdAt: Date.now(),
		messages: [],
		replyLang: null,
		correction: false,
		voice: null
	};
}

function browserStore(): KeyValueStore | null {
	try {
		if (typeof localStorage === "undefined") return null;
		return localStorage;
	} catch {
		return null;
	}
}

export function createChatState(store?: KeyValueStore): ChatState {
	const state: ChatState = {
		chats: [],
		activeChatId: "" as ChatId,
		sending: false,
		sendingChatId: null,
		sendingChatIds: [],
		replyStartedChatIds: [],
		fetchActiveChatIds: []
	};
	loadChats(state, store ?? browserStore() ?? memoryStore);
	if (state.chats.length === 0) {
		const chat = blankChat();
		state.chats = [chat];
		state.activeChatId = chat.id;
	}
	if (!state.chats.some((c) => c.id === state.activeChatId)) {
		// Land on the newest chat (last), as before — only the order
		// flipped, not the destination.
		const last = state.chats[state.chats.length - 1];
		if (!last) {
			const chat = blankChat();
			state.chats = [chat];
			state.activeChatId = chat.id;
		} else {
			state.activeChatId = last.id;
		}
	}
	return state;
}

export function activeChat(state: ChatState): Chat {
	const chat = state.chats.find((c) => c.id === state.activeChatId);
	if (!chat) throw new Error("No active chat");
	return chat;
}

export function newChat(state: ChatState, store?: KeyValueStore): void {
	const chat = blankChat();
	// Newest at the bottom, next to the add button — never prepend.
	state.chats = [...state.chats, chat];
	state.activeChatId = chat.id;
	persistChats(state, store);
}

export function selectChat(state: ChatState, id: ChatId): void {
	if (state.chats.some((c) => c.id === id)) state.activeChatId = id;
}

/**
 * Fold/unfold one pasted span, replacing the message object (never
 * mutating in place — proxy signals need the swap). No-op on bad ids.
 * Persists like siblings.
 */
export function setPasteFold(
	state: ChatState,
	msgId: ChatMsgId,
	index: number,
	open: boolean,
	store?: KeyValueStore
): void {
	for (const chat of state.chats) {
		const at = chat.messages.findIndex((m) => m.id === msgId);
		if (at < 0) continue;
		const msg = chat.messages[at];
		const folds = msg?.pasteFolds;
		if (!msg || !folds || index < 0 || index >= folds.length) return;
		const fold = folds[index];
		if (!fold) return;
		chat.messages = [
			...chat.messages.slice(0, at),
			{
				...msg,
				pasteFolds: [
					...folds.slice(0, index),
					{ ...fold, open },
					...folds.slice(index + 1)
				]
			},
			...chat.messages.slice(at + 1)
		];
		persistChats(state, store);
		return;
	}
}

/** Set (or clear) one chat's reply-language pill. Persists like siblings. */
export function setChatReplyLang(
	state: ChatState,
	id: ChatId,
	code: string | null,
	store?: KeyValueStore
): void {
	const target = state.chats.find((c) => c.id === id);
	if (!target) return;
	target.replyLang = code;
	persistChats(state, store);
}

/** Set (or clear) one chat's correction-mode toggle. Persists like siblings. */
export function setChatCorrection(
	state: ChatState,
	id: ChatId,
	on: boolean,
	store?: KeyValueStore
): void {
	const target = state.chats.find((c) => c.id === id);
	if (!target) return;
	target.correction = on;
	persistChats(state, store);
}

/**
 * Send-button hold swap (touch): holding with a reply language set
 * stashes it and drops back to default; holding with none restores
 * the stash. Pure toggle core — the component keeps the stash per
 * chat and calls setChatReplyLang with the outcome.
 */
export function swapReplyLang(
	current: string | null,
	stash: string | null
): { current: string | null; stash: string | null } {
	if (current !== null) return { current: null, stash: current };
	if (stash !== null) return { current: stash, stash };
	return { current, stash };
}

/**
 * Effective voice readback for one chat: its own override when set,
 * else the global default. Pure so the page and tests share it.
 */
export function chatVoiceReadback(chat: Chat, globalDefault: boolean): boolean {
	return chat.voice ?? globalDefault;
}

/** Set (or clear back to follow-global) one chat's readback override. Persists like siblings. */
export function setChatVoice(
	state: ChatState,
	id: ChatId,
	value: boolean | null,
	store?: KeyValueStore
): void {
	const target = state.chats.find((c) => c.id === id);
	if (!target) return;
	target.voice = value;
	persistChats(state, store);
}

/** Abort controllers for in-flight sends, keyed by owning chat (see abortSend). */
const inflightByChat = new Map<ChatId, AbortController>();

/**
 * Abort in-flight sends: one chat's when given an id, all of them
 * without one. Dropping a chat mid-stream must kill its network
 * request too — otherwise it pointlessly finishes into a chat that no
 * longer exists. (Merely looking at another chat never aborts: each
 * stream stays pinned to its origin via sendingChatId.)
 */
export function abortSend(chatId?: ChatId): void {
	if (chatId === undefined) {
		for (const controller of inflightByChat.values()) controller.abort();
		inflightByChat.clear();
		return;
	}
	inflightByChat.get(chatId)?.abort();
	inflightByChat.delete(chatId);
}

export function deleteChat(
	state: ChatState,
	id: ChatId,
	store?: KeyValueStore
): void {
	abortSend(id);
	const at = state.chats.findIndex((c) => c.id === id);
	state.chats = state.chats.filter((c) => c.id !== id);
	if (state.chats.length === 0) state.chats = [blankChat()];
	if (!state.chats.some((c) => c.id === state.activeChatId)) {
		// Land on the chat that slid into the deleted one's place (the
		// one right below it), or the new bottom one if it was last.
		const target =
			state.chats[Math.min(Math.max(at, 0), state.chats.length - 1)];
		if (target) state.activeChatId = target.id;
	}
	persistChats(state, store);
}

export function deleteMessage(
	state: ChatState,
	index: number,
	store?: KeyValueStore
): void {
	const chat = activeChat(state);
	// Removing the streaming placeholder mid-flight strands it the same
	// way dropping the chat does — kill the send with it.
	const target = chat.messages[index];
	if (
		isSending(state) &&
		target?.role === "assistant" &&
		index === chat.messages.length - 1
	) {
		abortSend(chat.id);
	}
	chat.messages = chat.messages.filter((_, i) => i !== index);
	persistChats(state, store);
}

/**
 * Stage the draft as the most recent message (⌥+Enter) without sending.
 * The model never sees it until the next submit carries the full history.
 * No-op while a reply streams (same quiet rule as sends).
 */
export function stageMessage(
	state: ChatState,
	text: string,
	attachments: Attachment[] = [],
	store?: KeyValueStore
): void {
	const trimmed = text.trim();
	if ((!trimmed && attachments.length === 0) || isSending(state)) return;
	const chat = activeChat(state);
	chat.messages = [
		...chat.messages,
		{
			id: newChatMsgId(),
			role: "user",
			content: trimmed,
			usage: null,
			error: null,
			...(attachments.length > 0 ? { attachments } : {})
		}
	];
	persistChats(state, store);
}

/** Copy messages up to `index` (inclusive) into a new chat. */
export function branchFrom(
	state: ChatState,
	index: number,
	store?: KeyValueStore
): void {
	const source = activeChat(state);
	const fork: Chat = {
		...blankChat(),
		messages: source.messages
			.slice(0, index + 1)
			.map((m) => ({ ...m, id: newChatMsgId(), error: null }))
	};
	state.chats = [...state.chats, fork];
	state.activeChatId = fork.id;
	persistChats(state, store);
}

/** Drop a failed assistant reply so the same prompt can go again. */
export function dismissFailedAssistant(
	state: ChatState,
	store?: KeyValueStore
): void {
	const chat = activeChat(state);
	const last = chat.messages[chat.messages.length - 1];
	if (last?.role === "assistant" && last.error) {
		chat.messages = chat.messages.slice(0, -1);
		persistChats(state, store);
	}
}

/** Drop the last assistant reply (failed or not) to regenerate it. */
export function takeBackLastReply(
	state: ChatState,
	store?: KeyValueStore
): void {
	const chat = activeChat(state);
	const last = chat.messages[chat.messages.length - 1];
	if (last?.role === "assistant") {
		chat.messages = chat.messages.slice(0, -1);
		persistChats(state, store);
	}
}

/**
 * Rerun from any user message: delete everything after it (unlike branch,
 * which keeps the original), so the prompt can go again cleanly.
 */
export function truncateToMessage(
	state: ChatState,
	index: number,
	store?: KeyValueStore
): void {
	const chat = activeChat(state);
	if (index < 0 || index >= chat.messages.length) return;
	if (chat.messages[index]?.role !== "user") return;
	chat.messages = chat.messages.slice(0, index + 1);
	persistChats(state, store);
}

/**
 * In-place edit of an own message (a corrected typo, no resend):
 * replace its content, attachments, and paste folds without touching
 * the rest of history. The message object is replaced, never mutated
 * (proxy signals can hold stale reads). Unknown ids and non-user
 * targets are no-ops (false).
 */
export function editMessageContent(
	state: ChatState,
	id: ChatMsgId,
	content: string,
	opts: {
		attachments?: Attachment[] | undefined;
		pasteFolds?: PasteFold[] | undefined;
	} = {},
	store?: KeyValueStore
): boolean {
	const chat = activeChat(state);
	const index = chat.messages.findIndex((m) => m.id === id);
	const msg = chat.messages[index];
	if (!msg || msg.role !== "user") return false;
	chat.messages = chat.messages.map((m, i) => {
		if (i !== index) return m;
		const next: ChatMsg = { ...m, content };
		if (opts.attachments !== undefined) next.attachments = opts.attachments;
		if (opts.pasteFolds !== undefined) next.pasteFolds = opts.pasteFolds;
		return next;
	});
	persistChats(state, store);
	return true;
}

/** Resend the last user message (used after dismissing a failed reply or taking one back). */
export async function resendLast(
	state: ChatState,
	provider: ChatProvider,
	systemPrompt: string,
	opts: {
		store?: KeyValueStore | undefined;
		thinking?: string | undefined;
		onFirstToken?: (() => void) | undefined;
		onToken?: (() => void) | undefined;
	} = {}
): Promise<void> {
	const chat = activeChat(state);
	const last = chat.messages[chat.messages.length - 1];
	if (!last || last.role !== "user" || state.sendingChatIds.includes(chat.id))
		return;
	await streamAssistantReply(
		state,
		provider,
		systemPrompt,
		{
			thinking: opts.thinking,
			onFirstToken: opts.onFirstToken,
			onToken: opts.onToken
		},
		opts.store
	);
}

export function tokenTotal(state: ChatState, chat?: Chat): number {
	const target = chat ?? activeChat(state);
	return target.messages.reduce((sum, m) => sum + (m.usage?.total ?? 0), 0);
}

/** Per-chat input/output split, summed from each message's reported usage. */
export function tokenSplit(
	state: ChatState,
	chat?: Chat
): { prompt: number; completion: number } {
	const target = chat ?? activeChat(state);
	let prompt = 0;
	let completion = 0;
	for (const m of target.messages) {
		prompt += m.usage?.prompt ?? 0;
		completion += m.usage?.completion ?? 0;
	}
	return { prompt, completion };
}

/**
 * Compact token count: full digits under 1000, then K/M/B with at most one
 * decimal (100+ drops the fraction; anything rounding to 1000 rolls up to
 * the next unit) so the header counter holds its width.
 */
export function formatTokens(n: number): string {
	const count = Math.max(0, Math.floor(n));
	if (count < 1000) return String(count);
	let divisor =
		count < 1_000_000
			? 1_000
			: count < 1_000_000_000
				? 1_000_000
				: 1_000_000_000;
	const suffix = (): string =>
		divisor === 1_000 ? "K" : divisor === 1_000_000 ? "M" : "B";
	const text = (): string => {
		const rounded = Math.round((count / divisor) * 10) / 10;
		return rounded >= 100 ? String(Math.round(rounded)) : String(rounded);
	};
	// Anything formatting as "1000" rolls up one unit (exact string check —
	// no float-threshold gambling). Terminates: B never rolls up.
	if (text() === "1000" && divisor < 1_000_000_000) divisor *= 1000;
	return text() + suffix();
}

/** Message indices that start a user turn — the waypoint jump targets. */
export function waypoints(state: ChatState, chat?: Chat): number[] {
	const target = chat ?? activeChat(state);
	const out: number[] = [];
	target.messages.forEach((m, i) => {
		if (m.role === "user") out.push(i);
	});
	return out;
}

/**
 * Waypoint position from laid-out message tops: the count of
 * targets at or above the scroll line (120px grace), minimum 1 —
 * the menu highlights where the thread sits. Offsets arrive in
 * message order (a missing node ends the run); empty stays 1.
 * Pure and unit-tested.
 */
export function waypointIndexAt(offsets: number[], scrollTop: number): number {
	let n = 0;
	for (const offset of offsets) {
		if (offset - scrollTop <= 120) n++;
		else break;
	}
	return Math.max(1, n);
}

/**
 * Menu label for a waypoint jump target: the message's first line,
 * whitespace-collapsed and capped (may be empty for blank messages —
 * callers fall back).
 */
export function waypointLabel(content: string, max = 60): string {
	// Code-point cut (see cutPreview in render-math): slice() would
	// split astral characters into lone surrogates. No marker here —
	// the waypoint menu has no room for one — so overlong labels
	// crop silently exactly as before for BMP text.
	return Array.from(content.replace(/\s+/g, " ").trim()).slice(0, max).join("");
}

/**
 * History compaction budget (chat cap, never per-message: long single
 * messages always send whole). Recent turns send verbatim up to the
 * window; older ones roll into the chat summary (see
 * selectHistoryWindow). Every send stays bounded no matter how long
 * the chat runs.
 */
/** Verbatim window per send (~8k tokens estimated). */
export const HISTORY_WINDOW_CHARS = 32000;
/** Last turns that always stay verbatim, however large (2 turns). */
export const MIN_VERBATIM_MESSAGES = 4;
/** Smallest overflow worth a refresh call (below this the middle
 * drops for one send and accumulates toward the next). */
export const MIN_FOLD_CHARS = 2000;
/** Most overflow folded per refresh (giant histories converge over
 * several sends instead of one huge summary call). */
export const MAX_FOLD_CHARS = 32000;
/** Stored summary cap (code-point safe). */
export const MAX_SUMMARY_CHARS = 2500;
/** Summary length the refresh prompt asks for. */
export const SUMMARY_WORDS = 400;

/**
 * Rough token estimate for cap decisions (chars/4, rounded up):
 * deliberately crude — the cap bounds growth, it doesn't budget
 * precisely (CJK-dense chats undercount; 128k-context models don't
 * care). Pure.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Chars of one message as sent (markers stripped, text attachments inlined). */
function sentChars(m: ChatMsg): number {
	const content = apiContent(m);
	return (typeof content === "string" ? content : messageText(content)).length;
}

/** One history window: what sends verbatim, what folds this round. */
export interface HistoryWindow {
	/** Resolved prior summary (null when absent or orphaned). */
	summary: string | null;
	/** Newest turns, verbatim. */
	turns: ChatMsg[];
	/** Oldest-beyond-window turns to fold now (empty when no refresh). */
	fold: ChatMsg[];
}

/**
 * Split a chat's history for one send: the resolved prior summary
 * plus a newest-first verbatim window (failed replies never send,
 * the live placeholder never counts), and the oldest-beyond-window
 * chunk to fold into the summary next. Pure over the chat; both
 * engines share it (TypeScript refreshes inline, the native runner
 * refreshes in Rust — same rule, same bounds).
 *
 * Healing without loss: a summary whose watermark id is gone
 * (deleted, truncated) rebuilds from full history — compaction
 * never deletes messages, so the content is all still there. An
 * edit inside the summarized prefix leaves the summary slightly
 * stale (accepted: ancient-turn edits are rare and harmless).
 */
export function selectHistoryWindow(
	chat: Chat,
	excludeId?: ChatMsgId
): HistoryWindow {
	const eligible = chat.messages.filter(
		(m) => m.id !== excludeId && !(m.role === "assistant" && m.error)
	);
	let summary: string | null =
		chat.summary && chat.summary.length > 0 ? chat.summary : null;
	let throughIdx = -1;
	if (summary !== null) {
		const at = eligible.findIndex((m) => m.id === chat.summaryThrough);
		if (at === -1) summary = null;
		else throughIdx = at;
	}
	const fresh = eligible.slice(throughIdx + 1);
	// Newest-first window: fill to the cap, but always keep the
	// floor count (long single messages send whole, per the chat
	// cap — never per-message).
	const turns: ChatMsg[] = [];
	let kept = 0;
	for (let i = fresh.length - 1; i >= 0; i--) {
		const m = fresh[i];
		if (!m) continue;
		if (
			turns.length >= MIN_VERBATIM_MESSAGES &&
			kept + sentChars(m) > HISTORY_WINDOW_CHARS
		)
			break;
		turns.unshift(m);
		kept += sentChars(m);
	}
	// Fold oldest-first up to the per-refresh cap (giant histories
	// converge over several sends); below the minimum the middle
	// drops for this send and accumulates toward the next refresh.
	// Each message counts capped, so a lone giant message folds its
	// head (see renderFoldText) instead of wedging the watermark
	// behind it forever.
	const candidates = fresh.slice(0, fresh.length - turns.length);
	const fold: ChatMsg[] = [];
	let folded = 0;
	for (const m of candidates) {
		const size = Math.min(sentChars(m), MAX_FOLD_CHARS);
		if (folded + size > MAX_FOLD_CHARS) break;
		fold.push(m);
		folded += size;
	}
	if (folded < MIN_FOLD_CHARS) fold.length = 0;
	return { summary, turns, fold };
}

/** Summary as the model reads it: a labeled system block, never prose
 * that could pass as chat history. Mirrored in Rust (`summary_block`
 * in turn.rs) — keep the marker text identical. */
export function summaryBlock(summary: string): string {
	return `Earlier in this chat (summarized for context, not verbatim):\n${summary}`;
}

/** Folded turns rendered for the refresh call (text only: old images
 * fall out of refresh scope, their captions ride the prose). Each
 * message caps at the fold budget (code-point safe), so giant old
 * messages fold truncated instead of ballooning the refresh call.
 * Pure. */
export function renderFoldText(fold: ChatMsg[]): string {
	return fold
		.map((m) => {
			const content = apiContent(m);
			const text = typeof content === "string" ? content : messageText(content);
			const points = Array.from(text);
			const body =
				points.length > MAX_FOLD_CHARS
					? `${points.slice(0, MAX_FOLD_CHARS).join("")}\n[…message truncated…]`
					: text;
			return `${m.role === "user" ? "User" : "Assistant"}: ${body}`;
		})
		.join("\n\n");
}

/**
 * One-shot messages merging overflowed history into the rolling
 * summary: the system caps the length, the user carries the prior
 * summary (when one exists) plus the newly folded turns. Pure; the
 * Rust engine mirrors the text (`SUMMARY_REFRESH_SYSTEM` there).
 */
export function buildSummaryRefreshMessages(
	prior: string | null,
	foldText: string
): ChatMessage[] {
	return [
		{
			role: "system",
			content:
				`Summarize the earlier part of an ongoing chat so a future reply can use it ` +
				`as context. Keep names, decisions, open questions, and language-learning ` +
				`goals. Third person, at most ${SUMMARY_WORDS} words, plain prose.`
		},
		{
			role: "user",
			content:
				prior !== null && prior.length > 0
					? `Previous summary:\n${prior}\n\nMore history:\n${foldText}`
					: foldText
		}
	];
}

/**
 * Roll the chat's summary forward when overflowed history awaits a
 * fold: one short non-streaming call, then the summary and watermark
 * advance and persist. No fold pending means no call (the common
 * case costs nothing). Failures are silent by design — the send
 * still goes out windowed (bounded, middle dropped for that send),
 * and the next send retries the fold. Only a stop aborts: it
 * rethrows so the send settles like any mid-stream stop.
 */
export async function refreshChatSummary(
	state: ChatState,
	chat: Chat,
	provider: ChatProvider,
	opts: { signal?: AbortSignal | undefined; excludeId?: ChatMsgId | undefined },
	store?: KeyValueStore
): Promise<void> {
	const { summary, fold } = selectHistoryWindow(chat, opts.excludeId);
	if (fold.length === 0) return;
	let result: { content: string };
	try {
		result = await provider.chat(
			buildSummaryRefreshMessages(summary, renderFoldText(fold)),
			{ signal: opts.signal }
		);
	} catch (error) {
		if (
			opts.signal?.aborted ||
			(error instanceof Error && error.name === "AbortError")
		)
			throw error;
		return;
	}
	const text = Array.from(result.content.trim())
		.slice(0, MAX_SUMMARY_CHARS)
		.join("");
	if (!text) return;
	const newest = fold[fold.length - 1];
	if (!newest) return;
	chat.summary = text;
	chat.summaryThrough = newest.id;
	persistChats(state, store);
}

/**
 * Index of the trim-point message: rows at and below it render, rows
 * above it hide behind the marker. -1 when untrimmed or the point is
 * gone (deleted) — the view heals to whole without a write. Pure.
 */
export function trimPointIndex(chat: Chat): number {
	if (!chat.trimmedThrough) return -1;
	return chat.messages.findIndex((m) => m.id === chat.trimmedThrough);
}

/**
 * Point (or clear, with null) the visual trim watermark, persisted
 * with the chat. The summary refresh is a separate step — the point
 * lands first so the collapse reads instant.
 */
export function setTrimPoint(
	state: ChatState,
	chat: Chat,
	id: ChatMsgId | null,
	store?: KeyValueStore
): void {
	if (id === null) delete chat.trimmedThrough;
	else chat.trimmedThrough = id;
	persistChats(state, store);
}

/**
 * Fold a manual trim's prefix into the rolling summary: the uncovered
 * turns above `topId` (failed replies excluded, like the window)
 * merge over the prior summary in one short non-streaming call, and
 * the watermark advances to the newest folded turn. Budget-capped
 * like the automatic fold — a giant prefix converges over later
 * sends while the middle windows normally. Returns the folded count
 * (0 means no call: already covered or below the floor). Throws on
 * model failure — a manual trim is an explicit gesture, never silent
 * (the caller unhides and banners). Races with the automatic refresh
 * are safe by construction: every fold is a prefix from the last
 * watermark, so concurrent writers stay pairwise consistent and the
 * smaller watermark simply refolds later.
 */
export async function refreshTrimSummary(
	state: ChatState,
	chat: Chat,
	provider: ChatProvider,
	topId: ChatMsgId,
	opts: { signal?: AbortSignal | undefined } = {},
	store?: KeyValueStore
): Promise<number> {
	const eligible = chat.messages.filter(
		(m) => !(m.role === "assistant" && m.error)
	);
	const topIdx = eligible.findIndex((m) => m.id === topId);
	if (topIdx <= 0) return 0;
	let startIdx = 0;
	if (chat.summary && chat.summary.length > 0 && chat.summaryThrough) {
		const at = eligible.findIndex((m) => m.id === chat.summaryThrough);
		if (at !== -1) startIdx = at + 1;
	}
	const fold: ChatMsg[] = [];
	let folded = 0;
	for (const m of eligible.slice(startIdx, topIdx)) {
		const size = Math.min(sentChars(m), MAX_FOLD_CHARS);
		if (folded + size > MAX_FOLD_CHARS) break;
		fold.push(m);
		folded += size;
	}
	if (fold.length === 0 || folded < MIN_FOLD_CHARS) return 0;
	const result = await provider.chat(
		buildSummaryRefreshMessages(
			chat.summary && chat.summary.length > 0 ? chat.summary : null,
			renderFoldText(fold)
		),
		{ signal: opts.signal }
	);
	const text = Array.from(result.content.trim())
		.slice(0, MAX_SUMMARY_CHARS)
		.join("");
	if (!text) return 0;
	const newest = fold[fold.length - 1];
	if (!newest) return 0;
	chat.summary = text;
	chat.summaryThrough = newest.id;
	persistChats(state, store);
	return fold.length;
}

export function buildApiMessages(
	chat: Chat,
	systemPrompt: string,
	excludeId?: ChatMsgId
): ChatMessage[] {
	const api: ChatMessage[] = [{ role: "system", content: systemPrompt }];
	const { summary, turns } = selectHistoryWindow(chat, excludeId);
	if (summary) api.push({ role: "system", content: summaryBlock(summary) });
	for (const m of turns) api.push({ role: m.role, content: apiContent(m) });
	return api;
}

/**
 * User messages with image attachments go out as multimodal content parts;
 * text attachments are appended as fenced blocks so every provider sees them.
 */
export function apiContent(message: ChatMsg): string | ContentPart[] {
	const images = (message.attachments ?? []).filter(
		(a) => a.kind === "image" && a.dataUrl
	);
	// Stored image literals are display tags (paired back to the parts
	// below by kind order) — the provider sees clean prose plus parts.
	let text = stripAttachmentMarkers(message.content);
	for (const a of message.attachments ?? []) {
		if (a.kind === "text" && a.text !== null) {
			text += `\n\n\`\`\`${a.name}\n${a.text}\n\`\`\``;
		}
	}
	if (images.length === 0) return text;
	const parts: ContentPart[] = [{ type: "text", text }];
	for (const image of images) {
		// The filter above already required dataUrl; re-check so a future
		// edit to it can't smuggle null into the API payload.
		if (!image.dataUrl) continue;
		parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
	}
	return parts;
}

export async function sendMessage(
	state: ChatState,
	provider: ChatProvider,
	systemPrompt: string,
	text: string,
	opts: {
		signal?: AbortSignal | undefined;
		attachments?: Attachment[] | undefined;
		thinking?: string | undefined;
		pasteFolds?: PasteFold[] | undefined;
		onFirstToken?: (() => void) | undefined;
		onToken?: (() => void) | undefined;
	} = {},
	store?: KeyValueStore
): Promise<void> {
	const trimmed = text.trim();
	const attachments = opts.attachments ?? [];
	const pasteFolds = opts.pasteFolds ?? [];
	const chat = activeChat(state);
	// Per-chat lock: this chat streaming blocks only itself — a reply
	// in flight elsewhere never gates a fresh send here.
	if (
		(!trimmed && attachments.length === 0) ||
		state.sendingChatIds.includes(chat.id)
	)
		return;
	chat.messages = [
		...chat.messages,
		{
			id: newChatMsgId(),
			role: "user",
			content: trimmed,
			usage: null,
			error: null,
			...(attachments.length > 0 ? { attachments } : {}),
			...(pasteFolds.length > 0 ? { pasteFolds } : {})
		}
	];
	persistChats(state, store);
	await streamAssistantReply(
		state,
		provider,
		systemPrompt,
		{
			signal: opts.signal,
			thinking: opts.thinking,
			onFirstToken: opts.onFirstToken,
			onToken: opts.onToken
		},
		store
	);
}

/**
 * File a captured read as an assistant message: no model call, no
 * send — the text lands in the thread ready to annotate and
 * question. Wholesale replacement, never in-place mutation (Svelte
 * proxy signals capture values on first read). Returns the new
 * message id, or null when there is nothing to file. Pure apart
 * from the persist; unit-tested.
 */
export function fileAssistantMessage(
	state: ChatState,
	text: string,
	store?: KeyValueStore
): ChatMsgId | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (!state.activeChatId) newChat(state, store);
	const chat = activeChat(state);
	const id = newChatMsgId();
	chat.messages = [
		...chat.messages,
		{ id, role: "assistant", content: trimmed, usage: null, error: null }
	];
	persistChats(state, store);
	return id;
}

/**
 * Stream one assistant reply onto the messages already there. The
 * last message must be the user turn being answered: resends reuse
 * it in place (same id, same attachments and paste folds) instead of
 * slicing it off and re-adding a copy, so retrying a failed reply
 * never remounts — and flashes — the messages above it.
 */
export async function streamAssistantReply(
	state: ChatState,
	provider: ChatProvider,
	systemPrompt: string,
	opts: {
		signal?: AbortSignal | undefined;
		thinking?: string | undefined;
		onFirstToken?: (() => void) | undefined;
		onToken?: (() => void) | undefined;
	} = {},
	store?: KeyValueStore
): Promise<void> {
	const chat = activeChat(state);
	const chatId = chat.id;
	if (state.sendingChatIds.includes(chatId)) return;
	const replyId = newChatMsgId();
	chat.messages = [
		...chat.messages,
		{ id: replyId, role: "assistant", content: "", usage: null, error: null }
	];
	state.sendingChatIds = [...state.sendingChatIds, chatId];
	state.sending = true;
	state.sendingChatId = chatId;
	// Own controller per chat (chained off a caller-provided signal, if
	// any) so dropping one chat aborts only its network request — a
	// concurrent reply elsewhere streams on untouched.
	const controller = new AbortController();
	inflightByChat.set(chatId, controller);
	if (opts.signal?.aborted) controller.abort();
	else
		opts.signal?.addEventListener("abort", () => controller.abort(), {
			once: true
		});
	// NOTE: never mutate a message object in place here. Svelte's proxy
	// signals capture values on first read, so only wholesale replacement
	// notifies reliably. The running text lives in this local accumulator.
	let streamed = "";
	const replaceReply = (patch: Partial<ChatMsg>) => {
		// Pinned to the originating chat, never the active one: looking
		// at another chat mid-stream must not swallow (or misroute) the
		// reply. A deleted origin simply matches nothing.
		const target = state.chats.find((c) => c.id === chatId);
		if (!target) return;
		target.messages = target.messages.map((m) =>
			m.id === replyId ? { ...m, ...patch } : m
		);
	};
	try {
		// Roll the summary forward before the send (no-op unless
		// overflow awaits a fold). Inside the try so a stop during
		// the refresh settles like any mid-stream abort.
		await refreshChatSummary(
			state,
			chat,
			provider,
			{ signal: controller.signal, excludeId: replyId },
			store
		);
		const apiMessages = buildApiMessages(chat, systemPrompt, replyId);
		const result = await provider.stream(
			apiMessages,
			{
				onFetchStart: () => {
					if (!state.fetchActiveChatIds.includes(chatId))
						state.fetchActiveChatIds = [...state.fetchActiveChatIds, chatId];
				},
				onFetchEnd: () => {
					state.fetchActiveChatIds = state.fetchActiveChatIds.filter(
						(id) => id !== chatId
					);
				},
				onToken: (token) => {
					// First visible token: the reply has started arriving
					// (thinking chip retires, haptic rumble, readback
					// warm-up). Fires once — later tokens just extend the
					// accumulator.
					if (streamed === "" && token !== "") {
						markReplyStarted(state, chatId);
						opts.onFirstToken?.();
					}
					streamed += token;
					replaceReply({ content: streamed });
					if (token !== "") opts.onToken?.();
				},
				// Tool round: the streamed prefix was provisional —
				// clear it and go back to thinking dots; the fetch
				// lands, then the final round streams fresh.
				onRoundRetract: () => {
					streamed = "";
					replaceReply({ content: "" });
					unmarkReplyStarted(state, chatId);
				}
			},
			{ signal: controller.signal, thinking: opts.thinking }
		);
		replaceReply({ content: result.content, usage: result.usage });
	} catch (error) {
		replaceReply({
			content: streamed,
			error: error instanceof Error ? error.message : String(error)
		});
	} finally {
		if (inflightByChat.get(chatId) === controller)
			inflightByChat.delete(chatId);
		state.sendingChatIds = state.sendingChatIds.filter((id) => id !== chatId);
		state.replyStartedChatIds = state.replyStartedChatIds.filter(
			(id) => id !== chatId
		);
		state.fetchActiveChatIds = state.fetchActiveChatIds.filter(
			(id) => id !== chatId
		);
		state.sending = state.sendingChatIds.length > 0;
		// sendingChatId tracks the most recent in-flight chat for the
		// legacy global readers: fall back to a still-streaming one.
		if (state.sendingChatId === chatId) {
			state.sendingChatId =
				state.sendingChatIds[state.sendingChatIds.length - 1] ?? null;
		}
		persistChats(state, store);
	}
}

/**
 * Open a native (Rust-run) send: append the user message plus the empty
 * assistant placeholder the turn fills, raise the sending flags, and
 * persist — so a killed process still leaves the placeholder and the
 * turn file behind for the boot scan to reconcile. Returns the ids the
 * page passes to `turn_start`, or null when there is nothing to send
 * (same guards as `sendMessage`: empty, or this chat already sending).
 */
export function beginNativeSend(
	state: ChatState,
	text: string,
	opts: {
		attachments?: Attachment[] | undefined;
		pasteFolds?: PasteFold[] | undefined;
	} = {},
	store?: KeyValueStore
): { chatId: ChatId; userId: ChatMsgId; replyId: ChatMsgId } | null {
	const trimmed = text.trim();
	const attachments = opts.attachments ?? [];
	const pasteFolds = opts.pasteFolds ?? [];
	const chat = activeChat(state);
	if (
		(!trimmed && attachments.length === 0) ||
		state.sendingChatIds.includes(chat.id)
	)
		return null;
	const userId = newChatMsgId();
	const replyId = newChatMsgId();
	chat.messages = [
		...chat.messages,
		{
			id: userId,
			role: "user",
			content: trimmed,
			usage: null,
			error: null,
			...(attachments.length > 0 ? { attachments } : {}),
			...(pasteFolds.length > 0 ? { pasteFolds } : {})
		},
		{ id: replyId, role: "assistant", content: "", usage: null, error: null }
	];
	state.sendingChatIds = [...state.sendingChatIds, chat.id];
	state.sending = true;
	state.sendingChatId = chat.id;
	persistChats(state, store);
	return { chatId: chat.id, userId, replyId };
}

/**
 * Open a native resend: the placeholder goes under the last user
 * message (same guards as `resendLast`: user-last, nobody sending).
 * Retry buttons route here on Android, so a retried turn survives the
 * background exactly like a fresh one.
 */
export function beginNativeResend(
	state: ChatState,
	store?: KeyValueStore
): { chatId: ChatId; replyId: ChatMsgId } | null {
	const chat = activeChat(state);
	const last = chat.messages[chat.messages.length - 1];
	if (!last || last.role !== "user") return null;
	if (state.sendingChatIds.includes(chat.id)) return null;
	const replyId = newChatMsgId();
	chat.messages = [
		...chat.messages,
		{ id: replyId, role: "assistant", content: "", usage: null, error: null }
	];
	state.sendingChatIds = [...state.sendingChatIds, chat.id];
	state.sending = true;
	state.sendingChatId = chat.id;
	persistChats(state, store);
	return { chatId: chat.id, replyId };
}

/**
 * Settle a native send: drop every per-chat flag the turn raised and
 * persist — the same tail `streamAssistantReply` runs, factored so the
 * page, the done-event path, and the boot scan all settle identically.
 */
export function settleNativeSend(
	state: ChatState,
	chatId: ChatId,
	store?: KeyValueStore
): void {
	state.sendingChatIds = state.sendingChatIds.filter((id) => id !== chatId);
	state.replyStartedChatIds = state.replyStartedChatIds.filter(
		(id) => id !== chatId
	);
	state.fetchActiveChatIds = state.fetchActiveChatIds.filter(
		(id) => id !== chatId
	);
	state.sending = state.sendingChatIds.length > 0;
	if (state.sendingChatId === chatId) {
		state.sendingChatId =
			state.sendingChatIds[state.sendingChatIds.length - 1] ?? null;
	}
	persistChats(state, store);
}

/**
 * Completion context for a finished send or resend: the origin chat's
 * last message plus whether that chat is still open. Reads pin to the
 * origin id, never the live chat — a mid-stream switch repoints the
 * active chat at the new thread, and the new thread must not thump,
 * speak, or ping for the old one's reply. A deleted origin matches
 * nothing (same rule as the streaming replace above). Pure.
 */
export function resolveSendCompletion(
	state: ChatState,
	originId: ChatId,
	activeId: ChatId
): { sent: ChatMsg | undefined; stillHere: boolean } {
	const origin = state.chats.find((c) => c.id === originId);
	const messages = origin ? origin.messages : [];
	return {
		sent: messages[messages.length - 1],
		stillHere: originId === activeId
	};
}

/**
 * Landing signal for a finished reply: the open chat thumps (done),
 * another chat's reply on phones ticks plus a tappable toast, and a
 * backgrounded app stays silent — the reply-ready ping owns that
 * moment, so any haptic here would buzz behind the user's back and
 * double the ping. Callers pass
 * `document.visibilityState === "visible"`. Pure.
 */
export function landingSignal(
	stillHere: boolean,
	visible: boolean,
	androidUI: boolean
): "done" | "tick" | "silent" {
	if (!visible) return "silent";
	if (stillHere) return "done";
	return androidUI ? "tick" : "silent";
}

/**
 * Silence that reads as stalled: tokens normally flow sub-second,
 * so no token for this long means the think between tool rounds.
 * The 1s send ticker re-evaluates, so the chip returns within about
 * a tick after the threshold.
 */
export const REPLY_STALL_MS = 3000;

/**
 * Phase chip for a live send: fetching while a page downloads,
 * waiting before the first token and whenever tokens stall (round-1
 * text must not retire the chip for the think that follows it),
 * null while text flows or the turn settles. Callers pass
 * Date.now() plus the last token stamp; `tick` only subscribes the
 * 1s send ticker so stalls surface without new timers. Pure.
 */
export function replyPhase(facts: {
	sending: boolean;
	fetching: boolean;
	started: boolean;
	tick: number;
	nowMs: number;
	lastTokenMs: number | null;
}): "fetch" | "waiting" | null {
	if (!facts.sending) return null;
	if (facts.fetching) return "fetch";
	if (!facts.started) return "waiting";
	if (
		facts.lastTokenMs === null ||
		facts.nowMs - facts.lastTokenMs >= REPLY_STALL_MS
	)
		return "waiting";
	return null;
}

/** Persisted shape owner (chats array only — runtime flags never touch disk). */
export function persistChats(state: ChatState, store?: KeyValueStore): void {
	try {
		(store ?? browserStore() ?? memoryStore).setItem(
			STORAGE_KEY,
			JSON.stringify(state.chats)
		);
	} catch {
		// Storage full or unavailable — chat still works in memory.
	}
}

function loadChats(state: ChatState, store: KeyValueStore): void {
	let raw: string | null;
	try {
		raw = store.getItem(STORAGE_KEY) ?? store.getItem(LEGACY_STORAGE_KEY);
	} catch {
		return;
	}
	if (!raw) return;
	try {
		const parsed = JSON.parse(raw) as Array<Chat & { pins?: unknown }>;
		if (Array.isArray(parsed)) {
			state.chats = parsed
				.filter((c) => c && typeof c.id === "string")
				.map((c) => {
					// The old pins array is gone; top-posted messages replaced it.
					delete c.pins;
					// Each chat keeps its reply pill across restarts (the
					// launch effect reinstalls its voice); unknown codes
					// from retired languages fall back to no pill.
					if (
						typeof c.replyLang !== "string" ||
						!replyLanguageFor(c.replyLang)
					) {
						c.replyLang = null;
					}
					// Pre-override chats (and hand-edited stores) carry no
					// voice flag: they follow the global default, never a
					// guessed value.
					if (typeof c.voice !== "boolean") c.voice = null;
					// Pre-correction chats carry no toggle: default off.
					if (typeof c.correction !== "boolean") c.correction = false;
					// A missing timestamp renders "Invalid Date" in the
					// sidebar and switcher: stamp it now instead.
					if (typeof c.createdAt !== "number" || Number.isNaN(c.createdAt)) {
						c.createdAt = Date.now();
					}
					return c;
				});
			if (state.chats.length > 0) {
				const first = state.chats[0];
				if (first) state.activeChatId = first.id;
			}
		}
	} catch {
		// Corrupt storage starts fresh.
	}
}

/** Chat-step decision (REFACTOR §6): where a sidebar-closed step lands. */
export type ChatStep =
	| { kind: "none" }
	| { kind: "stay" }
	| { kind: "mint" }
	| { kind: "goto"; id: ChatId; index: number };

/**
 * Step through chats: +1 goes down (newer), -1 goes up (older).
 * Past the newest end, a chat with messages mints one fresh chat
 * below it — never a second while it is still empty, so repeats
 * can't pile up blanks. Transition, haptics, and focus stay paged.
 */
export function planChatStep(
	chats: Chat[],
	activeId: ChatId,
	direction: 1 | -1
): ChatStep {
	if (chats.length === 0) return { kind: "none" };
	const at = Math.max(
		chats.findIndex((c) => c.id === activeId),
		0
	);
	const next = at + direction;
	if (next < 0) return { kind: "none" };
	if (next >= chats.length) {
		return chats[at]?.messages.length === 0
			? { kind: "stay" }
			: { kind: "mint" };
	}
	const target = chats[next];
	if (!target) return { kind: "none" };
	return { kind: "goto", id: target.id, index: next };
}

/**
 * Clamp a chat-list cursor into range (REFACTOR §6): sidebar focus,
 * keyboard enter, and post-delete landing share the one clamp. Null
 * on an empty list.
 */
export function clampChatIndex(index: number, length: number): number | null {
	if (length === 0) return null;
	return Math.min(Math.max(index, 0), length - 1);
}

/**
 * Viewed-message index from a `msg-{index}` article id (REFACTOR
 * §6): tap points, selection anchors, and scroll targets share the
 * one parse. Null outside messages or past the list end.
 */
export function messageIndexFromId(
	articleId: string,
	length: number
): number | null {
	const index = Number(articleId.slice(4));
	if (!Number.isInteger(index) || index < 0 || index >= length)
		return null;
	return index;
}
