import { describe, expect, it } from "vitest";
import {
	ESCAPE_HOLD_MS,
	GG_WINDOW_MS,
	HOVER_EDGE_MARGIN_PX,
	SCROLLKEY_DU_VELOCITY_PX_S,
	SCROLLKEY_JK_VELOCITY_PX_S,
	SCROLLKEY_LINE_PX,
	SCROLL_HOLD_TAP_MS,
	ggArmed,
	halfPageDy,
	holdIsTap,
	indexAtViewportLine,
	isEscapeHold,
	keyFocusesEmptyPrompt,
	messageEdgeScrollTop,
	nearBottom,
	resolveSidebarSpaceEnter,
	scrollHoldVelocity,
	stepScrollTop,
	unselectedScrollIntent
} from "./scrollkeys";

describe("unselectedScrollIntent", () => {
	it("steps a few lines on j/k", () => {
		expect(unselectedScrollIntent("j", false)).toEqual({ kind: "line", dy: SCROLLKEY_LINE_PX });
		expect(unselectedScrollIntent("k", false)).toEqual({ kind: "line", dy: -SCROLLKEY_LINE_PX });
		expect(SCROLLKEY_LINE_PX).toBeGreaterThan(0);
	});

	it("fast-scrolls on d/u", () => {
		expect(unselectedScrollIntent("d", false)).toEqual({ kind: "half-page", dir: 1 });
		expect(unselectedScrollIntent("u", false)).toEqual({ kind: "half-page", dir: -1 });
	});

	it("arms gg on the first g, tops on the second", () => {
		expect(unselectedScrollIntent("g", false)).toEqual({ kind: "gg-prefix" });
		expect(unselectedScrollIntent("g", true)).toEqual({ kind: "top" });
	});

	it("bottoms on G, lands the hovered message on z/Z", () => {
		expect(unselectedScrollIntent("G", false)).toEqual({ kind: "bottom" });
		expect(unselectedScrollIntent("z", false)).toEqual({ kind: "hovered-edge", edge: "start" });
		expect(unselectedScrollIntent("Z", false)).toEqual({ kind: "hovered-edge", edge: "end" });
	});

	it("leaves every other key (and shifted fast-scroll spellings) alone", () => {
		for (const key of ["J", "K", "D", "U", "f", "e", "x", " ", "Enter", "Escape", "ArrowDown"]) {
			expect(unselectedScrollIntent(key, false), key).toBeNull();
		}
		// Existing bindings keep their keys: bare f/e/x stay unclaimed.
		expect(unselectedScrollIntent("f", false)).toBeNull();
	});
});

describe("ggArmed", () => {
	it("arms inside the beat, expires past it", () => {
		expect(ggArmed(1000, 1000 + GG_WINDOW_MS - 1)).toBe(true);
		expect(ggArmed(1000, 1000 + GG_WINDOW_MS)).toBe(false);
		expect(ggArmed(0, Date.now())).toBe(false);
	});
});

describe("halfPageDy", () => {
	it("covers half the visible chat per d/u", () => {
		expect(halfPageDy(800, 1)).toBe(400);
		expect(halfPageDy(800, -1)).toBe(-400);
		expect(halfPageDy(1, 1)).toBe(1);
	});
});

describe("messageEdgeScrollTop", () => {
	it("parks the hovered top a margin under the chat top", () => {
		expect(
			messageEdgeScrollTop({ scrollTop: 200, boxTop: 100, elTop: 300, elHeight: 60, viewH: 600, edge: "start" })
		).toBe(200 + 200 - HOVER_EDGE_MARGIN_PX);
	});

	it("parks the hovered bottom a margin above the chat bottom", () => {
		expect(
			messageEdgeScrollTop({ scrollTop: 200, boxTop: 100, elTop: 300, elHeight: 60, viewH: 600, edge: "end" })
		).toBe(200 + 200 + 60 - 600 + HOVER_EDGE_MARGIN_PX);
	});
});

describe("resolveSidebarSpaceEnter", () => {
	it("stays on the current chat with nothing selected", () => {
		expect(resolveSidebarSpaceEnter(-1, 3)).toEqual({ kind: "stay" });
		expect(resolveSidebarSpaceEnter(-1, 0)).toEqual({ kind: "stay" });
	});

	it("enters the clamped row otherwise", () => {
		expect(resolveSidebarSpaceEnter(0, 3)).toEqual({ kind: "enter", index: 0 });
		expect(resolveSidebarSpaceEnter(2, 3)).toEqual({ kind: "enter", index: 2 });
		expect(resolveSidebarSpaceEnter(9, 3)).toEqual({ kind: "enter", index: 2 });
	});
});

