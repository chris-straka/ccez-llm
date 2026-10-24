import { describe, expect, it } from "vitest";
import {
	AffixCounts,
	fallbackStem,
	isCell,
	paradigmStem,
	separateMarkers,
	splitForm,
	tagKey,
	wordMorphemes,
	type FormSplit
} from "./dict-morph";

type Cell = { form: string; tags: string[] };

const PRES = ["present", "indicative"];
/** A regular -ar verb's present and its gerund, Wiktionary-style tags. */
function arVerb(stem: string): Cell[] {
	return [
		{ form: `${stem}ar`, tags: ["infinitive"] },
		{ form: `${stem}o`, tags: [...PRES, "first-person", "singular"] },
		{ form: `${stem}as`, tags: [...PRES, "second-person", "singular"] },
		{ form: `${stem}a`, tags: [...PRES, "third-person", "singular"] },
		{ form: `${stem}amos`, tags: [...PRES, "first-person", "plural"] },
		{ form: `${stem}an`, tags: [...PRES, "third-person", "plural"] },
		{ form: `${stem}ando`, tags: ["gerund"] }
	];
}

/** A German weak verb's present, past and participle. */
function weakVerb(stem: string): Cell[] {
	return [
		{ form: `${stem}en`, tags: ["infinitive"] },
		{ form: `${stem}e`, tags: [...PRES, "first-person", "singular"] },
		{ form: `${stem}st`, tags: [...PRES, "second-person", "singular"] },
		{ form: `${stem}t`, tags: [...PRES, "third-person", "singular"] },
		{ form: `${stem}te`, tags: ["past", "first-person", "singular"] },
		{ form: `ge${stem}t`, tags: ["participle", "past"] }
	];
}

/** A Finnish noun's cells, singular and plural. */
function fiNoun(stem: string): Cell[] {
	return [
		{ form: stem, tags: ["nominative", "singular"] },
		{ form: `${stem}t`, tags: ["nominative", "plural"] },
		{ form: `${stem}ssa`, tags: ["inessive", "singular"] },
		{ form: `${stem}issa`, tags: ["inessive", "plural"] },
		{ form: `${stem}lla`, tags: ["adessive", "singular"] },
		{ form: `${stem}illa`, tags: ["adessive", "plural"] }
	];
}

function counted(paradigms: Array<[string, string, Cell[]]>): AffixCounts {
	const counts = new AffixCounts();
	for (const [lemma, pos, cells] of paradigms)
		counts.observe(
			pos,
			paradigmStem(
				lemma,
				cells.map((c) => c.form)
			),
			cells
		);
	counts.settle();
	return counts;
}

const join = (s: FormSplit | null): string =>
	s ? [s.pre, s.stem, s.num, s.end].filter(Boolean).join(" + ") : "none";

describe("paradigmStem", () => {
	it("takes the start most forms share, not just the headword's", () => {
		expect(
			paradigmStem(
				"hablar",
				arVerb("habl").map((c) => c.form)
			)
		).toBe("habl");
		expect(paradigmStem("maison", ["maisons"])).toBe("maison");
	});

	it("finds none where the forms run on several stems", () => {
		expect(
			paradigmStem("gehen", [
				"gehe",
				"gehst",
				"ging",
				"gingst",
				"gingen",
				"gegangen"
			])
		).toBeNull();
		// aufmachen's forms share only auf, too little of the headword.
		expect(paradigmStem("aufmachen", ["aufgemacht", "aufzumachen"])).toBeNull();
	});
});

describe("fallbackStem", () => {
	it("takes the headword less its own cell's usual ending", () => {
		const de = counted(
			["mach", "sag", "spiel", "kauf", "hol", "lern"].map((s) => [
				`${s}en`,
				"verb",
				weakVerb(s)
			])
		);
		const sehen: Cell[] = [
			{ form: "sehen", tags: ["infinitive"] },
			{ form: "sehe", tags: [...PRES, "first-person", "singular"] },
			{ form: "siehst", tags: [...PRES, "second-person", "singular"] },
			{ form: "sieht", tags: [...PRES, "third-person", "singular"] },
			{ form: "sah", tags: ["past", "first-person", "singular"] },
			{ form: "gesehen", tags: ["participle", "past"] }
		];
		expect(fallbackStem("sehen", "verb", sehen, de)).toBe("seh");
		const sein: Cell[] = [
			{ form: "sein", tags: ["infinitive"] },
			{ form: "bin", tags: [...PRES, "first-person", "singular"] },
			{ form: "bist", tags: [...PRES, "second-person", "singular"] },
			{ form: "ist", tags: [...PRES, "third-person", "singular"] },
			{ form: "war", tags: ["past", "first-person", "singular"] }
		];
		expect(fallbackStem("sein", "verb", sein, de)).toBeNull();
	});
});

