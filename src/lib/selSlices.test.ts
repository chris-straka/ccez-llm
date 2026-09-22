import { describe, it, expect } from "vitest";
import {
	slicePoint,
	spanSliceOverlap,
	selMenuWidthEstimate,
	type SelSlice
} from "./selSlices";

function slices(): SelSlice[] {
	const a = {} as Text;
	const b = {} as Text;
	return [
		{ node: a, start: 2, end: 8, base: 0 },
		{ node: b, start: 0, end: 4, base: 6 }
	];
}

describe("slicePoint", () => {
	it("resolves offsets inside slices with the slice start added", () => {
		const [first] = slices();
		expect(slicePoint(slices(), 0)).toEqual({ node: first!.node, offset: 2 });
		expect(slicePoint(slices(), 6)).toEqual({ node: first!.node, offset: 8 });
		const [, second] = slices();
		expect(slicePoint(slices(), 7)).toEqual({ node: second!.node, offset: 1 });
	});

	it("resolves the exact end of the last slice, null past it", () => {
		const [, second] = slices();
		expect(slicePoint(slices(), 10)).toEqual({
			node: second!.node,
			offset: 4
		});
		expect(slicePoint(slices(), 11)).toBeNull();
		expect(slicePoint([], 0)).toBeNull();
	});
});

describe("spanSliceOverlap", () => {
	it("clamps spans to the slice in relative offsets", () => {
		const slice = { base: 10, start: 2, end: 8 };
		expect(spanSliceOverlap({ start: 0, end: 100 }, slice)).toEqual({
			relLo: 2,
			relHi: 8
		});
		expect(spanSliceOverlap({ start: 11, end: 13 }, slice)).toEqual({
			relLo: 3,
			relHi: 5
		});
	});

	it("returns null for misses and edge touches", () => {
		const slice = { base: 10, start: 2, end: 8 };
		expect(spanSliceOverlap({ start: 0, end: 10 }, slice)).toBeNull();
		expect(spanSliceOverlap({ start: 16, end: 20 }, slice)).toBeNull();
	});
});

describe("selMenuWidthEstimate", () => {
	it("pins phones at three buttons, desktop at one or two", () => {
		expect(selMenuWidthEstimate("字", true, true)).toBe(300);
		expect(selMenuWidthEstimate("字", false, true)).toBe(220);
		expect(selMenuWidthEstimate("plain words here", false, true)).toBe(120);
		expect(selMenuWidthEstimate("字", false, false)).toBe(120);
	});
});
