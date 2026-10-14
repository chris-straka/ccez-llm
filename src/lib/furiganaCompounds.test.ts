import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { toHiragana } from "wanakana";
import { unzipSync } from "fflate";
import init, { TokenizerBuilder, loadDictionaryFromBytes } from "lindera-wasm";
import {
	furiganaLineHtml,
	rubyHtmlForText,
	rubyTokensForLine,
	type LinderaTokenizer,
	type MorphToken,
	type NbestPath
} from "./furiganaRuby";

const morph = (
	surface: string,
	reading: string,
	pos: string,
	pos1 = "*"
): MorphToken => ({
	surface,
	details: [pos, pos1, "*", "*", "*", "*", surface, reading, reading]
});
const path = (
	cost: number,
	toks: {
		surface: string;
		start: number;
		end: number;
		reading: string;
		pos1?: string;
	}[]
): NbestPath => ({
	cost,
	tokens: toks.map((t) => ({
		surface: t.surface,
		byteStart: t.start,
		byteEnd: t.end,
		unknown: false,
		details: [
			"名詞",
			t.pos1 ?? "*",
			"*",
			"*",
			"*",
			"*",
			t.surface,
			t.reading,
			t.reading
		]
	}))
});
const html = (
	text: string,
	morphs: MorphToken[],
	nbest: NbestPath[] = []
): string =>
	rubyHtmlForText(
		text,
		rubyTokensForLine(text, morphs, nbest, toHiragana),
		toHiragana
	);
const frb = (base: string, rt: string): string =>
	`<span class="frb">${base}<span class="frt">${rt}</span></span>`;

/**
 * Lindera's best path splits some compounds into single kanji (一|歩)
 * whose readings are wrong in context (いち|ほ). The N-best lattice still
 * holds the whole-span token; its reading goes over the whole compound.
 * Cases ported with the fix from ccez-lang's tokens.test.ts.
 */
describe("rubyTokensForLine", () => {
	it("reads 一歩 as one word, a cheaper name reading notwithstanding", () => {
		const nbest = [
			path(4326, [
				{ surface: "一", start: 0, end: 3, reading: "イチ", pos1: "数" },
				{ surface: "歩", start: 3, end: 6, reading: "ホ", pos1: "接尾" }
			]),
			path(5000, [
				{
					surface: "一歩",
					start: 0,
					end: 6,
					reading: "ハジメ",
					pos1: "固有名詞"
				}
			]),
			path(7480, [
				{
					surface: "一歩",
					start: 0,
					end: 6,
					reading: "イッポ",
					pos1: "副詞可能"
				}
			])
		];
		expect(
			html(
				"一歩",
				[morph("一", "イチ", "名詞", "数"), morph("歩", "ホ", "名詞", "接尾")],
				nbest
			)
		).toBe(frb("一歩", "いっぽ"));
	});

	it("reads 一人 as ひとり, not the name カズト", () => {
		const nbest = [
			path(7000, [
				{
					surface: "一人",
					start: 0,
					end: 6,
					reading: "カズト",
					pos1: "固有名詞"
				}
			]),
			path(8590, [
				{ surface: "一人", start: 0, end: 6, reading: "ヒトリ", pos1: "一般" }
			])
		];
		expect(
			html(
				"一人",
				[
					morph("一", "イチ", "名詞", "数"),
					morph("人", "ニン", "名詞", "接尾")
				],
				nbest
			)
		).toBe(frb("一人", "ひとり"));
	});

	it("joins readings over 露軍 when the dictionary has no compound", () => {
		const morphs = [
			morph("露", "ロ", "名詞", "固有名詞"),
			morph("軍", "グン", "名詞", "接尾"),
			morph("の", "ノ", "助詞", "連体化"),
			morph("攻撃", "コウゲキ", "名詞", "サ変接続")
		];
		const nbest = [
			path(8083, [{ surface: "露", start: 0, end: 3, reading: "ロ" }])
		];
		expect(html("露軍の攻撃", morphs, nbest)).toBe(
			`${frb("露軍", "ろぐん")}の${frb("攻撃", "こうげき")}`
		);
	});

	it("finds the compound at its own offset when the characters repeat", () => {
		// The second 一歩 sits at bytes 9..15; a lattice token at 0..6 is
		// a different span.
		const morphs = [
			morph("一", "イチ", "名詞", "数"),
			morph("歩", "ホ", "名詞", "接尾"),
			morph("と", "ト", "助詞"),
			morph("一", "イチ", "名詞", "数"),
			morph("歩", "ホ", "名詞", "接尾")
		];
		const nbest = [
			path(7000, [{ surface: "一歩", start: 9, end: 15, reading: "イッポ" }])
		];
		expect(html("一歩と一歩", morphs, nbest)).toBe(
			`${frb("一歩", "いちほ")}と${frb("一歩", "いっぽ")}`
		);
	});

	it("leaves multi-kanji words, spaced kanji and okurigana alone", () => {
		const nbest = [
			path(7480, [{ surface: "一歩", start: 0, end: 7, reading: "イッポ" }])
		];
		expect(
			html(
				"一 歩",
				[morph("一", "イチ", "名詞", "数"), morph("歩", "ホ", "名詞", "接尾")],
				nbest
			)
		).toBe(`${frb("一", "いち")} ${frb("歩", "ほ")}`);
		expect(
			html(
				"踏み出そう",
				[morph("踏み出そ", "フミダソ", "動詞"), morph("う", "ウ", "助動詞")],
				nbest
			)
		).toBe(`${frb("踏", "ふ")}み${frb("出", "だ")}そう`);
	});

	it("merges nothing without N-best paths", () => {
		expect(
			html("一歩", [
				morph("一", "イチ", "名詞", "数"),
				morph("歩", "ホ", "名詞", "接尾")
			])
		).toBe(`${frb("一", "いち")}${frb("歩", "ほ")}`);
	});

	it("swaps known less-common readings for the everyday ones only", () => {
		expect(html("日本", [morph("日本", "ニッポン", "名詞", "固有名詞")])).toBe(
			frb("日本", "にほん")
		);
		expect(html("明日", [morph("明日", "アケビ", "名詞", "固有名詞")])).toBe(
			frb("明日", "あけび")
		);
	});
});

