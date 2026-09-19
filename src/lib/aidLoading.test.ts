import { describe, expect, it, vi } from "vitest";
import {
	createAidLoadingReporter,
	createRefMemo,
	furiganaRequestKey
} from "./aidLoading";

describe("createAidLoadingReporter", () => {
	it("notifies on change, never twice in a row", () => {
		const notify = vi.fn();
		const report = createAidLoadingReporter(notify);
		report(true);
		report(true);
		report(true);
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenLastCalledWith(true);
		report(false);
		report(false);
		expect(notify).toHaveBeenCalledTimes(2);
		expect(notify).toHaveBeenLastCalledWith(false);
	});

	it("starts undecided so the first report always lands", () => {
		const notify = vi.fn();
		createAidLoadingReporter(notify)(false);
		expect(notify).toHaveBeenCalledTimes(1);
	});
});

describe("createRefMemo", () => {
	it("returns the same reference for equal content, new for changes", () => {
		const memo = createRefMemo<{ n: number }>((m) => String(m.n));
		const first = memo("a", [{ n: 1 }]);
		expect(memo("a", [{ n: 1 }])).toBe(first);
		expect(memo("a", [{ n: 2 }])).not.toBe(first);
		expect(memo("b", [{ n: 1 }])).not.toBe(first);
	});

	it("keeps empty aid-kind arrays stable so hovers never rebuild bodies", () => {
		// The render effect subscribes to the array identity: a fresh
		// [] per parent render (hovering near an aid button) re-ran
		// every body and re-stamped its badges, flickering the text.
		const memo = createRefMemo<string>((kind) => kind);
		const first = memo("m1", []);
		expect(memo("m1", [])).toBe(first);
		expect(memo("m1", ["pinyin"])).not.toBe(first);
		const pinned = memo("m1", ["pinyin"]);
		expect(memo("m1", ["pinyin"])).toBe(pinned);
	});
});

describe("furiganaRequestKey", () => {
	it("is stable for equal inputs and sensitive to text and folds", () => {
		const a = furiganaRequestKey("日本語", [{ open: true }]);
		expect(furiganaRequestKey("日本語", [{ open: true }])).toBe(a);
		expect(furiganaRequestKey("日本語", [{ open: false }])).not.toBe(a);
		expect(furiganaRequestKey("中文", [{ open: true }])).not.toBe(a);
		expect(furiganaRequestKey("日本語", undefined)).toBe(
			furiganaRequestKey("日本語", null)
		);
	});
});
