import { describe, it, expect } from "vitest";
import {
	CLICK_PICK_PX,
	dragRect,
	isClickPick,
	toGlobalRect
} from "./areaPick";

describe("drag normalization", () => {
	it("returns null until both endpoints exist", () => {
		expect(dragRect(null, null)).toBeNull();
		expect(dragRect({ x: 1, y: 2 }, null)).toBeNull();
		expect(dragRect(null, { x: 1, y: 2 })).toBeNull();
	});

	it("normalizes any drag direction to a positive rect", () => {
		expect(
			dragRect({ x: 10, y: 20 }, { x: 110, y: 60 })
		).toEqual({ x: 10, y: 20, width: 100, height: 40 });
		expect(
			dragRect({ x: 110, y: 60 }, { x: 10, y: 20 })
		).toEqual({ x: 10, y: 20, width: 100, height: 40 });
	});
});

describe("click pick", () => {
	it("treats a press-release without a real drag as fullscreen", () => {
		expect(
			isClickPick({ x: 5, y: 5, width: 0, height: 0 })
		).toBe(true);
		expect(
			isClickPick({
				x: 5,
				y: 5,
				width: CLICK_PICK_PX - 1,
				height: CLICK_PICK_PX - 1
			})
		).toBe(true);
	});

	it("keeps a small-but-real square a rect", () => {
		expect(
			isClickPick({ x: 5, y: 5, width: CLICK_PICK_PX, height: 40 })
		).toBe(false);
		expect(
			isClickPick({ x: 5, y: 5, width: 60, height: 25 })
		).toBe(false);
	});
});

describe("global mapping", () => {
	it("adds the window origin without any display-scale multiply", () => {
		// A 100x40 drag on a 2x display stays 100x40 points: the old
		// devicePixelRatio multiply saved 200x80, and screencapture
		// read that as points — a 4x region shifted down-right.
		expect(
			toGlobalRect({ x: 10, y: 20, width: 100, height: 40 }, { x: 0, y: 0 })
		).toEqual({ x: 10, y: 20, width: 100, height: 40 });
		expect(
			toGlobalRect(
				{ x: 10, y: 20, width: 100, height: 40 },
				{ x: 0, y: 25 }
			)
		).toEqual({ x: 10, y: 45, width: 100, height: 40 });
	});

	it("rounds to integer points for the backend", () => {
		expect(
			toGlobalRect(
				{ x: 10.4, y: 20.6, width: 100.2, height: 40.7 },
				{ x: 0.3, y: 0 }
			)
		).toEqual({ x: 11, y: 21, width: 100, height: 41 });
	});

	it("maps the click-pick fullscreen rect to the overlay display", () => {
		expect(
			toGlobalRect(
				{ x: 0, y: 0, width: 1920, height: 1080 },
				{ x: 0, y: 0 }
			)
		).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
	});
});
