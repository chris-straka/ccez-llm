import { afterEach, describe, expect, it, vi } from "vitest";
import { activeChat, createChatState, newChat } from "./chat";
import type { ListenEntry, ListenFetched, ListenSession } from "./listen";
import type { ListenBackend } from "./listenBackend";
import {
	ListenMode,
	type NativeGradeResult,
	type NativeGrader
} from "./listen-mode.svelte";
import { startDrill } from "./listenChat";
import type { KeyValueStore } from "./settings";

const session: ListenSession = {
	videoId: "ujQZH4qyEgQ",
	lang: "fr",
	title: "Trump says the UNTHINKABLE about DEADLY PLAGUE",
	channel: "David Pakman",
	channelUrl: "https://www.youtube.com/channel/UCvixJtaXuNdMPUGdOPcY8Ag",
	thumbnail: "",
	audio: "dub",
	clips: [
		{ i: 0, start: 0, end: 8, text: "Parlons de la peste." },
		{
			i: 1,
			start: 8,
			end: 10.7,
			text: "Nous couvrons ce sujet de manière approfondie."
		},
		{ i: 2, start: 10.7, end: 16, text: "Ce qui est incroyable." },
		{ i: 3, start: 16, end: 20, text: "Nous avons déjà entendu cela." }
	]
};

const reply = (translation: string) =>
	JSON.stringify({ translation, notes: [] });

/** A drill on clip 1 with a fake native grader that records starts. */
function harness() {
	const data = new Map<string, string>();
	const store: KeyValueStore = {
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v)
	};
	const state = createChatState(store);
	const chatId = activeChat(state).id;
	startDrill(state, chatId, session, store);
	const starts: { i: number; prompt: string; retry: boolean }[][] = [];
	let stored: NativeGradeResult[] = [];
	const native: NativeGrader = {
		start: (_id, items) => {
			starts.push(items);
			return Promise.resolve();
		},
		results: () => Promise.resolve(stored)
	};
	const mode = new ListenMode({
		getChatState: () => state,
		backend: () => null,
		langName: () => "French",
		getChannels: () => [],
		setChannels: () => {},
		resolveProvider: () => Promise.resolve(null),
		toast: () => {},
		reveal: () => {},
		openUrl: () => Promise.resolve(),
		nativeGrader: () => native
	});
	const clip = (i: number) =>
		activeChat(state).messages.find((m) => m.clip?.i === i)?.clip;
	const result = (i: number, content: string | null): NativeGradeResult => ({
		chat_id: chatId,
		i,
		content,
		error: content ? null : "HTTP 500"
	});
	return {
		mode,
		chatId,
		starts,
		clip,
		result,
		store: (r: NativeGradeResult[]) => {
			stored = r;
		}
	};
}

describe("native grading", () => {
	it("translates nothing until asked, then just the clip asked for", () => {
		const h = harness();
		expect(h.mode.submit("parlons de la peste")).toBe(true);
		expect(h.starts).toEqual([]);
		expect(h.clip(0)?.grade).toBeUndefined();
		// Opening clip 2's English (not answered yet) asks nothing.
		h.mode.translate(1);
		expect(h.starts).toEqual([]);
		h.mode.translate(0);
		expect(h.starts).toEqual([
			[expect.objectContaining({ i: 0, retry: false })]
		]);
		expect(h.starts[0]?.[0]?.prompt).toContain("Parlons de la peste");
		expect(h.clip(0)?.grade).toBe("pending");
		// Asked once: reopening the fold doesn't ask again.
		h.mode.translate(0);
		expect(h.starts).toHaveLength(1);
	});

	it("lands results on their rows, and holds early ones until the clip appears", () => {
		const h = harness();
		h.mode.submit("parlons");
		h.mode.landNative(h.result(0, reply("Let's talk about the plague.")));
		expect(h.clip(0)?.grade).toBe("done");
		expect(h.clip(0)?.translation).toBe("Let's talk about the plague.");
		// Clip 3 has no row yet: it waits, then lands when shown.
		h.mode.landNative(h.result(2, reply("What's incredible.")));
		h.mode.submit("nous couvrons");
		expect(h.clip(2)?.translation).toBe("What's incredible.");
	});

	it("reads back what finished while the page was paused", async () => {
		const h = harness();
		h.mode.submit("parlons");
		h.store([
			h.result(0, reply("Let's talk about the plague.")),
			h.result(1, reply("We cover it."))
		]);
		await h.mode.resync();
		expect(h.clip(0)?.translation).toBe("Let's talk about the plague.");
		expect(h.clip(1)?.translation).toBe("We cover it.");
	});

	it("a failure offers Try again, which forces a fresh run", () => {
		const h = harness();
		h.mode.submit("parlons");
		h.mode.landNative(h.result(0, "not json"));
		expect(h.clip(0)?.grade).toBe("error");
		h.mode.regrade(0);
		const last = h.starts.at(-1) ?? [];
		expect(last).toEqual([expect.objectContaining({ i: 0, retry: true })]);
		expect(h.clip(0)?.grade).toBe("pending");
	});
});

