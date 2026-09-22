// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	splitScriptRuns,
	splitSentences,
	speechText,
	latinFallback,
	messageSpeechLang,
	speechAttemptable,
	speechLangsFor,
	startSpeechError,
	replyLangFor,
	sentenceSpeechLang,
	webVoiceAvailable,
	effectiveSpeechLang,
	splitGlossHalves,
	splitSpeechSegments,
	speakText,
	speakMultilingual,
	stopSpeaking,
	isSpeaking,
	micAvailable,
	dictateOnce,
	friendlyMicError,
	messageSpeakableFor,
	isMessageSpeaking,
	speakTitleFor,
	appendDictation,
	dictationInsert,
	micUnavailableMessage
} from "./voice";
import { ttsLangFor } from "./reading";

describe("splitSentences", () => {
	it("splits on Latin and CJK terminators", () => {
		expect(splitSentences("Hello world. How are you? Fine!")).toEqual([
			"Hello world.",
			"How are you?",
			"Fine!"
		]);
		expect(splitSentences("你好世界。今天好吗？很好！")).toEqual([
			"你好世界。",
			"今天好吗？",
			"很好！"
		]);
	});

	it("handles single sentences and empties", () => {
		expect(splitSentences("Bonjour")).toEqual(["Bonjour"]);
		expect(splitSentences("   ")).toEqual([]);
		expect(splitSentences("")).toEqual([]);
	});

	it("keeps halves on separate lines in their own voices", () => {
		expect(splitSentences("Hello world\nこんにちは世界")).toEqual([
			"Hello world",
			"こんにちは世界"
		]);
		expect(splitSentences("First.\n\nSecond line")).toEqual([
			"First.",
			"Second line"
		]);
	});
});

describe("speechText", () => {
	it("drops code fences and markdown noise", () => {
		const text = speechText(
			"# Title\n\nHello **world**.\n\n```ts\nconst x = 1;\n```\n\n[Pasted an image]"
		);
		expect(text).toContain("Title");
		expect(text).toContain("Hello world.");
		expect(text).not.toContain("const x");
		expect(text).not.toContain("```");
		expect(text).not.toContain("[Pasted an image]");
	});

	it("names pasted content instead of reading markers", () => {
		expect(speechText("[Pasted 250 chars]")).toBe("pasted content");
		expect(speechText("look [Pasted image]")).toBe("look pasted image");
	});
});

describe("sentenceSpeechLang", () => {
	it("lets kana and other scripts decide for themselves", () => {
		expect(sentenceSpeechLang("漢字を読む", "zh-CN")).toBe("ja-JP");
		expect(sentenceSpeechLang("自然が好き", "zh-CN")).toBe("ja-JP");
		expect(sentenceSpeechLang("Bonjour", "ja-JP")).toBe("ja-JP");
	});

	it("keeps complete han-only sentences chinese", () => {
		expect(sentenceSpeechLang("我是学生。", "ja-JP")).toBe("zh-CN");
		expect(sentenceSpeechLang("你好世界！", "ja-JP")).toBe("zh-CN");
	});

	it("hands mid-highlight fragments back to the surrounding voice", () => {
		expect(sentenceSpeechLang("自", "ja-JP")).toBe("ja-JP");
		expect(sentenceSpeechLang("自然", "ja-JP")).toBe("ja-JP");
		expect(sentenceSpeechLang("自", "zh-CN")).toBe("zh-CN");
	});

	it("keeps han-only fragments chinese under a latin surrounding voice", () => {
		// A bare Han line in an English message reads Mandarin,
		// never English — the fragment rule only inherits CJK voices.
		expect(sentenceSpeechLang("汉语是", "en-US")).toBe("zh-CN");
		expect(sentenceSpeechLang("自然", "en-US")).toBe("zh-CN");
		expect(sentenceSpeechLang("汉语是", "fr-FR")).toBe("zh-CN");
		expect(sentenceSpeechLang("汉语是", "ko-KR")).toBe("ko-KR");
	});

	it("reads a long distinctive Chinese tail in Mandarin under a CJK seed", () => {
		// Simplified-only 适/节 identify the fragment; short shared
		// fragments still inherit (two kanji identify nothing).
		expect(sentenceSpeechLang("秋天是中国最舒适的季节之", "ja-JP")).toBe(
			"zh-CN"
		);
		expect(sentenceSpeechLang("汉语是", "ja-JP")).toBe("ja-JP");
		expect(sentenceSpeechLang("日本経済新聞社", "zh-CN")).toBe("zh-CN");
		// Traditional-only 國/說 identify just as well.
		expect(sentenceSpeechLang("我國小說是好看的故事書本", "ja-JP")).toBe(
			"zh-CN"
		);
	});
});

