/**
 * Word cards: the structured answer for a single highlighted word.
 * The model splits the word into its pieces (stem, endings, particles)
 * and names each the way courses for that language do; the card shows
 * the literal meaning first, then only what the sentence adds. Each
 * language in the reply menus has a profile: the grammar a learner
 * trips on there (the model checks the word against it), the reading
 * line its script needs, and its direction. Pure: parsing, checking
 * the split against the quote, and the plain-text rendering that
 * flashcards, exports and follow-ups read.
 */

/** What a piece of the word does; each kind has its own color. */
export type WordPartKind =
	"core" | "tense" | "voice" | "role" | "agree" | "derive";

export const WORD_PART_KINDS: readonly WordPartKind[] = [
	"core",
	"tense",
	"voice",
	"role",
	"agree",
	"derive"
];

export interface WordPart {
	text: string;
	/** Pronunciation where the script hides it (kana, pinyin, vowels). */
	reading?: string;
	/** Base form for the core, else the grammar name ("past participle"). */
	label: string;
	/** A second, quieter line under the label ("irregular"). */
	note?: string;
	kind: WordPartKind;
}

/** The multi-word form a word is one part of in its sentence. */
export interface WordConstruction {
	/** What courses call it ("perfect tense", "passé composé"). */
	name: string;
	/** Its words as they stand, … for a gap ("sind … gegangen"). */
	words: string;
	/** The same words word for word in English ("are … gone"). */
	gloss: string;
}

/** The stretch of the sentence around the word and what it means. */
export interface WordPhrase {
	/** "sind … spazieren gegangen" */
	words: string;
	/** "we strolled" */
	meaning: string;
}

export interface WordFact {
	text: string;
	kind: WordPartKind;
}

export interface WordCard {
	/** What the word itself means, literally. */
	meaning: string;
	/** Only when the sentence gives it a sense the literal one lacks. */
	inSentence?: string;
	/** The word's pieces in order; empty when the split didn't check out. */
	parts: WordPart[];
	facts: WordFact[];
	/** The base form and its meaning, for an inflected or derived word. */
	base?: string;
	/** The multi-word form the word is part of here (perfect: sind … gegangen). */
	construction?: WordConstruction;
	/** The phrase around the word and what it means here. */
	phrase?: WordPhrase;
	/** Why this form is used in this sentence. */
	here?: string;
	/** The trap a learner most likely falls into with this word. */
	watch?: string;
	/** Language code the card was made for (direction, lang attribute). */
	lang?: string;
	/** The dictionary's instant card, while the model writes the rest. */
	partial?: boolean;
}

export interface WordProfile {
	name: string;
	/** What the reading line carries, when the script hides the sound. */
	reading?: string;
	rtl?: boolean;
	/** Grammar the model checks the word against, most common first. */
	checklist: string[];
}

const SEMITIC_READING =
	"Latin transliteration with the vowels the script leaves out";

