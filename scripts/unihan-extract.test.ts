import { describe, expect, it } from "vitest";
import {
	fillHangulFromVariants,
	formatGeneratedModule,
	inBundledRange,
	normalizeHangul,
	parseUnihanReadings
} from "./unihan-extract";

const FIXTURE = [
	"# Unihan_Readings.txt",
	"# Date: 2025-07-24 00:00:00 GMT [KL]",
	"U+8A9E\tkDefinition\tlanguage, words; saying, expression",
	"U+8A9E\tkMandarin\tyǔ",
	"U+8A9E\tkJapaneseOn\tGO GYO",
	"U+8A9E\tkJapaneseKun\tKATARU KOTOBA",
	"U+8A9E\tkCantonese\tjyu5",
	"U+8A9E\tkTotalStrokes\t14",
	"U+8A9E\tkRSUnicode\t149.7",
	"U+597D\tkDefinition\tgood, excellent, fine; well",
	"U+597D\tkMandarin\thǎo",
	"U+3400\tkDefinition\t(same as 丘) hillock or mound",
	"U+3400\tkMandarin\tqiū",
	"U+20000\tkDefinition\textension B char, never bundled",
	"U+9FFF\tkMandarin\tboundary-inclusive",
	"not a unihan line",
	"U+ZZZZ\tkDefinition\tbad code point",
	"U+8A9E\tkDefinition\t",
	""
].join("\n");

describe("inBundledRange", () => {
	it("bundles CJK Unified with and without the flag", () => {
		expect(inBundledRange(0x4e00)).toBe(true);
		expect(inBundledRange(0x9fff, { includeExtA: true })).toBe(true);
		expect(inBundledRange(0x20000)).toBe(false);
	});

	it("bundles Extension A only with the flag", () => {
		expect(inBundledRange(0x3400)).toBe(false);
		expect(inBundledRange(0x3400, { includeExtA: true })).toBe(true);
		expect(inBundledRange(0x4dbf, { includeExtA: true })).toBe(true);
	});
});

describe("parseUnihanReadings", () => {
	it("collects the six wanted fields per character", () => {
		const entries = parseUnihanReadings(FIXTURE);
		expect(entries.get("語")).toEqual({
			char: "語",
			d: "language, words; saying, expression",
			m: "yǔ",
			on: "GO GYO",
			kun: "KATARU KOTOBA",
			t: "14",
			rs: "149.7"
		});
		expect(entries.get("好")).toMatchObject({
			d: "good, excellent, fine; well",
			m: "hǎo"
		});
	});

	it("ignores comments, unknown fields, and malformed lines", () => {
		const entries = parseUnihanReadings(FIXTURE);
		expect(entries.get("語")).not.toHaveProperty("kCantonese");
		expect(entries.has("#")).toBe(false);
		expect(entries.size).toBe(3);
	});

	it("drops empty values and keeps the boundary code point", () => {
		const entries = parseUnihanReadings(FIXTURE);
		expect(entries.get("\u9fff")).toEqual({
			char: "\u9fff",
			m: "boundary-inclusive"
		});
	});

	it("excludes Extension A by default and includes it with the flag", () => {
		expect(parseUnihanReadings(FIXTURE).has("㐀")).toBe(false);
		const withExtA = parseUnihanReadings(FIXTURE, { includeExtA: true });
		expect(withExtA.get("㐀")).toEqual({
			char: "㐀",
			d: "(same as 丘) hillock or mound",
			m: "qiū"
		});
	});

	it("never bundles Extension B", () => {
		const withExtA = parseUnihanReadings(FIXTURE, { includeExtA: true });
		expect(withExtA.has("𠀀")).toBe(false);
	});
});

describe("formatGeneratedModule", () => {
	it("emits the license notice, provenance, and escaped entries", () => {
		const entries = parseUnihanReadings(
			'U+8A9E\tkDefinition\ta "quoted" \\ gloss\nU+8A9E\tkMandarin\tyǔ\n'
		);
		const module = formatGeneratedModule(entries, {
			unicodeVersion: "17.0.0",
			sourceUrl: "https://example.invalid/Unihan.zip",
			includeExtA: false
		});
		expect(module).toContain("Unicode License V3");
		expect(module).toContain("© 1991-2026 Unicode, Inc.");
		expect(module).toContain("U+4E00-U+9FFF");
		expect(module).toContain('"語":{d:"a \\"quoted\\" \\\\ gloss",m:"yǔ"}');
		expect(module).toContain("export const UNIHAN");
	});

	it("sorts entries by code point for stable regeneration diffs", () => {
		const entries = parseUnihanReadings(
			"U+8A9E\tkMandarin\tyǔ\nU+597D\tkMandarin\thǎo\n"
		);
		const module = formatGeneratedModule(entries, {
			unicodeVersion: "17.0.0",
			sourceUrl: "https://example.invalid/Unihan.zip",
			includeExtA: false
		});
		expect(module.indexOf('"好"')).toBeLessThan(module.indexOf('"語"'));
	});
});

describe("kHangul", () => {
	it("drops source tags and puts educational readings first", () => {
		expect(normalizeHangul("노:0 로:0E")).toBe("로 노");
		expect(normalizeHangul("접:0E")).toBe("접");
		expect(normalizeHangul("가:0 가:1E")).toBe("가");
	});

	it("parses into h and fills new forms from their old forms", () => {
		const readings = [
			"U+8FAD\tkHangul\t사:0E",
			"U+8F9E\tkMandarin\tcí",
			"U+63A5\tkHangul\t접:0E"
		].join("\n");
		const variants = [
			"U+8F9E\tkJapaneseOldVariant\tU+8FAD",
			"U+63A5\tkJapaneseOldVariant\tU+8FAD"
		].join("\n");
		const entries = parseUnihanReadings(readings);
		expect(entries.get("接")?.h).toBe("접");
		fillHangulFromVariants(entries, readings, variants);
		expect(entries.get("辞")?.h).toBe("사");
		// An own reading always wins over a variant's.
		expect(entries.get("接")?.h).toBe("접");
	});
});
