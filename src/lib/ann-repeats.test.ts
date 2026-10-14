import { describe, it, expect } from "vitest";
import { repeatInksByMessage, REPEAT_INK_COUNT } from "./ann-repeats";
import type { Annotation, AnnotationId } from "./annotations";
import type { ChatMsgId } from "./chat";

const m = (id: string): ChatMsgId => id as ChatMsgId;
let n = 0;
const ann = (messageId: string, quote: string, at?: number): Annotation => ({
	id: `a${++n}` as AnnotationId,
	messageId: m(messageId),
	quote,
	comment: "",
	...(at === undefined ? {} : { at })
});

describe("repeatInksByMessage", () => {
	const ids = [m("m1"), m("m2"), m("m3")];

	it("inks a quote from its annotation onward, never above it", () => {
		const out = repeatInksByMessage(ids, [ann("m2", "Haus", 1)]);
		expect(out.has(m("m1"))).toBe(false);
		expect(out.get(m("m2"))).toEqual([{ quote: "Haus", ink: 0, from: 1 }]);
		expect(out.get(m("m3"))).toEqual([{ quote: "Haus", ink: 0, from: 0 }]);
	});

	it("gives each quote its own ink in chat order, cycling", () => {
		const list = [
			ann("m3", "drei"),
			ann("m1", "eins"),
			ann("m1", "zwei"),
			ann("m2", "vier")
		];
		const out = repeatInksByMessage(ids, list);
		const inkOf = (q: string): number | undefined =>
			out.get(m("m3"))?.find((r) => r.quote === q)?.ink;
		expect(inkOf("eins")).toBe(0);
		expect(inkOf("zwei")).toBe(1);
		expect(inkOf("vier")).toBe(2);
		expect(inkOf("drei")).toBe(3 % REPEAT_INK_COUNT);
	});

	it("a second annotation of the same text shares the first one's ink", () => {
		const list = [ann("m1", "露"), ann("m2", "軍"), ann("m3", " 露 ")];
		const out = repeatInksByMessage(ids, list);
		expect(out.get(m("m3"))).toEqual([
			{ quote: "露", ink: 0, from: 0 },
			{ quote: "軍", ink: 1, from: 0 }
		]);
	});

	it("the topmost annotation of a repeated quote anchors it", () => {
		const out = repeatInksByMessage(ids, [
			ann("m2", "Tag", 2),
			ann("m2", "tag", 0)
		]);
		expect(out.get(m("m2"))).toEqual([{ quote: "tag", ink: 0, from: 0 }]);
	});

	it("skips stories, other chats, and quotes without letters", () => {
		const story: Annotation = {
			id: "s" as AnnotationId,
			story: { link: "l", title: "t", outlet: "o", lang: "de" },
			quote: "Haus",
			comment: ""
		};
		const out = repeatInksByMessage(ids, [
			story,
			ann("gone", "Haus"),
			ann("m1", "…!")
		]);
		expect(out.size).toBe(0);
	});
});
