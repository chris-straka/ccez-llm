/**
 * Listening drill mode: the browse screen (the learner's channels,
 * search, per-video language availability), the clip player, and the
 * guess → next clip → background grading loop. The page wires the
 * deps; chat changes go through `listenChat.ts`.
 */

import { SvelteMap } from "svelte/reactivity";
import { activeChat, type ChatId, type ChatState } from "./chat";
import {
	drillable,
	gradePrompt,
	listenErrorCopy,
	parseGrade,
	rankVideos,
	type ListenChannel,
	type ListenChannelPage,
	type ListenEntry,
	type ListenSession,
	type ListenVideo
} from "./listen";
import type { ListenBackend } from "./listenBackend";
import {
	advanceDrill,
	answerDrillClip,
	clipBefore,
	landGrade,
	markGrading,
	retimeDrill,
	peekDrillClip,
	openClip,
	startDrill
} from "./listenChat";
import {
	alignTokens,
	DEFAULT_SEGMENT,
	findPauses,
	parseJson3,
	retimeClips,
	segmentClips,
	type ClipSpan,
	type Token
} from "./listenClips";
import { heardTimes, type HeardWord } from "./listenHeard";
import { youtubeVideoId } from "./songs";
import type { ChatProvider } from "./providers/types";

export interface ListenModeDeps {
	getChatState: () => ChatState;
	backend: () => ListenBackend | null;
	langName: (code: string) => string;
	getChannels: () => ListenChannel[];
	setChannels: (next: ListenChannel[]) => void;
	resolveProvider: () => Promise<ChatProvider | null>;
	toast: (message: string) => void;
	/** After a clip appears: keep the newest clip in view. */
	reveal: () => void;
	openUrl: (url: string) => Promise<void>;
	/** Rust-side grading (Android shell): keeps going while the app is
	 * in the background. Null grades from the page instead. */
	nativeGrader: () => NativeGrader | null;
}

/** One stored or emitted native grading (`listen-graded`). */
export interface NativeGradeResult {
	chat_id: string;
	i: number;
	content: string | null;
	error: string | null;
}

export interface NativeGrader {
	start: (
		chatId: ChatId,
		items: { i: number; prompt: string; retry: boolean }[]
	) => Promise<void>;
	results: (chatId: ChatId) => Promise<NativeGradeResult[]>;
}

export const GRADED_EVENT = "listen-graded";

export interface ChannelView {
	status: "loading" | "ready" | "error";
	page: ListenChannelPage | null;
	error: string;
}

/** Slow replay rate (S). */
export const SLOW_RATE = 0.75;
/** Trimmed off a clip's caption end time (they run late). */
const END_TRIM_SEC = 0.3;
/** A trimmed clip still plays at least this long. */
const MIN_CLIP_SEC = 0.3;
/** Grading calls in flight at once. */
const GRADE_CONCURRENCY = 2;
/** Recent videos probed per channel row. */
const CHANNEL_PROBE = 6;
/** Recognized pieces (about 45 s each) between two retimes. */
const HEARD_STEP = 4;
/** Typing pause before the search box searches by itself. */
const TYPING_PAUSE_MS = 450;

const infoKey = (id: string, lang: string): string => `${lang}|${id}`;

export class ListenMode {
	/** Browse screen showing (empty chats only), for this language. */
	lang = $state<string | null>(null);
	query = $state("");
	searchKind = $state<"video" | "channel">("video");
	/** Search: show only what has audio in the language. */
	onlyAvailable = $state(true);
	searching = $state(false);
	results = $state<ListenEntry[] | null>(null);
	/** The results are one pasted link's video: shown whatever audio
	 * it has (a song is played, not drilled). */
	linked = $state(false);
	/** Channel searches: each result's own recent-video status. */
	channelViews = new SvelteMap<string, ChannelView>();
	/** Per-language availability by `lang|id`. */
	info = new SvelteMap<string, ListenVideo>();
	/** Probes in flight (`lang|id`). */
	probing = new SvelteMap<string, true>();
	/** The channel row under the pointer (hover + F folds it). */
	hoveredChannel = $state<string | null>(null);
	/** Videos being fetched to start a drill, by the chat each lands
	 * in: switching chats never drops one. */
	private starts = new SvelteMap<ChatId, string>();
	error = $state("");
	/** The clip playing (index), and whether slowly. */
	playing = $state<{ i: number; slow: boolean } | null>(null);
	/** A clip stopped mid-way: playing it again resumes there. */
	paused = $state<{ i: number; slow: boolean } | null>(null);
	/** The playhead (media seconds) of the clip playing or paused:
	 * the scrubber's thumb. Null once a clip plays to its end. */
	position = $state<{ i: number; t: number } | null>(null);
	/** The clip whose player the pointer is over (Space plays it). */
	hoveredPlayer = $state<number | null>(null);
	/** The drill's media: loading or failed. */
	audioStatus = $state<"idle" | "loading" | "ready" | "error">("idle");
	/** The element sounding (or cued) when its file carries the
	 * picture: the clip card hosts it. Null before the picture is
	 * made, or when YouTube has none (the still frame stays). */
	screen = $state.raw<HTMLVideoElement | null>(null);

