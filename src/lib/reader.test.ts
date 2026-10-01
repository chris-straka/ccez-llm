import { describe, expect, it } from "vitest";
import {
	phraseFontPx,
	phraseIndexAtOffset,
	readerGesture,
	readerKeyAction,
	readerPhrases,
	readerStep,
	startReader,
	type ReaderKeyFacts,
	type ReaderState
} from "./reader";

const TEXT =
	"Der Bahnhof ist ganz in der Nähe. Gehen Sie geradeaus bis zur Kreuzung. Dann links.";

describe("readerPhrases", () => {
	it("splits sentences into short phrases without splitting words", () => {
		const phrases = readerPhrases(TEXT);
		expect(phrases.map((p) => p.text)).toEqual([
			"Der Bahnhof ist",
			"ganz in der Nähe.",
			"Gehen Sie",
			"geradeaus bis zur",
			"Kreuzung.",
			"Dann links."
		]);
		expect(phrases.every((p) => p.text.length <= 18)).toBe(true);
		expect(phrases[3]).toMatchObject({
			sentenceIndex: 1,
			sentence: "Gehen Sie geradeaus bis zur Kreuzung."
		});
	});

	it("caps words per phrase when the setting asks (one big word at a time)", () => {
		expect(
			readerPhrases("Gehen Sie geradeaus, bitte.", 18, 1).map((p) => p.text)
		).toEqual(["Gehen", "Sie", "geradeaus,", "bitte."]);
		expect(
			readerPhrases("Gehen Sie geradeaus, bitte.", 18, 2).map((p) => p.text)
		).toEqual(["Gehen Sie", "geradeaus, bitte."]);
	});

	it("records where each phrase sits in its sentence", () => {
		const phrases = readerPhrases("die Katze und die Maus", 18, 1);
		expect(phrases.map((p) => p.at)).toEqual([0, 4, 10, 14, 18]);
		for (const p of phrases)
			expect(p.sentence.slice(p.at, p.at + p.text.length)).toBe(p.text);
	});

	it("keeps an over-long word whole", () => {
		const phrases = readerPhrases(
			"Die Donaudampfschifffahrtsgesellschaft fährt."
		);
		expect(phrases.map((p) => p.text)).toEqual([
			"Die",
			"Donaudampfschifffahrtsgesellschaft",
			"fährt."
		]);
	});

	it("phrases Japanese on word boundaries", () => {
		const phrases = readerPhrases(
			"今日は天気がいいです。散歩に行きましょう。",
			6
		);
		expect(phrases.length).toBeGreaterThan(2);
		expect(phrases.map((p) => p.text).join("")).toBe(
			"今日は天気がいいです。散歩に行きましょう。"
		);
		expect(phrases.every((p) => p.text.length <= 8)).toBe(true);
	});

	it("starts at the sentence holding an offset", () => {
		const phrases = readerPhrases(TEXT);
		expect(phraseIndexAtOffset(TEXT, phrases, 0)).toBe(0);
		expect(phraseIndexAtOffset(TEXT, phrases, TEXT.indexOf("Kreuzung"))).toBe(
			2
		);
		expect(phraseIndexAtOffset(TEXT, phrases, TEXT.indexOf("links"))).toBe(5);
	});
});

