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

/** Markdown chrome that reads as noise in a one-line title. */
function plainTitleText(content: string): string {
	return content
		.replace(/```[\s\S]*?(```|$)/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
		.replace(/[*_`~]+/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Longest title kept: the row ellipsizes to its width anyway. */
const TITLE_MAX = 80;

/**
 * Sidebar / switcher / search title: the chat's name when it has one
 * (a rename or the model's), else its opening question, plain and
 * one line. A chat that opened with only an attachment
 * reads its first reply instead; an empty chat reads "New chat".
 */
export function chatTitle(item: Pick<Chat, "messages" | "title">): string {
	if (item.title) return item.title;
	const pick = (role: "user" | "assistant"): string =>
		item.messages
			.filter((m) => m.role === role)
			.map((m) => plainTitleText(m.content))
			.find((t) => t.length > 0) ?? "";
	const text = pick("user") || pick("assistant");
	if (!text) return "New chat";
	if (text.length <= TITLE_MAX) return text;
	const cut = text.slice(0, TITLE_MAX);
	const space = cut.lastIndexOf(" ");
	return `${(space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
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
			`${chatTitle(item)} ${chatLabel(item.createdAt)}`,
			item.messages.map((m) => m.content),
			q
		)
	);
}