	private readonly deps: ListenModeDeps;
	/** The one element that plays the drill: picture and sound. */
	private media: HTMLMediaElement | null = null;
	/** The drill's track alone (a blob URL): small, so it plays first. */
	private trackUrl: string | null = null;
	/** The picture with the track's sound in one file (a blob URL),
	 * once the backend has made it; every element after uses it. */
	private clipUrl: string | null = null;
	/** The drill (`lang|id`) the media is for. */
	private mediaFor: string | null = null;
	private mediaLoad: Promise<boolean> | null = null;
	/** Where a cue wants the picture (scrubs land on the newest). */
	private cueAt: number | null = null;
	private stopAt = 0;
	private stopTimer: ReturnType<typeof setInterval> | null = null;
	/** The next clip, waiting for the one playing to finish. */
	private queued: number | null = null;
	/** Counts play() calls, so only the latest one's failure counts. */
	private playRun = 0;
	private volume = 1;
	/** Web Audio gain under the drill audio, so volume can pass 100%
	 * (an element's own volume stops at 1). Null where the runtime has
	 * no AudioContext: the element's volume then caps at 1. */
	private audioCtx: AudioContext | null = null;
	private gain: GainNode | null = null;
	/** The current element's feed into the gain (one per element). */
	private source: MediaElementAudioSourceNode | null = null;
	private browseSeq = 0;
	private typingTimer: ReturnType<typeof setTimeout> | null = null;
	/** The search last sent (`lang|kind|query`). */
	private searchedFor = "";
	private gradeQueue: { chatId: ChatId; i: number }[] = [];
	private gradesRunning = 0;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered.
	private gradeAsked = new Set<string>();

	constructor(deps: ListenModeDeps) {
		this.deps = deps;
	}

	get open(): boolean {
		return this.lang !== null;
	}

	/** The video starting a drill in the active chat (its id). */
	get starting(): string | null {
		return this.starts.get(activeChat(this.deps.getChatState()).id) ?? null;
	}

	videoInfo(id: string, lang: string): ListenVideo | undefined {
		return this.info.get(infoKey(id, lang));
	}

	/** Open the browse screen for `lang`; channel rows start loading. */
	enter(lang: string): void {
		this.lang = lang;
		this.error = "";
		this.results = null;
		for (const channel of this.deps.getChannels())
			void this.loadChannel(channel.url);
		if (this.query.trim()) void this.search();
	}

	/** Close the browse screen; a drill still loading for this chat
	 * is dropped (one loading for another chat carries on). */
	close(): void {
		this.lang = null;
		this.browseSeq++;
		this.starts.delete(activeChat(this.deps.getChatState()).id);
	}

	private needBackend(): ListenBackend {
		const backend = this.deps.backend();
		if (!backend) throw new Error("listen-needs-app");
		return backend;
	}

	/** Probe availability for `ids` in the open language (cached). */
	async probe(ids: string[]): Promise<void> {
		const lang = this.lang;
		if (!lang) return;
		const todo = ids.filter(
			(id) =>
				!this.info.has(infoKey(id, lang)) &&
				!this.probing.has(infoKey(id, lang))
		);
		if (todo.length === 0) return;
		for (const id of todo) this.probing.set(infoKey(id, lang), true);
		try {
			const found = await this.needBackend().videos(todo, lang);
			for (const v of found) this.info.set(infoKey(v.id, lang), v);
		} catch {
			// Rows without info just show no label.
		} finally {
			for (const id of todo) this.probing.delete(infoKey(id, lang));
		}
	}

	/** One channel's recent uploads plus their availability. */
	async loadChannel(url: string): Promise<void> {
		const current = this.channelViews.get(url);
		if (current?.status === "loading") return;
		this.channelViews.set(url, {
			status: "loading",
			page: current?.page ?? null,
			error: ""
		});
		try {
			const page = await this.needBackend().channel(url);
			this.channelViews.set(url, { status: "ready", page, error: "" });
			await this.probe(page.videos.slice(0, CHANNEL_PROBE).map((v) => v.id));
		} catch (error) {
			this.channelViews.set(url, {
				status: "error",
				page: null,
				error: listenErrorCopy(error, this.deps.langName(this.lang ?? ""))
			});
		}
	}

	/** The search box's text. A pause in typing searches; emptying it
	 * drops the results and any search still in flight, leaving just
	 * your channels. */
	setQuery(query: string): void {
		this.query = query;
		if (this.typingTimer) clearTimeout(this.typingTimer);
		this.typingTimer = null;
		if (query.trim()) {
			this.typingTimer = setTimeout(() => {
				this.typingTimer = null;
				void this.search();
			}, TYPING_PAUSE_MS);
			return;
		}
		this.searchedFor = "";
		this.browseSeq++;
		this.searching = false;
		this.results = null;
		this.linked = false;
		this.error = "";
	}

