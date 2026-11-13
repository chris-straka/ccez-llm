// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WordList, wordKey } from "./wordList.svelte";

const reply = (body: unknown, ok = true) =>
	({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

describe("the shared word list", () => {
	beforeEach(() => localStorage.clear());

	it("keys words by base language and lowercase", () => {
		expect(wordKey("fr-FR", "Fragiliser")).toBe("fr:fragiliser");
	});

	it("stars a word as learning, sends it, and takes in other apps' changes", async () => {
		const send = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
			init?.method === "POST"
				? reply(null)
				: reply({
						words: [{ lang: "fr", word: "marre", status: "known" }],
						seq: 7
					})
		);
		const list = new WordList("https://words.test", send);
		await list.toggleLearning("fr", "Fragiliser");
		expect(list.status("fr", "fragiliser")).toBe("learning");
		expect(list.status("fr", "marre")).toBe("known");
		const posted = JSON.parse(
			(
				send.mock.calls.find(
					([, init]) => init?.method === "POST"
				)![1] as RequestInit
			).body as string
		) as Array<{ word: string; status: string; from: string }>;
		// Sent as written, not lowercased here (this stand-in answers no
		// /headword, so the word also goes as it is).
		expect(posted).toMatchObject([
			{ word: "Fragiliser", status: "learning", from: "ccez-llm" }
		]);
		// Again: back to new.
		await list.toggleLearning("fr", "fragiliser");
		expect(list.status("fr", "fragiliser")).toBe("new");
	});

	it("a form's star follows its headword, and a tap before it's known never clears the word", async () => {
		const posted: Array<{ word: string; status: string }> = [];
		const send = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "POST") {
				posted.push(...(JSON.parse(init.body as string) as typeof posted));
				return reply(null);
			}
			if (typeof url === "string" && url.includes("/headword?"))
				return reply({ headword: "freiner" });
			return reply({
				words: [{ lang: "fr", word: "freiner", status: "learning" }],
				seq: 3
			});
		});
		const list = new WordList("https://words.test", send);
		await list.sync();
		// A new session: the form's headword isn't known yet, its star is empty.
		expect(list.status("fr", "freinent")).toBe("new");
		// Tapped as it showed (empty): stars, never "back to new" for freiner.
		await list.toggleLearning("fr", "freinent");
		expect(list.status("fr", "freiner")).toBe("learning");
		expect(posted.map((p) => p.status)).not.toContain("new");
		// The card asks as it opens: the star is lit without a tap.
		const fresh = new WordList("https://words.test", send);
		await fresh.sync();
		fresh.want("fr", "freinent");
		await vi.waitFor(() =>
			expect(fresh.status("fr", "freinent")).toBe("learning")
		);
		// Lit and tapped: back to new, under the headword.
		await fresh.toggleLearning("fr", "freinent");
		expect(posted.at(-1)).toMatchObject({ word: "freiner", status: "new" });
	});

	it("a quick star and unstar both reach the server, once each, in order", async () => {
		const posted: Array<{ word: string; status: string }> = [];
		let openGate!: () => void;
		const gate = new Promise<void>((r) => (openGate = r));
		const send = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "POST") {
				posted.push(...(JSON.parse(init.body as string) as typeof posted));
				// The first send is slow: the unstar lands while it's out.
				if (posted.length === 1) await gate;
				return reply(null);
			}
			return reply({ words: [], seq: 1 });
		});
		const list = new WordList("https://words.test", send);
		const first = list.toggleLearning("fr", "marre");
		// The first send is under way (the star asks /headword first).
		while (!posted.length) await Promise.resolve();
		const second = list.toggleLearning("fr", "marre");
		openGate();
		await Promise.all([first, second]);
		expect(posted.map((p) => p.status)).toEqual(["learning", "new"]);
		expect(list.status("fr", "marre")).toBe("new");
	});

	it("keeps a star made off the tailnet and sends it next time", async () => {
		const down = vi.fn(async () => {
			throw new Error("offline");
		});
		const list = new WordList("https://words.test", down);
		await list.toggleLearning("de", "Wetter");
		expect(list.status("de", "wetter")).toBe("learning");
		const up = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) =>
			init?.method === "POST" ? reply(null) : reply({ words: [], seq: 1 })
		);
		const again = new WordList("https://words.test", up);
		expect(again.status("de", "wetter")).toBe("learning");
		await again.sync();
		expect(
			JSON.parse((up.mock.calls[0]![1] as RequestInit).body as string)
		).toMatchObject([{ word: "Wetter", status: "learning" }]);
	});

	it("a tab's save never drops another tab's waiting star", async () => {
		const down = vi.fn(async () => {
			throw new Error("offline");
		});
		const tabA = new WordList("https://words.test", down);
		const tabB = new WordList("https://words.test", down);
		await tabA.toggleLearning("fr", "marée");
		// B, opened before A's star, saves its own (empty) list.
		await tabB.sync();
		const up = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) =>
			init?.method === "POST" ? reply(null) : reply({ words: [], seq: 1 })
		);
		const later = new WordList("https://words.test", up);
		await later.sync();
		expect(
			JSON.parse((up.mock.calls[0]![1] as RequestInit).body as string)
		).toMatchObject([{ word: "marée", status: "learning" }]);
	});

	it("stars under the headword the server names, and a word with none saves nothing", async () => {
		const posted: Array<{ lang: string; word: string; status: string }> = [];
		const asUrl = (u: RequestInfo | URL): URL =>
			new URL(typeof u === "string" ? u : u instanceof URL ? u.href : u.url);
		const send = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "POST") {
				posted.push(...(JSON.parse(init.body as string) as typeof posted));
				return reply(null);
			}
			const u = asUrl(url);
			if (u.pathname === "/headword") {
				const word = u.searchParams.get("word");
				const lang = u.searchParams.get("lang");
				if (lang === "fr" && word?.startsWith("frein"))
					return reply({ headword: "freiner" });
				if (lang === "de" && (word === "wasser" || word === "Wasser"))
					return reply({ headword: "Wasser" });
				return reply({ headword: null });
			}
			return reply({ words: [], seq: 1 });
		});
		const list = new WordList("https://words.test", send);
		await list.toggleLearning("fr", "freinent");
		expect(posted).toMatchObject([{ word: "freiner", status: "learning" }]);
		// The headword's star covers its forms, both ways.
		expect(list.status("fr", "freinent")).toBe("learning");
		expect(list.status("fr", "freiner")).toBe("learning");
		await list.toggleLearning("fr", "freiner");
		expect(list.status("fr", "freinent")).toBe("new");
		await list.toggleLearning("de", "wasser");
		expect(posted.at(-1)).toMatchObject({ word: "Wasser", status: "learning" });
		// Asked once per word (freinent, freiner, wasser), not per star.
		expect(
			send.mock.calls.filter(([u]) => asUrl(u).pathname === "/headword")
		).toHaveLength(3);
		// Nothing to save: no star, nothing sent.
		await list.toggleLearning("fr", "Trump");
		expect(list.status("fr", "Trump")).toBe("new");
		expect(posted.some((p) => p.word === "Trump")).toBe(false);
	});

	it("brings in other apps' stars while it stays open", async () => {
		vi.useFakeTimers();
		try {
			let seq = 0;
			const send = vi.fn(async () =>
				reply({
					words: seq ? [{ lang: "fr", word: "marre", status: "learning" }] : [],
					seq: ++seq
				})
			);
			const list = new WordList("https://words.test", send);
			const stop = list.watch(60_000);
			await vi.advanceTimersByTimeAsync(0);
			expect(send).toHaveBeenCalledTimes(1);
			// Starred on the phone meanwhile: here within a round.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(list.status("fr", "marre")).toBe("learning");
			// Back in view: a round at once.
			document.dispatchEvent(new Event("visibilitychange"));
			await vi.advanceTimersByTimeAsync(0);
			expect(send).toHaveBeenCalledTimes(3);
			stop();
			await vi.advanceTimersByTimeAsync(120_000);
			expect(send).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});
});
