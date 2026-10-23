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
	"prepositional"
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

function firstSense(entry: DictEntry): string {
	const s = entry.s[0] ?? "";
	const cut = s.split(";")[0] ?? s;
	return cut.trim();
}

function baseLine(entry: DictEntry): string {
	const reading = entry.r && entry.r !== entry.w ? ` (${entry.r})` : "";
	return `${entry.w}${reading}, ${entry.p}: ${entry.s.slice(0, 3).join("; ")}`;
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

/**
 * The instant card from dictionary hits: what the form is (or the
 * headword's first sense), the split where the stem shows, gender,
 * and the base word's senses. Marked partial; the model's card
 * replaces it. Null without hits.
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
	const form = quote.trim().replace(/^\p{P}+|\p{P}+$/gu, "");
	const tagName = formatTags(top.tags);
	const isHeadword = fold(top.entry.w) === fold(form);
	const meaning =
		!isHeadword && tagName
			? `${tagName} of ${top.entry.w}`
			: firstSense(top.entry);
	let parts: WordPart[] = [];
	if (japanese.length > 1) parts = japaneseParts(japanese);
	else if (!isHeadword) {
		const split = stemSplit(form, top.entry.w);
		if (split && tagName)
			parts = [
				{ text: split[0], label: top.entry.w, kind: "core" },
				{ text: split[1], label: tagName, kind: endingKind(top.tags) }
			];
	}
	const facts = top.entry.g
		? [{ text: top.entry.g, kind: "agree" as const }]
		: [];
	return {
		meaning: meaning || top.entry.w,
		parts,
		facts,
		base: baseLine(top.entry),
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

/**
 * Forms to look a quote up by: the word without edge punctuation, and
 * for elided articles and pronouns (l'homme, qu'il, dell'acqua) the
 * word after the apostrophe too.
 */
export function lookupForms(quote: string): string[] {
	const word = quote.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
	if (!word) return [];
	const forms = [word];
	const elided = /^\p{L}{1,4}['’](\p{L}.+)$/u.exec(word);
	if (elided?.[1]) forms.push(elided[1]);
	return forms;
}

/** The first form with hits wins: the whole word before its parts. */
export function firstHits(lists: DictHit[][]): DictHit[] {
	return lists.find((l) => l.length > 0) ?? [];
}
