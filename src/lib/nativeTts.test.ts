import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
	sentenceAtOffset,
	friendlyNativeError,
	quoteLangFor,
	quoteLangForContext,
	latinSentencesLang,
	sentenceLangsFor,
	sentenceForQuote,
	speakNative,
	speakNativeMulti,
	stopNative,
	saveNativeSpeech
} from "./nativeTts";
import { ttsLangFor } from "./reading";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

beforeEach(() => {
	vi.useRealTimers();
	mockInvoke.mockReset();
	mockListen.mockReset();
	// No shell outside Tauri: every bridge call rejects, like the real
	// invoke does in browsers and tests.
	mockInvoke.mockRejectedValue(new Error("no bridge"));
	mockListen.mockResolvedValue(() => {});
});

describe("sentenceAtOffset", () => {
	const sentences = ["Hello world.", "How are you?", "Fine."];
	const utterance = sentences.join(" ");

	it("maps offsets inside each sentence", () => {
		expect(sentenceAtOffset(sentences, utterance, 0)).toBe(0);
		expect(sentenceAtOffset(sentences, utterance, 11)).toBe(0);
		expect(sentenceAtOffset(sentences, utterance, 12)).toBe(1);
		expect(sentenceAtOffset(sentences, utterance, 13)).toBe(1);
		expect(sentenceAtOffset(sentences, utterance, 25)).toBe(2);
	});

	it("clamps past-the-end offsets to the last sentence", () => {
		expect(sentenceAtOffset(sentences, utterance, 10_000)).toBe(2);
	});

	it("falls back to cursor order when a sentence is not found", () => {
		expect(sentenceAtOffset(["zzz", "Fine."], utterance, 5)).toBe(1);
	});
});

describe("friendlyNativeError", () => {
	it("maps capability denials to a rebuild hint", () => {
		expect(friendlyNativeError("tts_speak not allowed.")).toContain(
			"permissions"
		);
		expect(friendlyNativeError("permission denied")).toContain("permissions");
	});

	it("maps timeouts to a retry hint", () => {
		expect(friendlyNativeError("recv timed out")).toContain("try again");
	});

	it("maps non-macOS builds to the browser-preview note", () => {
		expect(friendlyNativeError("native TTS requires macOS")).toContain(
			"Mac app"
		);
	});

	it("passes unknown errors through untouched", () => {
		expect(friendlyNativeError("boom")).toBe("boom");
	});
});

describe("quoteLangFor", () => {
	it("uses script detection without touching the bridge", async () => {
		await expect(
			quoteLangFor("你好，这是一个中文测试句子", "en-US")
		).resolves.toBe("zh-CN");
		await expect(
			quoteLangFor("مرحبا بك في هذا الاختبار الطويل", "en-US")
		).resolves.toBe("ar-SA");
	});

	it("routes toned pinyin to Chinese before the recognizer can say Vietnamese", async () => {
		// Apple's recognizer reads toned pinyin as vi (~0.98); the guard
		// must win even when the bridge would answer otherwise.
		mockInvoke.mockResolvedValue("vi");
		await expect(
			quoteLangFor("nǐ hǎo, wǒ shì xuéshēng, wǒ xuéxí zhōngwén", "en-US")
		).resolves.toBe("zh-CN");
		expect(mockInvoke).not.toHaveBeenCalled();
	});

	it("falls back without a bridge for Latin text", async () => {
		await expect(
			quoteLangFor(
				"this is a fairly long english sentence for testing",
				"en-US"
			)
		).resolves.toBe("en-US");
	});

	it("uses the offline scorer when the bridge answers null", async () => {
		mockInvoke.mockResolvedValue(null);
		await expect(
			quoteLangFor(
				"Les enfants jouent dans le jardin avec leurs amis pour feter la fin",
				"en-US"
			)
		).resolves.toBe("fr-FR");
	});

	it("prefers the bridge answer over the offline scorer", async () => {
		mockInvoke.mockResolvedValue("de-DE");
		await expect(
			quoteLangFor(
				"Les enfants jouent dans le jardin avec leurs amis pour feter la fin",
				"en-US"
			)
		).resolves.toBe("de-DE");
	});
});

describe("quoteLangForContext", () => {
	const JA =
		"昨夜は星空がとても綺麗で、つい時間を忘れて眺めてしまいました。熊猫慢悠悠地吃着竹子。";
	const ZH = "熊猫慢悠悠地吃着竹子，看起来很幸福。昨夜は星空がとても綺麗です。";

	it("reads kanji with the sentence's voice when kana is near", async () => {
		await expect(quoteLangForContext("眺め", JA, "en-US")).resolves.toBe(
			"ja-JP"
		);
		expect(mockInvoke).not.toHaveBeenCalled();
	});

	it("keeps the Chinese default without a bridge", async () => {
		await expect(quoteLangForContext("竹子", ZH, "en-US")).resolves.toBe(
			"zh-CN"
		);
	});

	it("asks the bridge for Han-only sentences", async () => {
		mockInvoke.mockResolvedValueOnce("ja");
		await expect(
			quoteLangForContext("竹子", "熊猫慢悠悠地吃着竹子。", "en-US")
		).resolves.toBe("ja");
		expect(mockInvoke).toHaveBeenCalledWith("tts_identify_lang", {
			text: "熊猫慢悠悠地吃着竹子。"
		});
	});

	it("leaves unambiguous quotes on today's path", async () => {
		await expect(quoteLangForContext("読む", JA, "en-US")).resolves.toBe(
			"ja-JP"
		);
		await expect(
			quoteLangForContext("this is a fairly long english sentence", JA, "en-US")
		).resolves.toBe("en-US");
	});
});

