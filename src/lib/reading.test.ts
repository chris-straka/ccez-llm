// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
	detectScript,
	detectScripts,
	classifyAidLine,
	hasAmbiguousAidLine,
	hanOverlayLangFor,
	isHanOverlayLangUncertain,
	HAN_OVERLAY_LANG_TAG,
	preferredLocalAid,
	extractWordAt,
	sentenceBounds,
	aidDisplayText,
	offeredLocalAids,
	hasPinyinTones,
	ttsLangFor,
	scriptRunKey,
	speakWord,
	vocalizeArabic,
	buildVocalizeMessages,
	buildAidMessages,
	runModelAid,
	MODEL_AIDS,
	MODEL_AID_FOR_SCRIPT,
	localAidFor,
	localAidsFor,
	LOCAL_AID_BUTTON,
	LOCAL_AID_SHOW_ORIGINAL,
	LOCAL_AID_ADD_TITLE,
	aidTargetLines,
	spliceAidResult,
	resolveAidKinds,
	codeAwareLines,
	stripCodeForDetection,
	readingsOnly
} from "./reading";
import { pinyinBlock, pinyinRuby } from "./pinyin";
import { isFuriganaCached } from "./furigana";
import type { ChatProvider } from "./providers/types";

describe("script detection", () => {
	it("detects Arabic, Japanese, Chinese, and nothing", () => {
		expect(detectScript("مرحبا بالعالم")).toBe("ar");
		expect(detectScript("漢字を読む")).toBe("ja");
		expect(detectScript("你好世界")).toBe("zh");
		expect(detectScript("hello world")).toBeNull();
		// Kana wins over shared Han characters.
		expect(detectScript("カタカナと漢字")).toBe("ja");
		// Arabic wins over anything mixed in.
		expect(detectScript("hello مرحبا")).toBe("ar");
	});

	it("reports every aid script present, in priority order", () => {
		expect(detectScripts("hello world")).toEqual([]);
		expect(detectScripts("你好世界")).toEqual(["zh"]);
		// Kanji share lines with kana: pure Japanese stays Japanese-only.
		expect(detectScripts("漢字を読む")).toEqual(["ja"]);
		// A Han-only line beside kana lines: both scripts present.
		expect(detectScripts("こんにちは！\n你好！")).toEqual(["ja", "zh"]);
		// Same-line mixing falls back to Japanese-only (as before).
		expect(detectScripts("こんにちは！你好！")).toEqual(["ja"]);
		expect(detectScripts("hello مرحبا\n你好")).toEqual(["ar", "zh"]);
		// Mixed messages offer both local aids, furigana first.
		expect(localAidsFor(detectScripts("こんにちは！\n你好！"))).toEqual(["furigana", "pinyin"]);
		expect(localAidsFor(detectScripts("你好世界"))).toEqual(["pinyin"]);
		expect(localAidsFor(detectScripts("漢字を読む"))).toEqual(["furigana"]);
		expect(localAidsFor(detectScripts("hello world"))).toEqual([]);
		expect(localAidsFor(detectScripts("مرحبا بالعالم"))).toEqual([]);
	});

	it("classifies rendered lines to their owning aid", () => {
		expect(classifyAidLine("こんにちは！テストです。")).toBe("furigana");
		expect(classifyAidLine("漢字を読む")).toBe("furigana");
		expect(classifyAidLine("你好！测试。")).toBe("pinyin");
		expect(classifyAidLine("Hello world")).toBeNull();
		expect(classifyAidLine("")).toBeNull();
		// Same-line mixing reads as Japanese (kana wins, as in detection).
		expect(classifyAidLine("テストtest测试")).toBe("furigana");
	});

	it("lets the chat language own kanji-only lines", () => {
		// A kanji-only line is genuinely ambiguous — same script in
		// both languages — so the reply-language pill breaks the tie.
		expect(classifyAidLine("「警察官、交通規則違反者検挙中」", "furigana")).toBe("furigana");
		expect(classifyAidLine("「警察官、交通規則違反者検挙中」", "pinyin")).toBe("pinyin");
		expect(classifyAidLine("「警察官、交通規則違反者検挙中」")).toBe("pinyin");
		expect(classifyAidLine("你好！测试。", "furigana")).toBe("furigana");
		// Kana is unambiguous: the pill never overrides it.
		expect(classifyAidLine("漢字を読む", "pinyin")).toBe("furigana");
		expect(classifyAidLine("Hello world", "furigana")).toBeNull();
	});

	it("spots messages with kanji-only lines", () => {
		expect(hasAmbiguousAidLine("「警察官、交通規則違反者検挙中」")).toBe(true);
		expect(hasAmbiguousAidLine("こんにちは！\n交通規則")).toBe(true);
		expect(hasAmbiguousAidLine("漢字を読む")).toBe(false);
		expect(hasAmbiguousAidLine("Hello world")).toBe(false);
	});

	it("predicts the components-overlay language like ttsLangFor", () => {
		// Kana present = Japanese, else Chinese default.
		expect(hanOverlayLangFor("漢字を読む")).toBe("ja");
		expect(hanOverlayLangFor("テストtest测试")).toBe("ja");
		expect(hanOverlayLangFor("你好世界")).toBe("zh");
		expect(hanOverlayLangFor("「警察官、交通規則違反者検挙中」")).toBe("zh");
		expect(hanOverlayLangFor("hello")).toBe("zh");
		// Same locale tags the speech path uses.
		expect(HAN_OVERLAY_LANG_TAG[hanOverlayLangFor("漢字を読む")]).toBe("ja-JP");
		expect(HAN_OVERLAY_LANG_TAG[hanOverlayLangFor("你好世界")]).toBe("zh-CN");
		expect(HAN_OVERLAY_LANG_TAG[hanOverlayLangFor("漢字を読む")]).toBe(
			ttsLangFor("読む", "en-US")
		);
	});

	it("marks Han-only text as an uncertain guess", () => {
		expect(isHanOverlayLangUncertain("漢字")).toBe(true);
		expect(isHanOverlayLangUncertain("你好世界")).toBe(true);
		expect(isHanOverlayLangUncertain("漢字を読む")).toBe(false);
		expect(isHanOverlayLangUncertain("hello")).toBe(false);
		expect(isHanOverlayLangUncertain("ひらがな")).toBe(false);
	});

	it("maps reply-language pills to their local aid", () => {
		expect(preferredLocalAid("ja")).toBe("furigana");
		expect(preferredLocalAid("zh")).toBe("pinyin");
		expect(preferredLocalAid("yue")).toBe("pinyin");
		expect(preferredLocalAid("fr")).toBeNull();
		expect(preferredLocalAid(null)).toBeNull();
	});
});