	async search(): Promise<void> {
		if (this.typingTimer) clearTimeout(this.typingTimer);
		this.typingTimer = null;
		const q = this.query.trim();
		if (!q || !this.lang) return;
		// Enter right after the pause already searched: no second call.
		const key = `${this.lang}|${this.searchKind}|${q}`;
		if (key === this.searchedFor && (this.searching || this.results !== null))
			return;
		this.searchedFor = key;
		const seq = ++this.browseSeq;
		this.searching = true;
		this.error = "";
		// A pasted YouTube link finds that one video (songs included:
		// it shows whatever audio it has).
		const linked = youtubeVideoId(q);
		this.linked = linked !== null;
		try {
			const backend = this.needBackend();
			const rows = linked
				? (await backend.videos([linked], this.lang)).map((v): ListenEntry => ({
						kind: "video",
						id: v.id,
						title: v.title,
						channel: v.channel,
						channel_url: v.channel_url,
						duration: v.duration,
						thumbnail: v.thumbnail
					}))
				: await backend.search(q, this.searchKind);
			if (seq !== this.browseSeq) return;
			if (linked && rows.length === 0) throw new Error("listen-unavailable");
			this.results = rows;
			if (this.searchKind === "video" || linked)
				await this.probe(rows.map((r) => r.id));
			else for (const r of rows.slice(0, 8)) void this.loadChannel(r.id);
		} catch (error) {
			if (seq !== this.browseSeq) return;
			// A failed search may be retried with Enter.
			this.searchedFor = "";
			this.error = listenErrorCopy(error, this.deps.langName(this.lang));
			this.results = [];
		} finally {
			if (seq === this.browseSeq) this.searching = false;
		}
	}

	/** Search rows as shown: ranked native → dub → unknown → none, and
	 * filtered to the language when the filter is on. */
	shownResults(): ListenEntry[] {
		const rows = this.results ?? [];
		const lang = this.lang ?? "";
		if (this.searchKind === "channel" && !this.linked) {
			if (!this.onlyAvailable) return rows;
			return rows.filter((r) => {
				const view = this.channelViews.get(r.id);
				if (view?.status === "error") return false;
				if (view?.status !== "ready") return true;
				return this.channelVideos(r.id).some((v) => drillable(v));
			});
		}
		const info: Record<string, ListenVideo | undefined> = {};
		for (const r of rows) info[r.id] = this.info.get(infoKey(r.id, lang));
		const ranked = rankVideos(rows, info);
		if (!this.onlyAvailable || this.linked) return ranked;
		return ranked.filter((r) => {
			const v = info[r.id];
			return v === undefined || drillable(v);
		});
	}

	/** Probed recent videos of a loaded channel. */
	channelVideos(url: string): ListenVideo[] {
		const lang = this.lang ?? "";
		const page = this.channelViews.get(url)?.page;
		if (!page) return [];
		return page.videos.flatMap((v) => {
			const info = this.info.get(infoKey(v.id, lang));
			return info ? [info] : [];
		});
	}

	hasChannel(url: string): boolean {
		return this.deps.getChannels().some((c) => c.url === url);
	}

	addChannel(entry: { url: string; name: string }): void {
		if (this.hasChannel(entry.url)) return;
		this.deps.setChannels([
			...this.deps.getChannels(),
			{ url: entry.url, name: entry.name }
		]);
		this.deps.toast(`Added ${entry.name}`);
		if (!this.channelViews.has(entry.url)) void this.loadChannel(entry.url);
	}

	removeChannel(url: string): void {
		this.deps.setChannels(this.deps.getChannels().filter((c) => c.url !== url));
	}

	/** Fold or unfold a channel's recent videos (kept across launches). */
	toggleFold(url: string): void {
		this.deps.setChannels(
			this.deps
				.getChannels()
				.map((c) => (c.url === url ? { ...c, folded: !c.folded } : c))
		);
	}

	/** Start a drill on `videoId` in the active (empty) chat. It
	 * loads in the background: switching chats meanwhile is fine, and
	 * the drill lands in the chat it was started from. */
	async start(videoId: string): Promise<void> {
		const lang = this.lang;
		const state = this.deps.getChatState();
		const chatId = activeChat(state).id;
		if (!lang || this.starts.has(chatId)) return;
		this.starts.set(chatId, videoId);
		this.error = "";
		const here = (): boolean => activeChat(state).id === chatId;
		try {
			const backend = this.needBackend();
			const fetched = await backend.fetch(videoId, lang);
			const tokens = parseJson3(fetched.captions);
			const aligned = await this.alignedTokens(videoId, lang, tokens);
			const clips = segmentClips(aligned ?? tokens, {
				...DEFAULT_SEGMENT,
				aligned: aligned !== null
			});
			if (clips.length === 0) throw new Error("listen-no-captions");
			// Dropped (× on the browse screen), or the chat was used or
			// deleted while the video loaded.
			const chat = state.chats.find((c) => c.id === chatId);
			if (
				this.starts.get(chatId) !== videoId ||
				!chat ||
				chat.messages.length > 0
			)
				return;
			const info = fetched.info;
			const session: ListenSession = {
				videoId,
				lang,
				title: info.title,
				channel: info.channel,
				channelUrl: info.channel_url,
				thumbnail: info.thumbnail,
				audio: info.audio?.kind ?? "dub",
				clips,
				storyboard: fetched.storyboard ?? null,
				...(aligned ? { aligned: true } : {})
			};
			startDrill(state, chatId, session);
			// Landed in the background: its first clip plays when opened.
			if (!here()) return;
			// Audio loads alongside; the first clip plays once it lands.
			const audioReady = this.loadAudio(session);
			this.close();
			this.deps.reveal();
			if ((await audioReady) && here()) this.play(0, false);
		} catch (error) {
			const copy = listenErrorCopy(error, this.deps.langName(lang));
			if (here()) this.error = copy;
			else this.deps.toast(copy);
		} finally {
			if (this.starts.get(chatId) === videoId) this.starts.delete(chatId);
		}
	}

