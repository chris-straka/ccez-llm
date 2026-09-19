import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
	it("reads Error messages", () => {
		expect(errorMessage(new Error("denied"))).toBe("denied");
	});
	it("passes strings through untouched", () => {
		expect(errorMessage("plain denial")).toBe("plain denial");
	});
	it("reads message off plain rejection objects", () => {
		// Tauri IPC denials arrive shaped like this, never as Errors.
		expect(errorMessage({ message: "capability denied" })).toBe(
			"capability denied"
		);
	});
	it("serializes message-less objects instead of [object Object]", () => {
		const text = errorMessage({ code: 403, kind: "denied" });
		expect(text).not.toContain("[object Object]");
		expect(text).toContain("403");
	});
	it("never throws, even on circular payloads", () => {
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		expect(() => errorMessage(loop)).not.toThrow();
	});
	it("stringifies the primitives", () => {
		expect(errorMessage(42)).toBe("42");
		expect(errorMessage(null)).toBe("null");
		expect(errorMessage(undefined)).toBe("undefined");
	});
});
