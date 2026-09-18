import { describe, it, expect, vi, afterEach } from "vitest";
import { startBlink } from "./blink";

describe("startBlink", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("alternates clear/paint on the 700/350 cadence and ends cleared", () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const stop = startBlink(
			() => {
				calls.push("paint");
				return true;
			},
			() => calls.push("clear")
		);
		expect(calls).toEqual([]);
		advance(700);
		expect(calls).toEqual(["clear"]);
		advance(350);
		expect(calls).toEqual(["clear", "paint"]);
		advance(700);
		expect(calls).toEqual(["clear", "paint", "clear"]);
		advance(350);
		expect(calls).toEqual(["clear", "paint", "clear", "clear"]);
		// Expired: further time does nothing, stop stays harmless.
		advance(10_000);
		expect(calls).toEqual(["clear", "paint", "clear", "clear"]);
		stop();
		expect(calls).toEqual(["clear", "paint", "clear", "clear"]);
	});

	it("a false paint aborts cleared, never stranding", () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		let ok = true;
		startBlink(
			() => {
				calls.push("paint");
				return ok;
			},
			() => calls.push("clear")
		);
		advance(700);
		ok = false;
		advance(350);
		// Failed re-paint clears instead of abandoning, then stops.
		expect(calls).toEqual(["clear", "paint", "clear"]);
		advance(10_000);
		expect(calls).toEqual(["clear", "paint", "clear"]);
	});

	it("stop cancels a run in flight", () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const stop = startBlink(
			() => {
				calls.push("paint");
				return true;
			},
			() => calls.push("clear")
		);
		advance(700);
		stop();
		advance(10_000);
		expect(calls).toEqual(["clear"]);
	});

	it("restarting stops the previous run first", () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const first = startBlink(
			() => {
				calls.push("paint-1");
				return true;
			},
			() => calls.push("clear-1")
		);
		first();
		startBlink(
			() => {
				calls.push("paint-2");
				return true;
			},
			() => calls.push("clear-2")
		);
		advance(10_000);
		expect(calls).toEqual(["clear-2", "paint-2", "clear-2", "clear-2"]);
	});
});

/** Step fake timers past due callbacks. */
function advance(ms: number): void {
	vi.advanceTimersByTime(ms);
}