describe("word extraction", () => {
	it("expands to the full word and stops at punctuation", () => {
		expect(extractWordAt("hello world", 1)).toBe("hello");
		expect(extractWordAt("hello, world", 5)).toBe("");
		expect(extractWordAt("你好世界", 1)).toBe("你好世界");
		expect(extractWordAt("ancienne d'un", 11)).toBe("un");
		expect(extractWordAt("ancienne d'un", 9)).toBe("d");
		expect(extractWordAt("«bonjour» verstehen", 1)).toBe("bonjour");
		expect(extractWordAt("بالعالم، كيف", 3)).toBe("بالعالم");
		expect(extractWordAt("", 0)).toBe("");
		expect(extractWordAt("hi", 9)).toBe("");
	});
});

describe("aid kind overrides", () => {
	it("renders nothing without offered kinds", () => {
		expect(resolveAidKinds([], [], null)).toEqual([]);
		expect(resolveAidKinds([], ["pinyin"], "pinyin")).toEqual([]);
	});

	it("renders pinned kinds the message still offers", () => {
		expect(resolveAidKinds(["pinyin", "furigana"], ["pinyin"], null)).toEqual(["pinyin"]);
		expect(resolveAidKinds(["pinyin", "furigana"], ["pinyin", "furigana"], null)).toEqual([
			"pinyin",
			"furigana"
		]);
	});

	it("filters pinned kinds the edited text no longer offers", () => {
		expect(resolveAidKinds(["pinyin"], ["pinyin", "furigana"], null)).toEqual(["pinyin"]);
	});

	it("previews a hovered kind alongside pins, never twice", () => {
		expect(resolveAidKinds(["pinyin", "furigana"], ["pinyin"], "furigana")).toEqual([
			"pinyin",
			"furigana"
		]);
		expect(resolveAidKinds(["pinyin"], [], "pinyin")).toEqual(["pinyin"]);
		expect(resolveAidKinds(["pinyin"], ["pinyin"], "pinyin")).toEqual(["pinyin"]);
		expect(resolveAidKinds(["pinyin"], [], "furigana")).toEqual([]);
		expect(resolveAidKinds(["pinyin"], ["pinyin"], null)).toEqual(["pinyin"]);
	});
});

