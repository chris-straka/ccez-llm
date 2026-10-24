// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearRepeatInks,
	focusInks,
	paintRepeatInks
} from "./ann-repeat-paint";

/** A stand-in Highlight registry (jsdom has none). */
class FakeHighlight extends Set<Range> {
	priority = 0;
	constructor(...ranges: Range[]) {
		super(ranges);
	}
}

const registry = new Map<string, FakeHighlight>();

function inked(): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const [name, hl] of registry)
		out[name] = [...hl].map((r) => r.toString());
	return out;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("paintRepeatInks", () => {
	let root: HTMLElement;
	beforeEach(() => {
		registry.clear();
		Object.assign(globalThis, { Highlight: FakeHighlight });
		Object.assign(CSS, { highlights: registry });
		root = document.createElement("div");
		root.className = "rendered";
		root.innerHTML = "<p>Das Haus ist alt, aber das Haus ist schön.</p>";
		document.body.append(root);
	});
	afterEach(() => {
		clearRepeatInks(root);
		root.remove();
	});

	it("underlines the annotated quote solid and its repeat dotted", () => {
		paintRepeatInks(
			root,
			[{ quote: "Haus", ink: 0, from: 0 }],
			[{ quote: "Haus", at: 0 }]
		);
		expect(inked()).toEqual({
			"ccez-rep-0": ["Haus"],
			"ccez-rep-0-again": ["Haus"]
		});
		expect(registry.get("ccez-rep-0")?.priority).toBe(1);
		expect(registry.get("ccez-rep-0-again")?.priority).toBe(0);
	});

	it("paints only the open card's message while it's focused", () => {
		const other = document.createElement("div");
		other.className = "rendered";
		other.innerHTML = "<p>Ein altes Haus.</p>";
		document.body.append(other);
		paintRepeatInks(
			root,
			[{ quote: "alt", ink: 1, from: 0 }],
			[{ quote: "alt", at: 0 }]
		);
		paintRepeatInks(
			other,
			[{ quote: "Haus", ink: 0, from: 0 }],
			[{ quote: "Haus", at: 0 }]
		);
		expect(Object.keys(inked()).sort()).toEqual(["ccez-rep-0", "ccez-rep-1"]);
		focusInks(root);
		expect(inked()["ccez-rep-1"]).toEqual(["alt"]);
		expect(inked()["ccez-rep-0"] ?? []).toEqual([]);
		focusInks(null);
		expect(inked()["ccez-rep-0"]).toEqual(["Haus"]);
		clearRepeatInks(other);
		other.remove();
	});

	it("re-inks after DOM surgery under the body, never onto other text", async () => {
		paintRepeatInks(
			root,
			[{ quote: "Haus", ink: 0, from: 0 }],
			[{ quote: "Haus", at: 0 }]
		);
		// Surgery the stamp never saw: the text node swapped for a
		// split copy (a wash mark's fade, a flash unwrap). The old
		// ranges collapse onto the paragraph.
		const p = root.querySelector("p")!;
		const old = p.firstChild as Text;
		p.replaceChild(document.createTextNode("Das Haus ist alt, "), old);
		p.append(document.createTextNode("aber das Haus ist schön."));
		await flush();
		expect(inked()).toEqual({
			"ccez-rep-0": ["Haus"],
			"ccez-rep-0-again": ["Haus"]
		});
		for (const hl of registry.values())
			for (const r of hl) expect(r.startContainer).toBeInstanceOf(Text);
	});

	it("drops a body's ink when its inks go away", () => {
		paintRepeatInks(root, [{ quote: "Haus", ink: 0, from: 0 }], []);
		expect(inked()).toEqual({ "ccez-rep-0-again": ["Haus", "Haus"] });
		paintRepeatInks(root, [], []);
		expect(inked()).toEqual({});
	});
});
