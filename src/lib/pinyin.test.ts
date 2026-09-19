import { describe, expect, it } from "vitest";
import { pinyinBlock, pinyinRuby, plainParagraphs } from "./pinyin";

describe("pinyinRuby", () => {
	it("annotates Han characters with tone-marked readings", () => {
		expect(pinyinRuby("你好")).toBe(
			"<ruby>你<rt>nǐ</rt></ruby><ruby>好<rt>hǎo</rt></ruby>"
		);
	});

	it("never annotates Japanese segments: any kana run passes through bare", () => {
		// pinyin-pro returns Chinese readings for Japanese kanji
		// (dú for 読む's 読) — wrong readings — so the engine bails
		// on kana-bearing input no matter who calls it.
		expect(pinyinRuby("漢字を読む")).toBe("漢字を読む");
		expect(pinyinRuby("テストtest测试")).toBe("テストtest测试");
		expect(pinyinRuby("今日はとてもいい天気です")).toBe(
			"今日はとてもいい天気です"
		);
	});

	it("passes non-Han text through escaped", () => {
		expect(pinyinRuby("hello")).toBe("hello");
		expect(pinyinRuby("a & b")).toBe("a &amp; b");
		expect(pinyinRuby("")).toBe("");
	});
});

describe("pinyinBlock", () => {
	it("converts Han-only lines and leaves Japanese lines bare", () => {
		expect(pinyinBlock("漢字を読む\n你好")).toBe(
			"漢字を読む\n<ruby>你<rt>nǐ</rt></ruby><ruby>好<rt>hǎo</rt></ruby>"
		);
		// Same-line mixing reads as Japanese: kana wins, as in detection.
		expect(pinyinBlock("テストtest测试")).toBe("テストtest测试");
	});

	it("preserves line count and escapes the rest", () => {
		expect(pinyinBlock("你好\n\n世界")).toBe(
			"<ruby>你<rt>nǐ</rt></ruby><ruby>好<rt>hǎo</rt></ruby>\n\n<ruby>世<rt>shì</rt></ruby><ruby>界<rt>jiè</rt></ruby>"
		);
		expect(pinyinBlock("Hello & <world>")).toBe("Hello &amp; &lt;world&gt;");
	});

	it("lets the reply-language pill own ambiguous Han-only lines", () => {
		expect(pinyinBlock("你好", "furigana")).toBe("你好");
		expect(pinyinBlock("你好", "pinyin")).toContain("<ruby>");
		// Kana is unambiguous: the pill never overrides it.
		expect(pinyinBlock("漢字を読む", "pinyin")).toBe("漢字を読む");
	});

	it("never converts fenced code, even with CJK inside", () => {
		expect(pinyinBlock("```py\nprint('你好')\n```")).toBe(
			"```py\nprint('你好')\n```"
		);
		expect(pinyinBlock("你好\n```\n世界\n```")).toContain(
			"<ruby>你<rt>nǐ</rt></ruby>"
		);
		expect(pinyinBlock("你好\n```\n世界\n```")).toContain("世界");
		expect(pinyinBlock("你好\n```\n世界\n```")).not.toContain("<ruby>世");
	});
});

