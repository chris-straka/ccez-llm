import { describe, it, expect } from "vitest";
import {
	parseFences,
	fenceBody,
	fenceAtOffset,
	shiftEnterAction
} from "./fences";

describe("parseFences", () => {
	it("returns no fences for plain text", () => {
		expect(parseFences("hello\nworld")).toEqual([]);
		expect(parseFences("")).toEqual([]);
		expect(parseFences("``not a fence``")).toEqual([]);
	});

	it("parses a closed fence with language and body offsets", () => {
		const doc = "before\n```js\nconst x = 1;\n```\nafter";
		const fences = parseFences(doc);
		expect(fences).toHaveLength(1);
		const fence = fences[0]!;
		expect(fence.openLine).toBe(1);
		expect(fence.closeLine).toBe(3);
		expect(fence.lang).toBe("js");
		expect(fenceBody(doc, fence)).toBe("const x = 1;\n");
	});

	it("leaves unclosed fences open to EOF", () => {
		const doc = "```py\nprint(1)";
		const fences = parseFences(doc);
		expect(fences).toHaveLength(1);
		expect(fences[0]!.closeLine).toBe(-1);
		expect(fences[0]!.lang).toBe("py");
		expect(fenceBody(doc, fences[0]!)).toBe("print(1)");
	});

	it("accepts bare fences and language tags with digits and symbols", () => {
		const doc = "```\nplain\n```\n```c++\nint x;\n```";
		const fences = parseFences(doc);
		expect(fences.map((f) => f.lang)).toEqual(["", "c++"]);
	});

	it("closes on the first bare fence and parses siblings", () => {
		const doc = "```js\na\n```\nmid\n```rs\nb\n```";
		const fences = parseFences(doc);
		expect(fences).toHaveLength(2);
		expect(fences[0]!.openLine).toBe(0);
		expect(fences[0]!.closeLine).toBe(2);
		expect(fences[1]!.openLine).toBe(4);
		expect(fences[1]!.closeLine).toBe(6);
	});

	it("handles empty bodies", () => {
		const doc = "```js\n```";
		const fences = parseFences(doc);
		expect(fences).toHaveLength(1);
		expect(fenceBody(doc, fences[0]!)).toBe("");
	});
});

describe("shiftEnterAction", () => {
	it("closes an unclosed opener", () => {
		expect(shiftEnterAction("```js", 5)).toEqual({ kind: "close" });
		// Cursor at the end of the opener line (offsets 3-8); 9 would be
		// the body line, where close does not apply.
		expect(shiftEnterAction("hi\n```py\ncode", 8)).toEqual({ kind: "close" });
	});

	it("leaves already-closed openers as newlines", () => {
		const doc = "```js\ncode\n```";
		expect(shiftEnterAction(doc, 2)).toEqual({ kind: "newline" });
	});

	it("exits from an empty body", () => {
		expect(shiftEnterAction("```js\n", 6)).toEqual({ kind: "exit" });
		expect(shiftEnterAction("```js\n\n```", 6)).toEqual({ kind: "exit" });
	});

	it("keeps newlines inside non-empty bodies and outside fences", () => {
		expect(shiftEnterAction("```js\ncode\n```", 8)).toEqual({
			kind: "newline"
		});
		expect(shiftEnterAction("plain text", 5)).toEqual({ kind: "newline" });
	});
});

describe("fenceAtOffset", () => {
	const doc = "hi\n```js\ncode\n```\nbye";
	const fences = parseFences(doc);

	it("finds fences by bar and body offsets", () => {
		expect(fenceAtOffset(fences, 0)).toBeNull();
		expect(fenceAtOffset(fences, 3)).not.toBeNull();
		expect(fenceAtOffset(fences, 9)).not.toBeNull();
		expect(fenceAtOffset(fences, doc.length)).toBeNull();
	});
});
