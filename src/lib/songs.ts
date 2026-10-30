/**
 * Songs for music: a YouTube video picked to play as music. Pure (no
 * player state): the link parser, the stored-song check, and the
 * error copy, shared by the player (`music.svelte.ts`) and chats.
 */

import { listenErrorCopy, type ListenEntry, type ListenVideo } from "./listen";

export interface Song {
	id: string;
	title: string;
	channel: string;
	thumbnail: string;
}

/**
 * The video id in a YouTube link (watch, youtu.be, shorts, live,
 * embed, music.youtube.com), or a bare 11-character id; null for
 * anything else.
 */
export function youtubeVideoId(text: string): string | null {
	const t = text.trim();
	if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
	let url: URL;
	try {
		url = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^(www|m|music)\./, "");
	let id: string | null = null;
	if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
	else if (host === "youtube.com" || host === "youtube-nocookie.com") {
		id =
			url.searchParams.get("v") ??
			/^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(url.pathname)?.[1] ??
			null;
	}
	return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** "That didn't load" copy for a song (no language to name). */
export function songErrorCopy(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("listen-no-track"))
		return "That video has no sound to play.";
	return listenErrorCopy(error, "");
}

/** A stored song, checked: a well-formed one, or null. */
export function cleanSong(raw: unknown): Song | null {
	if (!raw || typeof raw !== "object") return null;
	const s = raw as Partial<Record<keyof Song, unknown>>;
	if (typeof s.id !== "string" || youtubeVideoId(s.id) !== s.id) return null;
	return {
		id: s.id,
		title: typeof s.title === "string" ? s.title : "",
		channel: typeof s.channel === "string" ? s.channel : "",
		thumbnail: typeof s.thumbnail === "string" ? s.thumbnail : ""
	};
}

/** What finding songs needs from the app's backend. */
export interface SongSource {
	search: (query: string, kind: "video") => Promise<ListenEntry[]>;
	videos: (ids: string[], lang: string) => Promise<ListenVideo[]>;
}

/** Songs for a query: a pasted YouTube link finds that one video,
 * anything else searches YouTube's videos. */
export async function findSongs(
	source: SongSource,
	query: string
): Promise<(Song & { duration: number })[]> {
	const q = query.trim();
	if (!q) return [];
	const linked = youtubeVideoId(q);
	const rows: {
		id: string;
		title: string;
		channel: string;
		thumbnail: string;
		duration: number;
	}[] = linked
		? await source.videos([linked], "en")
		: (await source.search(q, "video")).filter((r) => r.kind === "video");
	if (linked && rows.length === 0) throw new Error("listen-unavailable");
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		channel: r.channel,
		thumbnail: r.thumbnail,
		duration: r.duration
	}));
}
