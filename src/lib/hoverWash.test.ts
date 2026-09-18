import { describe, it, expect, vi, afterEach } from "vitest";
import { badgeHover, resetHoverWashForTest } from "./hoverWash";

describe("badgeHover", () => {
	afterEach(() => {
		vi.useRealTimers();
		resetHoverWashForTest();
	});

	it("reports badge ids at once, deduping repeats", () => {
		vi.useFakeTimers();
		const calls: (string | null)[] = [];
		badgeHover((id) => calls.push(id), "a");
		badgeHover((id) => calls.push(id), "a");
		expect(calls).toEqual(["a"]);
	});

	it("a null waits out the tremor, then reports", () => {
		vi.useFakeTimers();
		const calls: (string | null)[] = [];
		badgeHover((id) => calls.push(id), "a");
		badgeHover((id) => calls.push(id), null);
		expect(calls).toEqual(["a"]);
		advance(200);
		expect(calls).toEqual(["a", null]);
	});

	it("a re-enter across bodies cancels the pending clear", () => {
		vi.useFakeTimers();
		const calls: (string | null)[] = [];
		// First body hovered, then left across a gap (null arms).
		badgeHover((id) => calls.push(id), "a");
		badgeHover((id) => calls.push(id), null);
		// Second body hovered before the window ends: the clear dies.
		advance(60);
		badgeHover((id) => calls.push(id), "b");
		advance(500);
		expect(calls).toEqual(["a", "b"]);
	});

	it("mouseout onto another badge reports nothing", () => {
		vi.useFakeTimers();
		const calls: (string | null)[] = [];
		badgeHover((id) => calls.push(id), "a");
		badgeHover((id) => calls.push(id), null, { toBadge: true });
		advance(500);
		expect(calls).toEqual(["a"]);
	});

	it("null with nothing showing reports nothing", () => {
		vi.useFakeTimers();
		const calls: (string | null)[] = [];
		badgeHover((id) => calls.push(id), null);
		advance(500);
		expect(calls).toEqual([]);
	});
});

/** Step fake timers past due callbacks. */
function advance(ms: number): void {
	vi.advanceTimersByTime(ms);
}
