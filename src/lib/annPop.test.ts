import { describe, it, expect } from "vitest";
import {
	annPopBlurAction,
	annPopCancelKind,
	annPopSaveKind,
	pillWashId
} from "./annPop";

describe("annPopSaveKind", () => {
	it("commits the pending annotation, else edits the saved comment", () => {
		expect(annPopSaveKind("a", "a")).toBe("commit-pending");
		expect(annPopSaveKind("a", "b")).toBe("save-edit");
		expect(annPopSaveKind("a", null)).toBe("save-edit");
	});
});

describe("annPopCancelKind", () => {
	it("drops never-submitted pendings first, even when fresh", () => {
		expect(annPopCancelKind("a", true, "a")).toBe("drop-pending");
		expect(annPopCancelKind("a", false, "a")).toBe("drop-pending");
	});

	it("deletes fresh annotations no matter what was typed", () => {
		expect(annPopCancelKind("a", true, null)).toBe("delete-fresh");
		expect(annPopCancelKind("a", true, "b")).toBe("delete-fresh");
	});

	it("keeps existing annotations as they were", () => {
		expect(annPopCancelKind("a", false, null)).toBe("keep-existing");
		expect(annPopCancelKind("a", false, "b")).toBe("keep-existing");
	});
});

describe("annPopBlurAction", () => {
	it("cancels empty drafts and saves typed ones", () => {
		expect(annPopBlurAction("")).toBe("cancel");
		expect(annPopBlurAction("   ")).toBe("cancel");
		expect(annPopBlurAction("note")).toBe("save");
		expect(annPopBlurAction(" ?")).toBe("save");
	});
});

describe("pillWashId", () => {
	it("holds the wash while open and releases it as the pill closes", () => {
		expect(pillWashId({ id: "a" }, false)).toBe("a");
		expect(pillWashId({ id: "a" }, true)).toBeNull();
		expect(pillWashId(null, false)).toBeNull();
		expect(pillWashId(null, true)).toBeNull();
	});
});
