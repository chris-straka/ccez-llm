import { describe, expect, it } from "vitest";
import {
	decomposeChar,
	decomposeText,
	decomposeTree,
	getInspectData,
	inspectLangFor,
	isHanChar,
	isSingleHanChar,
	onKunLine,
	parseKangxi,
	shouldShowInspect
} from "./inspect";
import { extractStrokePaths, kanjiSvgUrl } from "./kanjivg";
import { defaultSettings, loadSettings, saveSettings, memoryStore } from "./settings";

describe("isSingleHanChar", () => {
	it("accepts exactly one Han character", () => {
		expect(isSingleHanChar("語")).toBe(true);
		expect(isSingleHanChar(" 漢 ")).toBe(true);
	});

	it("rejects multi-char, kana, latin, and empty highlights", () => {
		expect(isSingleHanChar("漢字")).toBe(false);
		expect(isSingleHanChar("あ")).toBe(false);
		expect(isSingleHanChar("ア")).toBe(false);
		expect(isSingleHanChar("a")).toBe(false);
		expect(isSingleHanChar("")).toBe(false);
		expect(isSingleHanChar("  ")).toBe(false);
		expect(isSingleHanChar("語学")).toBe(false);
	});

	it("rejects multi-char highlights padded with whitespace or punctuation", () => {
		expect(isSingleHanChar("漢字 ")).toBe(false);
		expect(isSingleHanChar("\n好\n坏\n")).toBe(false);
		expect(isSingleHanChar("好!")).toBe(false);
		expect(isSingleHanChar("好，好")).toBe(false);
	});
});

describe("inspectLangFor", () => {
	it("guesses Japanese from kana in the picked paragraph", () => {
		expect(inspectLangFor("字", "漢字のテスト")).toBe("ja");
		expect(inspectLangFor("語", "日本語を勉強します")).toBe("ja");
	});

	it("defaults to Chinese for kana-free paragraphs", () => {
		expect(inspectLangFor("字", "汉字测试")).toBe("zh");
		expect(inspectLangFor("語", "学习中文")).toBe("zh");
	});

	it("falls back to the quote when the paragraph is empty", () => {
		expect(inspectLangFor("字", "")).toBe("zh");
		expect(inspectLangFor("字", "   ")).toBe("zh");
	});
});

describe("shouldShowInspect", () => {
	it("requires the setting AND a single Han character", () => {
		expect(shouldShowInspect("語", true)).toBe(true);
		expect(shouldShowInspect("語", false)).toBe(false);
	});

	it("never shows for multi-char or non-CJK highlights", () => {
		expect(shouldShowInspect("漢字", true)).toBe(false);
		expect(shouldShowInspect("テスト", true)).toBe(false);
		expect(shouldShowInspect("hello", true)).toBe(false);
		expect(shouldShowInspect("", true)).toBe(false);
		expect(shouldShowInspect("あ", true)).toBe(false);
	});

	it("never shows anywhere when the setting is off", () => {
		expect(shouldShowInspect("語", false)).toBe(false);
		expect(shouldShowInspect("漢", false)).toBe(false);
	});
});

describe("getInspectData", () => {
	it("returns radicals, stroke count, radical, and definition offline", () => {
		expect(getInspectData("語")).toEqual({
			char: "語",
			components: ["言", "吾"],
			strokeCount: 14,
			radical: "言",
			radicalRest: 7,
			definition: "language, words; saying, expression",
			mandarin: "yǔ",
			japaneseOn: "GO GYO",
			japaneseKun: "KATARU KOTOBA TSUGERU",
			hasStrokePaths: false
		});
		// mdbg ground truth: 通 is 10 strokes, radical 162 (辶) + 7.
		expect(getInspectData("通")).toMatchObject({
			strokeCount: 10,
			radical: "辶",
			radicalRest: 7
		});
		expect(getInspectData("好")).toMatchObject({
			components: ["女", "子"],
			strokeCount: 6
		});
	});

	it("trims the input before lookup", () => {
		expect(getInspectData(" 漢 ").char).toBe("漢");
		// Unihan kTotalStrokes counts 14 (Kangxi/traditional convention;
		// Japanese shinjitai counts 13 — data wins by decision).
		expect(getInspectData(" 漢 ").strokeCount).toBe(14);
	});

	it("falls back honestly outside the subset table", () => {
		// 鬰 (U+9B30) is Han with Unihan coverage but no subset split:
		// components stay empty while everything else enriches.
		const out = getInspectData("鬰");
		expect(out).toEqual({
			char: "鬰",
			components: [],
			strokeCount: 27,
			radical: "鬯",
			radicalRest: 17,
			definition: "luxuriant; dense, thick; moody",
			mandarin: "yù",
			japaneseOn: "UTSU",
			japaneseKun: "SHIGERU MURAGARI",
			hasStrokePaths: false
		});
	});

	it("uses Unihan definitions with no curated override", () => {
		expect(getInspectData("語").definition).toBe("language, words; saying, expression");
	});

	it("reports null readings for characters outside Unihan coverage", () => {
		expect(getInspectData("あ")).toMatchObject({
			definition: null,
			mandarin: null,
			japaneseOn: null,
			japaneseKun: null
		});
	});

	it("reports no bundled stroke paths (KanjiVG follow-up)", () => {
		expect(getInspectData("語").hasStrokePaths).toBe(false);
	});
});