describe("replyLangFor", () => {
	it("resolves non-Latin scripts and falls back for Latin", () => {
		expect(replyLangFor("你好世界", "en-US")).toBe("zh-CN");
		expect(replyLangFor("Bonjour le monde", "fr-FR")).toBe("fr-FR");
		expect(replyLangFor("Guten Morgen", "de-DE")).toBe("de-DE");
		expect(replyLangFor("```py\nprint(1)\n```\nHello", "en-US")).toBe("en-US");
	});
});

describe("speech unavailability", () => {
	it("no-ops cleanly without throwing", () => {
		expect(speakText("hello", "en-US")).toBe(false);
		expect(speakMultilingual("hello", () => "en-US")).toBe(false);
		expect(isSpeaking()).toBe(false);
		expect(() => stopSpeaking()).not.toThrow();
		expect(micAvailable()).toBe(false);
		expect(
			dictateOnce(
				"en-US",
				() => {},
				() => {}
			)
		).toBeNull();
	});
});

describe("splitScriptRuns", () => {
	it("keeps single-script sentences whole", () => {
		expect(splitScriptRuns("Hello world.")).toEqual(["Hello world."]);
		expect(splitScriptRuns("日本語です。")).toEqual(["日本語です。"]);
		expect(splitScriptRuns("...")).toEqual(["..."]);
	});
	it("breaks on script change, gluing spaces and digits", () => {
		expect(splitScriptRuns("Hello世界")).toEqual(["Hello", "世界"]);
		expect(splitScriptRuns("2024年 Report")).toEqual(["2024年", "Report"]);
		expect(splitScriptRuns("aبc")).toEqual(["a", "ب", "c"]);
	});
	it("shares one run for kana and Han", () => {
		expect(splitScriptRuns("漢字ひらがな")).toEqual(["漢字ひらがな"]);
	});
});

describe("splitSpeechSegments", () => {
	const langFor = (sentence: string): string => ttsLangFor(sentence, "en-US");
	it("resolves a voice locale per sentence", () => {
		expect(
			splitSpeechSegments("Hello world. 你好！こんにちは！", langFor)
		).toEqual([
			{ text: "Hello world.", lang: "en-US" },
			{ text: "你好！", lang: "zh-CN" },
			{ text: "こんにちは！", lang: "ja-JP" }
		]);
	});
	it("returns no segments for blank text", () => {
		expect(splitSpeechSegments("   ", langFor)).toEqual([]);
	});
	it("splits same-sentence script runs with no break between halves", () => {
		expect(splitSpeechSegments("Hello世界。", langFor)).toEqual([
			{ text: "Hello", lang: "en-US" },
			{ text: "世界。", lang: "zh-CN" }
		]);
	});
	it("keeps same-locale runs one utterance with exact text", () => {
		// ttsLangFor reads the Han fragment as Chinese; the real
		// callback (sentenceSpeechLang) only inherits CJK surrounding
		// voices, so a Han run under a Latin voice splits into its
		// own utterance instead of collapsing into English.
		expect(splitSpeechSegments("Hello世界", langFor)).toEqual([
			{ text: "Hello", lang: "en-US" },
			{ text: "世界", lang: "zh-CN" }
		]);
		expect(
			splitSpeechSegments("Hello世界", (s) => sentenceSpeechLang(s, "en-US"))
		).toEqual([
			{ text: "Hello", lang: "en-US" },
			{ text: "世界", lang: "zh-CN" }
		]);
		expect(
			splitSpeechSegments("Hello世界。Goodbye宇宙。", (s) =>
				sentenceSpeechLang(s, "en-US")
			)
		).toEqual([
			{ text: "Hello", lang: "en-US" },
			{ text: "世界。", lang: "zh-CN" },
			{ text: "Goodbye", lang: "en-US" },
			{ text: "宇宙。", lang: "zh-CN" }
		]);
	});
});

