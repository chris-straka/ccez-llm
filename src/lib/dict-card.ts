/**
 * Word cards from dictionary hits: the instant part of a card (what
 * the form is, its base word and senses, the split where the stem
 * shows) while the model writes the rest, and the lines the model
 * reads so it picks the sense that fits instead of guessing. Pure.
 */
import type { WordCard, WordPart, WordPartKind } from "./word-card";

/** One pack entry as stored (scripts/dict-pack.ts). */
export interface DictEntry {
	w: string;
	p: string;
	g?: string;
	r?: string;
	s: string[];
}

export interface DictHit {
	/** The form's grammar tags, space-separated (empty for the headword). */
	tags: string;
	entry: DictEntry;
}

/** One analyzed Japanese piece (furigana worker). */
export interface JaPiece {
	surface: string;
	pos: string;
	sub: string;
	base: string;
	/** Hiragana reading, for kanji pieces. */
	reading?: string;
}

const TENSES = [
	"present",
	"past",
	"future",
	"imperfect",
	"perfect",
	"pluperfect",
	"preterite",
	"aorist",
	"historic"
];
const MOODS = [
	"indicative",
	"subjunctive",
	"conditional",
	"imperative",
	"infinitive",
	"participle",
	"supine"
];
const CASES = [
	"nominative",
	"accusative",
	"dative",
	"genitive",
	"instrumental",
	"locative",
	"ablative",
	"vocative",
	"partitive",
	"prepositional",
	"inessive",
	"elative",
	"illative",
	"adessive",
	"allative",
	"essive",
	"translative",
	"abessive",
	"comitative",
	"instructive",
	"sublative",
	"delative",
	"superessive",
	"terminative",
	"causal-final",
	"ergative",
	"absolutive",
	"oblique",
	"construct"
];
const GENDERS = ["masculine", "feminine", "neuter"];
const PERSONS = ["first-person", "second-person", "third-person"];
const NUMBERS = ["singular", "plural", "dual"];
const DEGREES = ["comparative", "superlative", "diminutive", "augmentative"];
const DECLENSIONS = ["strong", "weak", "mixed"];

/**
 * Wiktionary's tag set as a grammar name: "participle past" reads
 * "past participle", "indicative present singular third-person" reads
 * "present indicative, third-person singular". Tags that only describe
 * the table (definite, canonical) drop out.
 */
export function formatTags(tags: string): string {
	const set = new Set(tags.split(/\s+/).filter(Boolean));
	const pick = (list: string[]): string[] => list.filter((t) => set.has(t));
	const moods = pick(MOODS);
	const verb = [...pick(TENSES), ...moods];
	if (moods.length === 0 && set.has("gerund")) verb.push("gerund");
	const noun = [
		...pick(DEGREES),
		...pick(DECLENSIONS),
		...pick(CASES),
		...pick(GENDERS),
		...pick(PERSONS),
		...pick(NUMBERS)
	];
	const parts = [verb.join(" "), noun.join(" ")].filter(Boolean);
	if (parts.length === 0 && set.has("alternative")) return "alternative form";
	return parts.join(", ");
}

/** What an ending marks: case reads as role, bare agreement as agree. */
function endingKind(tags: string): WordPartKind {
	const set = new Set(tags.split(/\s+/));
	if (CASES.some((c) => set.has(c))) return "role";
	if ([...TENSES, ...MOODS, "gerund"].some((t) => set.has(t))) return "tense";
	return "agree";
}

/** The first sense up to its first semicolon outside brackets. */
function firstSense(entry: DictEntry): string {
	const s = entry.s[0] ?? "";
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === "(" || c === "[") depth++;
		else if ((c === ")" || c === "]") && depth > 0) depth--;
		else if (c === ";" && depth === 0) return s.slice(0, i).trim();
	}
	return s.trim();
}

/** The base word, its reading and part of speech: the meaning is already on the card. */
function baseLine(entry: DictEntry): string {
	const reading = entry.r && entry.r !== entry.w ? ` (${entry.r})` : "";
	return `${entry.w}${reading}, ${entry.p}`;
}

