import { describe, expect, it } from "vitest";
import { hanjaReading, isKoreanText, quoteReadingLang } from "./hanja";

describe("hanjaReading", () => {
	it("reads hanja in Korean, Japanese forms through their old forms", () => {
		expect(hanjaReading("接尾辭")).toBe("접미사");
		expect(hanjaReading("接尾辞")).toBe("접미사");
		expect(hanjaReading("漢字")).toBe("한자");
		expect(hanjaReading("學校")).toBe("학교");
	});

	it("passes other characters through", () => {
		expect(hanjaReading("接尾辭는")).toBe("접미사는");
	});

	it("gives a word-initial hanja its initial form", () => {
		expect(hanjaReading("露出")).toBe("노출");
		expect(hanjaReading("白露")).toBe("백로");
		expect(hanjaReading("李")).toBe("이");
	});

	it("is null with no readable hanja", () => {
		expect(hanjaReading("들")).toBeNull();
		expect(hanjaReading("")).toBeNull();
	});
});

describe("isKoreanText", () => {
	it("weighs Hangul against Han", () => {
		expect(isKoreanText("한국어에서는 접미사(接尾辭) 들을 씁니다.")).toBe(true);
		expect(isKoreanText("韩语的复数后缀是들。")).toBe(false);
		expect(isKoreanText("plain English")).toBe(false);
	});
});

describe("quoteReadingLang", () => {
	const korean = "한국어의 복수 접미사 들은 接尾辞 로 쓰기도 합니다.";
	const chinese = "韩语的复数后缀是들，日语用接尾辞。";
	const japanese = "日本語では接尾辞の「たち」を使います。";

	it("reads a Han-only word in Korean text as hanja", () => {
		expect(quoteReadingLang("接尾辞", korean, korean, true)).toBe("ko");
	});

	it("keeps pinyin in Chinese text and furigana in Japanese", () => {
		expect(quoteReadingLang("接尾辞", chinese, chinese, true)).toBe("zh");
		expect(quoteReadingLang("接尾辞", japanese, japanese, true)).toBe("ja");
	});

	it("falls back to the paragraph when the sentence has no Hangul", () => {
		expect(quoteReadingLang("接尾辞", "接尾辞.", korean, true)).toBe("ko");
		expect(quoteReadingLang("接尾辞", "接尾辞.", chinese, true)).toBe("zh");
	});

	it("reads Hangul as Korean and leaves other text alone", () => {
		expect(quoteReadingLang("들", korean, korean, false)).toBe("ko");
		expect(quoteReadingLang("plural", korean, korean, true)).toBeNull();
		expect(quoteReadingLang("接尾辞", chinese, chinese, false)).toBeNull();
	});
});
