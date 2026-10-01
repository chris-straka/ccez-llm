import { describe, expect, it } from "vitest";
import type { Annotation, AnnotationId } from "./annotations";
import { withAnnotations } from "./annotations";
import type { ChatId, ChatMsgId } from "./chat";
import {
	RELEARN_MS,
	ankiExport,
	cardKey,
	currentCard,
	deckKeyAction,
	contextSentence,
	dismissCard,
	dueCards,
	gradeCard,
	harvestCards,
	intervalLabel,
	isEnglishQuote,
	nextDueAt,
	loadReviewSchedule,
	saveReviewSchedule,
	sessionQueue,
	startSession,
	stepSession,
	type DeckKeyFacts,
	type HarvestChat,
	type ReviewCard,
	type ReviewSchedule
} from "./flashcards";

const chatA = "chat-a" as ChatId;
const msg = (id: string) => id as ChatMsgId;
const DAY = 24 * 60 * 60 * 1000;

function card(key: string, extra: Partial<ReviewCard> = {}): ReviewCard {
	return {
		key,
		quote: key,
		context: "",
		answer: "a",
		note: "",
		lang: null,
		chatId: chatA,
		...extra
	};
}

describe("harvestCards", () => {
	const reply =
		"Ich wohne in Berlin. Der Bahnhof ist ganz in der Nähe. Er ist groß.\n\nZweiter Absatz.";

	it("turns answered drafts into cards with their sentence as context", () => {
		const chats: HarvestChat[] = [
			{
				id: chatA,
				messages: [{ id: msg("m1"), role: "assistant", content: reply }]
			}
		];
		const drafts: Annotation[] = [
			{
				id: "x" as AnnotationId,
				messageId: msg("m1"),
				quote: "ganz in der Nähe",
				comment: "meaning?",
				answer: "very close by"
			},
			// Unanswered: not a card yet.
			{
				id: "y" as AnnotationId,
				messageId: msg("m1"),
				quote: "groß",
				comment: ""
			}
		];
		const cards = harvestCards(chats, () => drafts);
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({
			quote: "ganz in der Nähe",
			context: "Der Bahnhof ist ganz in der Nähe.",
			answer: "very close by",
			note: "meaning?",
			lang: "de-DE",
			chatId: chatA
		});
	});

	it("reads baked refs from sent messages, context from the quoted reply", () => {
		const sent = withAnnotations("Danke!", [
			{ quote: "Bahnhof", comment: "", answer: "train station" }
		]);
		const chats: HarvestChat[] = [
			{
				id: chatA,
				messages: [
					{ id: msg("m1"), role: "assistant", content: reply },
					{ id: msg("m2"), role: "user", content: sent }
				]
			}
		];
		const cards = harvestCards(chats, () => []);
		expect(cards).toHaveLength(1);
		// The "?" placeholder for an empty question never shows.
		expect(cards[0]).toMatchObject({
			quote: "Bahnhof",
			note: "",
			answer: "train station",
			context: "Der Bahnhof ist ganz in der Nähe."
		});
	});

	it("skips English quotes and keeps one card per phrase, latest answer winning", () => {
		const chats: HarvestChat[] = [
			{
				id: chatA,
				messages: [{ id: msg("m1"), role: "assistant", content: reply }]
			}
		];
		const drafts: Annotation[] = [
			{
				id: "1" as AnnotationId,
				messageId: msg("m1"),
				quote: "what is the point of this",
				comment: "",
				answer: "an English aside"
			},
			{
				id: "2" as AnnotationId,
				messageId: msg("m1"),
				quote: "Bahnhof",
				comment: "",
				answer: "old"
			},
			{
				id: "3" as AnnotationId,
				messageId: msg("m1"),
				quote: "bahnhof ",
				comment: "",
				answer: "new"
			}
		];
		const cards = harvestCards(chats, () => drafts);
		expect(cards.map((c) => c.answer)).toEqual(["new"]);
	});

	it("uses the headline as context for news-story annotations", () => {
		const chats: HarvestChat[] = [{ id: chatA, messages: [] }];
		const drafts: Annotation[] = [
			{
				id: "s" as AnnotationId,
				story: {
					link: "l",
					title: "Le gouvernement annonce une réforme",
					outlet: "o",
					lang: "fr"
				},
				quote: "réforme",
				comment: "",
				answer: "reform"
			}
		];
		expect(harvestCards(chats, () => drafts)[0]?.context).toBe(
			"Le gouvernement annonce une réforme"
		);
	});
});