/** Fold for comparing a form with its headword. */
function fold(s: string): string {
	return s.normalize("NFC").toLowerCase();
}

/**
 * Split a form against its headword where the stem shows: franchi
 * against franchir is franch + i. Nothing when they share too little
 * (irregular forms) or are the same word.
 */
export function stemSplit(
	form: string,
	lemma: string
): [string, string] | null {
	const a = [...form];
	const b = [...fold(lemma)];
	const fa = [...fold(form)];
	let n = 0;
	while (n < fa.length && n < b.length && fa[n] === b[n]) n++;
	// The whole form starts the headword (franchi, franchir): the
	// headword's own ending isn't stem, so back off by its length.
	if (n === fa.length) n -= b.length - n;
	if (n < 2 || n >= a.length) return null;
	return [a.slice(0, n).join(""), a.slice(n).join("")];
}

/** Hits for the same entry merge; the most specific tags win. */
function bestHits(hits: DictHit[]): DictHit[] {
	const out: DictHit[] = [];
	for (const h of hits) {
		const same = out.find(
			(o) => o.entry.w === h.entry.w && o.entry.p === h.entry.p
		);
		if (!same) out.push(h);
		else if (formatTags(h.tags).length > formatTags(same.tags).length)
			same.tags = h.tags;
	}
	return out;
}

/** Japanese auxiliaries and particles by dictionary form: a short name. */
const JA_NAMES: Record<string, [string, WordPartKind]> = {
	れる: ["passive", "voice"],
	られる: ["passive", "voice"],
	せる: ["causative", "voice"],
	させる: ["causative", "voice"],
	ない: ["negative", "voice"],
	ぬ: ["negative", "voice"],
	た: ["past", "tense"],
	だ: ["copula", "agree"],
	です: ["polite copula", "agree"],
	ます: ["polite", "agree"],
	たい: ["want to", "voice"],
	う: ["volitional", "tense"],
	よう: ["volitional", "tense"],
	て: ["te-form", "tense"],
	で: ["te-form", "tense"],
	ば: ["conditional", "tense"],
	いる: ["ongoing", "tense"],
	ある: ["resulting state", "tense"],
	しまう: ["completely", "tense"],
	の: ["makes a noun", "derive"],
	こと: ["makes a noun", "derive"]
};

const JA_PARTICLES: Record<string, string> = {
	が: "subject marker",
	を: "object marker",
	は: "topic marker",
	に: "to, at",
	へ: "toward",
	と: "with, and",
	も: "also",
	から: "from",
	まで: "until",
	より: "than",
	の: "possessive"
};

const KANJI = /[㐀-䶿一-鿿豈-﫿々]/;

/**
 * Japanese pieces as a card's split: the content word labeled with its
 * dictionary form and reading, auxiliaries and particles by name.
 */
export function japaneseParts(pieces: JaPiece[]): WordPart[] {
	return pieces.map((p) => {
		const reading =
			p.reading && KANJI.test(p.surface) ? { reading: p.reading } : {};
		if (p.pos === "助詞") {
			const te = p.sub === "接続助詞" && (p.base === "て" || p.base === "で");
			if (te)
				return { text: p.surface, label: "te-form", kind: "tense", ...reading };
			const named = JA_NAMES[p.base];
			if (p.base === "の" && p.sub !== "格助詞" && named)
				return { text: p.surface, label: named[0], kind: named[1], ...reading };
			return {
				text: p.surface,
				label: JA_PARTICLES[p.base] ?? "particle",
				kind: "role",
				...reading
			};
		}
		const named = JA_NAMES[p.base];
		const auxiliary =
			p.pos === "助動詞" || p.sub === "非自立" || p.sub === "接尾";
		if (auxiliary && named)
			return { text: p.surface, label: named[0], kind: named[1], ...reading };
		return { text: p.surface, label: p.base, kind: "core", ...reading };
	});
}

/** The content word a Japanese split looks up by (its dictionary form). */
export function japaneseHead(pieces: JaPiece[]): string | null {
	const head = pieces.find((p) =>
		["動詞", "形容詞", "名詞", "形容動詞", "副詞"].includes(p.pos)
	);
	return head?.base ?? null;
}

