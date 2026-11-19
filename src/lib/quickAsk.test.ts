import { describe, it, expect } from "vitest";
import {
	answerAsk,
	askMessages,
	failureText,
	QUICK_ASK_DELTA_EVENT,
	QUICK_ASK_DONE_EVENT,
	QUICK_ASK_FAILED_EVENT,
	QUICK_ASK_RETRACT_EVENT,
	notificationText,
	oneASite,
	readAsk,
	siteName,
	threadFor,
	type AskTurn
} from "./quickAsk";
import type { ChatProvider, StreamCallbacks } from "./providers/types";

const ask = (q: string) => ({
	id: 7,
	chat: "a1b2",
	messages: [{ role: "user", content: q }]
});

describe("the Ask window's request", () => {
	it("takes a whole thread ending in a question", () => {
		expect(readAsk(ask("Quelle heure est-il à Tokyo ?"))).toEqual({
			id: 7,
			chat: "a1b2",
			messages: [{ role: "user", content: "Quelle heure est-il à Tokyo ?" }]
		});
	});
	it("refuses a bad id, a bad chat, or a thread not ending in a question", () => {
		expect(readAsk({ ...ask("Hallo"), id: "7" })).toBeNull();
		expect(readAsk({ ...ask("Hallo"), chat: "../x" })).toBeNull();
		expect(
			readAsk({
				id: 1,
				chat: "c",
				messages: [{ role: "assistant", content: "Guten Tag" }]
			})
		).toBeNull();
		expect(readAsk(null)).toBeNull();
	});
	it("drops empty and unknown turns", () => {
		const r = readAsk({
			id: 1,
			chat: "c",
			messages: [
				{ role: "system", content: "x" },
				{ role: "user", content: "  " },
				{ role: "user", content: "東京は今何時？" }
			]
		});
		expect(r?.messages).toEqual([{ role: "user", content: "東京は今何時？" }]);
	});
});

describe("the thread the window sends", () => {
	it("keeps answered turns and ends with the new question", () => {
		expect(
			threadFor([
				{
					q: "Wie spät ist es?",
					a: "Es ist drei Uhr.",
					failed: "",
					done: true
				},
				{ q: "Und in Paris?", a: "", failed: "", done: false }
			])
		).toEqual([
			{ role: "user", content: "Wie spät ist es?" },
			{ role: "assistant", content: "Es ist drei Uhr." },
			{ role: "user", content: "Und in Paris?" }
		]);
	});
	it("keeps each answer's sources for the next filing", () => {
		const thread = threadFor([
			{
				q: "Capitale du Canada ?",
				a: "Ottawa.",
				cited: ["https://ottawa.ca/fr"],
				failed: "",
				done: true
			},
			{ q: "Et Toronto ?", a: "", failed: "", done: false }
		]);
		expect(thread[1]).toEqual({
			role: "assistant",
			content: "Ottawa.",
			cited: ["https://ottawa.ca/fr"]
		});
		// The window's request keeps them; the provider never sees them.
		const read = readAsk({ id: 1, chat: "c", messages: thread });
		expect(read?.messages[1]?.cited).toEqual(["https://ottawa.ca/fr"]);
		expect(askMessages(read!.messages)[2]).toEqual({
			role: "assistant",
			content: "Ottawa."
		});
	});
	it("leaves out a question whose answer failed", () => {
		expect(
			threadFor([
				{ q: "Bonjour ?", a: "", failed: "Stopped.", done: true },
				{ q: "Bonsoir ?", a: "", failed: "", done: false }
			])
		).toEqual([{ role: "user", content: "Bonsoir ?" }]);
	});
	it("puts the quick-answer line first for the provider", () => {
		const m = askMessages([{ role: "user", content: "Salut" }]);
		expect(m[0]?.role).toBe("system");
		expect(m[1]).toEqual({ role: "user", content: "Salut" });
	});
});

describe("the notification's text", () => {
	it("drops markdown marks and folds lines", () => {
		expect(notificationText("**Il est** 15 h\n\n- à _Tokyo_")).toBe(
			"Il est 15 h - à Tokyo"
		);
	});
	it("cuts a long answer at a word", () => {
		const long =
			"Der Fuji ist der höchste Berg Japans und ein aktiver Vulkan ".repeat(5);
		const t = notificationText(long, 60);
		expect(t.length).toBeLessThanOrEqual(61);
		expect(t.endsWith("…")).toBe(true);
		expect(t).not.toMatch(/\s…$/);
	});
});

