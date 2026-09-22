import { describe, expect, it } from "vitest";
import {
	clampPromptIdleSec,
	draggedSliderPastTop,
	formatIdleTimeout,
	IDLE_SLIDER_BOTTOM,
	IDLE_SLIDER_TOP,
	idleSettingToSlider,
	idleSliderToSetting,
	isPromptIdle,
	pointInRect,
	sendHoldArmed,
	gutterSide,
	rowWorkRunning,
	messageActionsTapAllowed,
	SLIDER_DRAG_RESET_PX,
	stageOwnedByOverlay,
	type StageOwnerFlags
} from "./chrome";
import {
	PROMPT_IDLE_ALWAYS,
	PROMPT_IDLE_DEFAULT,
	PROMPT_IDLE_MAX,
	PROMPT_IDLE_MIN,
	PROMPT_IDLE_NEVER
} from "./settings";

describe("isPromptIdle", () => {
	it("hides once the timeout has fully elapsed", () => {
		expect(isPromptIdle(0, 5999, 6)).toBe(false);
		expect(isPromptIdle(0, 6000, 6)).toBe(true);
		expect(isPromptIdle(0, 60_001, 6)).toBe(true);
	});

	it("never hides on a non-positive timeout", () => {
		expect(isPromptIdle(0, 3_600_000, 0)).toBe(false);
		expect(isPromptIdle(0, 3_600_000, -5)).toBe(false);
	});

	it("restores the instant fresh input lands", () => {
		const now = 100_000;
		expect(isPromptIdle(now, now, 6)).toBe(false);
	});
});

describe("clampPromptIdleSec", () => {
	it("rounds to whole seconds inside the range", () => {
		expect(clampPromptIdleSec(6.4)).toBe(6);
		expect(clampPromptIdleSec(PROMPT_IDLE_DEFAULT)).toBe(PROMPT_IDLE_DEFAULT);
	});

	it("clamps strays to the range edges", () => {
		expect(clampPromptIdleSec(PROMPT_IDLE_MIN - 10)).toBe(PROMPT_IDLE_MIN);
		expect(clampPromptIdleSec(PROMPT_IDLE_MAX + 10)).toBe(PROMPT_IDLE_MAX);
		expect(clampPromptIdleSec(Number.NaN)).toBe(PROMPT_IDLE_MIN);
	});

	it("passes the never-hide sentinel through", () => {
		expect(clampPromptIdleSec(PROMPT_IDLE_NEVER)).toBe(PROMPT_IDLE_NEVER);
	});
});

describe("idle slider mapping", () => {
	it("tops at 10s with the top tick meaning never", () => {
		expect(PROMPT_IDLE_MAX).toBe(10);
		expect(IDLE_SLIDER_TOP).toBe(PROMPT_IDLE_MAX + 1);
		expect(idleSliderToSetting(IDLE_SLIDER_TOP)).toBe(PROMPT_IDLE_NEVER);
		expect(idleSliderToSetting(6)).toBe(6);
	});

	it("parks never-hide on the top tick, seconds below it", () => {
		expect(idleSettingToSlider(PROMPT_IDLE_NEVER)).toBe(IDLE_SLIDER_TOP);
		expect(idleSettingToSlider(0)).toBe(IDLE_SLIDER_TOP);
		expect(idleSettingToSlider(6)).toBe(6);
	});

	it("reads the top tick as never, the rest as seconds", () => {
		expect(formatIdleTimeout(PROMPT_IDLE_NEVER)).toBe("never");
		expect(formatIdleTimeout(6)).toBe("6 s");
	});

	it("parks always-hide on the bottom tick", () => {
		expect(IDLE_SLIDER_BOTTOM).toBe(1);
		expect(idleSliderToSetting(IDLE_SLIDER_BOTTOM)).toBe(PROMPT_IDLE_ALWAYS);
		expect(idleSettingToSlider(PROMPT_IDLE_ALWAYS)).toBe(IDLE_SLIDER_BOTTOM);
		expect(formatIdleTimeout(PROMPT_IDLE_ALWAYS)).toBe("always");
	});
});