	/** Caption tokens moved onto the track's own pauses, or null when
	 * the track can't say (no envelope, no pauses to match). */
	private async alignedTokens(
		videoId: string,
		lang: string,
		tokens: Token[]
	): Promise<Token[] | null> {
		try {
			const env = new Uint8Array(
				await this.needBackend().envelope(videoId, lang)
			);
			return alignTokens(tokens, findPauses(env));
		} catch {
			return null;
		}
	}

	/** The active drill's words with their track times (for the word
	 * that is sounding), once its captions are read. */
	private wordTimes = $state.raw<{ key: string; tokens: Token[] } | null>(null);

	/** Clip `i`'s words in the active drill, timed; empty until known. */
	clipWords(i: number): Token[] {
		const session = activeChat(this.deps.getChatState()).listen;
		const clip = session?.clips[i];
		const words = this.wordTimes;
		if (
			!session ||
			!clip ||
			words?.key !== infoKey(session.videoId, session.lang)
		)
			return [];
		const next = session.clips[i + 1];
		const until = next ? next.start : Infinity;
		return words.tokens.filter(
			(t) => t.start >= clip.start - 0.01 && t.start < Math.min(clip.end, until)
		);
	}

	/** Time the active drill's words, and move a drill cut before
	 * clips followed the audio onto its pauses (same clips, same
	 * text, better start and end). Then the recognizer's word times,
	 * where the platform has one. */
	private async timeWords(
		chatId: ChatId,
		session: ListenSession,
		captions: string
	): Promise<void> {
		const key = infoKey(session.videoId, session.lang);
		const tokens = parseJson3(captions);
		const aligned = await this.alignedTokens(
			session.videoId,
			session.lang,
			tokens
		);
		if (this.mediaFor !== key) return;
		let clips = session.clips;
		if (!session.aligned && aligned) {
			const moved = retimeClips(session.clips, tokens, aligned);
			if (moved) {
				retimeDrill(this.deps.getChatState(), chatId, moved);
				clips = moved;
			}
		}
		const base =
			session.aligned || clips !== session.clips ? (aligned ?? tokens) : tokens;
		this.wordTimes = { key, tokens: base };
		await this.hearWords(chatId, session, key, clips, base);
	}

	/** Move the drill's clips and word times onto what the speech
	 * recognizer hears, piece by piece from the start of the track
	 * (the first clips are timed within seconds). A platform or
	 * language without one keeps the pause times. */
	private async hearWords(
		chatId: ChatId,
		session: ListenSession,
		key: string,
		clips: ClipSpan[],
		base: Token[]
	): Promise<void> {
		const backend = this.deps.backend();
		if (!backend) return;
		const heard: HeardWord[] = [];
		let shown = -1;
		for (let n = 0; ; n++) {
			let chunk;
			try {
				chunk = await backend.heard(session.videoId, session.lang, n);
			} catch {
				return;
			}
			if (this.mediaFor !== key) return;
			heard.push(...chunk.words);
			const done = n + 1 >= chunk.chunks;
			// Cached pieces come back at once: show the first piece
			// right away, then every few.
			// A drill heard before needs only the whole list.
			if (!done && (session.heard || (n > 0 && n - shown < HEARD_STEP)))
				continue;
			shown = n;
			const times = heardTimes(base, heard);
			if (!times) {
				if (done) return;
				continue;
			}
			this.wordTimes = { key, tokens: times.tokens };
			if (session.heard) continue;
			const moved = retimeClips(
				clips,
				base,
				times.tokens,
				DEFAULT_SEGMENT,
				done ? Infinity : times.upTo
			);
			if (moved)
				retimeDrill(this.deps.getChatState(), chatId, moved, undefined, done);
			if (done) return;
		}
	}

	/** Fetch the drill's track once per video (blob URL, so every clip
	 * plays instantly and offline after this), then the picture made
	 * into one file with it. */
	loadAudio(session: ListenSession): Promise<boolean> {
		const key = infoKey(session.videoId, session.lang);
		if (this.mediaFor === key && this.mediaLoad) return this.mediaLoad;
		this.stop();
		this.dropMedia();
		this.mediaFor = key;
		this.wordTimes = null;
		this.audioStatus = "loading";
		this.mediaLoad = (async () => {
			try {
				const backend = this.needBackend();
				// The fetch is cached on the backend: a drill reopened later
				// re-reads the same file.
				const fetched = await backend.fetch(session.videoId, session.lang);
				const bytes = await backend.audio(session.videoId, session.lang);
				if (this.mediaFor !== key) return false;
				const chatId = activeChat(this.deps.getChatState()).id;
				void this.timeWords(chatId, session, fetched.captions);
				this.trackUrl = URL.createObjectURL(
					new Blob([bytes], { type: fetched.audio_mime })
				);
				this.media = this.element();
				this.audioStatus = "ready";
				// The picture comes after: bigger, and optional.
				void this.loadPicture(session, key);
				return true;
			} catch (error) {
				if (this.mediaFor === key) {
					this.audioStatus = "error";
					this.mediaLoad = null;
					this.deps.toast(
						listenErrorCopy(error, this.deps.langName(session.lang))
					);
				}
				return false;
			}
		})();
		return this.mediaLoad;
	}

