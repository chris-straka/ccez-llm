import { describe, expect, it } from "vitest";
import { badgeSteps } from "./badge-stack";

const box = (left: number, top = 0, width = 20) => ({
	left,
	right: left + width,
	top,
	bottom: top + 20
});

describe("badgeSteps", () => {
	it("leaves badges that don't touch alone", () => {
		expect(badgeSteps([box(0), box(40), box(0, 50)])).toEqual([0, 0, 0]);
	});
	it("steps a badge that lands on an earlier one aside", () => {
		// A word ending one letter before its sentence's last.
		expect(badgeSteps([box(100), box(108)])).toEqual([0, 1]);
	});
	it("keeps stepping past every badge already there", () => {
		expect(badgeSteps([box(100), box(104), box(106)])).toEqual([0, 1, 2]);
	});
	it("reads boxes whose fields are getters (DOMRect)", () => {
		class Rect {
			constructor(private l: number) {}
			get left() {
				return this.l;
			}
			get right() {
				return this.l + 20;
			}
			get top() {
				return 0;
			}
			get bottom() {
				return 20;
			}
		}
		expect(badgeSteps([new Rect(100), new Rect(100)])).toEqual([0, 1]);
	});
	it("steps the other way in right-to-left text", () => {
		expect(badgeSteps([box(100), box(96)], true)).toEqual([0, 1]);
	});
});