describe("speech locales", () => {
	it("maps scripts to voice locales", () => {
		expect(ttsLangFor("你好")).toBe("zh-CN");
		expect(ttsLangFor("読む")).toBe("ja-JP");
		expect(ttsLangFor("مرحبا")).toBe("ar-SA");
		expect(ttsLangFor("안녕하세요")).toBe("ko-KR");
		expect(ttsLangFor("спасибо")).toBe("ru-RU");
		expect(ttsLangFor("ευχαριστώ")).toBe("el-GR");
		expect(ttsLangFor("שלום")).toBe("he-IL");
		expect(ttsLangFor("สวัสดี")).toBe("th-TH");
		expect(ttsLangFor("नमस्ते")).toBe("hi-IN");
	});

	it("falls back for Latin script (French/German/English)", () => {
		expect(ttsLangFor("hello")).toBe("en-US");
		expect(ttsLangFor("bonjour", "fr-FR")).toBe("fr-FR");
		expect(ttsLangFor("verstehen", "de-DE")).toBe("de-DE");
	});

	it("keys script runs: latin, shared kana/Han, glued scriptless", () => {
		expect(scriptRunKey("a")).toBe("latin");
		expect(scriptRunKey("é")).toBe("latin");
		expect(scriptRunKey("あ")).toBe("han");
		expect(scriptRunKey("漢")).toBe("han");
		expect(scriptRunKey("한")).toBe("ko-KR");
		expect(scriptRunKey("б")).toBe("ru-RU");
		expect(scriptRunKey(" ")).toBe("other");
		expect(scriptRunKey("5")).toBe("other");
		expect(scriptRunKey("。")).toBe("other");
	});

	it("reports unavailable synthesis without throwing", () => {
		expect(speakWord("hello")).toEqual({ spoken: false, lang: "en-US" });
		expect(speakWord("bonjour", "fr-FR")).toEqual({ spoken: false, lang: "fr-FR" });
	});

	it("spots pinyin tone marks and nothing else", () => {
		// The exact misfire: Apple's recognizer reads this as Vietnamese.
		expect(hasPinyinTones("nǐ hǎo, wǒ shì xuéshēng")).toBe(true);
		expect(hasPinyinTones("lǚxíng")).toBe(true);
		expect(hasPinyinTones("NǍN")).toBe(true);
		// Vietnamese lookalikes carry other diacritics, never caron or ǖ.
		expect(hasPinyinTones("xin chào, tôi là sinh viên")).toBe(false);
		expect(hasPinyinTones("bonjour, je suis étudiant")).toBe(false);
		// Toneless pinyin is genuinely ambiguous Latin: left alone.
		expect(hasPinyinTones("ni hao, wo shi xuesheng")).toBe(false);
		expect(hasPinyinTones("")).toBe(false);
	});
});

