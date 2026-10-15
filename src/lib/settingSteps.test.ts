import { describe, expect, it } from "vitest";
import {
	ANN_POP_LADDER,
	IDLE_LADDER,
	LINE_HEIGHT_LADDER,
	MESSAGE_GAP_LADDER,
	TEXT_SIZE_LADDER,
	UI_SIZE_LADDER,
	VOICE_SPEED_LADDER,
	canStep,
	idleRank,
	linearLadder,
	pressGrabsThumb,
	sliderFraction,
	sliderValueAt,
	stepLadder,
	trimNumber
} from "./settingSteps";
import {
	LINE_HEIGHT_DEFAULT,
	MESSAGE_GAP_DEFAULT,
	PROMPT_IDLE_ALWAYS,
	PROMPT_IDLE_NEVER,
	VOICE_SPEED_DEFAULT
} from "./settings";

describe("ladders", () => {
	it("are strictly ascending and include each default", () => {
		for (const [ladder, def] of [
			[TEXT_SIZE_LADDER, 100],
			[UI_SIZE_LADDER, 100],
			[ANN_POP_LADDER, 100],
			[VOICE_SPEED_LADDER, VOICE_SPEED_DEFAULT],
			[LINE_HEIGHT_LADDER, LINE_HEIGHT_DEFAULT],
			[MESSAGE_GAP_LADDER, MESSAGE_GAP_DEFAULT]
		] as const) {
			for (let i = 1; i < ladder.length; i++)
				expect(ladder[i]!).toBeGreaterThan(ladder[i - 1]!);
			expect(ladder).toContain(def);
		}
	});
	it("keep the full text-size range (80% to 2000%)", () => {
		expect(TEXT_SIZE_LADDER[0]).toBe(80);
		expect(TEXT_SIZE_LADDER.at(-1)).toBe(2000);
	});
	it("builds float-safe linear rungs", () => {
		expect(linearLadder(1, 1.3, 0.1)).toEqual([1, 1.1, 1.2, 1.3]);
		expect(VOICE_SPEED_LADDER).toContain(0.85);
	});
});

describe("stepLadder", () => {
	it("moves one rung either way and stops at the ends", () => {
		expect(stepLadder(TEXT_SIZE_LADDER, 100, 1)).toBe(110);
		expect(stepLadder(TEXT_SIZE_LADDER, 100, -1)).toBe(90);
		expect(stepLadder(TEXT_SIZE_LADDER, 2000, 1)).toBe(2000);
		expect(stepLadder(TEXT_SIZE_LADDER, 80, -1)).toBe(80);
		expect(canStep(TEXT_SIZE_LADDER, 2000, 1)).toBe(false);
		expect(canStep(TEXT_SIZE_LADDER, 2000, -1)).toBe(true);
	});
	it("snaps an off-ladder value to its neighbor in the pressed direction", () => {
		expect(stepLadder(TEXT_SIZE_LADDER, 240, 1)).toBe(250);
		expect(stepLadder(TEXT_SIZE_LADDER, 240, -1)).toBe(225);
		expect(stepLadder(LINE_HEIGHT_LADDER, 1.55, 1)).toBe(1.6);
		expect(stepLadder(LINE_HEIGHT_LADDER, 1.55, -1)).toBe(1.5);
	});
	it("tolerates float noise on a rung", () => {
		expect(stepLadder(VOICE_SPEED_LADDER, 1.0000000001, 1)).toBe(1.05);
		expect(stepLadder(VOICE_SPEED_LADDER, 0.9999999999, -1)).toBe(0.95);
	});
	it("walks idle from always through seconds to never", () => {
		expect(IDLE_LADDER[0]).toBe(PROMPT_IDLE_ALWAYS);
		expect(IDLE_LADDER.at(-1)).toBe(PROMPT_IDLE_NEVER);
		expect(stepLadder(IDLE_LADDER, PROMPT_IDLE_ALWAYS, 1, idleRank)).toBe(2);
		expect(stepLadder(IDLE_LADDER, 10, 1, idleRank)).toBe(PROMPT_IDLE_NEVER);
		expect(stepLadder(IDLE_LADDER, PROMPT_IDLE_NEVER, -1, idleRank)).toBe(10);
		expect(stepLadder(IDLE_LADDER, 2, -1, idleRank)).toBe(PROMPT_IDLE_ALWAYS);
		expect(canStep(IDLE_LADDER, PROMPT_IDLE_NEVER, 1, idleRank)).toBe(false);
	});
});

describe("slider math", () => {
	it("maps a pointer x to a snapped, clamped value", () => {
		expect(sliderValueAt(50, 0, 100, 0, 1, 0.05)).toBe(0.5);
		expect(sliderValueAt(-20, 0, 100, 0, 1, 0.05)).toBe(0);
		expect(sliderValueAt(130, 0, 100, 0, 1, 0.05)).toBe(1);
		expect(sliderValueAt(51, 0, 100, 28, 120, 1)).toBe(75);
		expect(sliderValueAt(10, 0, 0, 28, 120, 1)).toBe(28);
	});
	it("places the thumb by fraction", () => {
		expect(sliderFraction(1, 0, 2)).toBe(0.5);
		expect(sliderFraction(5, 0, 2)).toBe(1);
	});
	it("only grabs presses near the thumb", () => {
		expect(pressGrabsThumb(110, 100)).toBe(true);
		expect(pressGrabsThumb(160, 100)).toBe(false);
	});
	it("trims trailing zeros", () => {
		expect(trimNumber(1.5)).toBe("1.5");
		expect(trimNumber(1)).toBe("1");
		expect(trimNumber(0.35)).toBe("0.35");
	});
});
