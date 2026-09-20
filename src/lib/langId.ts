import { ttsLangFor } from "./reading";

/**
 * Offline language identifier for non-Apple platforms, where the
 * `tts_identify_lang` bridge returns None (no `NLLanguageRecognizer`
 * off macOS/iOS).
 *
 * Two layers, both fully offline with no downloads:
 * - Non-Latin scripts resolve by Unicode script via `ttsLangFor`
 *   (reliable, needs no statistics).
 * - Latin scripts score a small stop-word list per language (English,
 *   French, German, Spanish, Italian, Portuguese, Dutch). Short or
 *   scoreless samples yield null and callers keep their fallback.
 *
 * Pure and unit-tested. The Rust bridge carries a matching word-list
 * scorer so `tts_identify_lang` answers off-Apple too; this TS copy
 * covers the browser preview and jsdom, where there is no bridge.
 */

/**
 * Shared function words vote in every list they belong to (que, la,
 * un, entre, mais, …) — the margin rule below lets the majority
 * decide. Kept OUT are one-list words that collide with another
 * list's core (an/am/im/is/was/do/we/on/sur/no/ma/si/da/su/mi/tu,
 * war/hat/alle/rond/door/via/plus/will/son). The Rust scorer in
 * src-tauri/src/langid.rs carries the same lists so shell and
 * preview agree.
 */
