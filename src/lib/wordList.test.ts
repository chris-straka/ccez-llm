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
			(send.mock.calls[0]![1] as RequestInit).body as string
		) as Array<{ word: string; status: string; from: string }>;
		expect(posted).toMatchObject([
			{ word: "fragiliser", status: "learning", from: "ccez-llm" }
		]);
		// Again: back to new.
		await list.toggleLearning("fr", "fragiliser");
		expect(list.status("fr", "fragiliser")).toBe("new");
	});

	it("a quick star and unstar both reach the server, once each, in order", async () => {
		const posted: Array<{ word: string; status: string }> = [];
		let held: (() => void) | null = null;
		const send = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "POST") {
				posted.push(...(JSON.parse(init.body as string) as typeof posted));
				// The first send is slow: the unstar lands while it's out.
				if (!held) await new Promise<void>((r) => (held = r));
				return reply(null);
			}
			return reply({ words: [], seq: 1 });
		});
		const list = new WordList("https://words.test", send);
		const first = list.toggleLearning("fr", "marre");
		await Promise.resolve();
		const second = list.toggleLearning("fr", "marre");
		held!();
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
		).toMatchObject([{ word: "wetter", status: "learning" }]);
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
