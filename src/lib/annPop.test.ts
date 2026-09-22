import { describe, it, expect } from "vitest";
import {
	annPopBlurAction,
	annPopCancelKind,
	annPopSaveKind,
	annPopWidth,
	pillWashId,
	placeAnnCard,
	placeAnnComposer
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
	it("keeps the fresh pill at 19rem inside the viewport", () => {
		expect(
			annPopWidth({ fresh: true, android: false, fontScale: 1, viewportWidth: 1280 })
		).toBe(304);
		expect(
			annPopWidth({ fresh: true, android: false, fontScale: 1, viewportWidth: 300 })
		).toBe(284);
	});
	it("scales the card with font size up to 32rem", () => {
		expect(
			annPopWidth({ fresh: false, android: false, fontScale: 1, viewportWidth: 1280 })
		).toBe(384);
		expect(
			annPopWidth({ fresh: false, android: false, fontScale: 4, viewportWidth: 1280 })
		).toBe(512);
	});
	it("caps phone cards at 8x scale", () => {
		expect(
			annPopWidth({ fresh: false, android: true, fontScale: 10, viewportWidth: 1280 })
		).toBe(512);
	});
});

describe("placeAnnCard", () => {
	it("centers over the anchor inside the viewport", () => {
		expect(
			placeAnnCard({ anchorX: 640, anchorY: 400, width: 384, viewportWidth: 1280, viewportHeight: 800 })
		).toEqual({ x: 448, y: 408 });
	});
	it("clamps narrow viewports instead of running off-screen", () => {
		const { x } = placeAnnCard({
			anchorX: 40,
			anchorY: 400,
			width: 384,
			viewportWidth: 412,
			viewportHeight: 915
		});
		expect(x).toBe(8);
	});
	it("drops above the anchor past the bottom edge", () => {
		expect(
			placeAnnCard({ anchorX: 640, anchorY: 780, width: 384, viewportWidth: 1280, viewportHeight: 800 })
		).toEqual({ x: 448, y: 532 });
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
				menuY: 600,
				highlightLeft: 40,
				highlightWidth: 60
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
			menuY: 300,
			highlightLeft: 100,
			highlightWidth: 50
		};
		expect(placeAnnComposer(narrow)).toEqual({ x: 8, y: 302 });
		expect(
			placeAnnComposer({ ...narrow, highlightWidth: 500 })
		).toEqual({ x: 500, y: 302 });
	});
});
