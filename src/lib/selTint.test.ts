// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
	scopeSlices,
	selectionSlices,
	spanRect,
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