describe("isEnglishQuote", () => {
	it("flags English sentences, not French, German, or unknown single words", () => {
		expect(isEnglishQuote("what is the point of this")).toBe(true);
		expect(isEnglishQuote("je ne sais pas ce que c'est")).toBe(false);
		expect(isEnglishQuote("Das ist mir egal")).toBe(false);
		expect(isEnglishQuote("Bahnhof")).toBe(false);
		expect(isEnglishQuote("逆転裁判")).toBe(false);
	});
});

describe("contextSentence", () => {
	it("returns nothing when the context only repeats the quote", () => {
		expect(contextSentence("Bahnhof", "Bahnhof")).toBe("");
	});

	it("clips long sentences around the quote", () => {
		const long = `${"mot ".repeat(100)}cible ${"mot ".repeat(100)}`;
		const out = contextSentence(long, "cible");
		expect(out.length).toBeLessThanOrEqual(242);
		expect(out).toContain("cible");
		expect(out.startsWith("…")).toBe(true);
		expect(out.endsWith("…")).toBe(true);
	});
});

describe("scheduling", () => {
	const now = 1_000_000;

	it("climbs 1, 3, then ×2.5 days on Got it; Again relearns in minutes", () => {
		const one = gradeCard(undefined, "good", now);
		expect(one).toEqual({ due: now + DAY, interval: 1, reps: 1 });
		const two = gradeCard(one, "good", now);
		expect(two.interval).toBe(3);
		const three = gradeCard(two, "good", now);
		expect(three.interval).toBe(8);
		expect(gradeCard(three, "again", now)).toEqual({
			due: now + RELEARN_MS,
			interval: 0,
			reps: 0
		});
	});

	it("queues overdue reviews oldest-first ahead of new cards, capped", () => {
		const cards = ["new1", "late", "later", "future", "gone", "new2"].map((k) =>
			card(k)
		);
		const schedule: ReviewSchedule = {
			late: { due: now - 10, interval: 1, reps: 1 },
			later: { due: now - 100, interval: 1, reps: 1 },
			future: { due: now + 10, interval: 1, reps: 1 },
			gone: dismissCard(undefined, now)
		};
		expect(dueCards(cards, schedule, now).map((c) => c.key)).toEqual([
			"new1",
			"late",
			"later",
			"new2"
		]);
		expect(sessionQueue(cards, schedule, now, 3).map((c) => c.key)).toEqual([
			"later",
			"late",
			"new1"
		]);
	});

	it("labels intervals in plain units", () => {
		expect(intervalLabel(RELEARN_MS)).toBe("10 min");
		expect(intervalLabel(DAY)).toBe("1 day");
		expect(intervalLabel(8 * DAY)).toBe("8 days");
		expect(intervalLabel(60 * DAY)).toBe("2 months");
	});
});

describe("ankiExport", () => {
	it("writes an Anki tab-separated import with escaped HTML and no dismissed cards", () => {
		const cards = [
			card("<b>", {
				quote: "<b>",
				context: "a\tb",
				answer: "line1\nline2",
				note: "why?"
			}),
			card("skip")
		];
		const out = ankiExport(cards, { skip: dismissCard(undefined, 0) });
		expect(out).toBe(
			"#separator:tab\n#html:true\n#columns:Front\tBack\n" +
				"<b>&lt;b&gt;</b><br><small>a b</small>\tline1<br>line2<br><small>why?</small>\n"
		);
	});
});