/** Payload text of a mocked `tts_identify_lang` call. */
function identifyText(args: unknown): string {
	if (typeof args !== "object" || args === null) return "";
	const text = (args as Record<string, unknown>)["text"];
	return typeof text === "string" ? text : "";
}

describe("latinSentencesLang", () => {
	it("recognizes only the Latin sentences in mixed text", async () => {
		// The bridge routes the whole message's Latin part: per-sentence
		// English must not inherit the Japanese voice (the read-aloud
		// bug), and the recognizer must never see the kana.
		mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
			if (cmd !== "tts_identify_lang")
				throw new Error(`unmocked command: ${cmd}`);
			return identifyText(args).includes("Bonjour") ? "fr-FR" : "en-US";
		});
		await expect(
			latinSentencesLang(
				"今日はいい天気ですね。Hello world, how are you today.",
				"ja-JP"
			)
		).resolves.toBe("en-US");
		for (const [, args] of mockInvoke.mock.calls) {
			expect(
				String((args as Record<string, string>)?.["text"] ?? "")
			).not.toMatch(/[\u3040-\u30FF]/);
		}
	});

	it("returns the fallback without a bridge when nothing is Latin", async () => {
		await expect(
			latinSentencesLang("今日はいい天気ですね。", "ja-JP")
		).resolves.toBe("ja-JP");
		expect(mockInvoke).not.toHaveBeenCalled();
	});
});

describe("sentenceLangsFor", () => {
	// Four languages in one highlight: kana and Arabic resolve by
	// script with no bridge; each Latin sentence gets its own
	// recognizer pass instead of sharing one voice.
	const MIXED =
		"今日はいい天気ですね。Hello world, how are you doing today. " +
		"Bonjour le monde, comment allez-vous aujourd'hui. مرحبا بك في هذا الاختبار الطويل.";
	const route = async (cmd: string, args?: unknown): Promise<string> => {
		if (cmd !== "tts_identify_lang")
			throw new Error(`unmocked command: ${cmd}`);
		const text = identifyText(args);
		if (/[\u3040-\u30FF\u0600-\u06FF]/.test(text))
			throw new Error("script text hit the bridge");
		return text.includes("Bonjour") ? "fr-FR" : "en-US";
	};

	it("gives every sentence its own voice", async () => {
		mockInvoke.mockImplementation(route);
		const langFor = await sentenceLangsFor(MIXED, "en-US", []);
		expect(langFor("今日はいい天気ですね。")).toBe("ja-JP");
		expect(langFor("Hello world, how are you doing today.")).toBe("en-US");
		expect(langFor("Bonjour le monde, comment allez-vous aujourd'hui.")).toBe(
			"fr-FR"
		);
		expect(langFor("مرحبا بك في هذا الاختبار الطويل.")).toBe("ar-SA");
	});

	it("lands ambiguous Latin on the surrounding voice, not a guess", async () => {
		// The bridge abstains everywhere: the whole-Latin seed and every
		// per-sentence pass fall back, so a bare "OK" inside Japanese
		// keeps the message voice instead of flipping to English.
		mockInvoke.mockResolvedValue(null);
		const langFor = await sentenceLangsFor("そうですね。OK.", "ja-JP", []);
		expect(langFor("そうですね。")).toBe("ja-JP");
		expect(langFor("OK.")).toBe("ja-JP");
	});

	it("returns the fallback without a bridge when nothing is Latin", async () => {
		const langFor = await sentenceLangsFor(
			"今日はいい天気ですね。",
			"ja-JP",
			[]
		);
		expect(langFor("今日はいい天気ですね。")).toBe("ja-JP");
		expect(mockInvoke).not.toHaveBeenCalled();
	});
});

describe("sentenceForQuote", () => {
	it("finds the holding sentence and misses cleanly", () => {
		expect(sentenceForQuote("First. 眺めて here. Last.", "眺めて")).toBe(
			"眺めて here."
		);
		expect(sentenceForQuote("First. Second.", "missing")).toBeNull();
		expect(sentenceForQuote("First. Second.", "  ")).toBeNull();
	});
});

describe("stopNative", () => {
	it("never throws without a bridge (send-path regression)", () => {
		expect(() => stopNative()).not.toThrow();
	});
});

