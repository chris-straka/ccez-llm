import { describe, it, expect } from "vitest";
import {
	capturePromptTemplate,
	captureSourceFor,
	friendlyCaptureError,
	hasCjkText,
	isCaptureUnsupported,
	isScreenRecordingDenial,
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
			"screen capture failed: allow Screen Recording for Ccez LLM, then relaunch and retry";
		expect(friendlyCaptureError(denial)).toBe(denial);
	});

	it("arms the settings action only on the denial", () => {
		expect(
			isScreenRecordingDenial(
				"screen capture failed: allow Screen Recording for Ccez LLM, then relaunch and retry"
			)
		).toBe(true);
		expect(isScreenRecordingDenial("no capturable window is on screen")).toBe(
			false
		);
		expect(isScreenRecordingDenial("")).toBe(false);
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
		expect(shouldStageCapture("hello", 0)).toBe(true);
		expect(shouldStageCapture("hello", 0.59)).toBe(true);
		expect(shouldStageCapture("hello", 0.6)).toBe(false);
		expect(shouldStageCapture("hello", 0.95)).toBe(false);
	});

	it("detects CJK text across scripts", () => {
		expect(hasCjkText("hello")).toBe(false);
		expect(hasCjkText("")).toBe(false);
		expect(hasCjkText("なんのヘンテツもない")).toBe(true);
		expect(hasCjkText("（・・・・一見）")).toBe(true);
		expect(hasCjkText("控室から一歩")).toBe(true);
		expect(hasCjkText("한국어")).toBe(true);
		expect(hasCjkText("简体中文")).toBe(true);
		expect(hasCjkText("mixed 一 text")).toBe(true);
	});

	it("sends accurate CJK reads at 0.4 and stages below", () => {
		const game = "（・・・・一見、なんのヘンテツもない）";
		expect(shouldStageCapture(game, 0.39)).toBe(true);
		expect(shouldStageCapture(game, 0.4)).toBe(false);
		expect(shouldStageCapture(game, 0.5)).toBe(false);
		// Latin keeps the 0.6 floor at the same confidence.
		expect(shouldStageCapture("screenshot", 0.4)).toBe(true);
		expect(shouldStageCapture("screenshot", 0.5)).toBe(true);
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
