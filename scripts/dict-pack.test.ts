import { describe, expect, it } from "vitest";
import {
	addKaikkiFormOf,
	addKaikkiRecord,
	lookupPack,
	PackBuilder,
	parseJmdictEntry,
	type KaikkiRecord
} from "./dict-pack";

const header = { lang: "fr", version: "test", sources: [] };

function build(records: KaikkiRecord[]): Uint8Array {
	const b = new PackBuilder();
	const lemmas = new Map<string, number[]>();
	const later: KaikkiRecord[] = [];
	for (const r of records) {
		const form = addKaikkiRecord(b, r, lemmas);
		if (form) later.push(form);
	}
	for (const r of later) addKaikkiFormOf(b, r, lemmas);
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
