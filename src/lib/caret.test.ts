// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
	baseCaret,
	baseSpanPoints,
	blockBaseText,
	caretOffsetInBlock,
	nodeAtBlockOffset
} from "./caret";

function block(): Element {
	const div = document.createElement("div");
	div.append(document.createTextNode("Hello "));
	const bold = document.createElement("b");
	bold.append(document.createTextNode("world"));
	div.append(bold);
	div.append(document.createTextNode("!"));
	document.body.append(div);
	return div;
}

describe("caretOffsetInBlock", () => {
	it("sums text across nodes", () => {
		const el = block();
		const first = el.firstChild!;
		// Inside "Hello " at offset 3.
		expect(caretOffsetInBlock(document, el, first, 3)).toBe(3);
		// Inside "world" at offset 2 -> 6 + 2.
		const world = el.querySelector("b")!.firstChild!;
		expect(caretOffsetInBlock(document, el, world, 2)).toBe(8);
	});

	it("clamps past-end offsets and reads past the last node", () => {
		const el = block();
		const world = el.querySelector("b")!.firstChild!;
		expect(caretOffsetInBlock(document, el, world, 99)).toBe(11);
		expect(
			caretOffsetInBlock(document, el, document.createTextNode("x"), 0)
		).toBe(12);
	});
});

describe("nodeAtBlockOffset", () => {
	it("round-trips offsets back to nodes", () => {
		const el = block();
		for (const at of [0, 3, 6, 8, 11, 12]) {
			const hit = nodeAtBlockOffset(document, el, at);
			expect(hit).not.toBeNull();
			expect(caretOffsetInBlock(document, el, hit!.node, hit!.offset)).toBe(at);
		}
	});

	it("lands past-end on the last node and null on empty blocks", () => {
		const el = block();
		const hit = nodeAtBlockOffset(document, el, 99)!;
		expect(hit.node.textContent).toBe("!");
		expect(hit.offset).toBe(1);
		const empty = document.createElement("div");
		document.body.append(empty);
		expect(nodeAtBlockOffset(document, empty, 0)).toBeNull();
	});
});

/** <p>你在做<ruby>什<rt>shén</rt></ruby><ruby>么<rt>me</rt></ruby>呢</p> */
function rubyBlock(): Element {
	const p = document.createElement("p");
	p.append(document.createTextNode("你在做"));
	for (const [char, reading] of [
		["什", "shén"],
		["么", "me"]
	] as const) {
		const ruby = document.createElement("ruby");
		ruby.append(document.createTextNode(char));
		const rt = document.createElement("rt");
		rt.append(document.createTextNode(reading));
		ruby.append(rt);
		p.append(ruby);
	}
	p.append(document.createTextNode("呢"));
	document.body.append(p);
	return p;
}

describe("blockBaseText", () => {
	it("joins base text across ruby and skips the readings", () => {
		const base = blockBaseText(document, rubyBlock(), "rt, rp");
		expect(base.text).toBe("你在做什么呢");
		expect(base.nodes.map((n) => [n.node.textContent, n.start])).toEqual([
			["你在做", 0],
			["什", 3],
			["么", 4],
			["呢", 5]
		]);
	});
});

describe("baseCaret", () => {
	it("maps base nodes to flat offsets and refuses skipped readings", () => {
		const el = rubyBlock();
		const base = blockBaseText(document, el, "rt, rp");
		const shen = el.querySelector("ruby")!.firstChild!;
		expect(baseCaret(base, shen, 0)).toBe(3);
		expect(baseCaret(base, shen, 9)).toBe(4);
		const reading = el.querySelector("rt")!.firstChild!;
		expect(baseCaret(base, reading, 1)).toBeNull();
	});
});

describe("baseSpanPoints", () => {
	it("spans 什么 from its first hanzi node to its last", () => {
		const el = rubyBlock();
		const base = blockBaseText(document, el, "rt, rp");
		const points = baseSpanPoints(base, 3, 5)!;
		const [shen, me] = [...el.querySelectorAll("ruby")].map(
			(r) => r.firstChild
		);
		expect(points.start).toEqual({ node: shen, offset: 0 });
		expect(points.end).toEqual({ node: me, offset: 1 });
		const range = document.createRange();
		range.setStart(points.start.node, points.start.offset);
		range.setEnd(points.end.node, points.end.offset);
		const frag = range.cloneContents();
		for (const rt of frag.querySelectorAll("rt")) rt.remove();
		expect(frag.textContent).toBe("什么");
	});

	it("never reaches over a seam reading for a one-node span", () => {
		const el = rubyBlock();
		const base = blockBaseText(document, el, "rt, rp");
		const points = baseSpanPoints(base, 4, 5)!;
		const me = el.querySelectorAll("ruby")[1]!.firstChild;
		expect(points.start).toEqual({ node: me, offset: 0 });
		expect(points.end).toEqual({ node: me, offset: 1 });
	});

	it("is null for empty and out-of-range spans", () => {
		const base = blockBaseText(document, rubyBlock(), "rt, rp");
		expect(baseSpanPoints(base, 2, 2)).toBeNull();
		expect(baseSpanPoints(base, 0, 99)).toBeNull();
	});
});