describe("search box", () => {
	const hit: ListenEntry = {
		kind: "channel",
		id: "https://www.youtube.com/@DavidPakmanShow",
		title: "David Pakman",
		channel: "David Pakman",
		channel_url: "https://www.youtube.com/@DavidPakmanShow",
		duration: 0,
		thumbnail: ""
	};

	/** A browse screen whose searches resolve when `land` is called. */
	function browse() {
		const pending: ((rows: ListenEntry[]) => void)[] = [];
		const queries: string[] = [];
		const backend = {
			search: (q: string) => {
				queries.push(q);
				return new Promise<ListenEntry[]>((resolve) => pending.push(resolve));
			},
			channel: () => new Promise<never>(() => {}),
			videos: () => Promise.resolve([]),
			fetch: () => new Promise<never>(() => {}),
			audio: () => new Promise<never>(() => {}),
			envelope: () => new Promise<never>(() => {}),
			video: () => new Promise<never>(() => {}),
			heard: () => new Promise<never>(() => {})
		} satisfies ListenBackend;
		const store: KeyValueStore = { getItem: () => null, setItem: () => {} };
		const state = createChatState(store);
		const mode = new ListenMode({
			getChatState: () => state,
			backend: () => backend,
			langName: () => "French",
			getChannels: () => [],
			setChannels: () => {},
			resolveProvider: () => Promise.resolve(null),
			toast: () => {},
			reveal: () => {},
			openUrl: () => Promise.resolve(),
			nativeGrader: () => null
		});
		mode.searchKind = "channel";
		mode.enter("fr");
		return {
			mode,
			land: (rows: ListenEntry[]) => pending.shift()?.(rows),
			calls: () => queries
		};
	}

	it("emptying the box drops the results", async () => {
		const { mode, land } = browse();
		mode.setQuery("pakman");
		const done = mode.search();
		land([hit]);
		await done;
		expect(mode.results).toEqual([hit]);
		mode.setQuery("pak");
		expect(mode.results).toEqual([hit]);
		mode.setQuery("  ");
		expect(mode.results).toBeNull();
	});

	it("a pause in typing searches once; Enter after it adds no second call", () => {
		vi.useFakeTimers();
		const { mode, calls } = browse();
		mode.setQuery("pak");
		vi.advanceTimersByTime(200);
		mode.setQuery("pakman");
		vi.advanceTimersByTime(200);
		expect(calls()).toEqual([]);
		vi.advanceTimersByTime(300);
		expect(calls()).toEqual(["pakman"]);
		void mode.search();
		expect(calls()).toEqual(["pakman"]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("a search that lands after the box was emptied is ignored", async () => {
		const { mode, land } = browse();
		mode.setQuery("pakman");
		const done = mode.search();
		mode.setQuery("");
		expect(mode.searching).toBe(false);
		land([hit]);
		await done;
		expect(mode.results).toBeNull();
		expect(mode.searching).toBe(false);
	});
});

describe("starting a drill", () => {
	const captions = JSON.stringify({
		events: [
			{
				tStartMs: 0,
				dDurationMs: 4000,
				segs: [
					{ utf8: "Parlons" },
					{ utf8: " de", tOffsetMs: 800 },
					{ utf8: " la", tOffsetMs: 1100 },
					{ utf8: " peste", tOffsetMs: 1500 },
					{ utf8: ".", tOffsetMs: 2400 }
				]
			}
		]
	});

	/** A browse screen whose video fetch resolves when `land` is called. */
	function starter(more: Partial<ListenBackend> = {}) {
		let land: () => void = () => {};
		const backend = {
			search: () => Promise.resolve([]),
			channel: () => new Promise<never>(() => {}),
			videos: () => Promise.resolve([]),
			fetch: () =>
				new Promise<ListenFetched>((resolve) => {
					land = () =>
						resolve({
							info: {
								id: "ujQZH4qyEgQ",
								title: "La peste",
								channel: "David Pakman",
								channel_url: "",
								duration: 60,
								thumbnail: "",
								original_lang: "en",
								audio: null,
								captions: null
							},
							audio_mime: "audio/mp4",
							captions,
							caption_kind: "asr"
						});
				}),
			audio: () => new Promise<never>(() => {}),
			envelope: () => Promise.reject(new Error("none")),
			video: () => new Promise<never>(() => {}),
			heard: () => Promise.reject(new Error("listen-heard-unsupported")),
			...more
		} satisfies ListenBackend;
		const store: KeyValueStore = { getItem: () => null, setItem: () => {} };
		const state = createChatState(store);
		const toasts: string[] = [];
		const mode = new ListenMode({
			getChatState: () => state,
			backend: () => backend,
			langName: () => "French",
			getChannels: () => [],
			setChannels: () => {},
			resolveProvider: () => Promise.resolve(null),
			toast: (m) => void toasts.push(m),
			reveal: () => {},
			openUrl: () => Promise.resolve(),
			nativeGrader: () => null
		});
		mode.enter("fr");
		return { mode, state, land: () => land(), toasts };
	}

	it("lands in its own chat when another chat opened meanwhile", async () => {
		const { mode, state, land } = starter();
		const from = activeChat(state).id;
		const started = mode.start("ujQZH4qyEgQ");
		expect(mode.starting).toBe("ujQZH4qyEgQ");
		newChat(state);
		// The new chat isn't waiting on anything: its own rows are free.
		expect(mode.starting).toBeNull();
		land();
		await started;
		const drill = state.chats.find((c) => c.id === from);
		expect(drill?.listen?.title).toBe("La peste");
		expect(drill?.messages).toHaveLength(1);
		expect(activeChat(state).messages).toHaveLength(0);
		expect(activeChat(state).listen).toBeUndefined();
	});

	it("moves its clip onto the times the recognizer heard", async () => {
		const { mode, state, land } = starter({
			audio: () => Promise.resolve(new ArrayBuffer(8)),
			heard: (_id, _lang, n) =>
				Promise.resolve({
					words: [
						{ text: "parlons", start: 1, end: 1.5 },
						{ text: "de", start: 1.8, end: 1.9 },
						{ text: "la", start: 2.1, end: 2.2 },
						{ text: "peste", start: 2.5, end: 3 }
					].filter(() => n === 0),
					start: 0,
					end: 60,
					chunks: 1
				})
		});
		const from = activeChat(state).id;
		const drill = () => state.chats.find((c) => c.id === from)?.listen;
		const started = mode.start("ujQZH4qyEgQ");
		land();
		// The track loads with a second (cached) fetch.
		await vi.waitFor(() => expect(drill()).toBeDefined());
		land();
		await started;
		await vi.waitFor(() => expect(drill()?.heard).toBe(true));
		const clip = drill()?.clips[0];
		expect(clip?.text).toBe("Parlons de la peste.");
		expect(clip?.start).toBeCloseTo(0.85);
		expect(clip?.end).toBeCloseTo(3.35);
	});

	it("keeps its own times where nothing was heard", async () => {
		const { mode, state, land } = starter({
			audio: () => Promise.resolve(new ArrayBuffer(8))
		});
		const from = activeChat(state).id;
		const started = mode.start("ujQZH4qyEgQ");
		land();
		await vi.waitFor(() =>
			expect(state.chats.find((c) => c.id === from)?.listen).toBeDefined()
		);
		land();
		await started;
		await new Promise((r) => setTimeout(r, 10));
		const drill = state.chats.find((c) => c.id === from)?.listen;
		expect(drill?.heard).toBeUndefined();
		expect(drill?.clips[0]?.start).toBe(0);
	});

	it("closing the browse screen drops the video loading for that chat", async () => {
		const { mode, state, land } = starter();
		const started = mode.start("ujQZH4qyEgQ");
		mode.close();
		land();
		await started;
		expect(activeChat(state).listen).toBeUndefined();
		expect(activeChat(state).messages).toHaveLength(0);
	});
});
