import { describe, expect, it, vi } from "vitest";

import {
	osMenuSelectionActive,
	reportOsMenu,
	resetOsMenuLatch
} from "./promptmenu";

const inside = { contains: () => true } as unknown as Node & {
	contains(n: Node | null): boolean;
};
const outside = { contains: () => false } as unknown as Node & {
	contains(n: Node | null): boolean;
};
const anchor = {} as Node;

describe("osMenuSelectionActive", () => {
	it("is active for a live range anchored in any allowed root", () => {
		expect(osMenuSelectionActive([inside], anchor, false)).toBe(true);
		expect(osMenuSelectionActive([outside, inside], anchor, false)).toBe(true);
		expect(osMenuSelectionActive([inside, null], anchor, false)).toBe(true);
	});

	it("denies collapsed selections, outside anchors, and missing parts", () => {
		expect(osMenuSelectionActive([inside], anchor, true)).toBe(false);
		expect(osMenuSelectionActive([outside], anchor, false)).toBe(false);
		expect(osMenuSelectionActive([], anchor, false)).toBe(false);
		expect(osMenuSelectionActive([null], anchor, false)).toBe(false);
		expect(osMenuSelectionActive([inside], null, false)).toBe(false);
	});

	it("denies when contains throws (detached DOM)", () => {
		const flaky = {
			contains: () => {
				throw new Error("detached");
			}
		} as unknown as Node & { contains(n: Node | null): boolean };
		expect(osMenuSelectionActive([flaky], anchor, false)).toBe(false);
	});
});

describe("reportOsMenu", () => {
	it("invokes only on transitions", () => {
		resetOsMenuLatch();
		const sink = vi.fn();
		reportOsMenu([inside], anchor, false, sink);
		expect(sink).toHaveBeenCalledTimes(1);
		expect(sink).toHaveBeenLastCalledWith(true);
		// Same state again: silent (handle drags must not chatter).
		reportOsMenu([inside], anchor, false, sink);
		expect(sink).toHaveBeenCalledTimes(1);
		// Collapse: one false.
		reportOsMenu([inside], anchor, true, sink);
		expect(sink).toHaveBeenCalledTimes(2);
		expect(sink).toHaveBeenLastCalledWith(false);
	});

	it("stays silent while selections live outside every root", () => {
		resetOsMenuLatch();
		const sink = vi.fn();
		reportOsMenu([outside], anchor, false, sink);
		reportOsMenu([outside], anchor, true, sink);
		expect(sink).not.toHaveBeenCalled();
	});
});
