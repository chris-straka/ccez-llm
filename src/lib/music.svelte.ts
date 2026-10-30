/**
 * Music: one YouTube video's own sound, played as a song and looped
 * until stopped. One player for the whole app (module state), so it
 * keeps going while chats switch, panels close, or the window sits in
 * the background. The song and the loop choice are remembered across
 * launches; a remembered song comes back paused, never playing.
 */

import type { ListenBackend } from "./listenBackend";
import { cleanSong, songErrorCopy, type Song } from "./songs";

export { youtubeVideoId, type Song } from "./songs";

export type MusicStatus = "idle" | "loading" | "playing" | "paused" | "error";

const KEY = "ccez-llm-music-v1";

interface Saved {
	song: Song | null;
	loop: boolean;
}

function load(): Saved {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
		if (raw && typeof raw === "object") {
			const r = raw as Partial<Saved>;
			const song = cleanSong(r.song);
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
	/** Playhead and length of the song loaded (seconds; 0 until known). */
	time = $state(0);
	duration = $state(0);
	/** The video's picture for the music chat (no sound; a blob URL),
	 * once asked for; null while it loads or when there is none. */
	picture = $state<string | null>(null);
	private pictureFor: string | null = null;
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
			el.ontimeupdate = () => {
				if (this.el === el) this.time = el.currentTime;
			};
			el.onloadedmetadata = () => {
				if (this.el === el && Number.isFinite(el.duration))
					this.duration = el.duration;
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

	/** Jump to `t` seconds in the song loaded. */
	seek(t: number): void {
		if (!this.el) return;
		const at = Math.max(0, Math.min(t, this.duration || t));
		this.el.currentTime = at;
		this.time = at;
	}

	/** The playhead right now (the element's own, finer than `time`). */
	now(): number {
		return this.el?.currentTime ?? this.time;
	}

	/** Fetch the current song's picture once (a miss leaves none). */
	async loadPicture(): Promise<void> {
		const id = this.song?.id;
		const backend = this.backend();
		if (!id || !backend || this.pictureFor === id) return;
		this.pictureFor = id;
		try {
			const bytes = await backend.video(id);
			if (this.pictureFor !== id) return;
			this.picture = URL.createObjectURL(
				new Blob([bytes], { type: "video/mp4" })
			);
		} catch {
			if (this.pictureFor === id) this.pictureFor = null;
		}
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
		if (this.picture) URL.revokeObjectURL(this.picture);
		this.picture = null;
		this.pictureFor = null;
		this.time = 0;
		this.duration = 0;
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