	/** The picture and the track's sound, made into one file by the
	 * backend (once per video and language). The clip playing finishes
	 * on the track; the next play, or a cue now, uses the new file. A
	 * miss keeps the track alone and the still frames: the drill never
	 * waits on it. */
	private async loadPicture(
		session: ListenSession,
		key: string
	): Promise<void> {
		try {
			const bytes = await this.needBackend().clip(
				session.videoId,
				session.lang
			);
			if (this.mediaFor !== key) return;
			this.clipUrl = URL.createObjectURL(
				new Blob([bytes], { type: "video/mp4" })
			);
			this.cueScreen();
		} catch {
			// The track alone plays on.
		}
	}

	/** Let go of the drill's media (another drill is loading). */
	private dropMedia(): void {
		this.media?.pause();
		this.media = null;
		this.screen = null;
		this.cueAt = null;
		for (const url of [this.trackUrl, this.clipUrl])
			if (url) URL.revokeObjectURL(url);
		this.trackUrl = null;
		this.clipUrl = null;
	}

	/** A new element on the drill's newest file, fed through the gain:
	 * a video on the picture's file, an audio on the track alone (a
	 * detached video never moves in Linux WebKit). */
	private element(): HTMLMediaElement {
		let el: HTMLMediaElement;
		if (this.clipUrl) {
			const video = document.createElement("video");
			video.playsInline = true;
			video.disablePictureInPicture = true;
			video.setAttribute("aria-hidden", "true");
			el = video;
		} else el = new Audio();
		el.preload = "auto";
		this.wireGain(el);
		el.src = this.clipUrl ?? this.trackUrl ?? "";
		return el;
	}

	/** `el` when it plays the picture's file. */
	private pictured(el: HTMLMediaElement): HTMLVideoElement | null {
		return el instanceof HTMLVideoElement &&
			this.clipUrl !== null &&
			el.getAttribute("src") === this.clipUrl
			? el
			: null;
	}