describe("model-assisted reading aids", () => {
	it("registers tashkeel as the Arabic model aid", () => {
		expect(MODEL_AID_FOR_SCRIPT.ar).toBe("tashkeel");
		expect(MODEL_AID_FOR_SCRIPT.zh).toBeNull();
		expect(MODEL_AID_FOR_SCRIPT.ja).toBeNull();
		expect(MODEL_AIDS.tashkeel!.instruction).toContain("tashkeel");
	});

	it("builds a tashkeel-only prompt", () => {
		const messages = buildAidMessages("tashkeel", "مرحبا");
		expect(messages[0]?.content).toContain("tashkeel");
		expect(messages[1]).toEqual({ role: "user", content: "مرحبا" });
		expect(() => buildAidMessages("nope", "x")).toThrow("Unknown reading aid");
	});

	it("keeps the vocalize wrappers working", () => {
		expect(buildVocalizeMessages("مرحبا")[0]?.content).toContain("tashkeel");
	});

	it("maps scripts to their local rendering, if any", () => {
		expect(localAidFor("zh")).toBe("pinyin");
		expect(localAidFor("ja")).toBe("furigana");
		// Arabic renders identically with the toggle on or off: its aid
		// is model-applied, never locally computed.
		expect(localAidFor("ar")).toBeNull();
		expect(localAidFor(null)).toBeNull();
		expect(localAidFor(detectScript("hello world"))).toBeNull();
		expect(localAidFor(detectScript("مرحبا بالعالم"))).toBeNull();
		expect(localAidFor(detectScript("你好世界"))).toBe("pinyin");
	});

	it("gives every aid script a visible path: local rendering or a model aid", () => {
		for (const script of ["zh", "ja", "ar"] as const) {
			expect(localAidFor(script) ?? MODEL_AID_FOR_SCRIPT[script]).toBeTruthy();
		}
	});

	it("labels local-aid buttons in their own script", () => {
		expect(LOCAL_AID_BUTTON.pinyin).toBe("拼音");
		expect(LOCAL_AID_BUTTON.furigana).toBe("読み仮名");
	});

	it("labels the pinned state in the aid's own script", () => {
		expect(LOCAL_AID_SHOW_ORIGINAL.pinyin).toBe("显示原件");
		expect(LOCAL_AID_SHOW_ORIGINAL.furigana).toBe("オリジナルを表示");
	});

	it("titles the unpinned buttons in English", () => {
		expect(LOCAL_AID_ADD_TITLE.pinyin).toBe("Add pinyin");
		expect(LOCAL_AID_ADD_TITLE.furigana).toBe("Add furigana");
	});

	it("titles the tashkeel button with no model parenthetical", () => {
		expect(MODEL_AIDS.tashkeel!.title).toBe("Add tashkeel");
	});

	it("caches by aid + exact input", async () => {
		const chat = vi.fn(async () => ({ content: "مَرْحَبًا", usage: null }));
		const provider = { id: "scripted", chat, stream: chat } as unknown as ChatProvider;
		await expect(runModelAid(provider, "tashkeel", "مرحبا")).resolves.toBe("مَرْحَبًا");
		await expect(runModelAid(provider, "tashkeel", "مرحبا")).resolves.toBe("مَرْحَبًا");
		expect(chat).toHaveBeenCalledTimes(1);
		await expect(runModelAid(provider, "tashkeel", "  ")).rejects.toThrow("Nothing to vocalize");
		await expect(vocalizeArabic(provider, "مرحبا")).resolves.toBe("مَرْحَبًا");
		expect(chat).toHaveBeenCalledTimes(1);
	});
});

