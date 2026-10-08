import { describe, it, expect } from "vitest";
import {
	annPopBlurAction,
	annPopCancelKind,
	annPopSaveKind,
	annPopWidth,
	pillWashId,
	placeAnnAnswer,
	placeAnnCard,
	placeAnnComposer,
	placeAnswerPopover,
	quoteAnchor
} from "./annPop";

describe("annPopSaveKind", () => {
	it("commits the pending annotation, else edits the saved comment", () => {
		expect(annPopSaveKind("a", "a")).toBe("commit-pending");
		expect(annPopSaveKind("a", "b")).toBe("save-edit");
		expect(annPopSaveKind("a", null)).toBe("save-edit");
	});
});

describe("annPopCancelKind", () => {
	it("drops never-submitted pendings first, even when fresh", () => {
		expect(annPopCancelKind("a", true, "a")).toBe("drop-pending");
		expect(annPopCancelKind("a", false, "a")).toBe("drop-pending");
	});

	it("deletes fresh annotations no matter what was typed", () => {
		expect(annPopCancelKind("a", true, null)).toBe("delete-fresh");
		expect(annPopCancelKind("a", true, "b")).toBe("delete-fresh");
	});

	it("keeps existing annotations as they were", () => {
		expect(annPopCancelKind("a", false, null)).toBe("keep-existing");
		expect(annPopCancelKind("a", false, "b")).toBe("keep-existing");
	});
});

describe("annPopBlurAction", () => {
	it("cancels empty drafts and saves typed ones", () => {
		expect(annPopBlurAction("")).toBe("cancel");
		expect(annPopBlurAction("   ")).toBe("cancel");
		expect(annPopBlurAction("note")).toBe("save");
		expect(annPopBlurAction(" ?")).toBe("save");
	});
});

describe("pillWashId", () => {
	it("holds the wash while open and releases it as the pill closes", () => {
		expect(pillWashId({ id: "a" }, false)).toBe("a");
		expect(pillWashId({ id: "a" }, true)).toBeNull();
		expect(pillWashId(null, false)).toBeNull();
		expect(pillWashId(null, true)).toBeNull();
	});
});

describe("annPopWidth", () => {
	it("runs every popup at 90% of the chat column", () => {
		// Default 36rem column: 32.4rem = 518.4px.
		expect(annPopWidth({ chatWidthRem: 36, viewportWidth: 1280 })).toBeCloseTo(
			518.4,
			10
		);
		// Wide columns earn wide popups (no fixed cap anymore).
		expect(annPopWidth({ chatWidthRem: 60, viewportWidth: 1280 })).toBeCloseTo(
			864,
			10
		);
	});
	it("clamps to the viewport on narrow phones", () => {
		expect(annPopWidth({ chatWidthRem: 36, viewportWidth: 300 })).toBe(284);
	});
});

describe("placeAnnCard", () => {
	it("centers over the anchor inside the viewport", () => {
		expect(
			placeAnnCard({ anchorX: 640, anchorY: 400, width: 384, viewportWidth: 1280, viewportHeight: 800, cardHeight: 240 })
		).toEqual({ x: 448, y: 408 });
	});
	it("clamps narrow viewports instead of running off-screen", () => {
		const { x } = placeAnnCard({
			anchorX: 40,
			anchorY: 400,
			width: 384,
			viewportWidth: 412,
			viewportHeight: 915,
			cardHeight: 240
		});
		expect(x).toBe(8);
	});
	it("drops above the anchor past the bottom edge", () => {
		expect(
			placeAnnCard({ anchorX: 640, anchorY: 780, width: 384, viewportWidth: 1280, viewportHeight: 800, cardHeight: 240 })
		).toEqual({ x: 448, y: 532 });
	});
	it("lands a short card right above a bottom badge", () => {
		// The old fixed 240px estimate left ~100px of daylight here.
		expect(
			placeAnnCard({ anchorX: 200, anchorY: 660, width: 320, viewportWidth: 412, viewportHeight: 700, cardHeight: 140 })
		).toEqual({ x: 40, y: 512 });
	});
	it("fits below the badge when the keyboard shortens the viewport", () => {
		expect(
			placeAnnCard({ anchorX: 200, anchorY: 100, width: 320, viewportWidth: 412, viewportHeight: 400, cardHeight: 140 })
		).toEqual({ x: 40, y: 108 });
	});
	it("pins an overflowing card to the top", () => {
		expect(
			placeAnnCard({ anchorX: 200, anchorY: 150, width: 320, viewportWidth: 412, viewportHeight: 300, cardHeight: 280 })
		).toEqual({ x: 40, y: 8 });
	});
});