/** One profile per language in the reply menus (languages.ts). */
export const WORD_PROFILES: Record<string, WordProfile> = {
	fr: {
		name: "French",
		checklist: [
			"gender (le or la) and plural",
			"verb form and tense: passé composé, imparfait, passé simple, subjonctif, conditionnel",
			"past participle agreement (with être, or a direct object placed before avoir)",
			"pronominal verbs (se, s')",
			"object pronouns y, en, le, lui and their order",
			"contractions: du, au, des",
			"suffixes that make nouns (-ment, -tion, -age) or adverbs (-ment)",
			"false friends with English"
		]
	},
	de: {
		name: "German",
		checklist: [
			"gender (der, die, das) and plural",
			"case: nominative, accusative, dative, genitive, and what triggers it",
			"adjective endings",
			"separable or inseparable prefix",
			"verb position: second in main clauses, last in subordinate clauses",
			"strong or weak verb; Perfekt with haben or sein",
			"compound nouns: the last part sets the gender",
			"modal particles: doch, ja, mal, eben"
		]
	},
	es: {
		name: "Spanish",
		checklist: [
			"gender and plural",
			"ser or estar",
			"preterite or imperfect",
			"subjunctive and what triggers it",
			"object pronouns attached to the verb (dámelo)",
			"reflexive and impersonal se",
			"por or para",
			"stem-changing and irregular verbs"
		]
	},
	pt: {
		name: "Portuguese",
		checklist: [
			"gender and plural",
			"ser or estar",
			"pretérito perfeito or imperfeito",
			"personal infinitive and future subjunctive",
			"contractions: do, na, pelo, num",
			"object pronoun placement (European and Brazilian differ)",
			"nasal vowels and their spelling"
		]
	},
	it: {
		name: "Italian",
		checklist: [
			"gender and plural",
			"passato prossimo with avere or essere",
			"past participle agreement",
			"articulated prepositions: del, nella, sul",
			"congiuntivo and what triggers it",
			"clitics ci and ne",
			"reflexive verbs"
		]
	},
	ro: {
		name: "Romanian",
		checklist: [
			"gender, including neuter",
			"definite article attached to the end (omul, casa)",
			"case: nominative-accusative, genitive-dative, vocative",
			"subjunctive with să",
			"perfect compus",
			"clitic pronouns and their doubling"
		]
	},
	ru: {
		name: "Russian",
		checklist: [
			"case (six) and what triggers it",
			"gender and number",
			"aspect: imperfective or perfective, and its pair",
			"verbs of motion (идти or ходить)",
			"stress and how it shifts",
			"short-form adjectives",
			"reflexive -ся"
		]
	},
	uk: {
		name: "Ukrainian",
		checklist: [
			"case (seven, with vocative) and what triggers it",
			"gender and number",
			"aspect: imperfective or perfective, and its pair",
			"verbs of motion",
			"stress",
			"vowel and consonant alternations (і and о)"
		]
	},
	pl: {
		name: "Polish",
		checklist: [
			"case (seven, with vocative) and what triggers it",
			"gender, including masculine-personal plurals",
			"aspect: imperfective or perfective, and its pair",
			"verbs of motion",
			"consonant alternations",
			"reflexive się"
		]
	},
	cs: {
		name: "Czech",
		checklist: [
			"case (seven, with vocative) and what triggers it",
			"gender, including animate and inanimate masculine",
			"aspect: imperfective or perfective, and its pair",
			"vowel length (á, ů, í) and what it changes",
			"consonant alternations",
			"reflexive se and si",
			"verbs of motion"
		]
	},
	sk: {
		name: "Slovak",
		checklist: [
			"case (six) and what triggers it",
			"gender, including animate masculine",
			"aspect: imperfective or perfective, and its pair",
			"vowel length and the rhythmic law",
			"reflexive sa and si"
		]
	},
	bg: {
		name: "Bulgarian",
		checklist: [
			"definite article attached to the end (-ът, -та, -то, -те)",
			"gender and number",
			"aspect: imperfective or perfective, and its pair",
			"renarrated mood (told, not seen)",
			"future with ще",
			"clitic pronouns and their doubling"
		]
	},
	sr: {
		name: "Serbian",
		checklist: [
			"case (seven) and what triggers it",
			"gender and number",
			"aspect: imperfective or perfective, and its pair",
			"clitic order (je, se, mi)",
			"Cyrillic and Latin spellings of the same word",
			"pitch accent and vowel length"
		]
	},
	el: {
		name: "Greek",
		checklist: [
			"gender and case: nominative, accusative, genitive, vocative",
			"aspect: perfective or imperfective stem",
			"voice: active or mediopassive (-ομαι)",
			"να with the subjunctive",
			"stress accent and how it moves"
		]
	},
	hu: {
		name: "Hungarian",
		checklist: [
			"suffix chain: case suffixes (about 18) and their order",
			"vowel harmony",
			"possessive suffixes",
			"definite or indefinite conjugation",
			"verbal prefixes (meg-, el-, ki-) and when they split off",
			"word order for focus"
		]
	},
	fi: {
		name: "Finnish",
		checklist: [
			"case (fifteen) and the suffix chain",
			"consonant gradation (kk to k, t to d)",
			"vowel harmony",
			"possessive suffixes",
			"the negative verb (en, et, ei)",
			"partitive or accusative object"
		]
	},
	nl: {
		name: "Dutch",
		checklist: [
			"de or het",
			"separable verbs",
			"verb position: second in main clauses, last in subordinate clauses",
			"perfect with hebben or zijn",
			"diminutive -je",
			"er (er is, ervan)"
		]
	},
	sv: {
		name: "Swedish",
		checklist: [
			"en or ett",
			"definite suffix (-en, -et, -na) and double definiteness",
			"verb second",
			"-s passive and deponent verbs",
			"particle verbs"
		]
	},
	da: {
		name: "Danish",
		checklist: [
			"en or et",
			"definite suffix and double definiteness",
			"verb second",
			"-s passive",
			"silent letters and stød"
		]
	},
	no: {
		name: "Norwegian",
		checklist: [
			"en, ei or et",
			"definite suffix and double definiteness",
			"verb second",
			"-s passive",
			"Bokmål and Nynorsk spellings"
		]
	},
	is: {
		name: "Icelandic",
		checklist: [
			"gender and case (four)",
			"strong or weak declension",
			"definite article attached to the end",
			"verb endings by person",
			"middle voice -st"
		]
	},
	zh: {
		name: "Chinese",
		reading: "pinyin with tone marks",
		checklist: [
			"each character's own meaning",
			"tones",
			"measure words",
			"aspect particles 了, 过, 着",
			"result and direction complements (看完, 拿出来)",
			"把 and 被",
			"separable verbs (睡觉, 见面)",
			"four-character idioms (成语)"
		]
	},
	yue: {
		name: "Cantonese",
		reading: "Jyutping with tone numbers",
		checklist: [
			"each character's own meaning",
			"tones (six)",
			"measure words",
			"aspect particles 咗, 過, 緊",
			"sentence-final particles (啦, 喎, 囉)",
			"Cantonese-only characters (嘅, 冇, 佢)"
		]
	},
	lzh: {
		name: "Classical Chinese",
		reading: "pinyin with tone marks",
		checklist: [
			"each character's classical sense, and how it differs from modern Chinese",
			"function words: 之, 乎, 者, 也, 矣, 焉, 而",
			"a word used as another part of speech (a noun used as a verb)",
			"left-out subjects and objects",
			"classical word order (a pronoun object before a negated verb)"
		]
	},
	ja: {
		name: "Japanese",
		reading: "hiragana for any kanji; none for kana",
		checklist: [
			"kanji readings: on or kun",
			"the verb ending chain: te-form, masu-form, passive, causative, potential, tense",
			"particles",
			"politeness and keigo",
			"transitive and intransitive pairs (開く, 開ける)",
			"nominalizers の and こと",
			"counters",
			"left-out subjects"
		]
	},
	ko: {
		name: "Korean",
		checklist: [
			"the verb ending chain: tense, honorific -시-, speech level",
			"particles",
			"speech level (해요, 합니다, 해)",
			"sound changes around the final consonant",
			"Sino-Korean or native root",
			"left-out subjects"
		]
	},
	vi: {
		name: "Vietnamese",
		checklist: [
			"tones and their marks",
			"classifiers",
			"Sino-Vietnamese compounds",
			"tense and aspect words: đã, đang, sẽ",
			"pronouns chosen by age and relationship",
			"modifiers after the noun"
		]
	},
	th: {
		name: "Thai",
		reading: "romanization with the tone",
		checklist: [
			"tone, from consonant class and tone marks",
			"where the word starts and ends (no spaces)",
			"classifiers",
			"polite particles (ครับ, ค่ะ, นะ)",
			"serial verbs",
			"Pali and Sanskrit loans"
		]
	},
	id: {
		name: "Indonesian",
		checklist: [
			"affixes: me-, ber-, di-, -kan, -i, pe-an",
			"reduplication (plural or variety)",
			"passive di- and object focus",
			"aspect words: sudah, sedang, akan"
		]
	},
	ms: {
		name: "Malay",
		checklist: [
			"affixes: me-, ber-, di-, -kan, -i, pe-an",
			"reduplication",
			"passive di-",
			"aspect words: sudah, sedang, akan"
		]
	},
	tl: {
		name: "Tagalog",
		checklist: [
			"verb focus: -um-, mag-, -in, i-, -an",
			"aspect: completed, ongoing, contemplated (reduplication)",
			"markers ang, ng, sa",
			"the linker na and -ng",
			"Spanish and English loans"
		]
	},
	hi: {
		name: "Hindi",
		checklist: [
			"gender, which verbs and adjectives agree with",
			"postpositions and the oblique case (ने, को, से, में)",
			"ने with past transitive verbs",
			"compound verbs (लेना, देना, जाना)",
			"tū, tum, āp levels",
			"Sanskrit or Persian-Arabic vocabulary"
		]
	},
	ur: {
		name: "Urdu",
		reading: SEMITIC_READING,
		rtl: true,
		checklist: [
			"gender, which verbs and adjectives agree with",
			"postpositions and the oblique case (نے, کو, سے, میں)",
			"نے with past transitive verbs",
			"compound verbs",
			"izafat (-e linking two nouns)",
			"Persian and Arabic loans"
		]
	},
	pa: {
		name: "Punjabi",
		checklist: [
			"gender, which verbs and adjectives agree with",
			"postpositions",
			"tones",
			"ਨੇ with past transitive verbs",
			"compound verbs"
		]
	},
	bn: {
		name: "Bengali",
		checklist: [
			"classifiers (-টা, -টি, -গুলো)",
			"verb endings by person and politeness",
			"compound verbs",
			"postpositions",
			"Sanskrit-derived or native word"
		]
	},
	ta: {
		name: "Tamil",
		checklist: [
			"the suffix chain: case on nouns; tense and person on verbs",
			"sandhi between words",
			"spoken or written Tamil",
			"the honorific plural"
		]
	},
	fa: {
		name: "Persian",
		reading: SEMITIC_READING,
		rtl: true,
		checklist: [
			"ezafe (-e linking a noun and its modifier)",
			"compound verbs (noun + kardan or shodan)",
			"present stem and past stem",
			"mi- for ongoing or habitual",
			"-rā for a definite object",
			"Arabic loans"
		]
	},
	ar: {
		name: "Arabic",
		reading: SEMITIC_READING,
		rtl: true,
		checklist: [
			"root and pattern",
			"verb form (I to X)",
			"gender and number, including the dual",
			"definite article and sun letters",
			"idafa (construct)",
			"case endings, often unwritten",
			"broken plurals"
		]
	},
	he: {
		name: "Hebrew",
		reading: SEMITIC_READING,
		rtl: true,
		checklist: [
			"root and binyan (pa'al, pi'el, hif'il)",
			"gender, which verbs agree with",
			"construct state (smichut)",
			"attached prefixes: ה, ו, ב, ל, מ, ש",
			"vowels the spelling leaves out"
		]
	},
	hbo: {
		name: "Biblical Hebrew",
		reading: SEMITIC_READING,
		rtl: true,
		checklist: [
			"root and binyan",
			"wayyiqtol and other consecutive forms",
			"construct state",
			"attached prefixes and suffixes",
			"vowel points"
		]
	},
	hy: {
		name: "Armenian",
		checklist: [
			"case (seven)",
			"definite article attached to the end (-ը, -ն)",
			"Eastern or Western form",
			"the auxiliary է",
			"suffix chains"
		]
	},
	tr: {
		name: "Turkish",
		checklist: [
			"the suffix chain and its order",
			"vowel harmony",
			"consonant changes (kitap, kitabı)",
			"case",
			"evidential -miş or witnessed -di",
			"possessive suffixes"
		]
	},
	sw: {
		name: "Swahili",
		checklist: [
			"noun class (m-wa, ki-vi) and the agreement it causes",
			"the verb chain: subject, tense, object, root, extensions",
			"tense markers: -na-, -li-, -ta-, -me-",
			"verb extensions: -ia, -ika, -wa, -ana"
		]
	},
	am: {
		name: "Amharic",
		reading: "Latin transliteration, doubled consonants shown",
		checklist: [
			"root and pattern",
			"gender, including on verbs",
			"the verb chain with object suffixes",
			"definite suffix (-u, -wa)",
			"doubled consonants the script doesn't show"
		]
	},
	la: {
		name: "Latin",
		checklist: [
			"case (six) and declension",
			"gender",
			"tense and mood (subjunctive)",
			"voice: passive or deponent",
			"principal parts",
			"participles and the ablative absolute"
		]
	},
	grc: {
		name: "Ancient Greek",
		checklist: [
			"case (five) and declension",
			"tense and aspect: aorist or imperfect",
			"mood: subjunctive, optative",
			"voice: middle or passive",
			"participles",
			"particles: μέν, δέ, γάρ, ἄν",
			"accents and breathings"
		]
	},
	sa: {
		name: "Sanskrit",
		reading: "IAST transliteration",
		checklist: [
			"sandhi: sounds merging at word boundaries",
			"case (eight) and number, including the dual",
			"verb class and voice (parasmaipada, ātmanepada)",
			"compounds (samāsa)",
			"participles and absolutives"
		]
	},
	non: {
		name: "Old Norse",
		checklist: [
			"case (four)",
			"strong or weak declension",
			"definite suffix (-inn)",
			"strong or weak verb",
			"middle voice -sk, -st",
			"umlaut and breaking"
		]
	},
	ang: {
		name: "Old English",
		checklist: [
			"case (four) and grammatical gender",
			"strong or weak noun and verb",
			"verb second",
			"letters þ, ð, æ, ƿ",
			"the modern English word it became"
		]
	},
	sux: {
		name: "Sumerian",
		reading: "transliteration of the cuneiform signs",
		checklist: [
			"logogram or syllabic sign",
			"the verb prefix chain",
			"ergative case (-e)",
			"the noun phrase chain: possessive, plural, case at the end",
			"determinatives (dingir, ki, giš)"
		]
	},
	akk: {
		name: "Babylonian",
		reading: "transliteration of the cuneiform signs",
		checklist: [
			"root and pattern",
			"case: -um, -am, -im",
			"construct state",
			"verb stem: G, D, Š, N",
			"preterite, perfect or durative",
			"Sumerian logograms and determinatives"
		]
	}
};