describe("pinyin readings", () => {
	it("annotates Han characters with tone-marked readings", () => {
		const html = pinyinRuby("汉语拼音");
		expect(html).toContain("<ruby>汉<rt>hàn</rt></ruby>");
		expect(html).toContain("<ruby>语<rt>yǔ</rt></ruby>");
	});

	it("emits native ruby with no estimated spacing", () => {
		// Spacing is the engine's job (each base fits its own
		// annotation): the markup carries no padding or hook classes.
		const html = pinyinRuby("中文");
		expect(html).toBe("<ruby>中<rt>zhōng</rt></ruby><ruby>文<rt>wén</rt></ruby>");
	});

	it("converts only Han-only lines, passing Japanese through", () => {
		// Pinyin readings on Japanese kanji are wrong readings: kana
		// lines survive escaped and unannotated, line count preserved.
		const html = pinyinBlock("你好\n漢字を読む");
		expect(html).toBe("<ruby>你<rt>nǐ</rt></ruby><ruby>好<rt>hǎo</rt></ruby>\n漢字を読む");
		expect(html.split("\n")).toHaveLength(2);
	});

	it("resolves polyphones from context and passes other text through", () => {
		const html = pinyinRuby("银行， OK!");
		expect(html).toContain("<ruby>银<rt>yín</rt></ruby>");
		expect(html).toContain("<ruby>行<rt>háng</rt></ruby>");
		expect(html).toContain("，");
		expect(html).toContain("OK!");
		expect(html).not.toContain("<rt>OK");
	});
});

describe("multilingual model aids", () => {
	it("targets only Arabic lines", () => {
		expect(aidTargetLines("日本語\nمرحبا بالعالم\nEnglish")).toEqual([1]);
		expect(aidTargetLines("مرحبا")).toEqual([0]);
		expect(aidTargetLines("日本語\nEnglish")).toEqual([]);
	});

	it("splices vocalized lines back, keeping other scripts identical", () => {
		const original = "日本語の文です\nمرحبا بالعالم\nEnglish text";
		expect(spliceAidResult(original, [1], "مَرْحَبًا بِالْعَالَم")).toBe(
			"日本語の文です\nمَرْحَبًا بِالْعَالَم\nEnglish text"
		);
	});

	it("falls back to null when the model reshapes lines", () => {
		const original = "日本語\nمرحبا\nبالعالم";
		// Two lines back for two sent: fits.
		expect(spliceAidResult(original, [1, 2], "مَرْحَبًا\nبِالْعَالَم")).toContain("日本語");
		// One line back for two sent: no safe splice.
		expect(spliceAidResult(original, [1, 2], "مَرْحَبًا بِالْعَالَم")).toBeNull();
	});
});

describe("furigana", () => {
	// Live conversion needs the Web Worker (no engine in Vitest): the
	// real end-to-end path is covered by e2e/furigana.e2e.ts, and the
	// ruby builder by furiganaRuby.test.ts.
	it("reports the conversion cache without fetching", () => {
		// Sync check: unseen text is uncached and checking starts no load.
		expect(isFuriganaCached("未見の文です 98765")).toBe(false);
		// Cache keys are exact input text, not prefixes of it — and an
		// empty cache stays empty without a worker to fill it.
		expect(isFuriganaCached("漢字を読む")).toBe(false);
	});
});

describe("code-aware aid lines", () => {
	it("tags fenced runs and their fences as code", () => {
		const tagged = codeAwareLines("見る\n```py\nprint('日本語')\n```\n読む");
		expect(tagged).toEqual([
			{ line: "見る", code: false },
			{ line: "```py", code: true },
			{ line: "print('日本語')", code: true },
			{ line: "```", code: true },
			{ line: "読む", code: false }
		]);
	});
	it("an unclosed fence owns the rest", () => {
		const tagged = codeAwareLines("見る\n```\n日本語");
		expect(tagged[2]).toEqual({ line: "日本語", code: true });
	});
	it("strips fenced blocks and inline spans for detection", () => {
		expect(stripCodeForDetection("```py\nprint('日本語')\n```")).toBe("");
		expect(stripCodeForDetection("見る `日本語` code")).toBe("見る  code");
		expect(stripCodeForDetection("見る\n```\n日本語\n```\n読む")).toBe("見る\n読む");
	});
	it("code-only Japanese summons no aid script", () => {
		expect(detectScripts(stripCodeForDetection("```py\nprint('日本語')\n```"))).toEqual([]);
		expect(detectScripts(stripCodeForDetection("見る\n```\n日本語\n```"))).toEqual(["ja"]);
	});
});

