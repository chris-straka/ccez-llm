import type { Chat } from "./chat";
import { chatMatchesQuery } from "./chatSearch";

/** Sidebar hover tip: message count plus the you/AI split
(in-memory only — drafts live per-chat in storage, so counting
them here would read localStorage on every row render). */
export function sideTip(item: Chat): string {
	// Empty chats report nothing: a "0 messages" tip is pure noise
	// (and pops on every keyboard-opened sidebar via the focus tip).
	const n = item.messages.length;
	if (n === 0) return "";
	const you = item.messages.filter((m) => m.role === "user").length;
	const msgs = n === 1 ? "1 message" : `${n} messages`;
	return `${msgs} · you ${you} · AI ${n - you}`;
}

export function chatLabel(createdAt: number): string {
	const date = new Date(createdAt);
	const today = new Date();
	const sameDay = date.toDateString() === today.toDateString();
	// 2-digit hour keeps the list column aligned (01:30, never 1:30).
	const time = date.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit"
	});
	const day = sameDay
		? "Today"
		: date.toLocaleDateString([], { month: "short", day: "numeric" });
	return `${day} ${time}`;
}

/**
 * Sidebar chat list filtered by the sidebar search box. Matches the
 * chat label plus every message body (substring per token), so a
 * swipe-opened list narrows as you type.
 */
export function filterSidebarChats(chats: Chat[], query: string): Chat[] {
	const q = query.trim();
	if (!q) return chats;
	return chats.filter((item) =>
		chatMatchesQuery(
			chatLabel(item.createdAt),
			item.messages.map((m) => m.content),
			q
		)
	);
}
