import { describe, expect, it } from "vitest";

import {
	activeChat,
	createChatState,
	KEEP_RECENT,
	newChatMsgId,
	trimToRecent,
	type Chat,
	type ChatMsg
} from "./chat";

function store() {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v)
	};
}

function msgs(n: number): ChatMsg[] {
	return Array.from(
		{ length: n },
		(_, i) =>
			({
				id: newChatMsgId(),
				role: i % 2 ? "assistant" : "user",
				content: `message ${i}`
			}) as ChatMsg
	);
}

describe("trimToRecent", () => {
	it("keeps each chat's newest five and reports what went", () => {
		const s = store();
		const state = createChatState(s);
		const chat = activeChat(state);
		chat.messages = msgs(8);
		const doomed = chat.messages.slice(0, 3).map((m) => m.id);
		const removed = trimToRecent(state, KEEP_RECENT, s);
		expect(chat.messages.map((m) => m.content)).toEqual([
			"message 3",
			"message 4",
			"message 5",
			"message 6",
			"message 7"
		]);
		expect([...(removed.get(chat.id) ?? [])]).toEqual(doomed);
		const saved = JSON.parse(s.data.get("ccez-llm-chats-v1")!) as Chat[];
		expect(saved[0]?.messages).toHaveLength(5);
	});

	it("leaves short chats, drills, music and the game chat alone", () => {
		const s = store();
		const state = createChatState(s);
		const chat = activeChat(state);
		chat.messages = msgs(5);
		const drill = { ...chat, id: "drill" as Chat["id"], messages: msgs(9) };
		drill.listen = {} as NonNullable<Chat["listen"]>;
		const game = { ...chat, id: "game" as Chat["id"], messages: msgs(9) };
		game.game = true;
		state.chats.push(drill, game);
		expect(trimToRecent(state, KEEP_RECENT, s).size).toBe(0);
		expect(drill.messages).toHaveLength(9);
		expect(game.messages).toHaveLength(9);
		expect(s.data.has("ccez-llm-chats-v1")).toBe(false);
	});

	it("drops a hide-above marker that sat on a deleted message", () => {
		const state = createChatState(store());
		const chat = activeChat(state);
		chat.messages = msgs(7);
		chat.trimmedThrough = chat.messages[1]!.id;
		trimToRecent(state);
		expect(chat.trimmedThrough).toBeUndefined();
	});
});

describe("trimToRecent while a reply streams", () => {
	it("waits for the chat's reply to land", () => {
		const state = createChatState(store());
		const chat = activeChat(state);
		chat.messages = msgs(8);
		state.sendingChatIds = [chat.id];
		expect(trimToRecent(state).size).toBe(0);
		state.sendingChatIds = [];
		expect(trimToRecent(state).get(chat.id)?.size).toBe(3);
	});
});
