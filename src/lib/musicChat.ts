/**
 * Music chats: an empty chat turned into a video player for one song
 * at a time (the front page's music button). The chat keeps its song
 * across restarts and takes the song's name as its title; playing
 * goes through the app's one player (`music.svelte.ts`).
 */

import { persistChats, type ChatId, type ChatState } from "./chat";
import type { KeyValueStore } from "./settings";
import type { Song } from "./songs";

/** Make an empty chat a music chat (no song yet). */
export function startMusicChat(
	state: ChatState,
	chatId: ChatId,
	store?: KeyValueStore
): void {
	const chat = state.chats.find((c) => c.id === chatId);
	if (!chat || chat.messages.length > 0 || chat.music) return;
	chat.music = { song: null };
	persistChats(state, store);
}

/** The music chat's song (null: back to picking one). */
export function setMusicSong(
	state: ChatState,
	chatId: ChatId,
	song: Song | null,
	store?: KeyValueStore
): void {
	const chat = state.chats.find((c) => c.id === chatId);
	if (!chat?.music) return;
	chat.music = { song };
	if (song) {
		chat.title = song.title;
		chat.titleBy = "user";
	}
	persistChats(state, store);
}

/** Turn a music chat back into a plain empty chat. */
export function endMusicChat(
	state: ChatState,
	chatId: ChatId,
	store?: KeyValueStore
): void {
	const chat = state.chats.find((c) => c.id === chatId);
	if (!chat?.music) return;
	delete chat.music;
	delete chat.title;
	delete chat.titleBy;
	persistChats(state, store);
}