describe("plainParagraphs", () => {
	it("mirrors the markdown renderer (breaks: true)", () => {
		expect(plainParagraphs("漢字")).toBe('<p class="cjk" dir="auto">漢字</p>');
		// Soft break: one paragraph, not two.
		expect(plainParagraphs("a\nb")).toBe('<p dir="auto">a<br>b</p>');
		// Blank line: two paragraphs.
		expect(plainParagraphs("a\n\nb")).toBe(
			'<p dir="auto">a</p><p dir="auto">b</p>'
		);
	});

	it("marks only paragraphs that can carry ruby", () => {
		expect(plainParagraphs("hello\n\n漢字")).toBe(
			'<p dir="auto">hello</p><p class="cjk" dir="auto">漢字</p>'
		);
		expect(plainParagraphs("hello")).toBe('<p dir="auto">hello</p>');
	});

	it("ignores leading, trailing, and whitespace-only lines like markdown", () => {
		expect(plainParagraphs("")).toBe("");
		expect(plainParagraphs("a\n\n")).toBe('<p dir="auto">a</p>');
		expect(plainParagraphs("\na")).toBe('<p dir="auto">a</p>');
		expect(plainParagraphs("a\n   \nb")).toBe(
			'<p dir="auto">a</p><p dir="auto">b</p>'
		);
	});

	it("keeps markdown lists as lists when given the source text", () => {
		// Numbers stay markers (no literal "1."), so pinning an aid
		// never moves them.
		expect(plainParagraphs("1. 漢字\n2. 仮名", "1. 漢字\n2. 仮名")).toBe(
			'<ol><li class="cjk" dir="auto">漢字</li><li class="cjk" dir="auto">仮名</li></ol>'
		);
		expect(plainParagraphs("- a\n- b", "- a\n- b")).toBe(
			'<ul><li dir="auto">a</li><li dir="auto">b</li></ul>'
		);
		// Start numbers survive, like markdown's <ol start>.
		expect(plainParagraphs("3. a", "3. a")).toBe(
			'<ol start="3"><li dir="auto">a</li></ol>'
		);
		// A paragraph between items breaks the list, like markdown.
		expect(plainParagraphs("1. a\nx\n2. b", "1. a\nx\n2. b")).toBe(
			'<ol><li dir="auto">a</li></ol><p dir="auto">x</p><ol start="2"><li dir="auto">b</li></ol>'
		);
		// Decimals and lone markers are not lists.
		expect(plainParagraphs("3.14 の話", "3.14 の話")).toBe(
			'<p class="cjk" dir="auto">3.14 の話</p>'
		);
		expect(plainParagraphs("1.", "1.")).toBe('<p dir="auto">1.</p>');
	});

	it("keeps inline bold/italic like markdown, so aids never pin literal asterisks", () => {
		expect(plainParagraphs("**今日は**")).toBe(
			'<p class="cjk" dir="auto"><strong>今日は</strong></p>'
		);
		expect(plainParagraphs("*Kyou wa totemo*")).toBe(
			'<p dir="auto"><em>Kyou wa totemo</em></p>'
		);
		// Emphasis never reaches inside converter tags.
		expect(plainParagraphs("<ruby>漢<rt>かん</rt></ruby>**の**")).toBe(
			'<p class="cjk" dir="auto"><ruby>漢<rt>かん</rt></ruby><strong>の</strong></p>'
		);
		// Runs span converter tags: markers wrap ruby output, exactly
		// what the tokenizer leaves behind (`**` + spans + `**`).
		expect(plainParagraphs("**<ruby>漢<rt>かん</rt></ruby>む**")).toBe(
			'<p class="cjk" dir="auto"><strong><ruby>漢<rt>かん</rt></ruby>む</strong></p>'
		);
		// Math and unmatched runs pass through untouched.
		expect(plainParagraphs("2 * 3 * 4")).toBe('<p dir="auto">2 * 3 * 4</p>');
		expect(plainParagraphs("*lone")).toBe('<p dir="auto">*lone</p>');
		// Star list markers still strip instead of emphasizing.
		expect(plainParagraphs("* a\n* b", "* a\n* b")).toBe(
			'<ul><li dir="auto">a</li><li dir="auto">b</li></ul>'
		);
	});

	it("never treats converted output as lists without source text", () => {
		// Converted lines lost their marker space to the tokenizer
		// ("1.<span…"), so the marker pattern can't match them: the
		// old paragraph-only shape holds without source text.
		expect(plainParagraphs("1.a\n2.b")).toBe('<p dir="auto">1.a<br>2.b</p>');
	});
});