describe("splitGlossHalves", () => {
	it("splits translation glosses at the first top-level =", () => {
		expect(splitGlossHalves("miteinander = with each other")).toEqual([
			"miteinander",
			"with each other"
		]);
		expect(splitGlossHalves("tief = deep / deeply")).toEqual([
			"tief",
			"deep / deeply"
		]);
	});
	it("leaves code, math, and letterless halves whole", () => {
		expect(splitGlossHalves("a == b")).toBe(null);
		expect(splitGlossHalves("a => b")).toBe(null);
		expect(splitGlossHalves("x = 2")).toBe(null);
		expect(splitGlossHalves("no equals here")).toBe(null);
	});
	it("reads gloss halves in different voices, same-voice lines whole", () => {
		const halves = (s: string): string =>
			s === "miteinander" ? "de-DE" : "en-US";
		expect(splitSpeechSegments("miteinander = with each other", halves)).toEqual(
			[
				{ text: "miteinander", lang: "de-DE" },
				{ text: "with each other", lang: "en-US" }
			]
		);
		expect(splitSpeechSegments("miteinander = with each other", () => "de-DE")).toEqual(
			[{ text: "miteinander = with each other", lang: "de-DE" }]
		);
	});
});

describe("webVoiceAvailable", () => {
	const VOICES = [{ lang: "en-US" }, { lang: "fr-FR" }, { lang: "ja-JP" }];
	it("matches the two-letter prefix case-insensitively", () => {
		expect(webVoiceAvailable("en-US", VOICES)).toBe(true);
		expect(webVoiceAvailable("en-GB", VOICES)).toBe(true);
		expect(webVoiceAvailable("fr-CA", VOICES)).toBe(true);
		expect(webVoiceAvailable("la", VOICES)).toBe(false);
		expect(webVoiceAvailable("de-DE", VOICES)).toBe(false);
	});
	it("treats an unloaded inventory as available, blank as not", () => {
		expect(webVoiceAvailable("la", [])).toBe(true);
		expect(webVoiceAvailable("", VOICES)).toBe(false);
	});
});

describe("effectiveSpeechLang", () => {
	const VOICES = [
		{ lang: "en-US" },
		{ lang: "it-IT" },
		{ lang: "hi-IN" },
		{ lang: "ja-JP" }
	];
	it("keeps the request when a voice exists", () => {
		expect(effectiveSpeechLang("en-US", VOICES)).toBe("en-US");
		expect(effectiveSpeechLang("ja-JP", VOICES)).toBe("ja-JP");
	});
	it("stands Latin in for Italian and Sanskrit for Hindi", () => {
		expect(effectiveSpeechLang("la", VOICES)).toBe("it-IT");
		expect(effectiveSpeechLang("sa", VOICES)).toBe("hi-IN");
	});
	it("leaves truly voiceless requests to the error path", () => {
		expect(effectiveSpeechLang("de-DE", VOICES)).toBe("de-DE");
	});
	it("never routes on an unloaded inventory", () => {
		expect(effectiveSpeechLang("la", [])).toBe("la");
	});
});