describe("keyFocusesEmptyPrompt", () => {
	const bare = {
		key: " ",
		shiftKey: false,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		messageCount: 0,
		inInteractive: false
	};
	it("lands bare Space, Enter, and i in the composer on an empty chat", () => {
		expect(keyFocusesEmptyPrompt(bare)).toBe(true);
		expect(keyFocusesEmptyPrompt({ ...bare, key: "Enter" })).toBe(true);
		expect(keyFocusesEmptyPrompt({ ...bare, key: "i" })).toBe(true);
	});

	it("stays native with history, modifiers, an interactive target, or other keys", () => {
		expect(keyFocusesEmptyPrompt({ ...bare, messageCount: 1 })).toBe(false);
		expect(keyFocusesEmptyPrompt({ ...bare, key: "Enter", messageCount: 1 })).toBe(false);
		expect(keyFocusesEmptyPrompt({ ...bare, key: "i", messageCount: 2 })).toBe(false);
		expect(keyFocusesEmptyPrompt({ ...bare, shiftKey: true })).toBe(false);
		expect(keyFocusesEmptyPrompt({ ...bare, key: "Enter", shiftKey: true })).toBe(false);
		expect(keyFocusesEmptyPrompt({ ...bare, ctrlKey: true })).toBe(false);
		expect(keyFocusesEmptyPrompt({ ...bare, inInteractive: true })).toBe(false);
		expect(keyFocusesEmptyPrompt({ ...bare, key: "Enter", inInteractive: true })).toBe(false);
		expect(keyFocusesEmptyPrompt({ ...bare, key: "j" })).toBe(false);
		expect(keyFocusesEmptyPrompt({ ...bare, key: "I" })).toBe(false);
	});
});

describe("isEscapeHold", () => {
	it("pins the two-second Chrome-parity threshold", () => {
		expect(ESCAPE_HOLD_MS).toBe(2000);
	});

	it("holds past the timer threshold, taps below it", () => {
		expect(isEscapeHold(1000, 1000 + ESCAPE_HOLD_MS)).toBe(true);
		expect(isEscapeHold(1000, 1000 + ESCAPE_HOLD_MS + 2000)).toBe(true);
		expect(isEscapeHold(1000, 1000 + ESCAPE_HOLD_MS - 1)).toBe(false);
		expect(isEscapeHold(1000, 1000)).toBe(false);
	});

	it("never fires without a tracked keydown", () => {
		expect(isEscapeHold(0, 60_000)).toBe(false);
	});
});

describe("scrollHoldVelocity", () => {
	it("glides j/k at line speed and d/u much faster", () => {
		expect(scrollHoldVelocity("j")).toBe(SCROLLKEY_JK_VELOCITY_PX_S);
		expect(scrollHoldVelocity("k")).toBe(-SCROLLKEY_JK_VELOCITY_PX_S);
		expect(scrollHoldVelocity("d")).toBe(SCROLLKEY_DU_VELOCITY_PX_S);
		expect(scrollHoldVelocity("u")).toBe(-SCROLLKEY_DU_VELOCITY_PX_S);
		expect(SCROLLKEY_DU_VELOCITY_PX_S).toBeGreaterThan(SCROLLKEY_JK_VELOCITY_PX_S);
	});

	it("leaves discrete keys alone", () => {
		for (const key of ["g", "G", "z", "Z", " ", "Enter", "ArrowDown"]) {
			expect(scrollHoldVelocity(key), key).toBeNull();
		}
	});
});

describe("stepScrollTop", () => {
	it("advances proportionally to frame time", () => {
		expect(stepScrollTop(100, 720, 16)).toBeCloseTo(111.52, 2);
		expect(stepScrollTop(100, -720, 16)).toBeCloseTo(88.48, 2);
		expect(stepScrollTop(100, 720, 0)).toBe(100);
		expect(stepScrollTop(100, 720, -5)).toBe(100);
	});
});

describe("holdIsTap", () => {
	it("calls quick holds taps and longer holds glides", () => {
		expect(holdIsTap(1000, 1050)).toBe(true);
		expect(holdIsTap(1000, 1000 + SCROLL_HOLD_TAP_MS)).toBe(false);
		expect(holdIsTap(1000, 1500)).toBe(false);
		expect(holdIsTap(0, 50)).toBe(false);
	});
});

describe("nearBottom", () => {
	it("pins within the slop and releases past it", () => {
		expect(nearBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 })).toBe(true);
		expect(nearBottom({ scrollHeight: 1000, scrollTop: 836, clientHeight: 100 })).toBe(true);
		expect(nearBottom({ scrollHeight: 1000, scrollTop: 835, clientHeight: 100 })).toBe(false);
		expect(nearBottom({ scrollHeight: 1000, scrollTop: 0, clientHeight: 100 }, 1000)).toBe(true);
	});
});

describe("indexAtViewportLine", () => {
	it("picks the message covering the line", () => {
		const rects = [
			{ top: 0, bottom: 100 },
			{ top: 100, bottom: 220 },
			{ top: 220, bottom: 300 }
		];
		expect(indexAtViewportLine(rects, 150)).toBe(1);
		expect(indexAtViewportLine(rects, 0)).toBe(0);
		expect(indexAtViewportLine(rects, 299)).toBe(2);
	});

	it("falls back to the nearest center in a gap", () => {
		const rects = [
			{ top: 0, bottom: 100 },
			{ top: 200, bottom: 300 }
		];
		// Gap 100–200, midpoint 150: equidistant centers tie to the first.
		expect(indexAtViewportLine(rects, 150)).toBe(0);
		expect(indexAtViewportLine(rects, 180)).toBe(1);
	});

	it("returns -1 when empty", () => {
		expect(indexAtViewportLine([], 150)).toBe(-1);
	});
});