describe("placeAnnComposer", () => {
	it("pins phones high and centered", () => {
		expect(
			placeAnnComposer({
				android: true,
				viewportWidth: 400,
				viewportHeight: 800,
				width: 300,
				menuX: 50,
				highlightLeft: 40,
				highlightWidth: 60,
				highlightTop: 580,
				highlightBottom: 600,
				fontScale: 1
			})
		).toEqual({ x: 50, y: 96 });
	});

	it("centers narrow desktop highlights, keeps wide cursor ends", () => {
		const narrow = {
			android: false,
			viewportWidth: 1000,
			viewportHeight: 800,
			width: 304,
			menuX: 500,
			highlightLeft: 100,
			highlightWidth: 50,
			highlightTop: 280,
			highlightBottom: 300,
			fontScale: 1
		};
		// Below the highlight with the 1x breath, never on the word.
		expect(placeAnnComposer(narrow)).toEqual({ x: 8, y: 302 });
		expect(
			placeAnnComposer({ ...narrow, highlightWidth: 500 })
		).toEqual({ x: 500, y: 302 });
	});

	it("scales the below-word gap with the font, flipping above at the edge", () => {
		const base = {
			android: false,
			viewportWidth: 1000,
			viewportHeight: 800,
			width: 304,
			menuX: 500,
			highlightLeft: 100,
			highlightWidth: 50,
			highlightTop: 280,
			highlightBottom: 300,
			fontScale: 3.7
		};
		// 2 + 2.7 × 12 ≈ 34px below the highlight bottom.
		expect(placeAnnComposer(base)).toEqual({ x: 8, y: 334 });
		// No room below: the box goes above the highlight top.
		const edge = { ...base, highlightTop: 700, highlightBottom: 720 };
		const placed = placeAnnComposer(edge);
		expect(placed.y + 99).toBeLessThanOrEqual(700);
		expect(placed.y).toBeGreaterThanOrEqual(8);
	});
});

describe("placeAnnAnswer", () => {
	const base = {
		viewportWidth: 1000,
		menuX: 500,
		highlightLeft: 100,
		highlightWidth: 50,
		highlightBottom: 300,
		width: 304,
		fontScale: 1
	};
	it("hangs below the quote with the create pill's gap and x math", () => {
		expect(placeAnnAnswer(base)).toEqual(placeAnnComposer({ ...base, android: false, viewportHeight: 800, highlightTop: 280 }));
		expect(placeAnnAnswer(base)).toEqual({ x: 8, y: 302 });
	});
	it("never flips above at the edge: the page scrolls instead", () => {
		const edge = { ...base, highlightBottom: 790 };
		expect(placeAnnAnswer(edge)).toEqual({ x: 8, y: 792 });
	});
	it("scales the gap with the font", () => {
		expect(placeAnnAnswer({ ...base, fontScale: 3.7 })).toEqual({ x: 8, y: 334 });
	});
});

describe("placeAnswerPopover", () => {
	const base = {
		anchor: { left: 400, top: 300, right: 460, bottom: 320 },
		clearTop: 288,
		pointX: 430,
		cardWidth: 300,
		cardHeight: 200,
		viewportWidth: 1000,
		viewportHeight: 800,
		gap: 2,
		tail: 9
	};
	it("hangs below the word, centered, tail on the word", () => {
		expect(placeAnswerPopover(base)).toEqual({
			x: 280,
			y: 331,
			side: "below",
			maxHeight: 461,
			tailX: 150
		});
	});
	it("flips above, clear of the badge, when the bottom has no room", () => {
		const p = placeAnswerPopover({
			...base,
			anchor: { left: 400, top: 700, right: 460, bottom: 720 },
			clearTop: 688
		});
		expect(p.side).toBe("above");
		expect(p.y + 200).toBeLessThanOrEqual(688 - 11);
		expect(p.y).toBeGreaterThanOrEqual(8);
	});
	it("caps the height on the roomier side when neither fits", () => {
		const p = placeAnswerPopover({
			...base,
			cardHeight: 2000,
			anchor: { left: 400, top: 500, right: 460, bottom: 520 },
			clearTop: 488
		});
		expect(p.side).toBe("above");
		expect(p.maxHeight).toBe(488 - 11 - 8);
		expect(p.y).toBe(8);
		const low = placeAnswerPopover({ ...base, cardHeight: 2000 });
		expect(low.side).toBe("below");
		expect(low.y + low.maxHeight).toBe(800 - 8);
	});
	it("stays inside the viewport and keeps the tail on the word at edges", () => {
		const left = placeAnswerPopover({
			...base,
			anchor: { left: 4, top: 300, right: 30, bottom: 320 }
		});
		expect(left.x).toBe(8);
		expect(left.tailX).toBe(18);
		const right = placeAnswerPopover({
			...base,
			viewportWidth: 390,
			anchor: { left: 360, top: 300, right: 386, bottom: 320 }
		});
		expect(right.x).toBe(390 - 300 - 8);
		expect(right.x + right.tailX).toBeGreaterThan(360);
	});
	it("points at the pointer inside quotes wider than the card", () => {
		const p = placeAnswerPopover({
			...base,
			anchor: { left: 50, top: 300, right: 950, bottom: 340 },
			pointX: 700
		});
		expect(p.x + p.tailX).toBe(700);
	});
});

describe("quoteAnchor", () => {
	it("anchors on the last line and clears the whole quote and badge", () => {
		const got = quoteAnchor(
			[
				{ left: 300, top: 100, right: 600, bottom: 120 },
				{ left: 40, top: 124, right: 90, bottom: 144 },
				{ left: 90, top: 126, right: 120, bottom: 142 },
				{ left: 0, top: 0, right: 0, bottom: 0 }
			],
			110
		);
		expect(got).toEqual({
			anchor: { left: 40, top: 124, right: 120, bottom: 144 },
			clearTop: 100
		});
		expect(quoteAnchor([{ left: 1, top: 50, right: 9, bottom: 60 }], 38)?.clearTop).toBe(38);
	});
	it("is null without boxes", () => {
		expect(quoteAnchor([], 10)).toBeNull();
	});
});
