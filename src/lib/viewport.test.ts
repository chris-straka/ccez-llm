import { describe, it, expect } from "vitest";
import {
	emptyViewport,
	rectInClear,
	clearLandingDelta,
	editViewDelta
} from "./viewport";

describe("emptyViewport", () => {
	it("starts pinned, unheld, uncached", () => {
		expect(emptyViewport()).toEqual({
			stick: true,
			holding: false,
			hold: null,
			holdSeq: 0,
			idleTimer: undefined,
			lastStreamLen: 0
		});
	});

	it("hands out independent states", () => {
		const a = emptyViewport();
		const b = emptyViewport();
		a.stick = false;
		a.lastStreamLen = 42;
		a.holdSeq = 7;
		expect(b.stick).toBe(true);
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

describe("editViewDelta", () => {
	it("lands quotes a fifth down the visible chat", () => {
		expect(editViewDelta(500, 0, 1000)).toBe(300);
		expect(editViewDelta(205, 0, 1000)).toBeNull();
		expect(editViewDelta(195, 0, 1000)).toBeNull();
		expect(editViewDelta(100, 0, 1000)).toBe(-100);
	});
});
