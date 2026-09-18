import { describe, expect, it } from "vitest";
import {
	isKeyboardOpen,
	keyboardOverlapPx,
	nativeResizeActive,
	pinArmStart,
	pinNow,
	settlePin
} from "./viewportReflow";

describe("keyboardOverlapPx", () => {
	it("is zero when the viewport fills the window", () => {
		expect(keyboardOverlapPx(800, 800)).toBe(0);
	});

	it("measures the covered pixels minus the viewport offset", () => {
		expect(keyboardOverlapPx(800, 500)).toBe(300);
		expect(keyboardOverlapPx(800, 500, 20)).toBe(280);
	});

	it("never goes negative", () => {
		expect(keyboardOverlapPx(800, 900)).toBe(0);
	});
});

describe("isKeyboardOpen", () => {
	it("opens past the 100px floor, stays shut below it", () => {
		expect(isKeyboardOpen(800, 500)).toBe(true);
		expect(isKeyboardOpen(800, 750)).toBe(false);
		expect(isKeyboardOpen(800, 700)).toBe(true);
	});
});

describe("pinNow", () => {
	it("arms in one step for settled geometry", () => {
		expect(pinNow()).toEqual({ armed: true, sawOpen: true });
	});
});

describe("nativeResizeActive", () => {
	it("is true once the layout shrank past the floor", () => {
		expect(nativeResizeActive(800, 800)).toBe(false);
		expect(nativeResizeActive(800, 750)).toBe(false);
		expect(nativeResizeActive(800, 700)).toBe(true);
		expect(nativeResizeActive(800, 500)).toBe(true);
	});

	it("never fires when the layout grew", () => {
		expect(nativeResizeActive(800, 900)).toBe(false);
	});
});

describe("settlePin", () => {
	it("releases a stale armed pin once geometry reads closed", () => {
		const settled = settlePin(pinNow(), 800, 800, false);
		expect(settled.pin).toEqual({ armed: false, sawOpen: false });
		expect(settled.fullHeight).toBe(800);
	});

	it("refreshes a stale baseline on closed geometry (rotation)", () => {
		const settled = settlePin(pinArmStart(), 800, 900, false);
		expect(settled.fullHeight).toBe(900);
		expect(settled.pin.armed).toBe(false);
	});

	it("stays disarmed while the native resize glides", () => {
		const settled = settlePin(pinNow(), 800, 500, true);
		expect(settled.pin).toEqual({ armed: false, sawOpen: false });
		expect(settled.fullHeight).toBe(800);
	});

	it("arms the no-shrink fallback pin on stable open geometry", () => {
		const settled = settlePin(pinArmStart(), 800, 800, true);
		expect(settled.pin).toEqual({ armed: true, sawOpen: true });
		expect(settled.fullHeight).toBe(800);
	});
});


