import { describe, it, expect, vi, afterEach } from "vitest";
import { startBlink, startHighlightFade, startMarkFade } from "./blink";

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

describe("startHighlightFade", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	function harness(): {
		calls: string[];
		fade: Parameters<typeof startHighlightFade>[0];
	} {
		const calls: string[] = [];
		return {
			calls,
			fade: {
				locate: () => ({}) as Range,
				paint: (_range: Range, name: string) => calls.push(`paint:${name}`),
				clear: (name: string) => calls.push(`clear:${name}`),
				full: "flash",
				grades: ["d1", "d2"],
				holdMs: 700,
				stepMs: 50,
				onDone: () => calls.push("done")
			}
		};
	}

	it("holds full, steps grades paint-before-clear, ends cleared", () => {
		vi.useFakeTimers();
		const { calls, fade } = harness();
		startHighlightFade(fade);
		expect(calls).toEqual([]);
		advance(700);
		expect(calls).toEqual(["paint:d1", "clear:flash"]);
		advance(50);
		expect(calls).toEqual(["paint:d1", "clear:flash", "paint:d2", "clear:d1"]);
		advance(50);
		expect(calls).toEqual([
			"paint:d1",
			"clear:flash",
			"paint:d2",
			"clear:d1",
			"clear:flash",
			"clear:d1",
			"clear:d2",
			"done"
		]);
		// Expired: further time does nothing.
		advance(10_000);
		expect(calls).toHaveLength(8);
	});

	it("a lost quote mid-fade clears everything, never stranding a grade", () => {
		vi.useFakeTimers();
		const { calls, fade } = harness();
		let alive = true;
		fade.locate = () => (alive ? ({} as Range) : null);
		startHighlightFade(fade);
		advance(700);
		expect(calls).toEqual(["paint:d1", "clear:flash"]);
		alive = false;
		advance(50);
		expect(calls).toEqual([
			"paint:d1",
			"clear:flash",
			"clear:flash",
			"clear:d1",
			"clear:d2",
			"done"
		]);
		advance(10_000);
		expect(calls).toHaveLength(6);
	});

	it("stop cancels a run in flight", () => {
		vi.useFakeTimers();
		const { calls, fade } = harness();
		const stop = startHighlightFade(fade);
		advance(700);
		stop();
		advance(10_000);
		expect(calls).toEqual(["paint:d1", "clear:flash"]);
	});

	it("reports every grade paint through onStep", () => {
		vi.useFakeTimers();
		const { calls, fade } = harness();
		fade.onStep = () => calls.push("step");
		startHighlightFade(fade);
		advance(700);
		advance(50);
		advance(50);
		expect(calls).toContain("step");
		expect(calls.filter((c) => c === "step")).toHaveLength(2);
	});
});

describe("startMarkFade", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	function mark(connected = true): HTMLElement {
		const classes: string[] = [];
		return {
			isConnected: connected,
			classList: { add: (c: string) => classes.push(c) },
			classes
		} as unknown as HTMLElement & { classes: string[] };
	}

	it("holds full, fades the marks, then reports done", () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const m = mark();
		startMarkFade({
			marks: [m],
			holdMs: 700,
			fadeMs: 250,
			onDone: () => calls.push("done")
		});
		expect(calls).toEqual([]);
		advance(700);
		expect((m as unknown as { classes: string[] }).classes).toEqual(["fading"]);
		expect(calls).toEqual([]);
		advance(250);
		expect(calls).toEqual(["done"]);
		advance(10_000);
		expect(calls).toEqual(["done"]);
	});

	it("skips the fade class when fadeMs is zero", () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const m = mark();
		startMarkFade({
			marks: [m],
			holdMs: 700,
			fadeMs: 0,
			onDone: () => calls.push("done")
		});
		advance(700);
		expect((m as unknown as { classes: string[] }).classes).toEqual([]);
		expect(calls).toEqual(["done"]);
	});

	it("stop cancels before the hold elapses", () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const m = mark();
		const stop = startMarkFade({
			marks: [m],
			holdMs: 700,
			fadeMs: 250,
			onDone: () => calls.push("done")
		});
		advance(100);
		stop();
		advance(10_000);
		expect((m as unknown as { classes: string[] }).classes).toEqual([]);
		expect(calls).toEqual([]);
	});
});
