import { describe, it, expect } from "vitest";
import {
	findQuotedMessage,
	resolveSentRefTarget,
	locateQuote,
	occurrenceAtPosition,
	paragraphForQuote
} from "./quote-match";
import type { ChatMsgId } from "./chat";
import type { AnnotationId } from "./annotations";

describe("locateQuote", () => {
	it("finds single-node quotes with offsets", () => {
		expect(locateQuote(["hello world"], "world")).toEqual({
			startNode: 0,
			startOffset: 6,
			endNode: 0,
			endOffset: 11
		});
	});

	it("spans element boundaries (inline markup splits nodes)", () => {
		expect(locateQuote(["hello ", "world"], "hello world")).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 1,
			endOffset: 5
		});
	});

	it("ignores whitespace differences (multi-line selections)", () => {
		expect(
			locateQuote(["first half", "second half"], "first half\n\nsecond half")
		).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 1,
			endOffset: 11
		});
	});

	it("folds typographic punctuation (rendered curly quotes)", () => {
		expect(locateQuote(["say “hi” now"], 'say "hi" now')).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 0,
			endOffset: 12
		});
	});

	it("returns null for empty quotes and cross-message text", () => {
		expect(locateQuote(["hello"], "")).toBeNull();
		expect(locateQuote(["hello"], "bye")).toBeNull();
		expect(
			locateQuote(["first message"], "first message second message")
		).toBeNull();
	});

	it("picks the requested repeat of a repeated quote", () => {
		expect(locateQuote(["ccc"], "c", 0)).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 0,
			endOffset: 1
		});
		expect(locateQuote(["ccc"], "c", 2)).toEqual({
			startNode: 0,
			startOffset: 2,
			endNode: 0,
			endOffset: 3
		});
		// Multi-char repeats across nodes: the second "bc".
		expect(locateQuote(["ab", "cbc"], "bc", 1)).toEqual({
			startNode: 1,
			startOffset: 1,
			endNode: 1,
			endOffset: 3
		});
	});

	it("falls back to the first match past the end", () => {
		expect(locateQuote(["ccc"], "c", 9)).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 0,
			endOffset: 1
		});
	});
});
describe("occurrenceAtPosition", () => {
	it("finds the repeat holding a node offset", () => {
		expect(occurrenceAtPosition(["ccc"], "c", 0, 0)).toBe(0);
		expect(occurrenceAtPosition(["ccc"], "c", 0, 1)).toBe(1);
		expect(occurrenceAtPosition(["ccc"], "c", 0, 2)).toBe(2);
		expect(occurrenceAtPosition(["ccc"], "c", 0, 3)).toBe(0);
	});

	it("maps multi-node positions through whitespace", () => {
		// "a b c", selecting "b c" from raw offset 2.
		expect(occurrenceAtPosition(["a b ", "c"], "b c", 0, 2)).toBe(0);
		// Second "bc" in "abcbc", range starting at raw offset 3.
		expect(occurrenceAtPosition(["abcbc"], "bc", 0, 3)).toBe(1);
	});

	it("returns 0 for empty quotes, misses, and unknown nodes", () => {
		expect(occurrenceAtPosition(["abc"], "", 0, 1)).toBe(0);
		expect(occurrenceAtPosition(["abc"], "z", 0, 1)).toBe(0);
		expect(occurrenceAtPosition(["abc"], "b", 4, 0)).toBe(0);
	});
});
describe("findQuotedMessage", () => {
	const m1 = "m1" as ChatMsgId;
	const m2 = "m2" as ChatMsgId;
	const messages = [
		{ id: m1, content: "Kyoto in spring is lovely" },
		{
			id: m2,
			content: 'explain this\n\nAnnotated selections:\n1. "spring" — ?'
		}
	];

	it("finds the quoted message, never the sender", () => {
		// The sender's baked block quotes it too — including it would
		// land every jump on the sender.
		expect(findQuotedMessage(messages, m2, "spring")).toBe(m1);
	});

	it("returns null when only the sender holds the quote", () => {
		expect(findQuotedMessage(messages, m1, "lovely")).toBeNull();
	});

	it("returns null when the quote is gone everywhere", () => {
		expect(findQuotedMessage(messages, m2, "osaka")).toBeNull();
	});

	it("matches badge-insensitively across whitespace", () => {
		expect(findQuotedMessage(messages, m2, "  Kyoto   in  spring ")).toBe(m1);
	});
});
describe("resolveSentRefTarget", () => {
	const m1 = "m1" as ChatMsgId;
	const m2 = "m2" as ChatMsgId;
	const messages = [
		{ id: m1, content: "Kyoto in spring is lovely" },
		{
			id: m2,
			content: 'explain this\n\nAnnotated selections:\n1. "spring" — ?'
		}
	];
	const ann = "a1" as AnnotationId;

	it("prefers the still-live annotation", () => {
		expect(
			resolveSentRefTarget(
				[{ id: ann, messageId: m2, quote: "spring" }],
				messages,
				m2,
				"spring"
			)
		).toEqual({ kind: "live", id: ann, messageId: m2 });
	});

	it("jumps to the quote owner when the badge is gone", () => {
		expect(resolveSentRefTarget([], messages, m2, "spring")).toEqual({
			kind: "quoted",
			messageId: m1
		});
	});

	it("falls back to the sender when edited away everywhere", () => {
		expect(resolveSentRefTarget([], messages, m2, "osaka")).toEqual({
			kind: "sender",
			index: 1
		});
	});

	it("reports gone when the sender is edited away too", () => {
		expect(
			resolveSentRefTarget([], messages, "m9" as ChatMsgId, "osaka")
		).toEqual({ kind: "gone" });
	});
});
describe("paragraphForQuote", () => {
	const text = "First para here.\n\nSecond holds the quote word.\n\nThird.";

	it("returns the paragraph holding the quote", () => {
		expect(paragraphForQuote(text, "quote word")).toBe(
			"Second holds the quote word."
		);
	});

	it("falls back to the quote when missing or blank", () => {
		expect(paragraphForQuote(text, "absent")).toBe("absent");
		expect(paragraphForQuote(text, "  ")).toBe("");
	});

	it("resolves a repeated quote to its occurrence paragraph", () => {
		const two =
			"日本語の旅行は楽しいです。\n\n北京旅行很好。";
		expect(paragraphForQuote(two, "旅行")).toBe(
			"日本語の旅行は楽しいです。"
		);
		expect(paragraphForQuote(two, "旅行", 1)).toBe("北京旅行很好。");
		// An overrun falls back to the first match, the old behavior.
		expect(paragraphForQuote(two, "旅行", 7)).toBe(
			"日本語の旅行は楽しいです。"
		);
	});
});
