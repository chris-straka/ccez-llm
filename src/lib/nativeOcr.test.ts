import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
	friendlyFallbackError,
	friendlyOcrError,
	isOcrUnsupported,
	keepBestRecognition,
	ocrFallbackLangs,
	ocrRetryHint,
	OCR_RETRY_BELOW,
	ocrSupported,
	recognizeImageText,
	type OcrResult
} from "./nativeOcr";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
	mockInvoke.mockReset();
	// No shell outside Tauri: every bridge call rejects, like the real
	// invoke does in browsers and tests.
	mockInvoke.mockRejectedValue(new Error("no bridge"));
});

describe("ocrSupported", () => {
	it("is false without a bridge and never throws", async () => {
		await expect(ocrSupported()).resolves.toBe(false);
	});
});

describe("recognizeImageText", () => {
	it("passes the image and hint through to the backend", async () => {
		const result: OcrResult = {
			text: "你好",
			lines: [{ text: "你好", confidence: 0.9 }],
			confidence: 0.9
		};
		mockInvoke.mockResolvedValueOnce(result);
		await expect(recognizeImageText("data:image/jpeg;base64,aGk=", "zh-CN")).resolves.toEqual(
			result
		);
		expect(mockInvoke).toHaveBeenCalledWith("ocr_recognize", {
			image: "data:image/jpeg;base64,aGk=",
			lang: "zh-CN"
		});
	});

	it("defaults the hint to null (backend takes the learner default)", async () => {
		mockInvoke.mockResolvedValueOnce({ text: "", lines: [], confidence: 0 });
		await recognizeImageText("aGk=");
		expect(mockInvoke).toHaveBeenCalledWith("ocr_recognize", {
			image: "aGk=",
			lang: null
		});
	});

	it("rejects without a bridge so the caller can explain", async () => {
		await expect(recognizeImageText("aGk=")).rejects.toThrow("no bridge");
	});
});

describe("isOcrUnsupported", () => {
	it("matches the platform stubs", () => {
		expect(isOcrUnsupported("on-device OCR requires macOS (Windows WinRT OCR is a planned follow-up)")).toBe(
			true
		);
		expect(isOcrUnsupported("native OCR is not supported on this platform")).toBe(true);
	});

	it("leaves real failures alone", () => {
		expect(isOcrUnsupported("no text found in this image")).toBe(false);
		expect(isOcrUnsupported("boom")).toBe(false);
	});
});

describe("friendlyOcrError", () => {
	it("maps non-macOS builds to the browser-preview note", () => {
		expect(friendlyOcrError("on-device OCR requires macOS")).toContain("Mac app");
	});

	it("maps capability denials to a rebuild hint", () => {
		expect(friendlyOcrError("ocr_recognize not allowed.")).toContain("permissions");
	});

	it("keeps the no-text message user-facing", () => {
		expect(friendlyOcrError("no text found in this image")).toBe(
			"No text found in this image."
		);
	});

	it("passes unknown errors through untouched", () => {
		expect(friendlyOcrError("boom")).toBe("boom");
	});
});

describe("ocrFallbackLangs", () => {
	it("pairs CJK replies with their traineddata plus English", () => {
		expect(ocrFallbackLangs("ja")).toEqual(["jpn", "eng"]);
		expect(ocrFallbackLangs("zh")).toEqual(["chi_sim", "eng"]);
		expect(ocrFallbackLangs("ko")).toEqual(["kor", "eng"]);
	});

	it("reads Latin-script replies with English alone", () => {
		expect(ocrFallbackLangs(null)).toEqual(["eng"]);
		expect(ocrFallbackLangs("fr")).toEqual(["eng"]);
		expect(ocrFallbackLangs("")).toEqual(["eng"]);
	});

	it("pairs Cyrillic replies with their traineddata plus English", () => {
		expect(ocrFallbackLangs("uk")).toEqual(["ukr", "eng"]);
		expect(ocrFallbackLangs("ru")).toEqual(["rus", "eng"]);
	});
});

describe("ocrRetryHint", () => {
	it("retries Russian as Russian, everything else as Ukrainian", () => {
		expect(ocrRetryHint("ru")).toBe("ru");
		expect(ocrRetryHint("uk")).toBe("uk");
		expect(ocrRetryHint(null)).toBe("uk");
		expect(ocrRetryHint("en")).toBe("uk");
	});
});

describe("keepBestRecognition", () => {
	const res = (text: string, confidence: number): OcrResult => ({
		text,
		lines: [{ text, confidence }],
		confidence
	});

	it("lets a good first pass stand without contest", () => {
		const first = res("hello", OCR_RETRY_BELOW);
		const second = res("different", 0.99);
		expect(keepBestRecognition(first, second)).toBe(first);
	});

	it("takes the retry when it reads better", () => {
		const first = res(",_ i", 0.3);
		const second = res("Ранковий туман", 0.92);
		expect(keepBestRecognition(first, second)).toBe(second);
	});

	it("keeps the first observation on ties and empty retries", () => {
		const first = res(",_ i", 0.3);
		expect(keepBestRecognition(first, res("alt", 0.3))).toBe(first);
		expect(keepBestRecognition(first, res("", 0))).toBe(first);
	});
});

describe("friendlyFallbackError", () => {
	it("reads engine-download failures as offline", () => {
		expect(friendlyFallbackError("Failed to fetch dynamically imported module")).toContain(
			"check the network"
		);
		expect(friendlyFallbackError("Network request failed")).toContain("check the network");
	});

	it("keeps the no-text message user-facing", () => {
		expect(friendlyFallbackError("no text found in this image")).toBe(
			"No text found in this image."
		);
	});

	it("passes unknown errors through untouched", () => {
		expect(friendlyFallbackError("boom")).toBe("boom");
	});
});