describe("inspect setting", () => {
	it("defaults on (fresh installs inspect single han highlights)", () => {
		expect(defaultSettings().inspectEnabled).toBe(true);
	});

	it("backfills true on older saves, keeps an explicit off", () => {
		const blank = defaultSettings();
		blank.providers["deepseek"]!.apiKey = "";
		blank.providers["muse"]!.apiKey = "";
		delete (blank as unknown as Record<string, unknown>).inspectEnabled;
		saveSettings(blank, memoryStore);
		expect(loadSettings(memoryStore).inspectEnabled).toBe(true);

		const off = defaultSettings();
		off.providers["deepseek"]!.apiKey = "";
		off.providers["muse"]!.apiKey = "";
		off.inspectEnabled = false;
		saveSettings(off, memoryStore);
		expect(loadSettings(memoryStore).inspectEnabled).toBe(false);

		const junk = defaultSettings();
		junk.providers["deepseek"]!.apiKey = "";
		junk.providers["muse"]!.apiKey = "";
		(junk as unknown as Record<string, unknown>).inspectEnabled = "yes";
		saveSettings(junk, memoryStore);
		expect(loadSettings(memoryStore).inspectEnabled).toBe(true);
	});
});

describe("isHanChar", () => {
	it("accepts CJK unified characters", () => {
		expect(isHanChar("漢")).toBe(true);
		expect(isHanChar("語")).toBe(true);
	});

	it("rejects kana, latin, and multi-char strings", () => {
		expect(isHanChar("あ")).toBe(false);
		expect(isHanChar("ア")).toBe(false);
		expect(isHanChar("a")).toBe(false);
		expect(isHanChar("漢字")).toBe(false);
		expect(isHanChar("")).toBe(false);
	});
});

describe("decomposeChar", () => {
	it("splits common characters into components", () => {
		expect(decomposeChar("好")).toEqual({ char: "好", components: ["女", "子"] });
		expect(decomposeChar("語")).toEqual({ char: "語", components: ["言", "吾"] });
		// No hand table anymore: 漢 comes from the vendored subset
		// (finer grain than the old hand split 氵+堇).
		expect(decomposeChar("漢")).toEqual({ char: "漢", components: ["氵", "廿", "中", "夫"] });
	});

	it("returns null for unknown or non-Han input", () => {
		// 㐀 is Han but in neither the hand table nor the data subset.
		expect(decomposeChar("㐀")).toBeNull();
		expect(decomposeChar("あ")).toBeNull();
	});
});

describe("decomposeText", () => {
	it("dedupes Han characters in order and skips kana", () => {
		const out = decomposeText("今日は語学");
		expect(out.map((e) => e.char)).toEqual(["今", "日", "語", "学"]);
		expect(out.find((e) => e.char === "語")?.components).toEqual(["言", "吾"]);
	});

	it("marks unknown Han characters with empty components", () => {
		const out = decomposeText("㐀");
		expect(out).toEqual([{ char: "㐀", components: [] }]);
	});

	it("returns nothing for text without Han characters", () => {
		expect(decomposeText("hello ひらがな")).toEqual([]);
	});
});

