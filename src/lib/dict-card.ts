/**
 * Word cards from dictionary hits: the instant part of a card (what
 * the form is, its base word and senses, the split where the stem
 * shows) while the model writes the rest, and the lines the model
 * reads so it picks the sense that fits instead of guessing. Pure.
 */
import type { WordCard, WordFact, WordPart, WordPartKind } from "./word-card";

/** One pack entry as stored (scripts/dict-pack.ts). */
export interface DictEntry {
	w: string;
	p: string;
	g?: string;
	r?: string;
	s: string[];
	/** Derivation pieces (text, label, kind) that spell the headword. */
	m?: Array<[string, string, WordPartKind]>;
	/** An irregular verb (scripts/dict-pack.ts). */
	i?: 1;
}

export interface DictHit {
	/** The form's grammar tags, space-separated (empty for the headword). */
	tags: string;
	entry: DictEntry;
	/**
	 * Where the form splits, from the pack: its prefix, stem and plural
	 * marker lengths in characters; the ending is the rest.
	 */
	split?: [number, number, number];
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

/**
 * The tags one reading is sure of: a category that holds two values
 * (cristallise is first- or third-person, indicative or subjunctive)
 * drops out until the sentence settles it. "indicative subjunctive
 * present first-person third-person singular" keeps "present
 * singular".
 */
export function settledTags(tags: string): string {
	const list = tags.split(/\s+/).filter(Boolean);
	const open = new Set(
		[TENSES, MOODS, CASES, GENDERS, PERSONS, NUMBERS]
			.filter((cat) => cat.filter((t) => list.includes(t)).length > 1)
			.flat()
	);
	return list.filter((t) => !open.has(t)).join(" ");
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

/**
 * The card's meaning: the first sense, and the next one too when the
 * first only repeats the word (extension's "extension" says nothing;
 * with "semantic widening" beside it, it does).
 */
function meaningOf(entry: DictEntry): string {
	const first = firstSense(entry);
	if (fold(first) !== fold(entry.w) || entry.s.length < 2) return first;
	const next = firstSense({ ...entry, s: entry.s.slice(1) });
	return next ? `${first}; ${next}` : first;
}

/** The base word, its reading and part of speech: the meaning is already on the card. */
function baseLine(entry: DictEntry): string {
	const reading = entry.r && entry.r !== entry.w ? ` (${entry.r})` : "";
	return `${entry.w}${reading}, ${entry.i ? "irregular verb" : entry.p}`;
}

/** Fold for comparing a form with its headword (curly apostrophes straight). */
function fold(s: string): string {
	return s.normalize("NFC").toLowerCase().replace(/[’ʼ]/g, "'");
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
	// The stem must be most of the headword: gegangen shares only
	// "ge" with gehen, нашёл only "на" with найти.
	if (n < 3 || n < b.length - 3 || n >= a.length) return null;
	return [a.slice(0, n).join(""), a.slice(n).join("")];
}

/** One entry's identity: homographs (der Leiter, die Leiter) stay apart. */
function entryKey(e: DictEntry): string {
	return [e.w, e.p, e.g ?? "", e.r ?? "", e.s.join("\u0001")].join("\u0000");
}

/**
 * Hits for the same entry merge; the most specific tags win, except
 * that the headword itself (no tags) beats a variant spelling of it
 * (Homme filed as an alternative form of homme).
 */
function bestHits(hits: DictHit[]): DictHit[] {
	const out: DictHit[] = [];
	for (const h of hits) {
		const same = out.find((o) => entryKey(o.entry) === entryKey(h.entry));
		if (!same) out.push({ ...h });
		else if (
			same.tags !== "" &&
			(h.tags === "" ||
				formatTags(h.tags).length > formatTags(same.tags).length)
		) {
			same.tags = h.tags;
			if (h.split) same.split = h.split;
			else delete same.split;
		}
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
		"qu'": "that",
		"jusqu'": "until",
		"lorsqu'": "when",
		"puisqu'": "since",
		"quoiqu'": "although"
	},
	it: {
		"l'": "the",
		"un'": "a",
		"dell'": "of the",
		"all'": "to the",
		"nell'": "in the",
		"sull'": "on the",
		"dall'": "from the",
		"quell'": "that",
		"quest'": "this",
		"bell'": "beautiful"
	}
};

/** An elided article or pronoun and the word after it (l'épineuse), in languages that elide. */
function splitElided(word: string, lang: string): [string, string] | null {
	if (lang && !ELIDED[lang]) return null;
	const m = /^(\p{L}{1,6}['’])(\p{L}.+)$/u.exec(word);
	return m ? [m[1]!, m[2]!] : null;
}

/** Definite articles by gender, where the article shows it. */
const ARTICLES: Record<string, Record<string, string>> = {
	fr: { masculine: "le", feminine: "la" },
	de: { masculine: "der", feminine: "die", neuter: "das" },
	es: { masculine: "el", feminine: "la" },
	it: { masculine: "il", feminine: "la" },
	pt: { masculine: "o", feminine: "a" }
};

/**
 * Spanish feminine nouns stressed on a first-syllable a (agua, hambre,
 * águila) take el. Stress by the spelling rules: a written accent
 * says where; otherwise a two-syllable word ending in a vowel, n or s
 * stresses its first.
 */
function stressedA(w: string): boolean {
	const bare = w.toLowerCase().replace(/^h/, "");
	if (bare.startsWith("á")) return true;
	if (!bare.startsWith("a") || /[áéíóú]/.test(bare)) return false;
	const syllables = bare.match(/[aeiouü]+/g)?.length ?? 0;
	return syllables === 2 && /[aeiouns]$/.test(bare);
}

/**
 * A noun's gender as its base form with an article that shows it
 * (la calèche), or the gender's name. Before a vowel or h, where l'
 * hides the gender, French and Italian take the indefinite article
 * (un homme, une heure, un'amica).
 */
function genderFact(entry: DictEntry, lang: string): string | null {
	if (!entry.g) return null;
	const article = ARTICLES[lang]?.[entry.g];
	if (!article) return entry.g;
	const w = entry.w;
	const fem = entry.g === "feminine";
	if (lang === "fr" && /^[aeiouyhàâéèêëîïôûœæ]/iu.test(w))
		return `${fem ? "une" : "un"} ${w}`;
	if (lang === "it" && /^[aeiouàèéìòù]/iu.test(w))
		return fem ? `un'${w}` : `un ${w}`;
	if (lang === "it" && !fem && /^(s[^aeiou]|z|gn|ps|x)/iu.test(w))
		return `lo ${w}`;
	if (lang === "es" && fem && stressedA(w)) return `el ${w}`;
	return `${article} ${w}`;
}

/** A form cut at the pack's lengths: prefix, stem, plural marker, ending. */
function cutForm(
	form: string,
	[a, b, c]: [number, number, number]
): [string, string, string, string] | null {
	const chars = [...form];
	if (a + b + c > chars.length || b === 0) return null;
	return [
		chars.slice(0, a).join(""),
		chars.slice(a, a + b).join(""),
		chars.slice(a + b, a + b + c).join(""),
		chars.slice(a + b + c).join("")
	];
}

/** Marker tags in the order packs pick a form's marker (scripts/dict-morph.ts). */
const MARKERS = ["comparative", "superlative", "plural"] as const;

/**
 * An inflected form's pieces from the pack's split: a prefix carries
 * the form's grammar name (ge- in gemacht), the stem its headword, a
 * marker its own piece (the plural i in taloissa, the comparative er
 * in kleineren), the ending what's left to name.
 */
function packParts(form: string, hit: DictHit, endingName: string): WordPart[] {
	const cut = hit.split ? cutForm(form, hit.split) : null;
	if (!cut) return [];
	const [pre, stem, num, end] = cut;
	const kind = endingKind(hit.tags);
	const tags = hit.tags.split(/\s+/);
	const marker = num ? MARKERS.find((m) => tags.includes(m)) : undefined;
	const endName = marker
		? formatTags(
				settledTags(
					tags
						// A noun's gender is its own fact, as in endingName.
						.filter((t) => t !== marker && !(hit.entry.g && GENDER_TAGS.has(t)))
						.join(" ")
				)
			)
		: endingName;
	const parts: WordPart[] = [];
	if (pre) parts.push({ text: pre, label: endingName, kind });
	parts.push({
		text: stem,
		label: hit.entry.w,
		...(hit.entry.i ? { note: "irregular" } : {}),
		kind: "core"
	});
	if (num)
		parts.push({
			text: num,
			label: marker ?? "",
			kind: marker === "plural" ? "agree" : "derive"
		});
	if (end) parts.push({ text: end, label: pre ? "" : endName, kind });
	return parts.length > 1 ? parts : [];
}

/** A headword's derivation pieces, when they spell the word as written. */
function morphemeParts(form: string, entry: DictEntry): WordPart[] {
	const m = entry.m ?? [];
	if (m.length < 2 || fold(m.map(([t]) => t).join("")) !== fold(form))
		return [];
	return m.map(([text, label, kind]) => ({ text, label, kind }));
}

/**
 * The instant card from dictionary hits: the base word's first sense,
 * the split (the pack's, else where the stem shows; the ending named,
 * its gender left to the gender fact), a headword's derivation pieces,
 * the gender as the article where one shows it, and what the form is
 * only when no split shows it. `matched` is the lookup form the hits
 * came from: the pack's split counts its letters, so a differently
 * spelled match keeps the guessed split. Marked partial; the model's
 * card replaces it. Null without hits.
 */
export function cardFromDictionary(
	quote: string,
	hits: DictHit[],
	lang: string,
	japanese: JaPiece[] = [],
	matched?: string
): WordCard | null {
	return dictionaryCard(quote, hits, lang, japanese, matched)?.card ?? null;
}

/**
 * The pieces the dictionary knows for certain (the pack's split, a
 * headword's derivation, the Japanese analysis), never a guess: the
 * model's card keeps them instead of splitting again. Empty when
 * there are none.
 */
export function knownParts(
	quote: string,
	hits: DictHit[],
	lang: string,
	japanese: JaPiece[] = [],
	matched?: string
): WordPart[] {
	const made = dictionaryCard(quote, hits, lang, japanese, matched);
	return made?.known ? made.card.parts : [];
}

/**
 * Whether every reading the dictionary has for a form comes from one
 * base word. parent is both the noun parent and parer's "they adorn":
 * only the sentence (the model) can tell which, so an instant card
 * from the top reading may be the wrong word.
 */
export function oneBaseWord(hits: DictHit[]): boolean {
	return new Set(bestHits(hits).map((h) => fold(h.entry.w))).size <= 1;
}

/**
 * The facts the dictionary knows (a noun's gender as its article).
 * None when the model split the word as an inflection the dictionary
 * also lists, while the dictionary's top reading is a headword: in
 * "les rues se parent", parent is parer's "they adorn", and the noun
 * le parent's gender would contradict the card.
 */
export function knownFacts(
	quote: string,
	hits: DictHit[],
	lang: string,
	modelParts: readonly WordPart[] = []
): WordFact[] {
	const best = bestHits(hits);
	if (
		modelParts.length > 1 &&
		best[0]?.tags === "" &&
		best.some((h) => h.tags !== "")
	)
		return [];
	return dictionaryCard(quote, hits, lang, [], undefined)?.card.facts ?? [];
}

function dictionaryCard(
	quote: string,
	hits: DictHit[],
	lang: string,
	japanese: JaPiece[],
	matched: string | undefined
): { card: WordCard; known: boolean } | null {
	const best = bestHits(hits);
	const first = best[0];
	if (!first) return null;
	// Every reading of the top word at once (cristallise is first- or
	// third-person, indicative or subjunctive): the card shows what
	// they share, never one picked at random.
	const readings = hits.filter(
		(h) => h.tags !== "" && entryKey(h.entry) === entryKey(first.entry)
	);
	const top =
		first.tags !== "" && readings.length > 1
			? {
					...first,
					tags: [...new Set(readings.flatMap((h) => h.tags.split(/\s+/)))].join(
						" "
					)
				}
			: first;
	const whole = quote
		.normalize("NFC")
		.trim()
		.replace(/^\p{P}+|\p{P}+$/gu, "");
	// An elided article or pronoun is its own piece: l' + épineuse.
	const elided =
		fold(top.entry.w) === fold(whole) ? null : splitElided(whole, lang);
	const form = elided?.[1] ?? whole;
	const lead: WordPart[] = elided
		? [
				{
					text: elided[0],
					label: ELIDED[lang]?.[fold(elided[0])] ?? "",
					kind: "agree"
				}
			]
		: [];
	const isHeadword = fold(top.entry.w) === fold(form);
	// A noun's gender is its own fact, not its ending's.
	const endingTags = top.entry.g
		? top.tags
				.split(/\s+/)
				.filter((t) => !GENDER_TAGS.has(t))
				.join(" ")
		: top.tags;
	// Only what this reading is sure of shows: the sentence (the
	// model's card) names the rest.
	const settled = settledTags(endingTags);
	const unsettled =
		settled !== endingTags.split(/\s+/).filter(Boolean).join(" ");
	const endingName = formatTags(settled);
	// Whether the form has a grammar name at all, settled or not.
	const named = formatTags(endingTags) !== "";
	let parts: WordPart[] = [];
	const sameLetters =
		matched === undefined ||
		[...fold(matched)].length === [...fold(form)].length;
	if (japanese.length > 1) parts = japaneseParts(japanese);
	else if (isHeadword) parts = morphemeParts(form, top.entry);
	else if (sameLetters && named) parts = packParts(form, top, endingName);
	const known = parts.length > 1;
	if (!known && !isHeadword && japanese.length <= 1) {
		const split = stemSplit(form, top.entry.w);
		if (split && named)
			parts = [
				{ text: split[0], label: top.entry.w, kind: "core" },
				{ text: split[1], label: endingName, kind: endingKind(top.tags) }
			];
	}
	// An ending the sentence still has to settle: the model's card
	// names it.
	if (unsettled && !isHeadword && japanese.length <= 1)
		parts = parts.map((p) =>
			p.kind === "core" ? p : { ...p, unsettled: true }
		);
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
		card: {
			meaning: meaningOf(top.entry) || top.entry.w,
			parts,
			facts,
			...(base ? { base } : {}),
			partial: true,
			lang
		},
		known
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
			const cut = h.split ? cutForm(quote.trim(), h.split) : null;
			const pieces = cut ? ` (${cut.filter(Boolean).join(" + ")})` : "";
			const head = what
				? `${quote.trim()}${pieces}: ${what} of ${h.entry.w}. `
				: "";
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
const OPTIONAL_MARKS: Record<
	string,
	{ marks: RegExp; onVowel: boolean; keepFinal?: boolean }
> = {};
for (const [langs, marks, onVowel, keepFinal] of [
	// Wiktionary marks Italian stress inside words (parliàmo); ordinary
	// text writes only a final one (parlò, città).
	[["it"], /[\u0300\u0301]/gu, true, true],
	[["ru"], /[\u0300\u0301\u0308]/gu, true],
	[["uk", "bg"], /[\u0300\u0301]/gu, true],
	[["el"], /[\u0301]/gu, true],
	[["sr"], /[\u0300-\u0302\u0304\u030f\u0311]/gu, true],
	[["la", "grc"], /[\u0304\u0306]/gu, true],
	[["ang"], /[\u0304\u0307]/gu, false],
	[["ar", "fa", "ur"], /[\u0610-\u061a\u064b-\u065f\u0670\u0640]/gu, false],
	[["he"], /[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/gu, false]
] as const)
	for (const lang of langs)
		OPTIONAL_MARKS[lang] = {
			marks,
			onVowel,
			...(keepFinal ? { keepFinal } : {})
		};

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
			? nfd.replace(
					/(\p{L})(\p{M}+)/gu,
					(whole: string, base: string, ms: string, at: number) =>
						rule.keepFinal && at + whole.length === nfd.length
							? whole
							: VOWEL.includes(base.toLowerCase()) ||
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
	add(splitElided(word, lang)?.[1]);
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