const GENDER_TAGS = new Set(["masculine", "feminine", "neuter"]);

/** What an elided article, pronoun or preposition stands for. */
const ELIDED: Record<string, Record<string, string>> = {
	fr: {
		"l'": "the",
		"d'": "of",
		"j'": "I",
		"m'": "me",
		"t'": "you",
		"s'": "self",
		"n'": "not",
		"c'": "it",
		"qu'": "that"
	},
	it: {
		"l'": "the",
		"un'": "a",
		"dell'": "of the",
		"all'": "to the",
		"nell'": "in the",
		"sull'": "on the",
		"dall'": "from the"
	}
};

/** Definite articles by gender, where the article shows it. */
const ARTICLES: Record<string, Record<string, string>> = {
	fr: { masculine: "le", feminine: "la" },
	de: { masculine: "der", feminine: "die", neuter: "das" },
	es: { masculine: "el", feminine: "la" },
	it: { masculine: "il", feminine: "la" },
	pt: { masculine: "o", feminine: "a" }
};

/** A noun's gender as its base form with the article (la calèche), or the gender's name. */
function genderFact(entry: DictEntry, lang: string): string | null {
	if (!entry.g) return null;
	const article = ARTICLES[lang]?.[entry.g];
	if (!article) return entry.g;
	const w = entry.w;
	if ((lang === "fr" || lang === "it") && /^[aeiouàâéèêîôûœæ]/iu.test(w))
		return `l'${w}`;
	if (
		lang === "it" &&
		entry.g === "masculine" &&
		/^(s[^aeiou]|z|gn|ps|x)/iu.test(w)
	)
		return `lo ${w}`;
	return `${article} ${w}`;
}

/**
 * The instant card from dictionary hits: the base word's first sense,
 * the split where the stem shows (the ending named, its gender left
 * to the gender fact), the gender as the article where one shows it,
 * and what the form is only when no split shows it. Marked partial;
 * the model's card replaces it. Null without hits.
 */
