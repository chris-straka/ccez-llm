// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
	joinSlicesWithBlocks,
	longestLineWidth,
	scopeSlices,
	selectionSlices,
	shrinkPanelToContent,
	spanRect,
	speechBlockOf,
	textBlockAtPoint,
	tintSelectionSpans,
	unwrapFuriganaTint
} from "./selTint";

afterEach(() => {
	document.body.innerHTML = "";
	window.getSelection()?.removeAllRanges();
});

function rendered(text: string): HTMLElement {
	const div = document.createElement("div");
	div.className = "rendered";
	div.textContent = text;
	document.body.append(div);
	return div;
}

function selectAll(el: HTMLElement): Range {
	const range = document.createRange();
	range.selectNodeContents(el);
	const sel = window.getSelection();
	if (!sel) throw new Error("no selection");
	sel.removeAllRanges();
	sel.addRange(range);
	return range;
}

describe("selectionSlices", () => {
	it("clamps one entry per text node to the range", () => {
		const div = rendered("hello world");
		const node = div.firstChild as Text;
		const range = document.createRange();
		range.setStart(node, 6);
		range.setEnd(node, 11);
		const slices = selectionSlices(range);
		expect(slices?.length).toBe(1);
		expect(
			slices?.map((s) => (s.node.textContent ?? "").slice(s.start, s.end)).join("")
		).toBe("world");
	});

	it("skips chrome text (ruby readings)", () => {
		const div = rendered("");
		div.innerHTML = "base<ruby>漢<rt>かん</rt></ruby>tail";
		const range = document.createRange();
		range.selectNodeContents(div);
		const walked = selectionSlices(range)
			?.map((s) => (s.node.textContent ?? "").slice(s.start, s.end))
			.join("");
		expect(walked).toBe("base漢tail");
	});

	it("returns null when the walk throws", () => {
		expect(selectionSlices(null as unknown as Range)).toBeNull();
	});
});

describe("scopeSlices", () => {
	it("walks the whole scope with running bases", () => {
		const div = rendered("");
		div.innerHTML = "ab<b>cd</b>ef";
		const slices = scopeSlices(div);
		expect(slices.map((s) => s.base)).toEqual([0, 2, 4]);
		expect(
			slices.map((s) => (s.node.textContent ?? "").slice(s.start, s.end)).join("")
		).toBe("abcdef");
	});
});

describe("joinSlicesWithBlocks", () => {
	it("blank-lines rendered blocks apart", () => {
		const div = rendered("");
		div.innerHTML =
			"<p>Alpha beta gamma. Delta epsilon zeta.</p><p>Second paragraph here.</p>";
		const slices = scopeSlices(div);
		const hit = slices[0];
		if (!hit) throw new Error("no slices");
		const { full, at } = joinSlicesWithBlocks(slices, div, hit, 7);
		expect(full).toBe(
			"Alpha beta gamma. Delta epsilon zeta.\n\nSecond paragraph here."
		);
		expect(at).toBe(7);
	});

	it("points the caret into the hit block past the separator", () => {
		const div = rendered("");
		div.innerHTML = "<p>First.</p><p>Second paragraph here.</p>";
		const slices = scopeSlices(div);
		const hit = slices[1];
		if (!hit) throw new Error("no second slice");
		const { full, at } = joinSlicesWithBlocks(slices, div, hit, 1);
		expect(full).toBe("First.\n\nSecond paragraph here.");
		expect(full.slice(at, at + 4)).toBe("econ");
	});

	it("keeps same-block spans fused and clamps the caret", () => {
		const div = rendered("");
		div.innerHTML = "<p>ab<b>cd</b>ef</p>";
		const slices = scopeSlices(div);
		const hit = slices[2];
		if (!hit) throw new Error("no slices");
		const { full, at } = joinSlicesWithBlocks(slices, div, hit, 99);
		expect(full).toBe("abcdef");
		expect(at).toBe(6);
	});

	it("speechBlockOf stays inside the scope", () => {
		const div = rendered("");
		div.innerHTML = "<p>inner</p>";
		document.body.append(div);
		const inner = div.querySelector("p")?.firstChild as Text;
		expect(speechBlockOf(inner, div)?.tagName).toBe("P");
		const outer = document.createElement("div");
		expect(speechBlockOf(inner, outer)).toBeNull();
	});
});

describe("longestLineWidth", () => {
	it("takes the widest top-sharing run span", () => {
		expect(
			longestLineWidth([
				{ top: 10, left: 0, width: 100 },
				{ top: 10, left: 100, width: 146 },
				{ top: 30, left: 0, width: 300 }
			])
		).toBe(300);
	});

	it("unions fragments on a line, skips zero-width ones", () => {
		expect(
			longestLineWidth([
				{ top: 10, left: 0, width: 100 },
				{ top: 10, left: 90, width: 100 },
				{ top: 10, left: 0, width: 0 },
				{ top: 30, left: 0, width: 50 }
			])
		).toBe(190);
		expect(longestLineWidth([])).toBe(0);
	});
});

describe("shrinkPanelToContent", () => {
	it("is zero where nothing lays out (jsdom paints no boxes)", () => {
		const div = rendered("");
		div.innerHTML = "<p>alpha beta gamma</p>";
		expect(shrinkPanelToContent(div)).toBe(0);
	});
});

describe("textBlockAtPoint", () => {
	it("is null where the caret API is missing", () => {
		expect(textBlockAtPoint(10, 10)).toBeNull();
	});
});

describe("spanRect", () => {
	it("is null without layout (jsdom paints no boxes)", () => {
		const div = rendered("hello world");
		selectAll(div);
		const range = window.getSelection()?.getRangeAt(0);
		if (!range) throw new Error("no range");
		const slices = selectionSlices(range);
		expect(slices).not.toBeNull();
		expect(spanRect(slices ?? [], 0, 5)).toBeNull();
	});
});

describe("tint + unwrap roundtrip", () => {
	it("wraps the span in its color class and keeps the highlight text", () => {
		const div = rendered("日本語テスト");
		selectAll(div);
		const range = window.getSelection()?.getRangeAt(0);
		if (!range) throw new Error("no range");
		const slices = selectionSlices(range);
		if (!slices) throw new Error("no slices");
		expect(tintSelectionSpans(slices, [{ start: 0, end: 2, color: 1 }])).toBe(
			true
		);
		const wrap = div.querySelector("span.frbt1");
		expect(wrap?.textContent).toBe("日本");
		expect(window.getSelection()?.toString()).toBe("日本語テスト");
		unwrapFuriganaTint();
		expect(div.querySelector("span.frbt1")).toBeNull();
		expect(div.textContent).toBe("日本語テスト");
	});

	it("refuses without a live highlight", () => {
		const div = rendered("abc");
		expect(tintSelectionSpans(scopeSlices(div), [])).toBe(false);
	});
});
