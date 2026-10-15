/**
 * Per-chat scroll marks: where each chat was left, kept across chat
 * switches and app reloads (persisted under its own storage key, so
 * the chats store never churns on a scroll).
 *
 * A mark is either "at the bottom" (the chat comes back at its newest
 * message, however much arrived meanwhile) or a reading anchor (the
 * message at the top of the view and its offset), with the raw offset
 * as a fallback when the anchor's message is gone. A chat with no mark
 * was never opened: it lands at the bottom, like a fresh conversation.
 */
import type { ScrollAnchor } from "./viewport";

export interface ChatScrollMark {
	bottom: boolean;
	top: number;
	anchor: ScrollAnchor | null;
}

export type ChatScrollLanding =
	| { kind: "bottom" }
	| { kind: "mark"; top: number; anchor: ScrollAnchor | null };

export const CHAT_SCROLL_KEY = "ccez-llm-chat-scroll-v1";

/** Where a chat lands when opened: its mark, else the bottom. New
messages while away never move a mid-thread mark; a chat left at the
bottom lands at the new bottom. */
export function chatScrollLanding(
	mark: ChatScrollMark | undefined
): ChatScrollLanding {
	if (!mark || mark.bottom) return { kind: "bottom" };
	return { kind: "mark", top: mark.top, anchor: mark.anchor };
}

/** The mark for a box as it sits now. `stuck` is the live stick flag:
a pinned view counts as at the bottom even while a stream's newest
token is still a frame ahead of it. */
export function markFor(facts: {
	stuck: boolean;
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	anchor: ScrollAnchor | null;
}): ChatScrollMark {
	const gap = facts.scrollHeight - facts.scrollTop - facts.clientHeight;
	const bottom = facts.stuck || gap <= 1;
	return {
		bottom,
		top: Math.max(0, Math.round(facts.scrollTop)),
		anchor: bottom ? null : facts.anchor
	};
}

function validAnchor(raw: unknown): ScrollAnchor | null {
	if (!raw || typeof raw !== "object") return null;
	const a = raw as { id?: unknown; offset?: unknown };
	if (typeof a.id !== "string" || typeof a.offset !== "number") return null;
	if (!Number.isFinite(a.offset)) return null;
	return { id: a.id, offset: a.offset };
}

/** Parse stored marks, dropping malformed entries and chats that no
longer exist. Corrupt storage reads as no marks. */
export function parseChatScrolls(
	raw: string | null,
	chatIds: readonly string[]
): Map<string, ChatScrollMark> {
	const out = new Map<string, ChatScrollMark>();
	if (!raw) return out;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return out;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		return out;
	const live = new Set(chatIds);
	for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (!live.has(id) || !value || typeof value !== "object") continue;
		const v = value as { bottom?: unknown; top?: unknown; anchor?: unknown };
		if (typeof v.bottom !== "boolean") continue;
		const top =
			typeof v.top === "number" && Number.isFinite(v.top)
				? Math.max(0, v.top)
				: 0;
		out.set(id, {
			bottom: v.bottom,
			top,
			anchor: v.bottom ? null : validAnchor(v.anchor)
		});
	}
	return out;
}

export function serializeChatScrolls(
	marks: ReadonlyMap<string, ChatScrollMark>
): string {
	return JSON.stringify(Object.fromEntries(marks));
}