function provider(
	run: (cb: StreamCallbacks) => Promise<string>,
	cited?: string[]
): ChatProvider {
	return {
		id: "deepseek",
		chat: () => Promise.reject(new Error("unused")),
		stream: async (_m, cb) => ({ content: await run(cb), usage: null, cited })
	};
}

describe("answering", () => {
	it("streams pieces, says done, and files the thread with its sources", async () => {
		const sent: [string, unknown][] = [];
		const saved: [string, AskTurn[], string[]][] = [];
		const out = await answerAsk(
			readAsk(ask("Capitale du Japon ?"))!,
			{
				resolve: () =>
					provider(
						async (cb) => {
							cb.onToken("Tokyo");
							cb.onToken(".");
							return "Tokyo.";
						},
						["https://fr.wikipedia.org/wiki/Tokyo"]
					),
				save: (chat, thread, cited) => saved.push([chat, thread, cited])
			},
			(e, p) => sent.push([e, p])
		);
		expect(out).toEqual({ answer: "Tokyo." });
		expect(sent.map(([e]) => e)).toEqual([
			QUICK_ASK_DELTA_EVENT,
			QUICK_ASK_DELTA_EVENT,
			QUICK_ASK_DONE_EVENT
		]);
		expect(sent.at(-1)?.[1]).toEqual({
			id: 7,
			text: "Tokyo.",
			cited: ["https://fr.wikipedia.org/wiki/Tokyo"]
		});
		expect(saved).toEqual([
			[
				"a1b2",
				[
					{ role: "user", content: "Capitale du Japon ?" },
					{ role: "assistant", content: "Tokyo." }
				],
				["https://fr.wikipedia.org/wiki/Tokyo"]
			]
		]);
	});
	it("passes a tool round's retract on", async () => {
		const sent: string[] = [];
		await answerAsk(
			readAsk(ask("Météo ?"))!,
			{
				resolve: () =>
					provider(async (cb) => {
						cb.onToken("Je cherche");
						cb.onRoundRetract?.();
						cb.onToken("Il pleut.");
						return "Il pleut.";
					}),
				save: () => undefined
			},
			(e) => sent.push(e)
		);
		expect(sent).toContain(QUICK_ASK_RETRACT_EVENT);
	});
	it("says so without a key, and saves nothing", async () => {
		const sent: [string, unknown][] = [];
		let saved = false;
		const out = await answerAsk(
			readAsk(ask("Hallo"))!,
			{ resolve: () => null, save: () => (saved = true) },
			(e, p) => sent.push([e, p])
		);
		expect("failed" in out).toBe(true);
		expect(sent[0]?.[0]).toBe(QUICK_ASK_FAILED_EVENT);
		expect(saved).toBe(false);
	});
	it("turns a provider error into words", async () => {
		const sent: [string, unknown][] = [];
		const out = await answerAsk(
			readAsk(ask("Hallo"))!,
			{
				resolve: () =>
					provider(() =>
						Promise.reject(new Error("DeepSeek: 402 out of credit"))
					),
				save: () => undefined
			},
			(e, p) => sent.push([e, p])
		);
		expect(out).toEqual({ failed: "DeepSeek: 402 out of credit" });
		expect(sent).toEqual([
			[QUICK_ASK_FAILED_EVENT, { id: 7, text: "DeepSeek: 402 out of credit" }]
		]);
		expect(failureText(new DOMException("x", "AbortError"))).toBe("Stopped.");
	});
});

describe("sources", () => {
	it("show as their site, once each", () => {
		expect(siteName("https://www.ottawa.ca/fr/ville")).toBe("ottawa.ca");
		expect(siteName("https://assets.publishing.service.gov.uk/x.pdf")).toBe(
			"service.gov.uk"
		);
		expect(
			oneASite([
				"https://ottawa.ca/fr",
				"https://www.ottawa.ca/en",
				"https://fr.wikipedia.org/wiki/Ottawa"
			])
		).toEqual(["https://ottawa.ca/fr", "https://fr.wikipedia.org/wiki/Ottawa"]);
	});
});