/** The real tokenizer and the dictionary the app ships. */
describe("furiganaLineHtml with lindera IPAdic", () => {
	let tokenizer: LinderaTokenizer | null = null;
	const ready = async (): Promise<LinderaTokenizer> => {
		if (tokenizer) return tokenizer;
		const root = new URL("../../", import.meta.url);
		await init({
			module_or_path: readFileSync(
				new URL("node_modules/lindera-wasm/lindera_wasm_bg.wasm", root)
			)
		});
		const zip = unzipSync(
			new Uint8Array(
				readFileSync(new URL("static/lindera/lindera-ipadic-6.0.0.zip", root))
			)
		);
		const at = (name: string): Uint8Array => {
			const bytes = zip[`lindera-ipadic/${name}`];
			if (!bytes) throw new Error(`missing ${name}`);
			return bytes;
		};
		const builder = new TokenizerBuilder();
		builder.setDictionaryInstance(
			loadDictionaryFromBytes(
				at("metadata.json"),
				at("dict.trie"),
				at("dict.valsidx"),
				at("dict.vals"),
				at("dict.wordsidx"),
				at("dict.words"),
				at("matrix.mtx"),
				at("char_def.bin"),
				at("unk.bin")
			)
		);
		builder.setMode("normal");
		tokenizer = builder.build();
		return tokenizer;
	};
	const line = async (text: string): Promise<string> =>
		furiganaLineHtml(await ready(), text, toHiragana);

	it("reads analyser-split compounds whole, never per kanji", async () => {
		const ippo = await line("今日こそ、新しい一歩を踏み出そう。");
		expect(ippo).toContain(frb("一歩", "いっぽ"));
		expect(ippo).toContain(frb("今日", "きょう"));
		expect(ippo).toContain(`${frb("踏", "ふ")}み${frb("出", "だ")}そ`);
		expect(await line("露軍の攻撃")).toContain(frb("露軍", "ろぐん"));
		expect(await line("一人")).toBe(frb("一人", "ひとり"));
		expect(await line("大人")).toBe(frb("大人", "おとな"));
	}, 60_000);

	it("gives the everyday reading, fixed phrases keep their own", async () => {
		expect(await line("日本")).toBe(frb("日本", "にほん"));
		expect(await line("日本人は親切だ")).toContain(frb("日本人", "にほんじん"));
		expect(await line("一日の仕事")).toContain(frb("一日", "いちにち"));
		expect(await line("二十歳になった")).toContain(frb("二十歳", "はたち"));
		expect(await line("日本銀行に行く")).toContain(
			frb("日本銀行", "にっぽんぎんこう")
		);
	}, 60_000);
});
