import { describe, it, expect } from "vitest";
import { toHiragana } from "wanakana";
import {
	rubyHtmlForTokens,
	rubyHtmlForText,
	type RubyToken
} from "./furiganaRuby";

const ruby = (tokens: RubyToken[]): string =>
	rubyHtmlForTokens(tokens, toHiragana);
const aligned = (text: string, tokens: RubyToken[]): string =>
	rubyHtmlForText(text, tokens, toHiragana);

/**
 * Kuroshiro's tokenization (captured from kuroshiro 1.2.0 + kuromoji
 * before the lindera swap), rendered as positioned spans instead of
 * kuroshiro's native ruby (see furiganaRuby: same segmentation and
 * reading splits, zero layout footprint). Token streams mirror the
 * analyzer's segmentation; the builder must reproduce the HTML verbatim.
 */
describe("rubyHtmlForTokens", () => {
	it("matches kuroshiro on 漢字を読む", () => {
		expect(
			ruby([
				{ surface: "漢字", reading: "カンジ" },
				{ surface: "を", reading: "ヲ" },
				{ surface: "読", reading: "ヨ" },
				{ surface: "む", reading: "ム" }
			])
		).toBe(
			'<span class="frb">漢字<span class="frt">かんじ</span></span>を<span class="frb">読<span class="frt">よ</span></span>む'
		);
	});

	it("matches kuroshiro on 感じ取れたら手を繋ごう", () => {
		expect(
			ruby([
				{ surface: "感じ", reading: "カンジ" },
				{ surface: "取れ", reading: "トレ" },
				{ surface: "たら", reading: "タラ" },
				{ surface: "手", reading: "テ" },
				{ surface: "を", reading: "ヲ" },
				{ surface: "繋ご", reading: "ツナゴ" },
				{ surface: "う", reading: "ウ" }
			])
		).toBe(
			'<span class="frb">感<span class="frt">かん</span></span>じ<span class="frb">取<span class="frt">と</span></span>れたら<span class="frb">手<span class="frt">て</span></span>を<span class="frb">繋<span class="frt">つな</span></span>ごう'
		);
	});

	it("matches kuroshiro on 美しい花が咲いている", () => {
		expect(
			ruby([
				{ surface: "美し", reading: "ウツクシ" },
				{ surface: "い", reading: "イ" },
				{ surface: "花", reading: "ハナ" },
				{ surface: "が", reading: "ガ" },
				{ surface: "咲い", reading: "サイ" },
				{ surface: "ている", reading: "テイル" }
			])
		).toBe(
			'<span class="frb">美<span class="frt">うつく</span></span>しい<span class="frb">花<span class="frt">はな</span></span>が<span class="frb">咲<span class="frt">さ</span></span>いている'
		);
	});

	it("matches kuroshiro on 株式会社の田中さんにお会いしました", () => {
		expect(
			ruby([
				{ surface: "株式会社", reading: "カブシキガイシャ" },
				{ surface: "の", reading: "ノ" },
				{ surface: "田中", reading: "タナカ" },
				{ surface: "さんに", reading: "サンニ" },
				{ surface: "お", reading: "オ" },
				{ surface: "会", reading: "ア" },
				{ surface: "いしました", reading: "イシマシタ" }
			])
		).toBe(
			'<span class="frb">株式会社<span class="frt">かぶしきがいしゃ</span></span>の<span class="frb">田中<span class="frt">たなか</span></span>さんにお<span class="frb">会<span class="frt">あ</span></span>いしました'
		);
	});

	it("splits coarse tokens on interior kana", () => {
		// Lindera segments 感じ取れ as one token where kuromoji gave
		// 感じ|取れ: the interior じ must still pin the split.
		expect(ruby([{ surface: "感じ取れ", reading: "カンジトレ" }])).toBe(
			'<span class="frb">感<span class="frt">かん</span></span>じ<span class="frb">取<span class="frt">と</span></span>れ'
		);
	});

	it("passes through when an anchor is missing from the reading", () => {
		expect(ruby([{ surface: "取れ", reading: "トク" }])).toBe("取れ");
	});

	it("keeps 々 inside the kanji run", () => {
		expect(ruby([{ surface: "様々", reading: "サマザマ" }])).toBe(
			'<span class="frb">様々<span class="frt">さまざま</span></span>'
		);
	});

	it("passes through kana, romaji, numbers, and unknown readings", () => {
		expect(ruby([{ surface: "これはひらがなだけです", reading: "*" }])).toBe(
			"これはひらがなだけです"
		);
		expect(ruby([{ surface: "mixedカタカナWord123", reading: "*" }])).toBe(
			"mixedカタカナWord123"
		);
		expect(ruby([{ surface: "漢字", reading: null }])).toBe("漢字");
		expect(ruby([{ surface: "", reading: "ア" }])).toBe("");
	});

	it("passes through when the alignment explains nothing", () => {
		// Reading fully consumed by leading okurigana: no ruby, not a
		// wrong one.
		expect(ruby([{ surface: "あ亜", reading: "ア" }])).toBe("あ亜");
	});
});

describe("rubyHtmlForText", () => {
	it("keeps spaces the tokenizer dropped", () => {
		// Lindera emits no whitespace tokens: aligning back to the
		// source is what keeps "Here are three" from becoming one word.
		expect(
			aligned("Here are three", [
				{ surface: "Here", reading: "*" },
				{ surface: "are", reading: "*" },
				{ surface: "three", reading: "*" }
			])
		).toBe("Here are three");
	});

	it("annotates kanji runs while keeping surrounding spaces", () => {
		expect(
			aligned("Hello 漢字 today", [
				{ surface: "Hello", reading: "*" },
				{ surface: "漢字", reading: "カンジ" },
				{ surface: "today", reading: "*" }
			])
		).toBe(
			'Hello <span class="frb">漢字<span class="frt">かんじ</span></span> today'
		);
	});

	it("passes through gaps the tokenizer skipped", () => {
		// Unknown/skipped punctuation between matches is content, not
		// a token boundary: it stays verbatim.
		expect(aligned("あ※い", [{ surface: "あ", reading: "*" }])).toBe("あ※い");
	});

	it("renders tokens that match nowhere instead of dropping them", () => {
		expect(aligned("漢字", [{ surface: "漢字", reading: "カンジ" }])).toContain(
			"かんじ"
		);
		expect(
			aligned("abc", [
				{ surface: "abc", reading: "*" },
				{ surface: "zzz-normalized-away", reading: "*" }
			])
		).toBe("abczzz-normalized-away");
	});
});
