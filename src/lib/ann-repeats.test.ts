import { describe, it, expect } from "vitest";
import { inkSpans, repeatInksByMessage, REPEAT_INK_COUNT } from "./ann-repeats";
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

describe("inkSpans", () => {
	const text = (spans: ReturnType<typeof inkSpans>, nodes: string[]) =>
		spans.map(
			({ ink, again, loc }) =>
				`${ink}${again ? "." : "_"}${(nodes[loc.startNode] ?? "").slice(loc.startOffset, loc.endOffset)}@${loc.startOffset}`
		);

	it("draws the annotated quote solid and its repeats dotted", () => {
		const nodes = ["das Haus und das Haus und das Haus"];
		const spans = inkSpans(
			nodes,
			[{ quote: "Haus", ink: 1, from: 1 }],
			[{ quote: "Haus", at: 1 }]
		);
		expect(text(spans, nodes)).toEqual(["1_Haus@17", "1.Haus@30"]);
	});

	it("draws repeats dotted where nothing is annotated", () => {
		const nodes = ["proche du mouvement MAGA"];
		const spans = inkSpans(nodes, [{ quote: "MAGA", ink: 0, from: 0 }], []);
		expect(text(spans, nodes)).toEqual(["0.MAGA@20"]);
	});

	it("drops a repeat nested in another annotated quote", () => {
		const nodes = ["elle est proche du mouvement MAGA, oui"];
		const spans = inkSpans(
			nodes,
			[
				{ quote: "mouvement MAGA", ink: 0, from: 0 },
				{ quote: "proche du mouvement MAGA", ink: 1, from: 0 }
			],
			[{ quote: "proche du mouvement MAGA" }]
		);
		// One unbroken solid line in the quote's own ink.
		expect(text(spans, nodes)).toEqual(["1_proche du mouvement MAGA@9"]);
	});

	it("spans text nodes split by a badge anchor", () => {
		const nodes = ["a connu des ", "débuts difficiles", ", selon"];
		const spans = inkSpans(
			nodes,
			[{ quote: "a connu des débuts difficiles", ink: 2, from: 0 }],
			[{ quote: "a connu des débuts difficiles" }]
		);
		expect(spans).toEqual([
			{
				ink: 2,
				again: false,
				loc: { startNode: 0, startOffset: 0, endNode: 1, endOffset: 17 }
			}
		]);
	});
});