describe("schedule storage", () => {
	it("round-trips and drops malformed entries", () => {
		const map = new Map<string, string>();
		const store = {
			getItem: (k: string) => map.get(k) ?? null,
			setItem: (k: string, v: string) => void map.set(k, v)
		};
		saveReviewSchedule(
			{ a: { due: 5, interval: 1, reps: 1, dismissed: true } },
			store
		);
		expect(loadReviewSchedule(store)).toEqual({
			a: { due: 5, interval: 1, reps: 1, dismissed: true }
		});
		map.set(
			"ccez-llm-flashcards-v1",
			JSON.stringify({ a: { due: "x" }, b: { due: 1 } })
		);
		expect(loadReviewSchedule(store)).toEqual({
			b: { due: 1, interval: 0, reps: 0 }
		});
		map.set("ccez-llm-flashcards-v1", "{not json");
		expect(loadReviewSchedule(store)).toEqual({});
	});

	it("normalizes keys by case, spacing, and Unicode form", () => {
		expect(cardKey("  Ganz   in der\nNähe ")).toBe(cardKey("ganz in der nähe"));
		expect(cardKey("é")).toBe(cardKey("é"));
	});
});

describe("deck session", () => {
	const now = 50_000;
	const cards = [card("eins"), card("zwei")];

	it("flips before grading, re-queues Again, and records schedules", () => {
		let s = startSession(cards, {}, now);
		let sched: ReviewSchedule = {};
		expect(currentCard(s)?.key).toBe("eins");
		// Grading face-down only flips.
		({ session: s, schedule: sched } = stepSession(s, sched, "good", now));
		expect(s.flipped).toBe(true);
		expect(sched).toEqual({});
		({ session: s, schedule: sched } = stepSession(s, sched, "again", now));
		expect(s.queue.map((c) => c.key)).toEqual(["eins", "zwei", "eins"]);
		expect(currentCard(s)?.key).toBe("zwei");
		expect(sched.eins?.due).toBe(now + RELEARN_MS);
		({ session: s, schedule: sched } = stepSession(s, sched, "flip", now));
		({ session: s, schedule: sched } = stepSession(s, sched, "good", now));
		expect(sched.zwei?.interval).toBe(1);
		expect(s.reviewed).toBe(2);
		expect(nextDueAt(cards, sched, now)).toBe(now + RELEARN_MS);
	});

	it("dismiss drops the card from the sitting and the deck", () => {
		const s = startSession(cards, {}, now);
		const out = stepSession(s, {}, "dismiss", now);
		expect(out.session.queue.map((c) => c.key)).toEqual(["zwei"]);
		expect(currentCard(out.session)?.key).toBe("zwei");
		expect(out.schedule.eins?.dismissed).toBe(true);
		expect(dueCards(cards, out.schedule, now).map((c) => c.key)).toEqual([
			"zwei"
		]);
	});

	it("is a no-op past the end", () => {
		const s = { ...startSession([], {}, now) };
		expect(stepSession(s, {}, "good", now).session).toBe(s);
	});
});

describe("deckKeyAction", () => {
	const k = (
		key: string,
		code: string,
		mods: Partial<DeckKeyFacts> = {}
	): DeckKeyFacts => ({
		key,
		code,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false,
		...mods
	});

	it("maps the deck keys and fences the chat behind it", () => {
		expect(deckKeyAction(k(" ", "Space"))).toBe("flip");
		expect(deckKeyAction(k("Enter", "Enter"))).toBe("flip");
		expect(deckKeyAction(k("1", "Digit1"))).toBe("again");
		expect(deckKeyAction(k("2", "Digit2"))).toBe("good");
		expect(deckKeyAction(k("Backspace", "Backspace"))).toBe("dismiss");
		expect(deckKeyAction(k("Escape", "Escape"))).toBe("close");
		expect(
			deckKeyAction(k("R", "KeyR", { metaKey: true, shiftKey: true }))
		).toBe("close");
		expect(deckKeyAction(k("j", "KeyJ"))).toBe("swallow");
		expect(deckKeyAction(k("2", "Digit2", { repeat: true }))).toBe("swallow");
		expect(deckKeyAction(k("q", "KeyQ", { metaKey: true }))).toBe("pass");
	});
});
