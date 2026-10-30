/**
 * Music: one YouTube video's own sound, played as a song and looped
 * until stopped. One player for the whole app (module state), so it
 * keeps going while chats switch, panels close, or the window sits in
 * the background. The song and the loop choice are remembered across
 * launches; a remembered song comes back paused, never playing.
 */

import { listenErrorCopy } from "./listen";
import type { ListenBackend } from "./listenBackend";

export interface Song {
	id: string;
	title: string;
	channel: string;
	thumbnail: string;
}

export type MusicStatus = "idle" | "loading" | "playing" | "paused" | "error";

const KEY = "ccez-llm-music-v1";

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
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- parsed once, never rendered.
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

interface Saved {
	song: Song | null;
	loop: boolean;
}

function load(): Saved {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
		if (raw && typeof raw === "object") {
			const r = raw as Partial<Saved>;
			const s = r.song;
			const song =
				s && typeof s.id === "string" && youtubeVideoId(s.id) === s.id
					? {
							id: s.id,
							title: String(s.title ?? ""),
							channel: String(s.channel ?? ""),
							thumbnail: String(s.thumbnail ?? "")
						}
					: null;
			return { song, loop: r.loop !== false };
		}
	} catch {
		// Blocked or corrupt storage: start empty.
	}
	return { song: null, loop: true };
}

export class MusicPlayer {
	song = $state<Song | null>(null);
	status = $state<MusicStatus>("idle");
	/** Play the song over and over (on unless turned off). */
	loop = $state(true);
	error = $state("");
	private backend: () => ListenBackend | null = () => null;
	private el: HTMLAudioElement | null = null;
	private url: string | null = null;
	/** The song the element holds (a newer pick drops a stale load). */
	private loadedFor: string | null = null;
	private volume = 1;

	constructor() {
		const saved = load();
		this.song = saved.song;
		this.loop = saved.loop;
		if (saved.song) this.status = "paused";
	}

	/** Where songs download from (the app's backend; null on the web). */
	connect(backend: () => ListenBackend | null): void {
		this.backend = backend;
	}

	/** 0-1 (the Video volume setting, capped at full). */
	setVolume(volume: number): void {
		this.volume = Math.min(1, Math.max(0, volume));
		if (this.el) this.el.volume = this.volume;
	}

	/** Play `song` (or resume the current one). */
	async play(song?: Song): Promise<void> {
		if (song && song.id !== this.song?.id) {
			this.release();
			this.song = song;
			this.save();
		}
		const current = this.song;
		if (!current) return;
		this.error = "";
		if (this.el && this.loadedFor === current.id) {
			await this.start(this.el);
			return;
		}
		const backend = this.backend();
		if (!backend) {
			this.status = "error";
			this.error = songErrorCopy(new Error("listen-needs-app"));
			return;
		}
		this.status = "loading";
		this.loadedFor = current.id;
		try {
			const mime = await backend.song(current.id);
			const bytes = await backend.songAudio(current.id);
			if (this.loadedFor !== current.id || this.song?.id !== current.id) return;
			this.url = URL.createObjectURL(new Blob([bytes], { type: mime }));
			const el = new Audio(this.url);
			el.loop = this.loop;
			el.volume = this.volume;
			el.onplay = () => {
				if (this.el === el) this.status = "playing";
			};
			el.onpause = () => {
				if (this.el === el && this.status === "playing") this.status = "paused";
			};
			this.el = el;
			await this.start(el);
		} catch (error) {
			if (this.loadedFor !== current.id) return;
			this.loadedFor = null;
			this.status = "error";
			this.error = songErrorCopy(error);
		}
	}

	private async start(el: HTMLAudioElement): Promise<void> {
		try {
			await el.play();
			this.status = "playing";
		} catch {
			// Refused (no user gesture yet): it waits for a Play press.
			this.status = "paused";
		}
	}

	pause(): void {
		this.el?.pause();
		if (this.song) this.status = "paused";
	}

	toggle(): void {
		if (this.status === "playing") this.pause();
		else void this.play();
	}

	setLoop(on: boolean): void {
		this.loop = on;
		if (this.el) this.el.loop = on;
		this.save();
	}

	/** Stop and forget the song. */
	close(): void {
		this.release();
		this.song = null;
		this.status = "idle";
		this.error = "";
		this.save();
	}

	private release(): void {
		this.el?.pause();
		this.el = null;
		this.loadedFor = null;
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
	}

	private save(): void {
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({ song: this.song, loop: this.loop } satisfies Saved)
			);
		} catch {
			// Storage blocked: the song plays, it just isn't remembered.
		}
	}
}

/** The app's one music player. */
export const music = new MusicPlayer();
