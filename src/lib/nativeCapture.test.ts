import { describe, it, expect } from "vitest";
import {
	capturePromptTemplate,
	captureSourceFor,
	friendlyCaptureError,
	isCaptureUnsupported,
	shouldStageCapture
} from "./nativeCapture";

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
			"Explain this for a language learner — readings, key words, one grammar point, then a natural translation:\n\n> Bonjour le monde"
		);
		expect(capturePromptTemplate("line one\nline two")).toBe(
			"Explain this for a language learner — readings, key words, one grammar point, then a natural translation:\n\n> line one\n> line two"
		);
	});

	it("stages weak reads instead of auto-sending", () => {
		expect(shouldStageCapture(0)).toBe(true);
		expect(shouldStageCapture(0.59)).toBe(true);
		expect(shouldStageCapture(0.6)).toBe(false);
		expect(shouldStageCapture(0.95)).toBe(false);
	});
});

describe("capture source resolution", () => {
	const chord = { windowId: null, savedWindowId: 42, fullscreen: false };
	const area = { x: 1, y: 2, width: 3, height: 4 };

	it("runs one-shots outright", () => {
		expect(
			captureSourceFor({ kind: "fullscreen" }, area, chord)
		).toEqual({ kind: "fullscreen" });
		expect(
			captureSourceFor({ kind: "interactive", mode: "area" }, area, chord)
		).toEqual({ kind: "interactive", mode: "area" });
	});

	it("prefers the saved square on the chord path", () => {
		expect(captureSourceFor(undefined, area, chord)).toEqual({
			kind: "rect",
			area
		});
	});

	it("falls back to the window source without a square", () => {
		expect(captureSourceFor(undefined, null, chord)).toEqual({
			kind: "window",
			source: chord
		});
		expect(
			captureSourceFor(undefined, { x: 0, y: 0, width: 0, height: 1 }, chord)
		).toEqual({ kind: "window", source: chord });
	});
});
