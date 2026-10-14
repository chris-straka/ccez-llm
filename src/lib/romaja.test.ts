import { describe, it, expect } from "vitest";
import { hasHangul, isHangulSyllable, romajaOf } from "./romaja";

describe("romajaOf", () => {
	it("romanises plain syllables", () => {
		expect(romajaOf("서울")).toBe("seoul");
		expect(romajaOf("들")).toBe("deul");
		expect(romajaOf("안녕하세요")).toBe("annyeonghaseyo");
		expect(romajaOf("꽃")).toBe("kkot");
		expect(romajaOf("밖")).toBe("bak");
		expect(romajaOf("닭")).toBe("dak");
		expect(romajaOf("삶")).toBe("sam");
		expect(romajaOf("여덟")).toBe("yeodeol");
		expect(romajaOf("값")).toBe("gap");
	});

	it("carries a final over to a vowel", () => {
		expect(romajaOf("한국어")).toBe("hangugeo");
		expect(romajaOf("음악")).toBe("eumak");
		expect(romajaOf("없어요")).toBe("eopseoyo");
		expect(romajaOf("읽어")).toBe("ilgeo");
		expect(romajaOf("영어")).toBe("yeongeo");
	});

	it("nasalises stops before ㄴ and ㅁ", () => {
		expect(romajaOf("감사합니다")).toBe("gamsahamnida");
		expect(romajaOf("접미사")).toBe("jeommisa");
		expect(romajaOf("학년")).toBe("hangnyeon");
		expect(romajaOf("있는")).toBe("inneun");
		expect(romajaOf("십만")).toBe("simman");
	});

	it("assimilates ㄹ", () => {
		expect(romajaOf("신라")).toBe("silla");
		expect(romajaOf("설날")).toBe("seollal");
		expect(romajaOf("몰라")).toBe("molla");
		expect(romajaOf("종로")).toBe("jongno");
		expect(romajaOf("독립")).toBe("dongnip");
		expect(romajaOf("법률")).toBe("beomnyul");
		expect(romajaOf("심리")).toBe("simni");
	});

	it("handles ㅎ: dropped before vowels, aspirating stops", () => {
		expect(romajaOf("좋아요")).toBe("joayo");
		expect(romajaOf("많이")).toBe("mani");
		expect(romajaOf("싫어")).toBe("sireo");
		expect(romajaOf("좋다")).toBe("jota");
		expect(romajaOf("않다")).toBe("anta");
		expect(romajaOf("축하")).toBe("chuka");
		expect(romajaOf("입학")).toBe("ipak");
	});

	it("palatalises ㄷ/ㅌ before 이", () => {
		expect(romajaOf("같이")).toBe("gachi");
		expect(romajaOf("굳이")).toBe("guji");
	});

	it("keeps spaces and other characters, syllable by syllable", () => {
		expect(romajaOf("한국어 공부")).toBe("hangugeo gongbu");
		expect(romajaOf("접미사(接尾辭)")).toBe("jeommisa(接尾辭)");
		expect(romajaOf("hello")).toBe("hello");
	});
});

describe("hasHangul and isHangulSyllable", () => {
	it("spot precomposed syllables only", () => {
		expect(isHangulSyllable("한")).toBe(true);
		expect(isHangulSyllable("ㅎ")).toBe(false);
		expect(isHangulSyllable("漢")).toBe(false);
		expect(hasHangul("tachi 들")).toBe(true);
		expect(hasHangul("たち")).toBe(false);
	});
});
