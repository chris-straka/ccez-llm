import { describe, expect, it } from "vitest";
import { chatLabel, filterSidebarChats, sideTip } from "./sidebar";
import type { Chat, ChatId, ChatMsg, ChatMsgId } from "./chat";

function msg(id: string, role: ChatMsg["role"], content: string): ChatMsg {
	return { id: id as ChatMsgId, role, content, usage: null, error: null };
}

function chat(id: string, createdAt: number, messages: ChatMsg[]): Chat {
	return {
		id: id as ChatId,
		createdAt,
		messages,
		replyLang: null,
		voice: null
	};
}

describe("sideTip", () => {
	it("reports nothing for empty chats", () => {
		expect(sideTip(chat("a", 1, []))).toBe("");
	});
	it("singularizes one message", () => {
		expect(sideTip(chat("a", 1, [msg("m1", "user", "hi")]))).toBe(
			"1 message · you 1 · AI 0"
		);
	});
	it("splits you and AI over several messages", () => {
		expect(
			sideTip(
				chat("a", 1, [
					msg("m1", "user", "hi"),
					msg("m2", "assistant", "hello"),
					msg("m3", "assistant", "more")
				])
			)
		).toBe("3 messages · you 1 · AI 2");
	});
});

describe("chatLabel", () => {
	it("labels today with Today plus a 2-digit time", () => {
		const label = chatLabel(Date.now());
		expect(label.startsWith("Today ")).toBe(true);
		expect(label).toMatch(/\d{2}:\d{2}/);
	});
	it("labels older chats with month and day", () => {
		const past = new Date(2026, 4, 9, 8, 5).getTime();
		const label = chatLabel(past);
		expect(label).toContain("9");
		expect(label).toMatch(/\d{2}:\d{2}/);
	});
});

describe("filterSidebarChats", () => {
	const chats = [
		chat("a", 1, [msg("m1", "user", "ramen recipe")]),
		chat("b", 2, [msg("m2", "assistant", "sushi rice")])
	];
	it("returns every chat on a blank query", () => {
		expect(filterSidebarChats(chats, "   ")).toBe(chats);
	});
	it("matches message bodies", () => {
		expect(filterSidebarChats(chats, "ramen").map((c) => c.id)).toEqual([
			"a"
		]);
	});
	it("matches nothing unknown", () => {
		expect(filterSidebarChats(chats, "croissant")).toEqual([]);
	});
});