describe("aidDisplayText", () => {
	it("reads prose past baked annotation blocks", () => {
		expect(aidDisplayText("見る日本語")).toBe("見る日本語");
		// Baked blocks are metadata, not prose.
		const baked = '見る\n\nAnnotated selections:\n1. "langue" — meaning?';
		const text = aidDisplayText(baked);
		expect(text).toContain("見る");
		expect(text).not.toContain("Annotated selections");
	});
});

describe("offeredLocalAids", () => {
	it("offers every script's own aid", () => {
		expect(offeredLocalAids("漢字を読む", null)).toEqual(["furigana"]);
		expect(offeredLocalAids("你好世界", null)).toEqual(["pinyin"]);
		expect(offeredLocalAids("hello", null)).toEqual([]);
	});

	it("code never summons reading aids", () => {
		expect(offeredLocalAids("```py\nprint('日本語')\n```", null)).toEqual([]);
	});

	it("prefers the reply pill's aid for Han-only lines", () => {
		// Kanji-only lines read as Chinese without kana or a pill.
		expect(offeredLocalAids("漢字", null)).toEqual(["pinyin"]);
		expect(offeredLocalAids("漢字", "ja")).toEqual(["furigana", "pinyin"]);
		expect(offeredLocalAids("漢字", "zh")).toEqual(["pinyin"]);
		// Kana is unambiguous: no pill ever overrides it.
		expect(offeredLocalAids("漢字を読む", "zh")).toEqual(["furigana"]);
	});
});

describe("readingsOnly", () => {
	it("joins matched readings with the joiner", () => {
		const html = "<p>nihon<rt>にほん</rt>go<rt>ご</rt></p>";
		expect(readingsOnly(html, " ", "rt")).toBe("にほん ご");
		expect(readingsOnly(html, "", "rt")).toBe("にほんご");
	});
	it("supports class selectors for furigana spans", () => {
		const html = '<span class="frt">かん</span><span class="frt">じ</span>';
		expect(readingsOnly(html, "", ".frt")).toBe("かんじ");
	});
	it("returns null when nothing matches or parts are empty", () => {
		expect(readingsOnly("<p>plain</p>", "", "rt")).toBe(null);
		expect(readingsOnly("<p><rt>  </rt></p>", "", "rt")).toBe(null);
		expect(readingsOnly("", "", "rt")).toBe(null);
	});
	it("output is inert: markup in readings is escaped, never live", () => {
		// A hostile reading cannot smuggle elements into the overlay.
		const html = "<p><rt>&lt;img src=x onerror=alert(1)&gt;</rt></p>";
		const out = readingsOnly(html, "", "rt");
		expect(out).not.toBe(null);
		expect(out).not.toContain("<img");
		expect(out).toContain("&lt;img");
	});
	it("trims each reading before joining", () => {
		const html = "<p><rt>  a  </rt><rt>b</rt></p>";
		expect(readingsOnly(html, "|", "rt")).toBe("a|b");
	});
});

describe("sentenceBounds", () => {
	it("spans the sentence around the offset", () => {
		const text = "First sentence. Second here. Third.";
		const [s, e] = sentenceBounds(text, 20);
		expect(text.slice(s, e)).toBe("Second here.");
	});
	it("skips leading space after the previous mark", () => {
		expect(sentenceBounds("Hi. Bye.", 5)).toEqual([4, 8]);
	});
	it("ends CJK sentences at 。！？", () => {
		const text = "春は美しい。桜が咲く。";
		const [s, e] = sentenceBounds(text, 8);
		expect(text.slice(s, e)).toBe("桜が咲く。");
	});
	it("selects the last sentence at the very end, never empty", () => {
		expect(sentenceBounds("Hi.", 3)).toEqual([0, 3]);
		expect(sentenceBounds("One. Two.", 9)).toEqual([5, 9]);
	});
	it("returns the whole text with no marks", () => {
		expect(sentenceBounds("no marks here", 5)).toEqual([0, 13]);
	});
});