describe("draggedSliderPastTop", () => {
	it("needs a full upward travel past the threshold", () => {
		expect(draggedSliderPastTop(200, 200 - SLIDER_DRAG_RESET_PX)).toBe(true);
		expect(draggedSliderPastTop(200, 200 - SLIDER_DRAG_RESET_PX + 1)).toBe(
			false
		);
	});

	it("ignores downward and sideways travel", () => {
		expect(draggedSliderPastTop(200, 400)).toBe(false);
		expect(draggedSliderPastTop(200, 200)).toBe(false);
	});
});

const STAGE_CLEAR: StageOwnerFlags = {
	shortcutsOpen: false,
	searchOpen: false,
	inspectOpen: false,
	findOpen: false,
	settingsOpen: false,
	sidebarOpen: false
};

describe("stageOwnedByOverlay", () => {
	it("leaves bare keys with the main chat when nothing is up", () => {
		expect(stageOwnedByOverlay(STAGE_CLEAR)).toBe(false);
	});

	it("hands the stage to any single owner", () => {
		for (const key of Object.keys(STAGE_CLEAR) as (keyof StageOwnerFlags)[]) {
			expect(stageOwnedByOverlay({ ...STAGE_CLEAR, [key]: true })).toBe(true);
		}
	});
});

describe("send-button hold geometry", () => {
	it("hits inside the button rect, edges included", () => {
		const rect = { left: 10, right: 20, top: 30, bottom: 40 };
		expect(pointInRect(15, 35, rect)).toBe(true);
		expect(pointInRect(10, 30, rect)).toBe(true);
		expect(pointInRect(9, 35, rect)).toBe(false);
		expect(pointInRect(15, 35, null)).toBe(false);
		expect(pointInRect(15, 35, undefined)).toBe(false);
	});

	it("arms only on a truly empty composer with no owner", () => {
		expect(sendHoldArmed(false, false, true)).toBe(true);
		expect(sendHoldArmed(true, false, true)).toBe(false);
		expect(sendHoldArmed(false, true, true)).toBe(false);
		expect(sendHoldArmed(false, false, false)).toBe(false);
	});
});

describe("gutterSide", () => {
	it("picks the gutter outside the column, column on edges", () => {
		expect(gutterSide(5, 10, 100)).toBe("left");
		expect(gutterSide(150, 10, 100)).toBe("right");
		expect(gutterSide(50, 10, 100)).toBe("column");
		expect(gutterSide(10, 10, 100)).toBe("column");
		expect(gutterSide(100, 10, 100)).toBe("column");
	});
});

describe("action-row ownership", () => {
	it("holds the row while aids load or audio runs", () => {
		expect(rowWorkRunning("m", new Set(["m"]), new Set(), null, null)).toBe(
			true
		);
		expect(rowWorkRunning("m", new Set(), new Set(["m"]), null, null)).toBe(
			true
		);
		expect(rowWorkRunning("m", new Set(), new Set(), "m", null)).toBe(true);
		expect(rowWorkRunning("m", new Set(), new Set(), null, "m")).toBe(true);
		expect(rowWorkRunning("m", new Set(), new Set(), null, null)).toBe(false);
		expect(rowWorkRunning("m", new Set(["x"]), new Set(), "y", null)).toBe(
			false
		);
	});

	it("gates row toggles on platform and settings", () => {
		expect(messageActionsTapAllowed(false, true, true, false)).toBe(true);
		expect(messageActionsTapAllowed(true, false, false, true)).toBe(true);
		expect(messageActionsTapAllowed(false, false, true, false)).toBe(false);
		expect(messageActionsTapAllowed(false, true, false, false)).toBe(false);
		expect(messageActionsTapAllowed(true, false, false, false)).toBe(false);
	});
});
