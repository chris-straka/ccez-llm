import { describe, it, expect } from "vitest";
import {
	emptyViewport,
	pickScrollAnchor,
	rectInClear,
	clearLandingDelta,
	stickAfterScroll
} from "./viewport";

describe("emptyViewport", () => {
	it("starts unpinned, unheld, uncached", () => {
		expect(emptyViewport()).toEqual({
			stick: false,
			holding: false,
			hold: null,
			holdSeq: 0,
			idleTimer: undefined,
			lastStreamLen: 0,
			lastTop: 0,
			anchor: null
		});
	});

	it("hands out independent states", () => {
		const a = emptyViewport();
		const b = emptyViewport();
		a.stick = true;
		a.lastStreamLen = 42;
		a.holdSeq = 7;
		expect(b.stick).toBe(false);
		expect(b.lastStreamLen).toBe(0);
		expect(b.holdSeq).toBe(0);
	});
});

describe("clear-view geometry", () => {
	it("reads clear inside the column above the dock", () => {
		expect(rectInClear(100, 150, 0, 500, 100)).toBe(true);
		expect(rectInClear(100, 450, 0, 500, 100)).toBe(false);
		expect(rectInClear(-10, 50, 0, 500, 100)).toBe(false);
	});

	it("lands covered rects a third down the clear height", () => {
		expect(clearLandingDelta(400, 0, 500, 100)).toBe(400 - 120);
		// A dock taller than the column clamps the landing at the top.
		expect(clearLandingDelta(400, 0, 500, 900)).toBe(400);
	});
});

describe("stickAfterScroll", () => {
	const base = { stick: true, top: 1000, lastTop: 1000, gap: 0, slop: 64 };
	it("pins at the true bottom, even after a shrink clamp", () => {
		expect(stickAfterScroll({ ...base, stick: false, top: 990, gap: 0 })).toBe(true);
	});
	it("unpins on any upward move, inside the slop too", () => {
		expect(stickAfterScroll({ ...base, top: 997, gap: 3 })).toBe(false);
		expect(stickAfterScroll({ ...base, top: 600, gap: 400 })).toBe(false);
	});
	it("re-pins moving down into the slop, keeps state otherwise", () => {
		expect(stickAfterScroll({ ...base, stick: false, top: 1010, gap: 40 })).toBe(true);
		expect(stickAfterScroll({ ...base, stick: false, top: 1010, gap: 400 })).toBe(false);
		expect(stickAfterScroll({ ...base, stick: true, top: 1010, gap: 400 })).toBe(true);
		expect(stickAfterScroll({ ...base, stick: false, gap: 400 })).toBe(false);
	});
});

describe("pickScrollAnchor", () => {
	it("takes the first message still showing below the box top", () => {
		const rects = [
			{ id: "msg-0", top: -900, bottom: -20 },
			{ id: "msg-1", top: -20, bottom: 400 },
			{ id: "msg-2", top: 400, bottom: 900 }
		];
		expect(pickScrollAnchor(rects, 0)).toEqual({ id: "msg-1", offset: -20 });
		expect(pickScrollAnchor(rects, 500)).toEqual({ id: "msg-2", offset: -100 });
		expect(pickScrollAnchor([], 0)).toBeNull();
	});
});