describe("friendlyMicError", () => {
	it("translates the network code instead of leaking it", () => {
		expect(friendlyMicError("network")).toMatch(/transcription service/i);
	});
	it("keeps the existing mappings", () => {
		expect(friendlyMicError("not-allowed")).toMatch(/permission/i);
		expect(friendlyMicError("no-speech")).toMatch(/didn't catch/i);
		expect(friendlyMicError("audio-capture")).toMatch(/no microphone/i);
		expect(friendlyMicError("service-not-allowed")).toMatch(/Chrome/i);
	});
	it("passes unknown messages through", () => {
		expect(friendlyMicError("weird-code")).toBe("weird-code");
	});
	it("names offline distinctly from unreachable", () => {
		Object.defineProperty(window.navigator, "onLine", {
			value: false,
			configurable: true
		});
		try {
			expect(friendlyMicError("network")).toMatch(/offline/i);
		} finally {
			// Remove the own override so the prototype getter shines through again.
			delete (window.navigator as unknown as Record<string, unknown>).onLine;
		}
		expect(friendlyMicError("network")).toMatch(/transcription service/i);
	});
});

describe("latinFallback", () => {
	it("pins the voice language, else US English", () => {
		expect(latinFallback("fr-FR ")).toBe("fr-FR");
		expect(latinFallback("")).toBe("en-US");
		expect(latinFallback(null)).toBe("en-US");
		expect(latinFallback(undefined)).toBe("en-US");
	});
});

describe("messageSpeechLang", () => {
	const VOICES = [{ lang: "en-US" }, { lang: "ja-JP" }];
	it("routes whole replies through the fallback and the stand-in map", () => {
		expect(messageSpeechLang("Hello world", "en-US", VOICES)).toBe("en-US");
		expect(messageSpeechLang("こんにちは。", "en-US", VOICES)).toBe("ja-JP");
		expect(messageSpeechLang("Hello world", "de-DE", VOICES)).toBe("de-DE");
		// Unloaded inventories pass everything through, never guess.
		expect(messageSpeechLang("こんにちは。", "en-US", [])).toBe("ja-JP");
	});
});

describe("speechAttemptable", () => {
	const VOICES = [{ lang: "en-US" }];
	it("gates the web engine on inventory, never native or unloaded lists", () => {
		expect(speechAttemptable("native", "xx-YY", VOICES)).toBe(true);
		expect(speechAttemptable("web", "en-US", VOICES)).toBe(true);
		expect(speechAttemptable("web", "fr-FR", VOICES)).toBe(false);
		expect(speechAttemptable("web", "fr-FR", [])).toBe(true);
	});
});

describe("speechLangsFor", () => {
	it("resolves each sentence once and caches the answer", () => {
		const VOICES = [{ lang: "en-US" }, { lang: "ja-JP" }];
		const langFor = speechLangsFor("en-US", VOICES);
		expect(langFor("Hello world.")).toBe("en-US");
		expect(langFor("Hello world.")).toBe("en-US");
		expect(langFor("こんにちは。")).toBe("ja-JP");
	});

	it("reads Latin with the Italian stand-in when no Latin voice exists", () => {
		const langFor = speechLangsFor("la", [{ lang: "it-IT" }]);
		expect(langFor("Hello world.")).toBe("it-IT");
	});
});

describe("startSpeechError", () => {
	it("banners start failures, naming the fault", () => {
		expect(
			startSpeechError({ quiet: false, useNative: false, inventoryEmpty: true })
		).toBe("No voices on this device — check its text-to-speech settings.");
		expect(
			startSpeechError({
				quiet: false,
				useNative: false,
				inventoryEmpty: false
			})
		).toBe("Voice not available.");
		expect(
			startSpeechError({ quiet: false, useNative: true, inventoryEmpty: true })
		).toBe("Voice not available.");
	});

	it("keeps quiet background readbacks silent", () => {
		expect(
			startSpeechError({ quiet: true, useNative: false, inventoryEmpty: true })
		).toBe(null);
		expect(
			startSpeechError({ quiet: true, useNative: true, inventoryEmpty: false })
		).toBe(null);
	});
});

describe("message row voice state", () => {
	it("gates speak buttons on attemptability", () => {
		const voices = [{ lang: "en-US" }, { lang: "fr-FR" }];
		expect(messageSpeakableFor("web", "hello", "en-US", voices)).toBe(true);
		// An unloaded inventory never disables; a loaded one without
		// the locale does.
		expect(messageSpeakableFor("web", "hello", "en-US", [])).toBe(true);
		expect(messageSpeakableFor("web", "hello", "en-US", [{ lang: "ja-JP" }])).toBe(
			false
		);
		expect(messageSpeakableFor("native", "hello", "en-US", [])).toBe(true);
	});

	it("attributes the live utterance to replies and quote picks", () => {
		expect(isMessageSpeaking("m1", "m1", null)).toBe(true);
		expect(isMessageSpeaking("m1", null, "m1")).toBe(true);
		expect(isMessageSpeaking("m1", "m2", null)).toBe(false);
		expect(isMessageSpeaking("m1", null, null)).toBe(false);
	});

	it("labels the speak button stop while speaking", () => {
		expect(speakTitleFor(true)).toBe("Stop reading aloud");
		expect(speakTitleFor(false)).toBe("Read this message aloud");
	});
});

describe("dictation text", () => {
	it("spaces appended transcripts onto drafts", () => {
		expect(appendDictation("", "hi")).toBe("hi");
		expect(appendDictation("go ", "hi")).toBe("go hi");
		expect(appendDictation("go", "hi")).toBe("go hi");
	});

	it("trails inserts with one space", () => {
		expect(dictationInsert("hi")).toBe("hi ");
		expect(dictationInsert("hi ")).toBe("hi ");
	});

	it("blames shell vs browser for missing mics", () => {
		expect(micUnavailableMessage(true)).toBe("Mic input is not available.");
		expect(micUnavailableMessage(false)).toBe(
			"Mic input not available in this browser."
		);
	});
});