	/** Put `el` on screen once it has a frame to show (until then the
	 * one before keeps its frame up). */
	private show(media: HTMLMediaElement): void {
		const el = this.pictured(media);
		if (!el) {
			if (this.media === media) this.screen = null;
			return;
		}
		if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			this.screen = el;
			return;
		}
		el.addEventListener(
			"loadeddata",
			() => {
				if (this.media === el) this.screen = el;
			},
			{ once: true }
		);
	}
	/** Nothing playing: show the picture at `t` (a clip waiting, a
	 * scrub). Seeks don't pile up: one in flight takes the newest `t`
	 * when it lands. */
	private cue(t: number): void {
		if (this.playing || !this.clipUrl) return;
		let el = this.media;
		if (!el || !this.pictured(el)) {
			el?.pause();
			el = this.element();
			this.media = el;
		}
		const target = el;
		this.cueAt = t;
		if (target.seeking) return;
		const land = (): void => {
			if (this.media !== target || this.playing) return;
			const want = this.cueAt;
			if (want !== null && Math.abs(target.currentTime - want) > 0.01) {
				target.addEventListener("seeked", land, { once: true });
				target.currentTime = want;
				return;
			}
			this.cueAt = null;
			this.show(target);
		};
		land();
	}

	/** Cue the picture on the clip the card shows: the one waiting for
	 * a guess, else the one paused mid-way, at its playhead. */
	private cueScreen(): void {
		if (this.playing) return;
		const chat = activeChat(this.deps.getChatState());
		const session = chat.listen;
		if (!session || this.mediaFor !== infoKey(session.videoId, session.lang))
			return;
		const at = this.position;
		const i = openClip(chat)?.clip?.i ?? at?.i;
		const clip = i === undefined ? undefined : session.clips[i];
		if (i === undefined || !clip) return;
		this.cue(at?.i === i ? at.t : clip.start);
	}

	/** The drill audio's volume (0-2), live on the clip playing. */
	setVolume(volume: number): void {
		this.volume = Math.min(2, Math.max(0, volume));
		this.applyVolume(this.media);
	}

	/** Route a fresh element through the shared gain node, unhooking
	 * the one before (a media element feeds one source node for life). */
	private wireGain(el: HTMLMediaElement): void {
		this.source?.disconnect();
		this.source = null;
		try {
			if (typeof AudioContext === "function") {
				this.audioCtx ??= new AudioContext();
				if (!this.gain) {
					this.gain = this.audioCtx.createGain();
					this.gain.connect(this.audioCtx.destination);
				}
				this.source = this.audioCtx.createMediaElementSource(el);
				this.source.connect(this.gain);
			}
		} catch {
			this.source = null;
		}
		this.applyVolume(el);
	}

	/** The element for the next play: the current one while it hasn't
	 * played and is on the newest file, else a new one. WebKit (the
	 * Mac shell) lands a seek on an element that has already played
	 * 0.1-2 s off and can sound a moment of the old spot first; a fresh
	 * element starts on the sample asked for (measured against the
	 * decoded track: within 40 ms, where the reused one strayed up to
	 * 2 s). The one before stays on screen until the new one's frame
	 * is up. */
	private freshElement(): HTMLMediaElement | null {
		const old = this.media;
		if (!old) return null;
		const url = this.clipUrl ?? this.trackUrl;
		if (old.played.length === 0 && old.getAttribute("src") === url) return old;
		old.pause();
		const el = this.element();
		this.media = el;
		return el;
	}

	private applyVolume(el: HTMLMediaElement | null): void {
		if (!el) return;
		if (this.gain) {
			el.volume = 1;
			this.gain.gain.value = this.volume;
		} else el.volume = Math.min(1, this.volume);
	}

	/** Silence the drill (playhead and queue untouched). */
	private halt(): void {
		if (this.stopTimer) clearInterval(this.stopTimer);
		this.stopTimer = null;
		this.media?.pause();
		this.playing = null;
	}

	/** Stop outright: nothing paused, nothing queued. */
	private stop(): void {
		this.halt();
		this.queued = null;
		this.paused = null;
		this.position = null;
	}

	/** Clip `i` of the active drill. */
	private span(i: number): ClipSpan | undefined {
		return activeChat(this.deps.getChatState()).listen?.clips[i];
	}

	/** Play clip `i` of the active drill from its start, or from `from`
	 * (a resume or a scrub). */
	play(i: number, slow: boolean, from?: number): void {
		const chat = activeChat(this.deps.getChatState());
		const session = chat.listen;
		const clip = session?.clips[i];
		if (!session || !clip) return;
		if (
			!this.media ||
			this.mediaFor !== infoKey(session.videoId, session.lang)
		) {
			void this.loadAudio(session).then((ok) => {
				if (ok) this.play(i, slow, from);
			});
			return;
		}
		this.halt();
		const el = this.freshElement();
		if (!el) return;
		this.cueAt = null;
		this.queued = null;
		this.paused = null;
		// A context made before any click starts suspended.
		if (this.audioCtx?.state === "suspended") void this.audioCtx.resume();
		el.playbackRate = slow ? SLOW_RATE : 1;
		el.preservesPitch = true;
		// Caption end times run late: stop a touch early so the next
		// sentence's first sound never leaks in. Clips cut on the
		// track's own pauses already end in the quiet.
		const trim = session.aligned ? 0 : END_TRIM_SEC;
		this.stopAt = Math.max(clip.start + MIN_CLIP_SEC, clip.end - trim);
		const at =
			from !== undefined && from >= clip.start && from < this.stopAt
				? from
				: clip.start;
		this.position = { i, t: at };
		this.playing = { i, slow };
		// A rejection from an earlier play() (interrupted by this one's
		// pause) must not clear this one.
		const run = ++this.playRun;
		const go = (): void => {
			if (run !== this.playRun || this.media !== el) return;
			this.show(el);
			el.play().catch(() => {
				if (run === this.playRun) this.halt();
			});
			// timeupdate fires every ~250 ms; a tight poll stops on the word.
			this.stopTimer = setInterval(() => {
				if (el.paused) {
					this.halt();
					return;
				}
				this.position = { i, t: el.currentTime };
				if (el.currentTime >= this.stopAt) this.finish();
			}, 30);
		};
		// Sound starts once the seek has landed: playing first lets the
		// old spot through.
		if (Math.abs(el.currentTime - at) < 0.001 && !el.seeking) go();
		else {
			el.addEventListener("seeked", go, { once: true });
			el.addEventListener(
				"error",
				() => {
					if (run === this.playRun) this.halt();
				},
				{ once: true }
			);
			el.currentTime = at;
		}
	}

	/** The clip played to its end: the queued one (if any) goes next. */
	private finish(): void {
		const next = this.queued;
		this.stop();
		if (next !== null) this.play(next, false);
		else this.cueScreen();
	}

	/** Stop clip playback where it is; playing it again resumes. */
	pause(): void {
		const p = this.playing;
		if (!p || !this.media) return;
		const t = this.media.currentTime;
		this.halt();
		this.queued = null;
		this.paused = p;
		this.position = { i: p.i, t };
	}

	/** A clip's play button: stop it if playing at that speed, resume
	 * it if paused at that speed, otherwise play it from the start. */
	toggle(i: number, slow: boolean): void {
		const p = this.playing;
		if (p?.i === i && p.slow === slow) {
			this.pause();
			return;
		}
		const at = this.position;
		if (this.paused?.i === i && this.paused.slow === slow && at?.i === i)
			this.play(i, slow, at.t);
		else this.play(i, slow);
	}

	/** A clip's play button, a click on its picture, or Space over it:
	 * pause it if it is playing at either speed, resume it where it
	 * paused (at the speed it had), otherwise play it from the start.
	 * The 0.75× button and S stay [toggle] with `slow`. */
	playPause(i: number): void {
		if (this.playing?.i === i) {
			this.pause();
			return;
		}
		const at = this.position;
		if (this.paused?.i === i && at?.i === i)
			this.play(i, this.paused.slow, at.t);
		else this.play(i, false);
	}

	/** Scrub clip `i` to `t`: a playing clip jumps there, any other
	 * waits there for its next play. */
	seek(i: number, t: number): void {
		const clip = this.span(i);
		if (!clip) return;
		const at = Math.min(Math.max(t, clip.start), clip.end);
		const p = this.playing;
		if (p?.i === i) {
			this.play(i, p.slow, at);
			return;
		}
		const slow = this.paused?.i === i ? this.paused.slow : false;
		this.halt();
		this.queued = null;
		this.paused = { i, slow };
		this.position = { i, t: at };
		this.cue(at);
	}

	/** The pointer entered (or left) clip `i`'s player. */
	hoverPlayer(i: number | null, over: boolean): void {
		if (over) this.hoveredPlayer = i;
		else if (this.hoveredPlayer === i) this.hoveredPlayer = null;
	}

	/** Space: play, pause, or resume the clip waiting for a guess. */
	replay(slow: boolean): void {
		const chat = activeChat(this.deps.getChatState());
		const clip =
			openClip(chat)?.clip ?? chat.messages.findLast((m) => m.clip)?.clip;
		if (!clip) return;
		this.toggle(clip.i, slow);
	}

	/** r: replay a clip from its start (the one sounding, else the one
	 * waiting for a guess, else the newest). */
	restart(i?: number): void {
		const chat = activeChat(this.deps.getChatState());
		const target =
			i ??
			this.playing?.i ??
			openClip(chat)?.clip?.i ??
			chat.messages.findLast((m) => m.clip)?.clip?.i;
		if (target === undefined) return;
		this.play(target, this.playing?.i === target && this.playing.slow);
	}

	/** Shift+A or Show text: the waiting clip's transcript appears
	 * while it still waits (Next or a guess settles it). */
	peek(): boolean {
		const state = this.deps.getChatState();
		const chat = activeChat(state);
		const open = openClip(chat);
		if (!chat.listen || !open?.clip || open.clip.peeked) return false;
		peekDrillClip(state, chat.id, open.id);
		this.deps.reveal();
		return true;
	}

	/**
	 * Enter (guess) or "?" (null: reveal as a skip): answer the open
	 * clip, show and play the next one at once, grade in the
	 * background. False when the chat isn't waiting for a guess.
	 */
	submit(guess: string | null): boolean {
		const state = this.deps.getChatState();
		const chat = activeChat(state);
		const open = openClip(chat);
		if (!chat.listen || !open?.clip) return false;
		const chatId = chat.id;
		answerDrillClip(state, chatId, open.id, guess);
		advanceDrill(state, chatId);
		const next = openClip(activeChat(state))?.clip;
		if (next) {
			this.catchUpGrade(chatId, next.i);
			// A clip still playing finishes first; the next one follows.
			if (this.playing) {
				this.paused = null;
				this.queued = next.i;
			} else this.play(next.i, false);
		} else if (!this.playing) this.stop();
		this.deps.reveal();
		return true;
	}

	/** Ask for clip translations, each once per session (a retry
	 * re-asks one that failed). */
	private requestGrades(
		chatId: ChatId,
		wanted: number[],
		retry: number | null = null
	): void {
		const chat = this.deps.getChatState().chats.find((c) => c.id === chatId);
		const session = chat?.listen;
		if (!chat || !session) return;
		const fresh: number[] = [];
		for (const i of wanted) {
			const key = `${chatId}|${i}`;
			if (this.gradeAsked.has(key)) continue;
			this.gradeAsked.add(key);
			fresh.push(i);
		}
		if (fresh.length === 0) return;
		const native = this.deps.nativeGrader();
		if (native) {
			this.startNative(native, chatId, session, fresh, retry);
			return;
		}
		for (const i of fresh) this.gradeQueue.push({ chatId, i });
		this.pumpGrades();
	}

	private promptFor(session: ListenSession, i: number): string | null {
		const clip = session.clips[i];
		if (!clip) return null;
		return gradePrompt(
			clip.text,
			this.deps.langName(session.lang),
			clipBefore(session, i)
		);
	}

	private hasRow(chatId: ChatId, i: number): boolean {
		return (
			this.deps
				.getChatState()
				.chats.find((c) => c.id === chatId)
				?.messages.some((m) => m.clip?.i === i) ?? false
		);
	}

	private begin(chatId: ChatId, i: number): void {
		this.inFlight.add(`${chatId}|${i}`);
		if (this.hasRow(chatId, i))
			markGrading(this.deps.getChatState(), chatId, i);
	}

	/** A grading came back (null = failed): onto its row, or held in
	 * `early` until the row appears (catchUpGrade). */
	private settle(
		chatId: ChatId,
		i: number,
		result: ReturnType<typeof parseGrade>
	): void {
		this.inFlight.delete(`${chatId}|${i}`);
		if (this.hasRow(chatId, i))
			landGrade(this.deps.getChatState(), chatId, i, result);
		else this.early.set(`${chatId}|${i}`, result);
	}

	private startNative(
		native: NativeGrader,
		chatId: ChatId,
		session: ListenSession,
		indexes: number[],
		retry: number | null
	): void {
		const items = indexes.flatMap((i) => {
			const prompt = this.promptFor(session, i);
			return prompt ? [{ i, prompt, retry: i === retry }] : [];
		});
		for (const item of items) this.begin(chatId, item.i);
		native
			.start(chatId, items)
			// Results already on file (answered before a relaunch) send
			// no event: read them back.
			.then(() => this.resync(chatId))
			.catch(() => {
				for (const item of items) this.settle(chatId, item.i, null);
			});
	}

	/** A native result (event or file): parse and land it. */
	landNative(r: NativeGradeResult): void {
		const chatId = r.chat_id as ChatId;
		const chat = this.deps.getChatState().chats.find((c) => c.id === chatId);
		if (!chat?.listen) return;
		const row = chat.messages.find((m) => m.clip?.i === r.i)?.clip;
		// A newer retry is running: its own result will land.
		if (row?.grade === "done" && !r.content) return;
		this.settle(chatId, r.i, r.content ? parseGrade(r.content) : null);
	}

	/** Subscribe to native results as they finish. Missed events (a
	 * paused page) land through `resync` instead. */
	listenNative(
		listen: <T>(
			event: string,
			cb: (e: { payload: T }) => void
		) => Promise<() => void>
	): () => void {
		let off: (() => void) | null = null;
		let gone = false;
		void listen<NativeGradeResult>(GRADED_EVENT, (e) =>
			this.landNative(e.payload)
		)
			.then((unlisten) => {
				if (gone) unlisten();
				else off = unlisten;
			})
			.catch(() => undefined);
		return () => {
			gone = true;
			try {
				off?.();
			} catch {
				// Already unlistened; shutdown is best-effort.
			}
		};
	}

	/** Land whatever native grading finished while the page was paused
	 * or gone (one chat, or every drill still waiting on a grade). */
	async resync(chatId?: ChatId): Promise<void> {
		const native = this.deps.nativeGrader();
		if (!native) return;
		const chats = this.deps
			.getChatState()
			.chats.filter(
				(c) =>
					c.listen &&
					(chatId
						? c.id === chatId
						: c.messages.some((m) => m.clip && m.clip.grade !== "done"))
			);
		for (const c of chats) {
			let results: NativeGradeResult[];
			try {
				results = await native.results(c.id);
			} catch {
				continue;
			}
			for (const r of results) {
				const row = c.messages.find((m) => m.clip?.i === r.i)?.clip;
				if (row?.grade === "done") continue;
				this.landNative(r);
			}
		}
	}

	private pumpGrades(): void {
		while (
			this.gradesRunning < GRADE_CONCURRENCY &&
			this.gradeQueue.length > 0
		) {
			const job = this.gradeQueue.shift();
			if (!job) break;
			this.gradesRunning++;
			void this.grade(job.chatId, job.i).finally(() => {
				this.gradesRunning--;
				this.pumpGrades();
			});
		}
	}

	private async grade(chatId: ChatId, i: number): Promise<void> {
		const session = this.deps
			.getChatState()
			.chats.find((c) => c.id === chatId)?.listen;
		const prompt = session ? this.promptFor(session, i) : null;
		if (!prompt) return;
		this.begin(chatId, i);
		let result: ReturnType<typeof parseGrade> = null;
		try {
			const provider = await this.deps.resolveProvider();
			if (provider) {
				const reply = await provider.chat(
					[{ role: "user", content: prompt }],
					{}
				);
				result = parseGrade(reply.content);
			}
		} catch {
			result = null;
		}
		this.settle(chatId, i, result);
	}

	/** Clip `i`'s row just appeared: land a grade that came early, or
	 * show the one still in flight as pending. */
	private catchUpGrade(chatId: ChatId, i: number): void {
		const key = `${chatId}|${i}`;
		const state = this.deps.getChatState();
		if (this.early.has(key)) {
			landGrade(state, chatId, i, this.early.get(key) ?? null);
			this.early.delete(key);
		} else if (this.inFlight.has(key)) {
			markGrading(state, chatId, i);
		}
	}

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered.
	private early = new Map<string, ReturnType<typeof parseGrade>>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered.
	private inFlight = new Set<string>();

	/** The English fold opened on answered clip `i` of the active
	 * drill: translate it now (nothing translates before it's asked). */
	translate(i: number): void {
		const chat = activeChat(this.deps.getChatState());
		const clip = chat.messages.find((m) => m.clip?.i === i)?.clip;
		if (!chat.listen || !clip || clip.heard === undefined) return;
		if (clip.grade === "done" || clip.grade === "pending") return;
		this.requestGrades(chat.id, [i]);
	}

	/** Retry a failed grading in the active drill ("Try again"). */
	regrade(i: number): void {
		const chatId = activeChat(this.deps.getChatState()).id;
		this.gradeAsked.delete(`${chatId}|${i}`);
		this.requestGrades(chatId, [i], i);
	}

	/** The clip's moment on YouTube, in the system browser. */
	openSource(url: string): void {
		void this.deps.openUrl(url);
	}

	/** Leaving a drill chat: stop sound (the blob stays for a return). */
	leave(): void {
		this.stop();
	}
}
