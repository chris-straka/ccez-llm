import { describe, expect, it } from "vitest";
import {
	addKaikkiFormsOf,
	addKaikkiRecord,
	lookupPack,
	PackBuilder,
	parseJmdictEntry,
	type KaikkiRecord
} from "./dict-pack";

const header = { lang: "fr", version: "test", sources: [] };

function build(records: KaikkiRecord[], lang = ""): Uint8Array {
	const b = new PackBuilder(lang);
	const lemmas = new Map<string, number[]>();
	const later: KaikkiRecord[] = [];
	for (const r of records) {
		const form = addKaikkiRecord(b, r, lemmas);
		if (form) later.push(form);
	}
	addKaikkiFormsOf(b, later, lemmas);
	return b.encode(header);
}

describe("dictionary packs", () => {
	const pack = build([
		{
			word: "franchir",
			pos: "verb",
			senses: [{ glosses: ["to clear, to cross (a line)"] }],
			forms: [
				{ form: "fr-conj-auto", tags: ["inflection-template"] },
				{ form: "avoir + past participle", tags: ["multiword-construction"] },
				{ form: "franchissant", tags: ["gerund", "participle", "present"] }
			]
		},
		{
			word: "franchi",
			pos: "verb",
			senses: [
				{
					glosses: ["past participle of franchir"],
					tags: ["form-of", "participle", "past"],
					form_of: [{ word: "franchir" }]
				}
			]
		},
		{
			word: "maison",
			pos: "noun",
			senses: [{ glosses: ["house"], tags: ["feminine"] }],
			forms: [{ form: "maisons", tags: ["plural"] }]
		},
		{ word: "Paris", pos: "name", senses: [{ glosses: ["capital of France"] }] }
	]);

	it("reaches an entry from its headword, table forms and form-of records", () => {
		expect(lookupPack(pack, "franchir")[0]).toMatchObject({
			tags: "",
			entry: { w: "franchir", p: "verb" }
		});
		expect(lookupPack(pack, "Franchissant")[0]?.tags).toBe(
			"gerund participle present"
		);
		expect(lookupPack(pack, "franchi")[0]).toMatchObject({
			tags: "participle past",
			entry: { w: "franchir" }
		});
		expect(lookupPack(pack, "maisons")[0]).toMatchObject({
			tags: "plural",
			entry: { w: "maison", g: "feminine", s: ["house"] }
		});
	});

	it("leaves out names, table templates and multi-word forms", () => {
		expect(lookupPack(pack, "paris")).toEqual([]);
		expect(lookupPack(pack, "fr-conj-auto")).toEqual([]);
		expect(lookupPack(pack, "avoir + past participle")).toEqual([]);
	});

	it("reaches marked forms by their plain spelling too", () => {
		const latin = build(
			[
				{
					word: "amo",
					pos: "verb",
					senses: [{ glosses: ["to love"] }],
					forms: [{ form: "amō", tags: ["canonical"] }]
				},
				{
					word: "amat",
					pos: "verb",
					senses: [
						{
							glosses: ["third-person singular of amō"],
							tags: ["form-of", "third-person", "singular"],
							form_of: [{ word: "amō" }]
						}
					]
				}
			],
			"la"
		);
		expect(lookupPack(latin, "amō")[0]?.entry.w).toBe("amo");
		expect(lookupPack(latin, "amat")[0]).toMatchObject({
			tags: "third-person singular",
			entry: { w: "amo" }
		});
		const russian = build(
			[
				{
					word: "говорить",
					pos: "verb",
					senses: [{ glosses: ["to speak"] }],
					forms: [{ form: "говорю́", tags: ["first-person", "singular"] }]
				}
			],
			"ru"
		);
		expect(lookupPack(russian, "говорю")[0]?.entry.w).toBe("говорить");
	});

	it("lists a word's current senses before its dated ones", () => {
		const pack = build([
			{
				word: "中國",
				pos: "noun",
				senses: [
					{ glosses: ["royal court"], tags: ["historical"] },
					{ glosses: ["China"] }
				]
			}
		]);
		expect(lookupPack(pack, "中國")[0]?.entry.s).toEqual([
			"China",
			"royal court"
		]);
	});

	it("leaves out Finnish possessive forms", () => {
		const finnish = build(
			[
				{
					word: "talo",
					pos: "noun",
					senses: [{ glosses: ["house"] }],
					forms: [
						{ form: "talossa", tags: ["inessive", "singular"] },
						{
							form: "talossani",
							tags: ["first-person", "inessive", "possessive", "singular"]
						}
					]
				}
			],
			"fi"
		);
		expect(lookupPack(finnish, "talossa")[0]?.entry.w).toBe("talo");
		expect(lookupPack(finnish, "talossani")).toEqual([]);
	});

	it("keeps a Chinese word's pinyin, or jyutping for Cantonese", () => {
		const record: KaikkiRecord = {
			word: "中國",
			pos: "noun",
			senses: [{ glosses: ["China"] }],
			sounds: [
				{ tags: ["Cantonese", "Jyutping"], zh_pron: "zung¹ gwok³" },
				{ tags: ["Mandarin", "Pinyin"], zh_pron: "Zhōngguó" }
			]
		};
		expect(lookupPack(build([record], "zh"), "中國")[0]?.entry.r).toBe(
			"Zhōngguó"
		);
		expect(lookupPack(build([record], "yue"), "中國")[0]?.entry.r).toBe(
			"zung¹ gwok³"
		);
		const name: KaikkiRecord = { ...record, pos: "name" };
		expect(lookupPack(build([name], "zh"), "中國")).toHaveLength(1);
		expect(lookupPack(build([name], "fr"), "中國")).toEqual([]);
		// Single-character words file as characters: 我 is "I".
		const char: KaikkiRecord = {
			word: "我",
			pos: "character",
			senses: [{ glosses: ["I; me; my"] }]
		};
		expect(lookupPack(build([char], "zh"), "我")[0]?.entry.s).toEqual([
			"I; me; my"
		]);
		expect(lookupPack(build([char], "fr"), "我")).toEqual([]);
	});

	it("links forms whose lemma is garbled, a form, or missing", () => {
		const formOf = (word: string, target: string, tags: string[]) => ({
			word,
			pos: "verb",
			senses: [
				{
					glosses: [`${tags.join(" ")} of ${target}`],
					tags: ["form-of", ...tags],
					form_of: [{ word: target }]
				}
			]
		});
		const pack = build([
			// Chained first, so the chain resolves on the second try.
			formOf("mere", "mera", ["plural"]),
			{ word: "avere", pos: "verb", senses: [{ glosses: ["to have"] }] },
			formOf("ho", "avere and", ["first-person"]),
			{ word: "mai", pos: "pron", senses: [{ glosses: ["I"] }] },
			formOf("mera", "mai", ["genitive"]),
			formOf("vsichko", "vsichak", ["neuter"])
		]);
		expect(lookupPack(pack, "ho")[0]).toMatchObject({
			tags: "first-person",
			entry: { w: "avere" }
		});
		expect(lookupPack(pack, "mere")[0]).toMatchObject({
			tags: "plural",
			entry: { w: "mai" }
		});
		// No lemma anywhere: the form keeps its own gloss.
		expect(lookupPack(pack, "vsichko")[0]).toMatchObject({
			tags: "",
			entry: { w: "vsichko", s: ["neuter of vsichak"] }
		});
	});

	it("reads JMdict entries", () => {
		const e = parseJmdictEntry(
			"<k_ele><keb>読む</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>よむ</reb></r_ele>" +
				"<sense><pos>&v5m;</pos><pos>&vt;</pos><gloss>to read</gloss></sense>" +
				"<sense><gloss>to recite (e.g. a sutra)</gloss><gloss>to chant</gloss></sense>"
		);
		expect(e).toEqual({
			kebs: ["読む"],
			rebs: ["よむ"],
			pos: "godan verb",
			senses: ["to read", "to recite (e.g. a sutra); to chant"],
			common: true
		});
	});
});
