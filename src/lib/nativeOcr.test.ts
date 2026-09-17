import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
	friendlyFallbackError,
	friendlyOcrError,
	isOcrUnsupported,
	keepBestRecognition,
	ocrFallbackLangs,
	ocrRetryHint,
	visionSupports,
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
		expect(ocrFallbackLangs("bg")).toEqual(["bul", "eng"]);
		expect(ocrFallbackLangs("sr")).toEqual(["srp", "eng"]);
	});

	it("pairs every other non-Latin script with its traineddata plus English", () => {
		expect(ocrFallbackLangs("ar")).toEqual(["ara", "eng"]);
		expect(ocrFallbackLangs("fa")).toEqual(["fas", "eng"]);
		expect(ocrFallbackLangs("ur")).toEqual(["urd", "eng"]);
		expect(ocrFallbackLangs("he")).toEqual(["heb", "eng"]);
		expect(ocrFallbackLangs("hi")).toEqual(["hin", "eng"]);
		expect(ocrFallbackLangs("sa")).toEqual(["san", "eng"]);
		expect(ocrFallbackLangs("bn")).toEqual(["ben", "eng"]);
		expect(ocrFallbackLangs("ta")).toEqual(["tam", "eng"]);
		expect(ocrFallbackLangs("th")).toEqual(["tha", "eng"]);
		expect(ocrFallbackLangs("vi")).toEqual(["vie", "eng"]);
		expect(ocrFallbackLangs("hy")).toEqual(["hye", "eng"]);
		expect(ocrFallbackLangs("am")).toEqual(["amh", "eng"]);
		expect(ocrFallbackLangs("el")).toEqual(["ell", "eng"]);
		expect(ocrFallbackLangs("grc")).toEqual(["grc", "eng"]);
		expect(ocrFallbackLangs("yue")).toEqual(["chi_tra", "eng"]);
	});
});

describe("visionSupports", () => {
	it("covers the learner default and every modeled script", () => {
		expect(visionSupports(null)).toBe(true);
		expect(visionSupports("")).toBe(true);
		for (const code of ["en", "zh", "ja", "ko", "yue", "uk", "ru", "ar", "th", "vi", "tr", "pl", "id", "ms", "no", "pt"]) {
			expect(visionSupports(code)).toBe(true);
		}
		// Latin without its own model reads through English …
		for (const code of ["hu", "fi", "sk", "tl", "sw", "la"]) {
			expect(visionSupports(code)).toBe(true);
		}
		// … as does unmodeled Cyrillic through the shared base.
		expect(visionSupports("bg")).toBe(true);
		expect(visionSupports("sr")).toBe(true);
	});

	it("rejects scripts Vision has no model for", () => {
		// Probe-verified absent (supportedRecognitionLanguages,
		// macOS 26): these route to the WASM fallback instead.
		for (const code of ["hi", "sa", "he", "el", "grc", "fa", "ur", "bn", "ta", "hy", "am"]) {
			expect(visionSupports(code)).toBe(false);
		}
	});
});

describe("ocrRetryHint", () => {
	it("leads the retry with the reply's own language", () => {
		expect(ocrRetryHint("ru")).toBe("ru");
		expect(ocrRetryHint("uk")).toBe("uk");
		expect(ocrRetryHint("ar")).toBe("ar");
		expect(ocrRetryHint("th")).toBe("th");
		expect(ocrRetryHint("en")).toBe("en");
		expect(ocrRetryHint("fr")).toBe("fr");
		// Cyrillic without its own model shares the Ukrainian base.
		expect(ocrRetryHint("bg")).toBe("uk");
		expect(ocrRetryHint("sr")).toBe("uk");
		// No reply language: the legacy Ukrainian guess stands.
		expect(ocrRetryHint(null)).toBe("uk");
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