/** Checklist for a passage whose language is unknown. */
const GENERIC_CHECKLIST = [
	"inflection: tense, case, person, number",
	"gender and agreement",
	"prefixes and suffixes that change the meaning",
	"idioms and fixed expressions",
	"false friends with English"
];

const SCRIPT_LANGS: ReadonlyArray<[RegExp, string]> = [
	[/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "ja"],
	[/\p{Script=Hangul}/u, "ko"],
	[/\p{Script=Han}/u, "zh"],
	[/\p{Script=Hebrew}/u, "he"],
	[/\p{Script=Arabic}/u, "ar"],
	[/\p{Script=Thai}/u, "th"],
	[/\p{Script=Devanagari}/u, "hi"],
	[/\p{Script=Bengali}/u, "bn"],
	[/\p{Script=Gurmukhi}/u, "pa"],
	[/\p{Script=Tamil}/u, "ta"],
	[/\p{Script=Ethiopic}/u, "am"],
	[/\p{Script=Armenian}/u, "hy"],
	[/\p{Script=Greek}/u, "el"]
];

/**
 * The passage's language: the chat's or story's own when it has a
 * profile, else what the quote's script gives away (kana is Japanese,
 * Hangul Korean). Latin and Cyrillic scripts say too little; null
 * leaves it to the model.
 */
