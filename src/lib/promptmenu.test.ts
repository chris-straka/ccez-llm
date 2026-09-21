import { describe, expect, it, vi } from "vitest";

import {
	composerSelectionActive,
	reportPromptMenu,
	resetPromptMenuLatch
} from "./promptmenu";

const inside = { contains: () => true } as unknown as Node & {
	contains(n: Node | null): boolean;
};
const outside = { contains: () => false } as unknown as Node & {
	contains(n: Node | null): boolean;
};
const anchor = {} as Node;

describe("composerSelectionActive", () => {
	it("is active for a live range anchored in the prompt", () => {
		expect(composerSelectionActive(inside, anchor, false)).toBe(true);
	});

	it("denies collapsed selections, outside anchors, and missing parts", () => {
		expect(composerSelectionActive(inside, anchor, true)).toBe(false);
		expect(composerSelectionActive(outside, anchor, false)).toBe(false);
		expect(composerSelectionActive(null, anchor, false)).toBe(false);
		expect(composerSelectionActive(inside, null, false)).toBe(false);
	});

	it("denies when contains throws (detached DOM)", () => {
		const flaky = {
			contains: () => {
				throw new Error("detached");
			}
		} as unknown as Node & { contains(n: Node | null): boolean };
		expect(composerSelectionActive(flaky, anchor, false)).toBe(false);
	});
});

describe("reportPromptMenu", () => {
	it("invokes only on transitions", () => {
		resetPromptMenuLatch();
		const sink = vi.fn();
		reportPromptMenu(inside, anchor, false, sink);
		expect(sink).toHaveBeenCalledTimes(1);
		expect(sink).toHaveBeenLastCalledWith(true);
		// Same state again: silent (handle drags must not chatter).
		reportPromptMenu(inside, anchor, false, sink);
		expect(sink).toHaveBeenCalledTimes(1);
		// Collapse: one false.
		reportPromptMenu(inside, anchor, true, sink);
		expect(sink).toHaveBeenCalledTimes(2);
		expect(sink).toHaveBeenLastCalledWith(false);
	});

	it("stays silent while selections live outside the prompt", () => {
		resetPromptMenuLatch();
		const sink = vi.fn();
		reportPromptMenu(outside, anchor, false, sink);
		reportPromptMenu(outside, anchor, true, sink);
		expect(sink).not.toHaveBeenCalled();
	});
});