describe("readerStep", () => {
	const phrases = readerPhrases(TEXT);
	const run = (
		state: ReaderState,
		...events: Parameters<typeof readerStep>[1][]
	) => {
		let s = state;
		let last = readerStep(s, events[0]!);
		s = last.state;
		for (const e of events.slice(1)) {
			last = readerStep(s, e);
			s = last.state;
		}
		return last;
	};

	it("follow mode moves on when a phrase finishes, and pauses on tap", () => {
		const s0 = startReader(phrases, "follow");
		const a = readerStep(s0, "spoken");
		expect(a.state.index).toBe(1);
		expect(a.effects.speak).toBe(true);
		const paused = readerStep(a.state, "tap");
		expect(paused.state.paused).toBe(true);
		expect(paused.effects.stop).toBe(true);
		// A phrase ending after the pause never advances.
		expect(readerStep(paused.state, "spoken").state.index).toBe(1);
		const resumed = readerStep(paused.state, "tap");
		expect(resumed.state).toMatchObject({ index: 1, paused: false });
		expect(resumed.effects.speak).toBe(true);
	});

	it("tap mode waits after each phrase and advances on tap", () => {
		const s0 = startReader(phrases, "tap");
		expect(readerStep(s0, "spoken").state.index).toBe(0);
		const t = readerStep(s0, "tap");
		expect(t.state.index).toBe(1);
		expect(t.effects.speak).toBe(true);
	});

	it("finishes on the last phrase, then a tap closes", () => {
		const end = startReader(phrases, "follow", phrases.length - 1);
		const done = readerStep(end, "spoken");
		expect(done.state.done).toBe(true);
		expect(readerStep(done.state, "tap").effects.close).toBe(true);
	});

	it("arrows jump by sentence; back returns to the sentence start first", () => {
		const s0 = startReader(phrases, "follow", 1);
		expect(readerStep(s0, "next").state.index).toBe(2);
		expect(readerStep(s0, "prev").state.index).toBe(0);
		expect(run(startReader(phrases, "follow", 2), "prev").state.index).toBe(0);
		expect(run(startReader(phrases, "follow", 3), "prev").state.index).toBe(2);
		expect(
			run(startReader(phrases, "follow", 3), "prev", "prev").state.index
		).toBe(0);
		// No sentence after the last: next stays put.
		expect(
			readerStep(startReader(phrases, "follow", 5), "next").state.index
		).toBe(5);
	});

	it("an empty reader closes on tap", () => {
		expect(readerStep(startReader([], "follow"), "tap").effects.close).toBe(
			true
		);
	});
});

describe("readerKeyAction", () => {
	const k = (
		key: string,
		code: string,
		mods: Partial<ReaderKeyFacts> = {}
	): ReaderKeyFacts => ({
		key,
		code,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		repeat: false,
		...mods
	});
	it("maps reader keys and fences the chat behind", () => {
		expect(readerKeyAction(k(" ", "Space"))).toBe("tap");
		expect(readerKeyAction(k("Enter", "Enter"))).toBe("tap");
		expect(readerKeyAction(k("ArrowRight", "ArrowRight"))).toBe("next");
		expect(readerKeyAction(k("ArrowLeft", "ArrowLeft"))).toBe("prev");
		expect(readerKeyAction(k("Escape", "Escape"))).toBe("close");
		expect(readerKeyAction(k("j", "KeyJ"))).toBe("swallow");
		expect(readerKeyAction(k("q", "KeyQ", { metaKey: true }))).toBe("pass");
	});
});

describe("phraseFontPx", () => {
	it("fits the longest word on a line and caps the height", () => {
		// Phone: the longest word sets the size.
		const fit = phraseFontPx("zur Kreuzung", 412, 915);
		expect(fit * 0.64 * "Kreuzung".length).toBeLessThanOrEqual(412 * 0.88 + 1);
		// A word too long for any readable size floors (CSS wraps it).
		expect(phraseFontPx("Donaudampfschifffahrtsgesellschaft", 412, 915)).toBe(
			32
		);
		// Laptop, short word: the height cap wins.
		expect(phraseFontPx("Ja", 1280, 800)).toBe(320);
		// Laptop, three words: the wrapped lines fit the screen height.
		const three = phraseFontPx("Der Bahnhof ist", 1280, 800);
		const lines = Math.ceil((15 * 0.64 * three) / (1280 * 0.88)) + 1;
		expect(lines * three * 1.1).toBeLessThanOrEqual(800 * 0.6);
		// CJK counts square glyphs.
		expect(phraseFontPx("天気", 412, 915)).toBeLessThanOrEqual(
			Math.floor((412 * 0.88) / 2)
		);
		expect(phraseFontPx("x".repeat(400), 300, 300)).toBe(32);
	});
});

describe("readerGesture", () => {
	it("reads swipes and taps", () => {
		expect(readerGesture(-120, 10)).toBe("next");
		expect(readerGesture(120, 10)).toBe("prev");
		expect(readerGesture(5, 140)).toBe("close");
		expect(readerGesture(4, 6)).toBe("tap");
	});
});