describe("speakNative", () => {
	it("returns false without touching the bridge for empty text", () => {
		expect(
			speakNative("   ", "en-US", {
				onError: () => {
					throw new Error("onError must not fire when there is nothing to say");
				}
			})
		).toBe(false);
	});

	it("reports bridge failure via onError instead of throwing", async () => {
		const errors: string[] = [];
		const ok = speakNative("Hello world, this is a spoken test.", "en-US", {
			onError: (message) => errors.push(message)
		});
		expect(ok).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(errors.length).toBe(1);
	});
});

describe("speakNativeMulti", () => {
	const langFor = (sentence: string): string => ttsLangFor(sentence, "en-US");
	afterEach(() => {
		stopNative();
	});

	it("returns false without touching the bridge for empty text", () => {
		expect(
			speakNativeMulti("   ", langFor, {
				onError: () => {
					throw new Error("onError must not fire when there is nothing to say");
				}
			})
		).toBe(false);
		expect(mockInvoke).not.toHaveBeenCalled();
	});

	it("stops the chain after a segment fails", async () => {
		const errors: string[] = [];
		const ended: string[] = [];
		const ok = speakNativeMulti("Hello world. 你好世界。", langFor, {
			onError: (message) => errors.push(message),
			onEnd: () => ended.push("end")
		});
		expect(ok).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(errors.length).toBe(1);
		expect(ended).toEqual([]);
		// The bridge rejects everything: only the first segment speaks.
		expect(mockInvoke).toHaveBeenCalledTimes(1);
		expect(mockInvoke.mock.calls[0]?.[1]).toMatchObject({ lang: "en-US" });
	});

	it("chains one utterance per segment with its own lang", async () => {
		mockInvoke.mockResolvedValue(7);
		const ended: string[] = [];
		const natural: string[] = [];
		const ok = speakNativeMulti("Hello world. 你好世界。", langFor, {
			onEnd: () => ended.push("end"),
			onNaturalEnd: () => natural.push("natural")
		});
		expect(ok).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(mockInvoke).toHaveBeenCalledTimes(1);
		// First segment ends naturally: the second goes out in Chinese.
		const doneCalls = mockListen.mock.calls.filter(
			(call) => call[0] === "tts-done"
		);
		expect(doneCalls.length).toBe(1);
		const done = doneCalls[0]?.[1] as (event: {
			payload: { id: number; finished: boolean };
		}) => void;
		done({ payload: { id: 7, finished: true } });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(mockInvoke).toHaveBeenCalledTimes(2);
		expect(mockInvoke.mock.calls[1]?.[1]).toMatchObject({ lang: "zh-CN" });
		// Second segment ends: the chain settles exactly once.
		const doneCalls2 = mockListen.mock.calls.filter(
			(call) => call[0] === "tts-done"
		);
		const done2 = doneCalls2[doneCalls2.length - 1]?.[1] as (event: {
			payload: { id: number; finished: boolean };
		}) => void;
		done2({ payload: { id: 7, finished: true } });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(mockInvoke).toHaveBeenCalledTimes(2);
		expect(ended).toEqual(["end"]);
		expect(natural).toEqual(["natural"]);
	});
});

describe("speakNative watchdog", () => {
	afterEach(() => {
		stopNative();
		vi.useRealTimers();
	});

	it("surfaces a wedged bridge via onError instead of sticking", async () => {
		vi.useFakeTimers();
		mockInvoke.mockImplementation(() => new Promise(() => {}));
		const errors: string[] = [];
		const ended: string[] = [];
		const ok = speakNative("Hello world, this is a spoken test.", "en-US", {
			onError: (message) => errors.push(message),
			onEnd: () => ended.push("end")
		});
		expect(ok).toBe(true);
		// 35 chars → max(30s, 35 × 250ms) = 30s ceiling.
		await vi.advanceTimersByTimeAsync(31_000);
		expect(errors).toEqual(["Speech timed out — stopped. Try again."]);
		expect(ended).toEqual([]);
	});

	it("stays silent when a stop supersedes the stuck utterance", async () => {
		vi.useFakeTimers();
		mockInvoke.mockImplementation(() => new Promise(() => {}));
		const errors: string[] = [];
		speakNative("First utterance that will wedge.", "en-US", {
			onError: (message) => errors.push(message)
		});
		await vi.advanceTimersByTimeAsync(10_000);
		stopNative();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(errors).toEqual([]);
	});
});

describe("saveNativeSpeech", () => {
	it("invokes tts_save_speech with the voice pick", async () => {
		mockInvoke.mockResolvedValue("/tmp/ccez-speech-7.m4a");
		await expect(saveNativeSpeech("hello", "en-US", "voice-1")).resolves.toBe(
			"/tmp/ccez-speech-7.m4a"
		);
		expect(mockInvoke).toHaveBeenCalledWith("tts_save_speech", {
			text: "hello",
			lang: "en-US",
			voice: "voice-1"
		});
	});

	it("rejects when the bridge is unavailable", async () => {
		await expect(saveNativeSpeech("hello", "en-US")).rejects.toThrow(
			"no bridge"
		);
	});
});
