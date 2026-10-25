import { describe, expect, it } from "vitest";
import {
	alwaysReparkDue,
	PROMPT_PRESS_GRACE_MS,
	clampPromptIdleSec,
	columnBounds,
	formatIdleTimeout,
	isPromptIdle,
	pointInRect,
	sendHoldAction,
	gutterSide,
	rowWorkRunning,
	messageActionsTapAllowed,
	promptParkedFor,
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

describe("alwaysReparkDue", () => {
	const due = (o: Partial<Parameters<typeof alwaysReparkDue>[0]>) =>
		alwaysReparkDue({
			alwaysMode: true,
			idle: false,
			sincePressMs: PROMPT_PRESS_GRACE_MS,
			...o
		});
	it("re-parks a visible composer once the press grace runs out", () => {
		expect(due({})).toBe(true);
	});
	it("waits out a press still in flight", () => {
		expect(due({ sincePressMs: PROMPT_PRESS_GRACE_MS - 1 })).toBe(false);
	});
	it("leaves a hidden composer and timed modes alone", () => {
		expect(due({ idle: true })).toBe(false);
		expect(due({ alwaysMode: false })).toBe(false);
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

describe("formatIdleTimeout", () => {
	it("reads always, seconds, and never", () => {
		expect(PROMPT_IDLE_MAX).toBe(10);
		expect(formatIdleTimeout(PROMPT_IDLE_NEVER)).toBe("never");
		expect(formatIdleTimeout(6)).toBe("6 s");
		expect(formatIdleTimeout(PROMPT_IDLE_ALWAYS)).toBe("always");
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

	it("stops a live reply, else swaps the reply language", () => {
		const idle = {
			timerRunning: false,
			promptNoteEditing: false,
			replyLive: false
		};
		expect(sendHoldAction(idle)).toBe("swap-lang");
		expect(sendHoldAction({ ...idle, timerRunning: true })).toBeNull();
		expect(sendHoldAction({ ...idle, promptNoteEditing: true })).toBeNull();
		// A reply in flight: the hold stops it.
		expect(sendHoldAction({ ...idle, replyLive: true })).toBe("stop-reply");
		expect(
			sendHoldAction({ ...idle, replyLive: true, timerRunning: true })
		).toBeNull();
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

	it("columnBounds spans the boxes, null when empty", () => {
		expect(
			columnBounds([
				{ x: 10, width: 100 },
				{ x: 20, width: 120 }
			])
		).toEqual({ left: 10, right: 140 });
		expect(columnBounds([])).toBeNull();
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
		expect(messageActionsTapAllowed(true, true, false, true)).toBe(true);
		// The Messages checkbox removes the row on both platforms.
		expect(messageActionsTapAllowed(false, false, true, false)).toBe(false);
		expect(messageActionsTapAllowed(true, false, false, true)).toBe(false);
		expect(messageActionsTapAllowed(false, true, false, false)).toBe(false);
		expect(messageActionsTapAllowed(true, false, false, false)).toBe(false);
	});
});

describe("promptParkedFor", () => {
	it("parks for drawers on desktop, idle only on phones", () => {
		expect(promptParkedFor(false, false, true, true)).toBe(true);
		expect(promptParkedFor(false, false, false, false)).toBe(true);
		expect(promptParkedFor(false, false, false, true)).toBe(false);
		expect(promptParkedFor(true, false, true, false)).toBe(false);
		expect(promptParkedFor(true, true, false, true)).toBe(true);
	});
});