describe("vendored subset splits", () => {
	it("covers common characters from data", () => {
		// 館 resolves from the subset (variants normalized at
		// build time: 飠→食).
		expect(decomposeChar("館")).toEqual({ char: "館", components: ["食", "官"] });
		// 鬱 used to be the honest-null example; the subset covers it now.
		expect(decomposeChar("鬱")).toEqual({
			char: "鬱",
			components: ["林", "缶", "冖", "鬯", "彡"]
		});
	});

	it("uses the vendored data everywhere, Mainland forms included", () => {
		// No hand overrides left: 電 resolves to the subset's Mainland
		// form (雨+电, not the old hand split 日乚土).
		expect(decomposeChar("電")).toEqual({ char: "電", components: ["雨", "电"] });
		expect(decomposeChar("好")).toEqual({ char: "好", components: ["女", "子"] });
	});
});

describe("parseKangxi", () => {
	it("resolves radical numbers cross-checked against Unihan values", () => {
		// Each pair below is an independent Unihan kRSUnicode reading
		// (語 149.7, 通 162.7, 好 38.3, 明 72.4, 漢 85.11, 館 184.8):
		// a transcription slip in the 214-char string fails loudly.
		expect(parseKangxi("149.7")).toEqual({ radical: "言", rest: 7 });
		expect(parseKangxi("162.7")).toEqual({ radical: "辶", rest: 7 });
		expect(parseKangxi("38.3")).toEqual({ radical: "女", rest: 3 });
		expect(parseKangxi("72.4")).toEqual({ radical: "日", rest: 4 });
		expect(parseKangxi("85.11")).toEqual({ radical: "水", rest: 11 });
		expect(parseKangxi("184.8")).toEqual({ radical: "食", rest: 8 });
	});

	it("rejects missing and malformed values", () => {
		expect(parseKangxi(undefined)).toBeNull();
		expect(parseKangxi("149")).toBeNull();
		expect(parseKangxi("x.7")).toBeNull();
		expect(parseKangxi("999.1")).toBeNull();
	});
});

describe("decomposeTree", () => {
	it("nests two levels and stops at leaves", () => {
		const tree = decomposeTree("通");
		expect(tree.char).toBe("通");
		expect(tree.children.length).toBeGreaterThanOrEqual(2);
		for (const child of tree.children) {
			expect(child.char.length).toBeGreaterThan(0);
			for (const grand of child.children) expect(grand.children).toEqual([]);
		}
	});
	it("returns a leaf for unknown characters", () => {
		expect(decomposeTree("�")).toEqual({ char: "�", children: [] });
	});
	it("depth 1 never nests", () => {
		const tree = decomposeTree("通", 1);
		for (const child of tree.children) expect(child.children).toEqual([]);
	});
});

describe("onKunLine", () => {
	it("lowercases and comma-joins both sides on one line", () => {
		expect(onKunLine({ japaneseOn: "ICHI ITSU", japaneseKun: "HITOTSU HAJIME" })).toBe(
			"On/Kun: ichi,itsu | hitotsu,hajime"
		);
	});
	it("omits a missing side without a dangling separator", () => {
		expect(onKunLine({ japaneseOn: "ICHI", japaneseKun: null })).toBe("On/Kun: ichi");
		expect(onKunLine({ japaneseOn: null, japaneseKun: null })).toBeNull();
	});
});

describe("kanjivg", () => {
	it("addresses files by 5-digit lowercase hex codepoint", () => {
		expect(kanjiSvgUrl("一")).toBe(
			"https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/04e00.svg"
		);
		expect(kanjiSvgUrl("往")).toContain("/05f80.svg");
	});
	it("extracts stroke paths in -sN order", () => {
		const svg =
			`<svg><g id="kvg:123"><path id="kvg:123-s2" d="M20 0C30 0 40 0"/><path id="kvg:123-s1" d="M10 0C10 10 10 20"/>` +
			`<path id="kvg:123-g1" d="M0 0h5"/></g></svg>`;
		expect(extractStrokePaths(svg)).toEqual(["M10 0C10 10 10 20", "M20 0C30 0 40 0"]);
	});
	it("returns null when no stroke paths exist", () => {
		expect(extractStrokePaths("<svg><g></g></svg>")).toBeNull();
	});
});
