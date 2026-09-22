// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { caretOffsetInBlock, nodeAtBlockOffset } from "./caret";

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
			expect(caretOffsetInBlock(document, el, hit!.node, hit!.offset)).toBe(
				at
			);
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