const STOP_WORDS: Array<{ lang: string; words: string[] }> = [
	{
		lang: "en-US",
		words: [
			"the",
			"and",
			"that",
			"have",
			"with",
			"this",
			"from",
			"they",
			"would",
			"there",
			"are",
			"you",
			"your",
			"yours",
			"our",
			"ours",
			"them",
			"their",
			"theirs",
			"it",
			"its",
			"were",
			"has",
			"had",
			"shall",
			"should",
			"can",
			"cannot",
			"could",
			"must",
			"may",
			"might",
			"does",
			"did",
			"done",
			"each",
			"other",
			"such",
			"than",
			"then",
			"these",
			"those",
			"when",
			"where",
			"which",
			"while",
			"who",
			"whom",
			"whose",
			"because",
			"about",
			"into",
			"over",
			"under",
			"between",
			"both",
			"few",
			"more",
			"most",
			"some",
			"only",
			"own",
			"same",
			"too",
			"very",
			"often",
			"always",
			"never",
			"every",
			"all",
			"to",
			"for",
			"not",
			"what",
			"out",
			"here",
			"how",
			"why",
			"now"
		]
	},
	{
		lang: "fr-FR",
		words: [
			"les",
			"des",
			"une",
			"que",
			"est",
			"dans",
			"pour",
			"vous",
			"avec",
			"pas",
			"la",
			"le",
			"un",
			"du",
			"au",
			"aux",
			"et",
			"sont",
			"ont",
			"fait",
			"tout",
			"tous",
			"toute",
			"toutes",
			"cette",
			"ces",
			"ses",
			"mes",
			"leur",
			"leurs",
			"notre",
			"votre",
			"mon",
			"sous",
			"suis",
			"sommes",
			"êtes",
			"où",
			"ça",
			"mais",
			"entre"
		]
	},
	{
		lang: "de-DE",
		words: [
			"der",
			"die",
			"und",
			"den",
			"von",
			"mit",
			"ist",
			"das",
			"sich",
			"nicht",
			"eine",
			"einer",
			"einem",
			"einen",
			"eines",
			"ein",
			"auch",
			"noch",
			"nur",
			"schon",
			"sehr",
			"mehr",
			"oder",
			"aber",
			"wenn",
			"dann",
			"weil",
			"wird",
			"werden",
			"sind",
			"haben",
			"hatte",
			"hatten",
			"wurde",
			"wurden",
			"kein",
			"keine",
			"keiner",
			"keinen",
			"dieser",
			"diese",
			"dieses",
			"diesen",
			"diesem",
			"jeder",
			"jede",
			"jedes",
			"jeden",
			"allem",
			"aller",
			"alles",
			"beim",
			"zum",
			"zur",
			"vom",
			"aus",
			"bei",
			"nach",
			"durch",
			"gegen",
			"ohne",
			"zwischen",
			"bis",
			"zu",
			"vor",
			"hinter",
			"neben",
			"seit",
			"statt",
			"trotz",
			"während",
			"wegen",
			"für",
			"über",
			"dich",
			"euch",
			"uns"
		]
	},
	{
		lang: "es-ES",
		words: [
			"los",
			"las",
			"una",
			"que",
			"está",
			"para",
			"con",
			"por",
			"como",
			"pero",
			"la",
			"un",
			"el",
			"unos",
			"unas",
			"sino",
			"aunque",
			"porque",
			"donde",
			"dónde",
			"cuando",
			"cuándo",
			"cómo",
			"qué",
			"cuál",
			"están",
			"este",
			"esta",
			"estos",
			"estas",
			"eso",
			"esa",
			"aquí",
			"muy",
			"también",
			"siempre",
			"nunca",
			"más",
			"menos",
			"hasta",
			"desde",
			"sobre",
			"contra",
			"según",
			"durante",
			"mediante",
			"hacia",
			"tras",
			"bajo",
			"entre",
			"mes",
			"del",
			"al",
			"poco",
			"cosa"
		]
	},
	{
		lang: "it-IT",
		words: [
			"che",
			"una",
			"della",
			"sono",
			"come",
			"più",
			"anche",
			"nostra",
			"questo",
			"molto",
			"la",
			"le",
			"un",
			"uno",
			"di",
			"dello",
			"degli",
			"delle",
			"del",
			"al",
			"dal",
			"dallo",
			"dalla",
			"dai",
			"dagli",
			"dalle",
			"nel",
			"nello",
			"nella",
			"nei",
			"negli",
			"nelle",
			"sul",
			"sullo",
			"sulla",
			"sui",
			"sugli",
			"sulle",
			"non",
			"quando",
			"è",
			"ho",
			"hai",
			"dove",
			"perché",
			"poiché",
			"mentre",
			"tanto",
			"troppo",
			"poco",
			"tutto",
			"tutti",
			"ogni",
			"questa",
			"questi",
			"queste",
			"quello",
			"quella",
			"stesso",
			"stessa",
			"sopra",
			"sotto",
			"dentro",
			"fuori",
			"senza",
			"contro",
			"verso",
			"durante",
			"secondo",
			"oltre",
			"attraverso",
			"lungo",
			"presso",
			"circa",
			"quasi",
			"forse",
			"sempre",
			"mai",
			"già",
			"ancora",
			"appena",
			"insieme",
			"meno",
			"bene",
			"cosa",
			"niente",
			"nulla",
			"qualcosa",
			"qualcuno",
			"altro",
			"altra",
			"altri",
			"altre"
		]
	},
	{
		lang: "pt-PT",
		words: [
			"que",
			"uma",
			"para",
			"com",
			"não",
			"como",
			"mais",
			"seus",
			"entre",
			"muito",
			"ao",
			"aos",
			"numa",
			"este",
			"esta",
			"estes",
			"estas",
			"esse",
			"essa",
			"isso",
			"isto",
			"aquele",
			"aquela",
			"aquilo",
			"menos",
			"desde",
			"sobre",
			"nunca",
			"sempre",
			"tanto",
			"quando",
			"porque",
			"tudo",
			"todos",
			"todas",
			"todo",
			"toda",
			"cada",
			"qual",
			"quais",
			"onde",
			"pois",
			"é",
			"são",
			"está",
			"estão",
			"embora",
			"também",
			"ainda",
			"já",
			"até",
			"tão",
			"segundo",
			"durante",
			"através",
			"sem"
		]
	},
	{
		lang: "nl-NL",
		words: [
			"van",
			"het",
			"een",
			"dat",
			"die",
			"voor",
			"met",
			"zijn",
			"niet",
			"ook",
			"ik",
			"wij",
			"jullie",
			"zij",
			"ze",
			"mij",
			"jou",
			"jouw",
			"hem",
			"haar",
			"hen",
			"hun",
			"ons",
			"dit",
			"deze",
			"daar",
			"waar",
			"wanneer",
			"hoe",
			"één",
			"waarom",
			"omdat",
			"terwijl",
			"maar",
			"dus",
			"toch",
			"wel",
			"te",
			"geen",
			"nooit",
			"altijd",
			"soms",
			"vaak",
			"alleen",
			"samen",
			"tussen",
			"zonder",
			"naar",
			"uit",
			"tegen",
			"tijdens",
			"volgens",
			"wegens",
			"dankzij",
			"ondanks",
			"behalve",
			"naast",
			"boven",
			"onder",
			"langs",
			"tenzij",
			"zodat",
			"zodra",
			"voordat",
			"nadat",
			"totdat",
			"alsof",
			"evenals",
			"mits",
			"zelfs",
			"zelf",
			"elkaar"
		]
	}
];

/** Minimum scored words before a Latin sample counts as classifiable. */
export const LANG_ID_MIN_WORDS = 10;

/** Minimum winning score before a Latin sample counts as identified. */
export const LANG_ID_MIN_SCORE = 2;

function latinTokens(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[']/g, "")
		.split(/[^a-zà-ÿ]+/u)
		.filter((token) => token.length > 0);
}

/** Stop-word hits per language for already-tokenized text. */
function stopCounts(tokens: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const entry of STOP_WORDS) {
		let score = 0;
		for (const word of entry.words) {
			for (const token of tokens) {
				if (token === word) score += 1;
			}
		}
		counts.set(entry.lang, score);
	}
	return counts;
}

