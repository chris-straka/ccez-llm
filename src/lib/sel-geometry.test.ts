import { describe, it, expect } from "vitest";
import {
	snapOffsetsToWordEdges,
	placeAnnPopX,
	selMenuPlacement,
	firstContentRect,
	readingPanelPlacement,
	menuYAbovePanel,
	clampPanelCenterX,
	highlightSteady,
	panelCenterMoved,
	lineStartOffset,
	clampDragAnchorToFocusLine,
	clampMenuDrag,
	menuBtnTouchAction,
	selMenuDragTarget,
	pressExpandedSelection
} from "./sel-geometry";

describe("snapOffsetsToWordEdges", () => {
	it("expands mid-word cuts out to the word's edges", () => {
		// "hell|o wo|rld": start cut inside "hello", end cut inside "world".
		expect(snapOffsetsToWordEdges("hello world", 2, 9)).toEqual({
			start: 0,
			end: 11
		});
	});

	it("leaves boundaries already on word edges alone", () => {
		expect(snapOffsetsToWordEdges("hello world", 0, 5)).toEqual({
			start: 0,
			end: 5
		});
		expect(snapOffsetsToWordEdges("hello world", 6, 11)).toEqual({
			start: 6,
			end: 11
		});
		// Leading space is not a word char: no snap into the neighbor.
		expect(snapOffsetsToWordEdges("hello world", 5, 6)).toEqual({
			start: 5,
			end: 6
		});
	});

	it("leaves spaceless scripts untouched", () => {
		expect(snapOffsetsToWordEdges("テストを確認", 2, 4)).toEqual({
			start: 2,
			end: 4
		});
	});

	it("snaps spaced non-Latin words too", () => {
		expect(snapOffsetsToWordEdges("مرحبا بالعالم", 2, 8)).toEqual({
			start: 0,
			end: 13
		});
	});

	it("clamps out-of-range input and normalizes reversed ranges", () => {
		expect(snapOffsetsToWordEdges("hello", -4, 99)).toEqual({
			start: 0,
			end: 5
		});
		expect(snapOffsetsToWordEdges("hello world", 8, 2)).toEqual({
			start: 0,
			end: 11
		});
	});

	it("treats digits and underscores as word characters", () => {
		expect(snapOffsetsToWordEdges("foo_bar2 baz", 2, 10)).toEqual({
			start: 0,
			end: 12
		});
	});
});
describe("placeAnnPopX", () => {
	const viewportWidth = 1280;
	const popWidth = 384;

	it("centers the box over a highlight narrower than the box", () => {
		// Highlight [500, 600): center 550, box 384 wide -> x = 358.
		expect(
			placeAnnPopX({
				cursorX: 600,
				highlightLeft: 500,
				highlightWidth: 100,
				popWidth,
				viewportWidth
			})
		).toBe(358);
	});

	it("keeps the cursor placement for wide highlights", () => {
		expect(
			placeAnnPopX({
				cursorX: 600,
				highlightLeft: 100,
				highlightWidth: 900,
				popWidth,
				viewportWidth
			})
		).toBe(600);
	});

	it("clamps centered and cursor placements on screen", () => {
		expect(
			placeAnnPopX({
				cursorX: 10,
				highlightLeft: 0,
				highlightWidth: 40,
				popWidth,
				viewportWidth
			})
		).toBe(8);
		expect(
			placeAnnPopX({
				cursorX: 2000,
				highlightLeft: 100,
				highlightWidth: 900,
				popWidth,
				viewportWidth
			})
		).toBe(viewportWidth - popWidth - 8);
	});
});
describe("selMenuPlacement", () => {
	const viewportWidth = 1280;
	const viewportHeight = 800;
	const rect = { rectLeft: 500, rectTop: 300, rectBottom: 322, rectWidth: 200 };

	it("docks desktop above the finishing cursor", () => {
		expect(
			selMenuPlacement({
				cursorX: 600,
				cursorY: 310,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: false,
				menuWidth: 120,
				fontScale: 1
			})
		).toEqual({ x: 584, y: 262 });
	});

	it("falls back to the highlight when the cursor is gone (scroll track)", () => {
		expect(
			selMenuPlacement({
				cursorX: undefined,
				cursorY: undefined,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: false,
				menuWidth: 120,
				fontScale: 1
			})
		).toEqual({ x: 484, y: 252 });
	});

	it("clamps to the viewport edges", () => {
		expect(
			selMenuPlacement({
				cursorX: 10,
				cursorY: 4,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: false,
				menuWidth: 120,
				fontScale: 1
			})
		).toEqual({ x: 8, y: 8 });
	});

	it("clamps the right edge by menu width, not a phantom box", () => {
		// Cursor near the right edge: the menu's right edge lands on
		// the viewport's, keeping the button under the cursor instead
		// of stranding it a phantom-box away to the left.
		expect(
			selMenuPlacement({
				cursorX: 1200,
				cursorY: 310,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: false,
				menuWidth: 120,
				fontScale: 1
			})
		).toEqual({ x: 1152, y: 262 });
	});

	it("centers the Android menu over the highlight, like desktop height", () => {
		// Selection middle is 600; a 120-wide menu centers at 540 —
		// never at the cursor-anchored 584, whatever the button count.
		expect(
			selMenuPlacement({
				cursorX: 600,
				cursorY: 310,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: true,
				iosUI: false,
				menuWidth: 120,
				fontScale: 1
			})
		).toEqual({ x: 540, y: 253 });
		expect(
			selMenuPlacement({
				cursorX: 600,
				cursorY: 310,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: true,
				menuWidth: 220,
				fontScale: 1
			})
		).toEqual({ x: 584, y: 253 });
	});

	it("drops the Android menu below only at the cramped top edge", () => {
		expect(
			selMenuPlacement({
				cursorX: 200,
				cursorY: 30,
				rectLeft: 180,
				rectTop: 20,
				rectBottom: 42,
				rectWidth: 120,
				viewportWidth: 360,
				viewportHeight: 740,
				androidUI: true,
				iosUI: false,
				menuWidth: 220,
				fontScale: 1
			})
		).toEqual({ x: 130, y: 72 });
	});

	it("lifts the desktop menu clear of huge type", () => {
		// 370%: the button stands ~83px tall, so the menu rides
		// ~91px above the cursor instead of the 1x 48px — the word
		// stays clickable for double/triple clicks underneath.
		expect(
			selMenuPlacement({
				cursorX: 600,
				cursorY: 310,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: false,
				menuWidth: 120,
				fontScale: 3.7
			})
		).toEqual({ x: 584, y: 219 });
	});

	it("keeps the phone menu centered for 2- and 3-button widths", () => {
		// Same selection (middle 700): narrow and wide rows both ride
		// its middle, so Annotate+Speak centers exactly like the
		// Copy-armed row does.
		const at = {
			cursorX: undefined,
			cursorY: undefined,
			rectLeft: 500,
			rectTop: 300,
			rectBottom: 322,
			rectWidth: 400,
			viewportWidth,
			viewportHeight,
			androidUI: true,
			iosUI: false,
			fontScale: 1
		};
		const narrow = selMenuPlacement({ ...at, menuWidth: 200 });
		const wide = selMenuPlacement({ ...at, menuWidth: 320 });
		expect(narrow).toEqual({ x: 600, y: 253 });
		expect(wide).toEqual({ x: 540, y: 253 });
		expect(narrow.x + 200 / 2).toBe(700);
		expect(wide.x + 320 / 2).toBe(700);
	});
});
describe("firstContentRect", () => {
	it("anchors on the first line fragment, not the union box", () => {
		const first = { left: 40, top: 300, bottom: 322, width: 120, height: 22 };
		const second = { left: 16, top: 322, bottom: 344, width: 200, height: 22 };
		expect(firstContentRect([first, second])).toBe(first);
	});

	it("skips empty fragments and gives up on none", () => {
		const empty = { left: 0, top: 0, bottom: 0, width: 0, height: 0 };
		const live = { left: 40, top: 300, bottom: 322, width: 60, height: 22 };
		expect(firstContentRect([empty, live])).toBe(live);
		expect(firstContentRect([empty])).toBeNull();
		expect(firstContentRect([])).toBeNull();
	});
});
describe("readingPanelPlacement", () => {
	const rect = { left: 40, top: 300, bottom: 322, width: 120, height: 22 };

	it("centers on the span, never its left edge", () => {
		expect(
			readingPanelPlacement({
				rect,
				viewportWidth: 1280,
				viewportHeight: 800
			})
		).toEqual({ x: 100, y: 300, above: true });
	});

	it("goes below without headroom", () => {
		expect(
			readingPanelPlacement({
				rect: { ...rect, top: 40, bottom: 62 },
				viewportWidth: 1280,
				viewportHeight: 800
			})
		).toEqual({ x: 100, y: 62, above: false });
	});

	it("hangs above on phones too — the menu rises above the panel", () => {
		expect(
			readingPanelPlacement({
				rect,
				viewportWidth: 360,
				viewportHeight: 740
			})
		).toEqual({ x: 100, y: 300, above: true });
		expect(
			readingPanelPlacement({
				rect: { ...rect, top: 660, bottom: 700 },
				viewportWidth: 360,
				viewportHeight: 740
			})
		).toEqual({ x: 100, y: 660, above: true });
	});

	it("keeps narrow-phone group centers spread, never stacked", () => {
		// Four kanji groups across a 360px phone: the old fixed-pixel
		// reserve collapsed every center past ~150px to one x.
		const xs = [60, 140, 220, 300].map(
			(left) =>
				readingPanelPlacement({
					rect: { left, top: 300, bottom: 322, width: 40, height: 22 },
					viewportWidth: 360,
					viewportHeight: 740
				}).x
		);
		expect(new Set(xs).size).toBe(4);
		expect(Math.min(...xs)).toBeGreaterThanOrEqual(8);
		expect(Math.max(...xs)).toBeLessThanOrEqual(352);
	});
});
describe("menuYAbovePanel", () => {
	it("clears the panel with a hair, never past the edge", () => {
		expect(menuYAbovePanel(300, 48)).toBe(248);
		expect(menuYAbovePanel(40, 48)).toBe(8);
		expect(menuYAbovePanel(300, 48, 12)).toBe(240);
	});
});
describe("readings width pass", () => {
	it("clampPanelCenterX keeps the 8px margins on both sides", () => {
		expect(clampPanelCenterX(600, 200, 1280)).toBe(600);
		expect(clampPanelCenterX(10, 200, 1280)).toBe(108);
		expect(clampPanelCenterX(1270, 200, 1280)).toBe(1072);
	});

	it("clampPanelCenterX never inverts on a narrow phone", () => {
		// 300-wide panel on a 320 viewport: the upper bound
		// (12) sits below the lower (158), so it parks at 158
		// instead of sliding off the left edge.
		expect(clampPanelCenterX(160, 300, 320)).toBe(158);
	});

	it("panelCenterMoved tolerates a pixel, flags the rest", () => {
		expect(panelCenterMoved(100.5, 100)).toBe(false);
		expect(panelCenterMoved(101.5, 100)).toBe(true);
	});

	it("highlightSteady tolerates 2px drift either way", () => {
		const placed = { left: 100, top: 200 };
		expect(highlightSteady({ left: 101, top: 202 }, placed)).toBe(true);
		expect(highlightSteady({ left: 103, top: 200 }, placed)).toBe(false);
		expect(highlightSteady({ left: 100, top: 204 }, placed)).toBe(false);
	});
});
describe("off-chat drag clamp", () => {
	it("finds the current line's start", () => {
		expect(lineStartOffset("a\nbc\ndef", 6)).toBe(5);
		expect(lineStartOffset("a\nbc\ndef", 5)).toBe(5);
		expect(lineStartOffset("single", 3)).toBe(0);
		expect(lineStartOffset("single", 0)).toBe(0);
	});

	it("pins anchors above the cursor line, passes the rest through", () => {
		// Focus on line 2 ("bc"), anchor up on line 1: pin to line 2's start.
		expect(clampDragAnchorToFocusLine("a\nbc\ndef", 0, 4)).toBe(2);
		// Anchor on the same line or below: untouched.
		expect(clampDragAnchorToFocusLine("a\nbc\ndef", 2, 4)).toBe(2);
		expect(clampDragAnchorToFocusLine("a\nbc\ndef", 6, 4)).toBe(6);
	});
});
describe("clampMenuDrag", () => {
	it("pins the dragged spot inside the viewport", () => {
		expect(clampMenuDrag(100, 100, 400, 800)).toEqual({ x: 100, y: 100 });
		expect(clampMenuDrag(-50, 900, 400, 800)).toEqual({ x: 8, y: 792 });
		expect(clampMenuDrag(500, 100, 400, 800)).toEqual({ x: 392, y: 100 });
	});
});
describe("menuBtnTouchAction", () => {
	const tap = { x: 10, y: 10 };

	it("runs a settled tap", () => {
		expect(
			menuBtnTouchAction({ now: 1000, suppressAt: 0, start: tap, end: tap })
		).toBe("run");
	});

	it("eats the tap while the post-drag drift guard holds", () => {
		expect(
			menuBtnTouchAction({ now: 1000, suppressAt: 500, start: tap, end: tap })
		).toBe("suppress-drag");
		expect(
			menuBtnTouchAction({ now: 1000, suppressAt: 251, start: tap, end: tap })
		).toBe("suppress-drag");
		expect(
			menuBtnTouchAction({ now: 1000, suppressAt: 250, start: tap, end: tap })
		).toBe("run");
	});

	it("drops missing endpoints and handle-nudge drift", () => {
		expect(
			menuBtnTouchAction({ now: 1000, suppressAt: 0, start: null, end: tap })
		).toBe("ignore");
		expect(
			menuBtnTouchAction({ now: 1000, suppressAt: 0, start: tap, end: null })
		).toBe("ignore");
		expect(
			menuBtnTouchAction({
				now: 1000,
				suppressAt: 0,
				start: tap,
				end: { x: 100, y: 100 }
			})
		).toBe("ignore");
	});
});
describe("selMenuDragTarget", () => {
	const drag = { mx: 10, my: 10, x0: 100, y0: 200 };

	it("holds still inside the tap slop", () => {
		expect(
			selMenuDragTarget(drag, { x: 12, y: 12 }, 400, 800)
		).toBeNull();
	});

	it("follows the finger past the slop, clamped to the viewport", () => {
		expect(
			selMenuDragTarget(drag, { x: 30, y: 40 }, 400, 800)
		).toEqual({ x: 120, y: 230 });
		expect(
			selMenuDragTarget(drag, { x: -500, y: -500 }, 400, 800)
		).toEqual({ x: 8, y: 8 });
	});
});
describe("pressExpandedSelection", () => {
	it("flags growth out of the press snapshot", () => {
		expect(pressExpandedSelection("声调", "声调很难")).toBe(true);
	});

	it("ignores steady presses, fresh picks, and empty priors", () => {
		expect(pressExpandedSelection("声调", "声调")).toBe(false);
		expect(pressExpandedSelection("声调", "很难")).toBe(false);
		expect(pressExpandedSelection("", "很难")).toBe(false);
		expect(pressExpandedSelection("", "")).toBe(false);
	});
});