export function wordCardLang(
	quote: string,
	known: string | null | undefined
): string | null {
	if (known && WORD_PROFILES[known]) return known;
	for (const [re, code] of SCRIPT_LANGS) if (re.test(quote)) return code;
	return null;
}

const DENSE_SCRIPT =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/**
 * One word, so it gets a word card: no spaces, no sentence punctuation
 * inside. Scripts written without spaces (Chinese, Japanese, Thai) cap
 * at eight characters so a whole clause still gets prose.
 */
export function isWordQuote(quote: string): boolean {
	const q = quote.trim();
	if (!q || /\s/u.test(q)) return false;
	const inner = q.replace(/^\p{P}+|\p{P}+$/gu, "");
	if (!inner || /[.!?;:,。、，！？；：]/u.test(inner)) return false;
	const length = [...inner].length;
	return DENSE_SCRIPT.test(inner) ? length <= 8 : length <= 40;
}

// Labels leave room for a full grammar name ("present indicative,
// third-person singular"): the card shortens it for display.
const MAX = { short: 80, label: 64, line: 320 } as const;

function text(raw: unknown, max: number): string | undefined {
	if (typeof raw !== "string") return undefined;
	const t = raw.replace(/\s+/g, " ").trim();
	if (!t) return undefined;
	return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function kind(raw: unknown): WordPartKind {
	return WORD_PART_KINDS.includes(raw as WordPartKind)
		? (raw as WordPartKind)
		: "core";
}

/** Letters only, case- and form-folded: the split must spell the quote. */
function spelling(s: string): string {
	return s
		.normalize("NFC")
		.toLowerCase()
		.replace(/[\s\p{P}ـ]/gu, "");
}

/**
 * A card from untrusted JSON (a model reply or stored drafts): fields
 * clipped to size, unknown kinds read as core, at most three facts.
 * A split that doesn't spell the quote is dropped (the card keeps its
 * meaning and notes). No meaning, no card.
 */
export function cleanWordCard(raw: unknown, quote: string): WordCard | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const meaning = text(r.meaning, MAX.short);
	if (!meaning) return null;
	const parts: WordPart[] = [];
	if (Array.isArray(r.parts)) {
		for (const p of r.parts) {
			if (!p || typeof p !== "object") continue;
			const o = p as Record<string, unknown>;
			const t = text(o.text, MAX.label);
			if (!t) continue;
			const reading = text(o.reading, MAX.label);
			const note = text(o.note, MAX.label);
			parts.push({
				text: t,
				...(reading ? { reading } : {}),
				label: text(o.label, MAX.label) ?? "",
				...(note ? { note } : {}),
				kind: kind(o.kind)
			});
		}
	}
	const spelled =
		parts.length > 0 &&
		spelling(parts.map((p) => p.text).join("")) === spelling(quote);
	const facts: WordFact[] = [];
	if (Array.isArray(r.facts)) {
		for (const f of r.facts) {
			if (facts.length === 3) break;
			const o =
				f && typeof f === "object" ? (f as Record<string, unknown>) : {};
			const t = text(o.text, MAX.short);
			if (t) facts.push({ text: t, kind: kind(o.kind) });
		}
	}
	const inSentence = text(r.inSentence, MAX.line);
	// A base the core piece's label already names says nothing new.
	const baseLine = text(r.base, MAX.line);
	const baseHead = baseLine?.split(/\s*[→=]\s*/)[0];
	const base =
		baseHead &&
		spelled &&
		parts.some(
			(p) => p.kind === "core" && spelling(p.label) === spelling(baseHead)
		)
			? undefined
			: baseLine;
	const here = text(r.here, MAX.line);
	const field = (raw: unknown, key: string): string | undefined =>
		raw && typeof raw === "object"
			? text((raw as Record<string, unknown>)[key], MAX.short)
			: undefined;
	const cName = field(r.construction, "name");
	const cWords = field(r.construction, "words");
	const cGloss = field(r.construction, "gloss");
	const construction =
		cName && cWords && cGloss
			? { name: cName, words: cWords, gloss: cGloss }
			: undefined;
	const pWords = field(r.phrase, "words");
	const pMeaning = field(r.phrase, "meaning");
	const phrase =
		pWords && pMeaning ? { words: pWords, meaning: pMeaning } : undefined;
	const watch = text(r.watch, MAX.line);
	const lang = text(r.lang, 12);
	const partial = r.partial === true;
	return {
		meaning,
		...(inSentence && inSentence !== meaning ? { inSentence } : {}),
		parts: spelled ? parts : [],
		facts,
		...(base ? { base } : {}),
		...(construction ? { construction } : {}),
		...(phrase ? { phrase } : {}),
		...(here ? { here } : {}),
		...(watch ? { watch } : {}),
		...(lang ? { lang } : {}),
		...(partial ? { partial } : {})
	};
}