/** Leading entry and its margin over the runner-up. */
function leader(counts: Map<string, number>): {
	lang: string | null;
	score: number;
	margin: number;
} {
	let best: string | null = null;
	let bestScore = 0;
	let second = 0;
	for (const [lang, score] of counts) {
		if (score > bestScore) {
			second = bestScore;
			bestScore = score;
			best = lang;
		} else if (score > second) {
			second = score;
		}
	}
	return { lang: best, score: bestScore, margin: bestScore - second };
}

/**
 * BCP-47 tag for `text`, or null when it cannot be told apart.
 * Script-detected languages return with the empty-fallback sentinel
 * (""), exactly like `ttsLangFor` callers already treat them.
 */
export function identifyLangOffline(text: string): string | null {
	const trimmed = text.trim();
	if (trimmed.length === 0) return null;
	const scriptLang = ttsLangFor(trimmed, "");
	if (scriptLang) return scriptLang;
	const tokens = latinTokens(trimmed);
	if (tokens.length < LANG_ID_MIN_WORDS) return null;
	const { lang, score } = leader(stopCounts(tokens));
	if (lang === null || score < LANG_ID_MIN_SCORE) return null;
	return lang;
}

/**
 * Short-sample identification for single sentences and highlights
 * below `LANG_ID_MIN_WORDS`: stop-word hits plus orthographic votes
 * (diacritics, ß, elisions, German mid-sentence capitals and noun
 * suffixes, Dutch ij). Needs a score of 2 with a clear margin, so
 * scoreless or contested fragments still return null and callers
 * keep their seed voice.
 *
 * Pure and unit-tested.
 */
export function identifyLangShort(text: string): string | null {
	const trimmed = text.trim();
	if (trimmed.length === 0) return null;
	const scriptLang = ttsLangFor(trimmed, "");
	if (scriptLang) return scriptLang;
	const tokens = latinTokens(trimmed);
	if (tokens.length === 0) return null;
	const counts = stopCounts(tokens);
	const bump = (lang: string, n: number): void => {
		counts.set(lang, (counts.get(lang) ?? 0) + n);
	};
	// German: ß and umlauts, capitalized nouns past the first word,
	// characteristic noun/adjective suffixes on longer words. Capitals
	// read off the raw text: tokens arrive lowercased.
	if (/ß/i.test(trimmed)) bump("de-DE", 3);
	// Umlauts barely occur outside German, so one is already a vote.
	const hasUmlaut = tokens.some((t) => /[äöü]/.test(t));
	if (hasUmlaut) bump("de-DE", 2);
	const rawWords = trimmed.split(/[^A-Za-zÀ-ÿ]+/).filter((w) => w.length > 0);
	const caps = rawWords
		.slice(1)
		.filter((w) => /^[A-ZÀ-Þ][a-zà-ÿ]+$/.test(w)).length;
	bump("de-DE", Math.min(3, caps));
	const deSuffix = tokens.filter(
		(t) =>
			t.length > 4 &&
			/(ung|heit|keit|isch|lich|los|bar|sam|haft|tum)$/.test(t)
	).length;
	bump("de-DE", Math.min(2, deSuffix));
	// French: accented words, guillemets, single-letter elisions
	// (raw text: tokenizing strips straight apostrophes).
	const frWords = tokens.filter((t) => /[éèêëàâîïôùûçœæ]/.test(t)).length;
	bump("fr-FR", Math.min(3, frWords));
	if (/[«»]/.test(trimmed)) bump("fr-FR", 2);
	const elisions = trimmed.match(/\b[ldcjnmqstvy]['’]/gi)?.length ?? 0;
	bump("fr-FR", Math.min(2, elisions));
	// Spanish: ñ, accented vowels, inverted marks.
	if (/ñ/i.test(trimmed)) bump("es-ES", 3);
	const esWords = tokens.filter((t) => /[áéíóúü]/.test(t)).length;
	bump("es-ES", Math.min(3, esWords));
	if (/[¿¡]/.test(trimmed)) bump("es-ES", 2);
	// Italian and Portuguese: accented vowels.
	const itWords = tokens.filter((t) => /[àèéìòù]/.test(t)).length;
	bump("it-IT", Math.min(3, itWords));
	const ptWords = tokens.filter((t) => /[ãõâêô]/.test(t)).length;
	bump("pt-PT", Math.min(3, ptWords));
	// Dutch: ij inside words.
	const ijWords = tokens.filter((t) => /ij/.test(t)).length;
	bump("nl-NL", Math.min(3, ijWords));
	const { lang, score, margin } = leader(counts);
	// A lone hit with no contest still reads on a tiny fragment
	// (der Hund, the cat); anything longer or contested needs a
	// real lead.
	if (lang === null) return null;
	if (score < 2) {
		if (score === 1 && margin === 1 && tokens.length <= 4) return lang;
		return null;
	}
	if (margin < 2 && score < 3) return null;
	return lang;
}
