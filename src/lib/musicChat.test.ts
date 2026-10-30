import { describe, expect, it } from "vitest";
import { activeChat, createChatState, newChat } from "./chat";
import { endMusicChat, setMusicSong, startMusicChat } from "./musicChat";
import type { KeyValueStore } from "./settings";

function memory(): KeyValueStore & { data: Record<string, string> } {
	const data: Record<string, string> = {};
	return {
		data,
		getItem: (k) => data[k] ?? null,
		setItem: (k, v) => {
			data[k] = v;
		}
	};
}

const SONG = {
	id: "1f583cw0FOk",
	title: "SUM-80",
	channel: "Krrish",
	thumbnail: ""
};

describe("music chats", () => {
	it("an empty chat becomes a music chat that keeps its song across restarts", () => {
		const store = memory();
		const state = createChatState(store);
		const id = activeChat(state).id;
		startMusicChat(state, id, store);
		expect(activeChat(state).music).toEqual({ song: null });
		setMusicSong(state, id, SONG, store);
		expect(activeChat(state).title).toBe("SUM-80");
		const again = createChatState(store);
		expect(again.chats.find((c) => c.id === id)?.music).toEqual({ song: SONG });
	});

	it("a damaged stored song loads as no song", () => {
		const store = memory();
		store.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "a",
					createdAt: 1,
					messages: [],
					music: { song: { id: "<script>" } }
				},
				{ id: "b", createdAt: 2, messages: [], music: "nope" }
			])
		);
		const state = createChatState(store);
		expect(state.chats[0]?.music).toEqual({ song: null });
		expect(state.chats[1]?.music).toBeUndefined();
	});

	it("only an empty chat turns into one, and ending it leaves a plain chat", () => {
		const store = memory();
		const state = createChatState(store);
		newChat(state, store);
		const id = activeChat(state).id;
		startMusicChat(state, id, store);
		setMusicSong(state, id, SONG, store);
		endMusicChat(state, id, store);
		const chat = activeChat(state);
		expect(chat.music).toBeUndefined();
		expect(chat.title).toBeUndefined();
		chat.messages.push({
			id: "m" as never,
			role: "user",
			content: "hi",
			usage: null,
			error: null
		});
		startMusicChat(state, id, store);
		expect(activeChat(state).music).toBeUndefined();
	});
});
