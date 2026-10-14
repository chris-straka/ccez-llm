/**
 * Hanja: Han characters inside Korean text read in Korean. A Han-only
 * word in a Korean paragraph (接尾辭 in a Korean answer) earns its
 * Korean reading 접미사 and the Korean voice, never pinyin; the same
 * word in Chinese text keeps pinyin and in Japanese text furigana.
 * Readings come from the bundled Unihan kHangul (educational reading
 * first; Japanese and simplified forms borrow their old form's). Pure.
 */
import { isHanChar } from "./inspect";
import { hanOverlayLangFor } from "./reading";
import { hasHangul, isHangulSyllable } from "./romaja";
import { UNIHAN } from "./unihan.generated";

/** Which readings a highlight earns: furigana, pinyin, or Korean. */
export type QuoteReadingLang = "ja" | "zh" | "ko";

const HANGUL_BASE = 0xac00;
/** Vowels that turn a word-initial ㄹ/ㄴ into ㅇ (ㅑ ㅕ ㅖ ㅛ ㅠ ㅣ). */
const Y_VOWELS = new Set([2, 6, 7, 12, 17, 20]);

/**
 * The word-initial form of a hanja syllable (두음법칙): 로 → 노,
 * 리 → 이, 녀 → 여. Other syllables come back unchanged.
 */
function initialForm(syllable: string): string {
	const code = (syllable.codePointAt(0) ?? 0) - HANGUL_BASE;
	if (code < 0 || code > 11171) return syllable;
	const initial = Math.floor(code / 588);
	const vowel = Math.floor((code % 588) / 28);
	const rest = code % 588;
	let next = initial;
	if (initial === 5) next = Y_VOWELS.has(vowel) ? 11 : 2;
	else if (initial === 2 && Y_VOWELS.has(vowel)) next = 11;
	if (next === initial) return syllable;
	return String.fromCodePoint(HANGUL_BASE + next * 588 + rest);
}

/**
 * Korean reading of the Han characters in `text`; everything else
 * passes through (接尾辭는 reads 접미사는). A word-initial hanja takes
 * its initial form when Unihan lists it (露出 노출, 出露 출로). Null
 * when no Han character has a reading.
 */
export function hanjaReading(text: string): string | null {
	let out = "";
	let found = false;
	let wordStart = true;
	for (const ch of text) {
		if (!isHanChar(ch)) {
			out += ch;
			wordStart = !isHangulSyllable(ch);
			continue;
		}
		const list = (UNIHAN[ch]?.h ?? "").split(" ").filter((s) => s !== "");
		const first = list[0];
		if (first === undefined) {
			out += ch;
		} else {
			const lead = initialForm(first);
			out += wordStart && list.includes(lead) ? lead : first;
			found = true;
		}
		wordStart = false;
	}
	return found ? out : null;
}

/** True when Hangul outweighs Han in the text: Korean, not Chinese. */
export function isKoreanText(text: string): boolean {
	let hangul = 0;
	let han = 0;
	for (const ch of text) {
		if (isHangulSyllable(ch)) hangul++;
		else if (isHanChar(ch)) han++;
	}
	return hangul > 0 && hangul > han;
}

/**
 * Which readings a highlight earns, from the highlight, its sentence
 * (`probe`) and its paragraph (`context`). Hangul alone reads Korean;
 * Han reads furigana in Japanese text (kana in the sentence), hanja in
 * Korean text (Hangul outweighs Han in the sentence, or in the
 * paragraph when the sentence has no Hangul), else pinyin when the
 * message offers it.
 */
export function quoteReadingLang(
	quote: string,
	probe: string,
	context: string,
	pinyinOffered: boolean
): QuoteReadingLang | null {
	if (![...quote].some((ch) => isHanChar(ch)))
		return hasHangul(quote) ? "ko" : null;
	if (hanOverlayLangFor(probe) === "ja") return "ja";
	const korean = hasHangul(probe) ? isKoreanText(probe) : isKoreanText(context);
	if (korean && hanjaReading(quote) !== null) return "ko";
	return pinyinOffered ? "zh" : null;
}
