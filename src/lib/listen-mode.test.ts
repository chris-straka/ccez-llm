import { describe, expect, it } from "vitest";
import { activeChat, createChatState } from "./chat";
import type { ListenSession } from "./listen";
import { ListenMode, type NativeGradeResult, type NativeGrader } from "./listen-mode.svelte";
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
		{ i: 1, start: 8, end: 10.7, text: "Nous couvrons ce sujet de manière approfondie." },
		{ i: 2, start: 10.7, end: 16, text: "Ce qui est incroyable." },
		{ i: 3, start: 16, end: 20, text: "Nous avons déjà entendu cela." }
	]
};

const reply = (translation: string) => JSON.stringify({ translation, notes: [] });

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
		focusComposer: () => {},
		openUrl: () => Promise.resolve(),
		nativeGrader: () => native
	});
	const clip = (i: number) => activeChat(state).messages.find((m) => m.clip?.i === i)?.clip;
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
	it("hands the answered clip and the next ones to the runner at once", () => {
		const h = harness();
		expect(h.mode.submit("parlons de la peste")).toBe(true);
		const items = h.starts.flat();
		expect(items.map((x) => x.i).sort()).toEqual([0, 1, 2, 3]);
		expect(items.every((x) => !x.retry)).toBe(true);
		expect(items.find((x) => x.i === 1)?.prompt).toContain("Nous couvrons ce sujet");
		// Rows on screen show the grading as in flight.
		expect(h.clip(0)?.grade).toBe("pending");
		expect(h.clip(1)?.grade).toBe("pending");
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
		h.store([h.result(0, reply("Let's talk about the plague.")), h.result(1, reply("We cover it."))]);
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
