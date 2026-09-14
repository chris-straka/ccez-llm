import { describe, it, expect } from "vitest";
import {
	dropFilesFromDataTransfer,
	isPermissionDismissal
} from "./intake";

function textFile(name: string, content = "x"): File {
	return new File([content], name, { type: "text/plain" });
}

describe("dropFilesFromDataTransfer", () => {
	it("returns dropped files in order", () => {
		const a = textFile("a.md");
		const b = textFile("b.png");
		expect(dropFilesFromDataTransfer({ files: [a, b] })).toEqual([a, b]);
	});

	it("treats null, missing, and null entries as no files", () => {
		expect(dropFilesFromDataTransfer(null)).toEqual([]);
		expect(dropFilesFromDataTransfer(undefined)).toEqual([]);
		expect(dropFilesFromDataTransfer({})).toEqual([]);
		expect(dropFilesFromDataTransfer({ files: null })).toEqual([]);
		expect(dropFilesFromDataTransfer({ files: [null, textFile("a.md")] })).toHaveLength(1);
	});
});
describe("isPermissionDismissal", () => {
	it("swallows Abort and NotAllowed, surfaces the rest", () => {
		expect(isPermissionDismissal(new DOMException("x", "AbortError"))).toBe(true);
		expect(isPermissionDismissal(new DOMException("x", "NotAllowedError"))).toBe(true);
		expect(isPermissionDismissal(new Error("Couldn't capture that frame."))).toBe(false);
		expect(isPermissionDismissal(null)).toBe(false);
	});
});