describe("splitForm", () => {
	const es = counted(
		["habl", "cant", "bail", "tom", "llam"].map((s) => [
			`${s}ar`,
			"verb",
			arVerb(s)
		])
	);
	const k = (tags: string[]) => tagKey("verb", tags);

	it("splits around the paradigm's stem", () => {
		expect(
			join(
				splitForm(
					"hablamos",
					"hablar",
					"habl",
					k([...PRES, "first-person", "plural"]),
					es
				)
			)
		).toBe("habl + amos");
	});

	it("splits a stem-changed form on its tags' usual ending", () => {
		// pensar's table runs on pens- and piens-.
		expect(
			join(
				splitForm(
					"pienso",
					"pensar",
					"pens",
					k([...PRES, "first-person", "singular"]),
					es
				)
			)
		).toBe("piens + o");
	});

	it("leaves a form alone when what's left doesn't look like the stem", () => {
		const de = counted(
			["mach", "sag", "spiel", "kauf", "hol", "lern"].map((s) => [
				`${s}en`,
				"verb",
				weakVerb(s)
			])
		);
		expect(
			splitForm(
				"bin",
				"sein",
				null,
				tagKey("verb", [...PRES, "first-person", "singular"]),
				de
			)
		).toBeNull();
		expect(
			join(
				splitForm(
					"gestaltet",
					"gestalten",
					null,
					tagKey("verb", ["participle", "past"]),
					de
				)
			)
			// Its ge stays: staltet doesn't start with gestalten's g.
		).toBe("gestalte + t");
		// ge- is the participle's usual prefix; the ending is the
		// participle's.
		expect(
			join(
				splitForm(
					"gemacht",
					"machen",
					"mach",
					tagKey("verb", ["participle", "past"]),
					de
				)
			)
		).toBe("ge + mach + t");
	});

	it("keeps the form's own letters", () => {
		const de = counted([
			[
				"Haus",
				"noun",
				[
					{ form: "Hauses", tags: ["genitive", "singular"] },
					{ form: "Häuser", tags: ["nominative", "plural"] }
				]
			],
			...["Kind", "Feld", "Bild", "Lied", "Brett", "Glied"].map(
				(n) =>
					[
						n,
						"noun",
						[
							{ form: `${n}es`, tags: ["genitive", "singular"] },
							{ form: `${n}er`, tags: ["nominative", "plural"] }
						]
					] as [string, string, Cell[]]
			)
		]);
		expect(
			join(
				splitForm(
					"Häuser",
					"Haus",
					"haus",
					tagKey("noun", ["nominative", "plural"]),
					de
				)
			)
		).toBe("Häus + er");
	});
});

describe("separateMarkers", () => {
	it("pulls the plural marker out of an agglutinative ending", () => {
		const nouns = ["talo", "kala", "kissa", "auto", "koulu", "pöytä"];
		const fi = counted(nouns.map((n) => [n, "noun", fiNoun(n)]));
		const splits = new Map<string, { split: FormSplit; tags: string[] }>();
		for (const c of fiNoun("talo")) {
			const split = splitForm(
				c.form,
				"talo",
				"talo",
				tagKey("noun", c.tags),
				fi
			);
			if (split) splits.set(tagKey("noun", c.tags), { split, tags: c.tags });
		}
		separateMarkers("noun", splits);
		const at = (tags: string[]) =>
			join(splits.get(tagKey("noun", tags))?.split ?? null);
		expect(at(["inessive", "plural"])).toBe("talo + i + ssa");
		expect(at(["adessive", "plural"])).toBe("talo + i + lla");
		// No singular ending to peel off: the -t stays whole.
		expect(at(["nominative", "plural"])).toBe("talo + t");
	});
});

describe("isCell", () => {
	it("keeps table cells and drops other words and spellings", () => {
		expect(isCell(["genitive", "singular"])).toBe(true);
		expect(isCell(["diminutive", "neuter"])).toBe(false);
		expect(isCell(["table-tags"])).toBe(false);
		expect(isCell(["alternative", "obsolete"])).toBe(false);
	});
});

describe("wordMorphemes", () => {
	it("lines a compound's pieces up with its spelling", () => {
		expect(
			wordMorphemes("Krankenhaus", "noun", [
				{
					name: "affix",
					args: { "1": "de", "2": "Kranker", "3": "-en-", "4": "Haus" }
				}
			])
		).toEqual([
			["Krank", "Kranker", "core"],
			["en", "", "derive"],
			["haus", "Haus", "core"]
		]);
	});

	it("names a final suffix by what it makes", () => {
		expect(
			wordMorphemes("happiness", "noun", [
				{ name: "suffix", args: { "1": "en", "2": "happy", "3": "ness" } }
			])
		).toEqual([
			["happi", "happy", "core"],
			["ness", "makes a noun", "derive"]
		]);
		expect(
			wordMorphemes("Freiheit", "noun", [
				{ name: "suffix", args: { "1": "de", "2": "frei", "3": "-heit" } }
			])
		).toEqual([
			["Frei", "frei", "core"],
			["heit", "makes a noun", "derive"]
		]);
	});

	it("labels a prefix by its gloss, as voice on verbs", () => {
		expect(
			wordMorphemes("défaire", "verb", [
				{
					name: "prefix",
					args: { "1": "fr", "2": "dé", "3": "faire", t1: "un-" }
				}
			])
		).toEqual([
			["dé", "un-", "voice"],
			["faire", "faire", "core"]
		]);
	});

	it("gives nothing when the pieces don't spell the word", () => {
		expect(
			wordMorphemes("Gebäude", "noun", [
				{ name: "affix", args: { "1": "de", "2": "ge-", "3": "bauen" } }
			])
		).toBeUndefined();
		expect(
			wordMorphemes("chien", "noun", [
				{ name: "inh", args: { "1": "fr", "2": "la", "3": "canis" } }
			])
		).toBeUndefined();
		expect(
			wordMorphemes("illegal", "adj", [
				{ name: "affix", args: { "1": "en", "2": "la:in-", "3": "legal" } }
			])
		).toBeUndefined();
	});
});
