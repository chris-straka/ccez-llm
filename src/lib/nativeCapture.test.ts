import { describe, it, expect } from "vitest";
import {
	capturePromptTemplate,
	captureSourceLabel,
	friendlyCaptureError,
	isCaptureUnsupported,
	shouldStageCapture
} from "./nativeCapture";

describe("capture source labels", () => {
	it("names titled windows owner-first", () => {
		expect(
			captureSourceLabel({ id: 11, owner: "BlueStacks", title: "Game" }, false)
		).toBe("BlueStacks — Game");
	});

	it("falls back to the owner for untitled windows", () => {
		expect(
			captureSourceLabel({ id: 11, owner: "BlueStacks", title: "" }, false)
		).toBe("BlueStacks");
	});

	it("labels fullscreen and the frontmost fallback", () => {
		expect(captureSourceLabel(null, true)).toBe("Fullscreen");
		expect(
			captureSourceLabel({ id: 11, owner: "BlueStacks", title: "Game" }, true)
		).toBe("Fullscreen");
		expect(captureSourceLabel(null, false)).toBe("Frontmost window");
	});
});

describe("capture errors", () => {
	it("detects unsupported builds", () => {
		expect(
			isCaptureUnsupported("window capture is not supported on this platform")
		).toBe(true);
		expect(isCaptureUnsupported("no capturable window is on screen")).toBe(
			true
		);
		expect(isCaptureUnsupported("screen capture failed")).toBe(false);
	});

	it("keeps the Screen Recording fix verbatim", () => {
		const denial =
			"screen capture failed: allow Screen Recording for Ccez LLM, then retry";
		expect(friendlyCaptureError(denial)).toBe(denial);
	});

	it("maps unsupported builds to the device message", () => {
		expect(
			friendlyCaptureError("window capture is not supported on this platform")
		).toBe("Window capture is not available on this device.");
	});

	it("passes anything else through", () => {
		expect(friendlyCaptureError("the window list is unavailable")).toBe(
			"the window list is unavailable"
		);
	});
});

describe("capture send shape", () => {
	it("quotes the recognized text under the question", () => {
		expect(capturePromptTemplate("Bonjour le monde")).toBe(
			"What does this mean?\n\n> Bonjour le monde"
		);
		expect(capturePromptTemplate("line one\nline two")).toBe(
			"What does this mean?\n\n> line one\n> line two"
		);
	});

	it("stages weak reads instead of auto-sending", () => {
		expect(shouldStageCapture(0)).toBe(true);
		expect(shouldStageCapture(0.59)).toBe(true);
		expect(shouldStageCapture(0.6)).toBe(false);
		expect(shouldStageCapture(0.95)).toBe(false);
	});
});
