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
			"there"
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
			"pas"
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
			"nicht"
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
			"pero"
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
			"molto"
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
			"muito"
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
			"ook"
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
	let best: string | null = null;
	let bestScore = 0;
	for (const [lang, score] of counts) {
		if (score > bestScore) {
			bestScore = score;
			best = lang;
		}
	}
	if (best === null || bestScore < LANG_ID_MIN_SCORE) return null;
	return best;
}