/**
 * A card from the model's reply: the JSON object it was asked for,
 * fenced or bare. Null when there is no parsable object.
 */
export function parseWordCard(reply: string, quote: string): WordCard | null {
	const start = reply.indexOf("{");
	const end = reply.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		return cleanWordCard(JSON.parse(reply.slice(start, end + 1)), quote);
	} catch {
		return null;
	}
}

/** True when a reply was trying to be JSON (and so isn't prose). */
export function looksLikeJson(reply: string): boolean {
	return /^\s*(```|\{)/.test(reply);
}

/**
 * The card as plain lines (meaning first): what flashcards, exports
 * and follow-up replays read, and the note when a card can't render.
 */
export function wordCardText(card: WordCard): string {
	const lines = [card.meaning];
	if (card.inSentence) lines.push(`In this sentence: ${card.inSentence}`);
	if (card.parts.length > 1)
		lines.push(
			card.parts
				.map((p) => (p.label ? `${p.text} (${p.label})` : p.text))
				.join(" + ")
		);
	if (card.construction)
		lines.push(
			`${card.construction.name}: ${card.construction.words} (${card.construction.gloss})`
		);
	if (card.facts.length > 0)
		lines.push(card.facts.map((f) => f.text).join(" · "));
	if (card.base) lines.push(card.base);
	if (card.phrase) lines.push(`${card.phrase.words} → ${card.phrase.meaning}`);
	if (card.here) lines.push(card.here);
	if (card.watch) lines.push(`Watch: ${card.watch}`);
	return lines.join("\n");
}

/** Grammar words drawn as numbers and symbols on the card. */
const GRAMMAR_SHORT: Array<[RegExp, string]> = [
	[/\bfirst[- ]person\b/gi, "1st"],
	[/\bsecond[- ]person\b/gi, "2nd"],
	[/\bthird[- ]person\b/gi, "3rd"],
	[/\bsingular\b/gi, "👤"],
	[/\bplural\b/gi, "👨‍👨‍👧‍👦"],
	[/\b(?:continuous|progressive)\b/gi, "🔁"],
	[/\bpresent\b/gi, "▶"],
	[/\bpast\b/gi, "⏪"],
	[/\bfuture\b/gi, "⏩"]
];

/**
 * A grammar label in short (owner, 2026-10-24): persons as 1st, 2nd,
 * 3rd; singular 👤, plural 👨‍👨‍👧‍👦; present ▶, past ⏪, future ⏩,
 * continuous 🔁. For grammar labels only: a stem's label is its base
 * word and stays as written. Pure.
 */
export function shortGrammar(label: string): string {
	let out = label;
	for (const [word, short] of GRAMMAR_SHORT) out = out.replace(word, short);
	return out.replace(/\s{2,}/g, " ").trim();
}

/** What a card's word row shows. */
export interface WordRow {
	/** The article in ghost before the word ("une"), when the gender
	 * fact would only repeat the word with it. */
	article: string;
	/** The pieces to draw; empty when the row would add nothing. */
	parts: WordPart[];
	/** The facts left to draw as pills. */
	facts: WordFact[];
	/** The gender under the stem ("m.", "f.", "n."), when the gender
	 * fact names another form of this word (le lycéen for lycéens). */
	gender: string;
}

/** Articles that show a noun's gender, in the languages whose gender
 * facts carry one (l' and plural articles hide it). */
const ARTICLE_GENDER: Record<string, string> = {
	le: "m.",
	un: "m.",
	der: "m.",
	el: "m.",
	il: "m.",
	lo: "m.",
	uno: "m.",
	o: "m.",
	um: "m.",
	la: "f.",
	une: "f.",
	die: "f.",
	una: "f.",
	"un'": "f.",
	a: "f.",
	uma: "f.",
	das: "n."
};

/**
 * The word row without repeats: a label that only repeats its piece
 * goes (extension labeled extension), and a gender fact that is just
 * an article and this very word (une extension) becomes the ghost
 * article before the word instead of a pill, as does one for a
 * singular word's base (das Ausreiseverbot for Ausreiseverbots). A
 * gender fact for a plural's base (le lycéen for lycéens) becomes a
 * gender letter under the stem. A lone piece with nothing to add shows only to carry the
 * article or the letter. Pure.
 */
export function cardWordRow(card: WordCard, quote: string): WordRow {
	const word = spelling(quote);
	const stems = new Set(
		card.parts
			.filter((p) => p.kind === "core")
			.flatMap((p) => [spelling(p.text), spelling(p.label)])
	);
	// A singular word with an ending (Ausreiseverbot + s): its pieces up
	// to the last stem spell the base, and the article still reads
	// right before it. A plural (lycéen + s) or a word that opens with
	// its own article (l' + annonce) takes the letter instead.
	const lastCore = card.parts.map((p) => p.kind).lastIndexOf("core");
	const singularBase =
		lastCore >= 0 &&
		card.parts[0]?.kind === "core" &&
		!card.parts.some((p) => /plural/i.test(p.label))
			? spelling(
					card.parts
						.slice(0, lastCore + 1)
						.map((p) => p.text)
						.join("")
				)
			: "";
	let article = "";
	let gender = "";
	const facts = card.facts.filter((f) => {
		if (article || gender) return true;
		const m = /^(\p{L}{1,4}['’]|\p{L}{1,4}\s+)(.+)$/u.exec(f.text.trim());
		if (!m) return true;
		const said = m[1]!.trim();
		const base = spelling(m[2]!);
		if (base === word || base === singularBase) {
			article = said;
			return false;
		}
		const g = ARTICLE_GENDER[said.toLowerCase().replace("’", "'")];
		if (!g || !stems.has(base)) return true;
		gender = g;
		return false;
	});
	const parts = card.parts.map((p) =>
		p.label && spelling(p.label) === spelling(p.text) ? { ...p, label: "" } : p
	);
	const adds = parts.length > 1 || parts.some((p) => p.label !== "" || p.note);
	if (adds) return { article, parts, facts, gender };
	if (!article && !gender) return { article, parts: [], facts, gender };
	const text = quote.trim().replace(/^\p{P}+|\p{P}+$/gu, "");
	return {
		article,
		parts: parts.length === 1 ? parts : [{ text, label: "", kind: "core" }],
		facts,
		gender
	};
}

/** Text direction for a card's word and passage. */
export function wordCardDir(lang: string | undefined): "rtl" | "ltr" {
	return lang && WORD_PROFILES[lang]?.rtl ? "rtl" : "ltr";
}

/**
 * Messages asking for a word card. The literal meaning leads: a
 * learner meets "raining" in "raining cats and dogs" and wants
 * raining first; the idiom's sense goes in inSentence. Labels use the
 * names courses for the language use (passé composé stays French,
 * past participle stays English); the checklist is that language's
 * usual traps. Pure.
 */
export function buildWordCardMessages(
	q: { quote: string; context: string },
	lang: string | null,
	opts: {
		inPassageLang?: boolean;
		dictionary?: string;
		/** The dictionary already split the word: no parts asked for. */
		knownParts?: boolean;
	} = {}
): Array<{ role: string; content: string }> {
	const profile = lang ? WORD_PROFILES[lang] : undefined;
	const tongue = opts.inPassageLang
		? "the passage's own language, in plain words an intermediate learner reads easily"
		: "English";
	const langLine = profile
		? `The passage is in ${profile.name}.`
		: "Work out the passage's language first.";
	const reading = profile?.reading
		? `"reading": ${profile.reading}, on the pieces that need it; leave it out elsewhere.`
		: `"reading": leave it out.`;
	const checklist = (profile?.checklist ?? GENERIC_CHECKLIST)
		.map((c) => `- ${c}`)
		.join("\n");
	const system =
		`You make a word card for a language learner who highlighted one word ` +
		`in a passage they are reading. ${langLine} Reply with one JSON object ` +
		`and nothing else, no markdown:\n` +
		`{"meaning": "", "parts": [{"text": "", "reading": "", ` +
		`"label": "", "kind": ""}], "facts": [{"text": "", "kind": ""}], ` +
		`"base": "", "construction": {"name": "", "words": "", "gloss": ""}, ` +
		`"phrase": {"words": "", "meaning": ""}, "watch": ""}\n` +
		`Write every field in ${tongue}.\n` +
		`"meaning": what the word itself means, literally: its dictionary ` +
		`sense, in the same form where the language allows ("being ironic" ` +
		`for a present participle, "crossed" for a past one), a few words. ` +
		`Never the sense of an idiom or larger phrase it sits in.\n` +
		(opts.knownParts
			? `"parts": [] always: the dictionary already split the word.\n`
			: `"parts": the word split into its meaningful pieces, in order; the ` +
				`pieces joined must spell the word exactly as highlighted. A word ` +
				`with no inner structure is one piece. ${reading} "label": for the ` +
				`piece carrying the meaning, its base form ("ironiser"); for the ` +
				`others, the short grammar name English-language courses for this ` +
				`language use ("past participle", "passé composé", "te-form", ` +
				`"dative"), never an abbreviation.\n` +
				`"kind": core (the stem or root), tense (tense, aspect, mood, or a ` +
				`form such as participle or infinitive), voice (passive, causative, ` +
				`ability, negation, a prefix that changes the verb), role (case, ` +
				`particles or prepositions attached: the word's job in the sentence), ` +
				`agree (gender, number, person, politeness, an attached article), ` +
				`derive (a piece that turns it into a noun, adjective or adverb).\n`) +
		`"facts": where nouns take a gendered article, the noun's gender as ` +
		`its base form with that article ("la calèche", "der Tisch"), never ` +
		`as "feminine noun"; where the definite article elides and hides ` +
		`the gender, the indefinite one ("une annonce", never "l'annonce" ` +
		`or "la annonce"); [] otherwise.\n` +
		`"base": the base form and its meaning as "base → meaning", a few ` +
		`words ("épineux → thorny, spiky"), only when the base is spelled ` +
		`unlike the word's core piece (épineuse from épineux, yeux from ` +
		`œil). Leave it out when they match (calèches: the piece is ` +
		`calèche), a piece's label already names the base (ironis labeled ` +
		`ironiser) or a fact already gives it.\n` +
		`"construction": only when the word is one part of a multi-word ` +
		`grammatical form in this sentence (a helper verb with a participle ` +
		`or infinitive: a perfect, passive or future; a verb with its ` +
		`separated prefix; a reflexive pronoun): "name", the form's name ` +
		`as English-language courses give it ("perfect tense", "passé ` +
		`composé", "passive"); "words", only the form's own words (the ` +
		`helper, prefix or pronoun and the highlighted word) as they stand, ` +
		`with … for everything between them ("sind … gegangen", never ` +
		`"sind … spazieren gegangen"); "gloss", those words word for word ` +
		`in English, keeping the gaps ("are … gone"). Leave it out ` +
		`otherwise.\n` +
		`"phrase": the stretch of the sentence around the word that means ` +
		`one thing together, as it stands, with … for a gap ("sind … ` +
		`spazieren gegangen", "pleut des cordes"), and "meaning": what it ` +
		`means here in plain words, as few as do ("we strolled", "it's ` +
		`pouring"). Leave it out when the stretch would be the word alone. ` +
		`Say only what the passage says.\n` +
		`"watch": one short sentence, only for a trap learners really fall ` +
		`into with this word (a false friend, a form or gender commonly ` +
		`got wrong), saying nothing the facts already say. Most words have ` +
		`none: then leave it out.\n` +
		`Checklist:\n${checklist}` +
		(opts.dictionary
			? `\nDictionary entries for the word. Trust their forms and base ` +
				`words; choose the sense that fits the passage, and give a sense ` +
				`none of them lists only when the passage plainly needs it:\n` +
				opts.dictionary
			: "");
	return [
		{ role: "system", content: system },
		{
			role: "user",
			content: `Paragraph:\n${q.context}\n\nHighlighted: "${q.quote.trim()}"`
		}
	];
}