export function cardFromDictionary(
	quote: string,
	hits: DictHit[],
	lang: string,
	japanese: JaPiece[] = []
): WordCard | null {
	const best = bestHits(hits);
	const top = best[0];
	if (!top) return null;
	const whole = quote.trim().replace(/^\p{P}+|\p{P}+$/gu, "");
	// An elided article or pronoun is its own piece: l' + épineuse.
	const elided =
		fold(top.entry.w) === fold(whole)
			? null
			: /^(\p{L}{1,4}['’])(\p{L}.+)$/u.exec(whole);
	const form = elided?.[2] ?? whole;
	const lead: WordPart[] = elided?.[1]
		? [
				{
					text: elided[1],
					label: ELIDED[lang]?.[fold(elided[1]).replace("’", "'")] ?? "",
					kind: "agree"
				}
			]
		: [];
	const tagName = formatTags(top.tags);
	const isHeadword = fold(top.entry.w) === fold(form);
	// A noun's gender is its own fact, not its ending's.
	const endingName = top.entry.g
		? formatTags(
				top.tags
					.split(/\s+/)
					.filter((t) => !GENDER_TAGS.has(t))
					.join(" ")
			)
		: tagName;
	let parts: WordPart[] = [];
	if (japanese.length > 1) parts = japaneseParts(japanese);
	else if (!isHeadword) {
		const split = stemSplit(form, top.entry.w);
		if (split && endingName)
			parts = [
				{ text: split[0], label: top.entry.w, kind: "core" },
				{ text: split[1], label: endingName, kind: endingKind(top.tags) }
			];
	}
	if (lead.length > 0)
		parts = [
			...lead,
			...(parts.length > 0
				? parts
				: [{ text: form, label: top.entry.w, kind: "core" as const }])
		];
	const gender = genderFact(top.entry, lang);
	const facts = gender ? [{ text: gender, kind: "agree" as const }] : [];
	// What the form is, when no split already shows it; a Japanese
	// split still wants its base's reading and verb class.
	const splitShown = parts.length > lead.length + 1 || japanese.length > 1;
	const base = isHeadword
		? undefined
		: !splitShown
			? `${endingName ? `${endingName} of ` : ""}${baseLine(top.entry)}`
			: japanese.length > 1
				? baseLine(top.entry)
				: undefined;
	return {
		meaning: firstSense(top.entry) || top.entry.w,
		parts,
		facts,
		...(base ? { base } : {}),
		partial: true,
		lang
	};
}

/**
 * Dictionary lines for the model: what each form is and its base
 * word's senses, so the card picks the sense that fits the sentence
 * and gets the form right.
 */
export function dictionaryPromptLines(quote: string, hits: DictHit[]): string {
	return bestHits(hits)
		.slice(0, 4)
		.map((h) => {
			const what = formatTags(h.tags);
			const head = what ? `${quote.trim()}: ${what} of ${h.entry.w}. ` : "";
			const gender = h.entry.g ? `, ${h.entry.g}` : "";
			return `- ${head}${h.entry.w} (${h.entry.p}${gender}): ${h.entry.s.join("; ")}`;
		})
		.join("\n");
}

/** Vowels a stress or length mark sits on (Latin, Cyrillic, Greek). */
const VOWEL = "aeiouyæœøɛɔаеёиоуыэюяіїєαεηιουω";

/**
 * Marks dictionaries print and ordinary text leaves out, per language:
 * stress in Russian (говорю́) and ё's dots (пришёл, written пришел),
 * length in Latin (amō), tone in Serbo-Croatian (kùća), Greek accents
 * (είναι, typed ειναι), vowel points in Arabic and Hebrew. `onVowel`
 * marks only count on a vowel (and syllabic r), so ć, й and ї stay.
 */
const OPTIONAL_MARKS: Record<string, { marks: RegExp; onVowel: boolean }> = {};
for (const [langs, marks, onVowel] of [
	[["ru"], /[\u0300\u0301\u0308]/gu, true],
	[["uk", "bg"], /[\u0300\u0301]/gu, true],
	[["el"], /[\u0301]/gu, true],
	[["sr"], /[\u0300-\u0302\u0304\u030f\u0311]/gu, true],
	[["la", "grc"], /[\u0304\u0306]/gu, true],
	[["ang"], /[\u0304\u0307]/gu, false],
	[["ar", "fa", "ur"], /[\u0610-\u061a\u064b-\u065f\u0670\u0640]/gu, false],
	[["he"], /[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/gu, false]
] as const)
	for (const lang of langs) OPTIONAL_MARKS[lang] = { marks, onVowel };

/**
 * A form without the marks its language leaves out of ordinary text,
 * or null when it has none: говорю́ is говорю, amō is amo.
 */
export function plainSpelling(form: string, lang: string): string | null {
	const rule = OPTIONAL_MARKS[lang];
	if (!rule) return null;
	const nfd = form.normalize("NFD");
	const plain = (
		rule.onVowel
			? nfd.replace(/(\p{L})(\p{M}+)/gu, (_, base: string, ms: string) =>
					VOWEL.includes(base.toLowerCase()) ||
					(lang === "sr" && /[rр]/i.test(base))
						? base + ms.replace(rule.marks, "")
						: base + ms
				)
			: nfd.replace(rule.marks, "")
	).normalize("NFC");
	return plain === form.normalize("NFC") ? null : plain;
}

/** Letters ordinary text swaps for the ones dictionaries print. */
const SPELLINGS: Record<string, (word: string) => string> = {
	// Dotted capital İ lowercases to i plus a dot; dotless I is ı.
	tr: (w) => w.replace(/İ/g, "i").replace(/I/g, "ı"),
	// Cedilla ş ţ from older keyboards for comma-below ș ț.
	ro: (w) =>
		w
			.replace(/ş/g, "ș")
			.replace(/Ş/g, "Ș")
			.replace(/ţ/g, "ț")
			.replace(/Ţ/g, "Ț"),
	// Arabic yeh and kaf for the Persian letters.
	fa: (w) => w.replace(/ي/g, "ی").replace(/ك/g, "ک"),
	ur: (w) => w.replace(/ي/g, "ی").replace(/ك/g, "ک")
};

const KO_PARTICLES = [
	"에서",
	"에게",
	"한테",
	"까지",
	"부터",
	"으로",
	"이랑",
	"하고",
	"처럼",
	"보다",
	"이",
	"가",
	"은",
	"는",
	"을",
	"를",
	"도",
	"에",
	"의",
	"와",
	"과",
	"로",
	"만"
];

/** Korean pronouns that fuse with their particle (제가 is 저 + 가). */
const KO_FUSED: Record<string, string> = {
	제가: "저",
	내가: "나",
	네가: "너",
	그건: "그것",
	이건: "이것",
	저건: "저것",
	그걸: "그것",
	이걸: "이것"
};

/**
 * The bare word inside a form that carries grammar a dictionary
 * doesn't list: clitics (avez-vous, deixa-me), Czech and Slovak ne-,
 * Hebrew and Arabic prefixes (ואני, بهذا), Korean particles (우리가),
 * Malay and Indonesian suffixes (padaku), the Tagalog linker (akong).
 */
const BARE: Record<string, (word: string) => string[]> = {};
const hyphenClitic = (w: string): string[] => {
	const head = /^(\p{L}+)-\p{L}/u.exec(w)?.[1];
	return head ? [head] : [];
};
for (const lang of ["fr", "pt", "ro"]) BARE[lang] = hyphenClitic;
for (const lang of ["cs", "sk"])
	BARE[lang] = (w) => {
		const rest = /^ne(\p{L}{3,})$/iu.exec(w)?.[1];
		return rest ? [rest] : [];
	};
BARE.he = (w) =>
	[1, 2]
		.filter(
			(n) =>
				w.length - n >= 2 &&
				[...w.slice(0, n)].every((c) => "ושהבלמכ".includes(c))
		)
		.map((n) => w.slice(n));
BARE.ar = (w) => {
	const m = /^[وف]?([بلك]?)((?:ال)?)(.{2,})$/u.exec(w);
	if (!m) return [];
	const [, prep = "", art = "", stem = ""] = m;
	return [prep + art + stem, art + stem, stem].filter(
		(f, i, all) => f !== w && all.indexOf(f) === i
	);
};
BARE.ko = (w) => {
	if (KO_FUSED[w]) return [KO_FUSED[w]];
	const p = KO_PARTICLES.find((x) => w.endsWith(x) && w.length > x.length);
	return p ? [w.slice(0, -p.length)] : [];
};
for (const lang of ["id", "ms"])
	BARE[lang] = (w) => {
		const rest = /^(\p{L}{3,}?)(nya|ku|mu|lah|kah|pun)$/u.exec(w)?.[1];
		return rest ? [rest] : [];
	};
BARE.tl = (w) => {
	if (!w.endsWith("ng") || w.length < 4) return [];
	return /[aeiou]ng$/.test(w)
		? [w.slice(0, -2), w.slice(0, -1)]
		: [w.slice(0, -1)];
};

/**
 * Forms to look a quote up by: the word without edge punctuation, for
 * elided articles and pronouns (l'homme, qu'il, dell'acqua) the word
 * after the apostrophe too, the spelling dictionaries print, each
 * without its optional marks, and last the bare word inside a form
 * with clitics, prefixes or particles. The first form with hits wins.
 */
export function lookupForms(quote: string, lang = ""): string[] {
	const word = quote
		.normalize("NFC")
		.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
	if (!word) return [];
	const forms = [word];
	const add = (f: string | null | undefined) => {
		if (f && !forms.includes(f)) forms.push(f);
	};
	const elided = /^\p{L}{1,4}['’](\p{L}.+)$/u.exec(word);
	add(elided?.[1]);
	for (const f of [...forms]) add(SPELLINGS[lang]?.(f));
	for (const f of [...forms]) add(plainSpelling(f, lang));
	for (const f of [...forms])
		for (const bare of BARE[lang]?.(f) ?? []) add(bare);
	return forms;
}

/** The first form with hits wins: the whole word before its parts. */
export function firstHits(lists: DictHit[][]): DictHit[] {
	return lists.find((l) => l.length > 0) ?? [];
}
