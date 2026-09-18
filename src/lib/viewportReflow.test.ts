import { describe, expect, it } from "vitest";
import { isKeyboardOpen, keyboardOverlapPx, nextPinArm, pinArmStart } from "./viewportReflow";

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

describe("nextPinArm", () => {
	it("needs two consecutive open frames before arming", () => {
		let state = pinArmStart();
		state = nextPinArm(state, true);
		expect(state.armed).toBe(false);
		state = nextPinArm(state, true);
		expect(state.armed).toBe(true);
	});

	it("stays armed while open, releases on the first closed frame", () => {
		let state = nextPinArm(nextPinArm(pinArmStart(), true), true);
		state = nextPinArm(state, true);
		expect(state.armed).toBe(true);
		state = nextPinArm(state, false);
		expect(state).toEqual({ armed: false, sawOpen: false });
	});

	it("never arms on open-closed-open flicker", () => {
		let state = pinArmStart();
		for (const open of [true, false, true, false, true]) {
			state = nextPinArm(state, open);
			expect(state.armed).toBe(false);
		}
	});
});
