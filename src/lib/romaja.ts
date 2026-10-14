/**
 * Revised Romanization of Korean for the readings panel: a Hangul
 * highlight shows its romaja the way a Han one shows pinyin. Syllable
 * blocks decompose into initial, vowel and final jamo; the common
 * sound changes across a syllable boundary apply (liaison before a
 * vowel, nasalisation before ㄴ/ㅁ, ㄹ assimilation, ㅎ aspiration and
 * dropping, ㄷ/ㅌ palatalisation before 이). Hyphens are never
 * written; non-Hangul characters pass through. Pure and unit-tested.
 */

const INITIALS = [
	"g",
	"kk",
	"n",
	"d",
	"tt",
	"r",
	"m",
	"b",
	"pp",
	"s",
	"ss",
	"",
	"j",
	"jj",
	"ch",
	"k",
	"t",
	"p",
	"h"
] as const;

const VOWELS = [
	"a",
	"ae",
	"ya",
	"yae",
	"eo",
	"e",
	"yeo",
	"ye",
	"o",
	"wa",
	"wae",
	"oe",
	"yo",
	"u",
	"wo",
	"we",
	"wi",
	"yu",
	"eu",
	"ui",
	"i"
] as const;

/** Final jamo (index 0 = none), as the coda sound before a pause. */
const CODAS = [
	"",
	"k", // ㄱ
	"k", // ㄲ
	"k", // ㄳ
	"n", // ㄴ
	"n", // ㄵ
	"n", // ㄶ
	"t", // ㄷ
	"l", // ㄹ
	"k", // ㄺ
	"m", // ㄻ
	"l", // ㄼ
	"l", // ㄽ
	"l", // ㄾ
	"p", // ㄿ
	"l", // ㅀ
	"m", // ㅁ
	"p", // ㅂ
	"p", // ㅄ
	"t", // ㅅ
	"t", // ㅆ
	"ng", // ㅇ
	"t", // ㅈ
	"t", // ㅊ
	"k", // ㅋ
	"t", // ㅌ
	"p", // ㅍ
	"t" // ㅎ
] as const;

/** Before a vowel the final carries over: what stays as coda, what
moves to the next initial. */
const LIAISON: ReadonlyArray<readonly [string, string]> = [
	["", ""],
	["", "g"], // ㄱ
	["", "kk"], // ㄲ
	["k", "s"], // ㄳ
	["", "n"], // ㄴ
	["n", "j"], // ㄵ
	["", "n"], // ㄶ (ㅎ drops)
	["", "d"], // ㄷ
	["", "r"], // ㄹ
	["l", "g"], // ㄺ
	["l", "m"], // ㄻ
	["l", "b"], // ㄼ
	["l", "s"], // ㄽ
	["l", "t"], // ㄾ
	["l", "p"], // ㄿ
	["", "r"], // ㅀ (ㅎ drops)
	["", "m"], // ㅁ
	["", "b"], // ㅂ
	["p", "s"], // ㅄ
	["", "s"], // ㅅ
	["", "ss"], // ㅆ
	["ng", ""], // ㅇ
	["", "j"], // ㅈ
	["", "ch"], // ㅊ
	["", "k"], // ㅋ
	["", "t"], // ㅌ
	["", "p"], // ㅍ
	["", ""] // ㅎ (drops)
];

/** Sound class of a final: what nasalisation and ㄹ rules key on. */
type CodaClass = "none" | "k" | "t" | "p" | "n" | "m" | "l" | "ng";
const CODA_CLASS: readonly CodaClass[] = [
	"none",
	"k",
	"k",
	"k",
	"n",
	"n",
	"n",
	"t",
	"l",
	"k",
	"m",
	"l",
	"l",
	"l",
	"p",
	"l",
	"m",
	"p",
	"p",
	"t",
	"t",
	"ng",
	"t",
	"t",
	"k",
	"t",
	"p",
	"t"
];

const NASAL: Record<CodaClass, string> = {
	none: "",
	k: "ng",
	t: "n",
	p: "m",
	n: "n",
	m: "m",
	l: "l",
	ng: "ng"
};

/** Finals that carry a ㅎ (ㄶ, ㅀ, ㅎ): they aspirate a following
ㄱ/ㄷ/ㅂ/ㅈ and drop before a vowel. */
const H_FINALS = new Set([6, 15, 27]);
/** What stays as coda when the ㅎ aspirates the next initial. */
const H_CODA: Record<number, string> = { 6: "n", 15: "l", 27: "" };
/** What moves to the next initial when the ㅎ drops before a vowel. */
const H_MOVE: Record<number, string> = { 6: "n", 15: "r", 27: "" };
const ASPIRATED: Record<number, string> = { 0: "k", 3: "t", 7: "p", 12: "ch" };

interface Syllable {
	initial: number;
	vowel: number;
	final: number;
}

function decompose(ch: string): Syllable | null {
	const code = ch.codePointAt(0) ?? 0;
	if (code < 0xac00 || code > 0xd7a3) return null;
	const offset = code - 0xac00;
	return {
		initial: Math.floor(offset / 588),
		vowel: Math.floor((offset % 588) / 28),
		final: offset % 28
	};
}

/** Coda of `cur` and initial of `next` once the boundary rules run. */
function boundary(cur: Syllable, next: Syllable | null): [string, string] {
	const t = cur.final;
	if (!next) return [CODAS[t] ?? "", ""];
	const l = next.initial;
	const plainInitial = INITIALS[l] ?? "";
	if (t === 0) return ["", plainInitial];
	const cls = CODA_CLASS[t] ?? "none";
	// ㅎ finals: drop before a vowel, aspirate ㄱ/ㄷ/ㅂ/ㅈ.
	if (H_FINALS.has(t)) {
		if (l === 11) return ["", H_MOVE[t] ?? ""];
		const aspirated = ASPIRATED[l];
		if (aspirated !== undefined) return [H_CODA[t] ?? "", aspirated];
	}
	// A following ㅎ aspirates a stop final (축하 chuka, 입학 ipak).
	if (l === 18 && (cls === "k" || cls === "t" || cls === "p")) {
		if (t === 22) return ["", "ch"];
		return ["", cls];
	}
	// Vowel next: liaison, with ㄷ/ㅌ palatalising before 이.
	if (l === 11) {
		if (next.vowel === 20 && t === 7) return ["", "j"];
		if (next.vowel === 20 && t === 25) return ["", "ch"];
		const [stay, move] = LIAISON[t] ?? ["", ""];
		return [stay, move];
	}
	// ㄴ/ㅁ next: stops nasalise (합니다 hamnida), ㄹ+ㄴ reads ll.
	if (l === 2 || l === 6) {
		if (cls === "l" && l === 2) return ["l", "l"];
		return [NASAL[cls], plainInitial];
	}
	// ㄹ next: ㄹ/ㄴ finals read ll, nasals and stops turn it to n.
	if (l === 5) {
		if (cls === "l" || cls === "n") return ["l", "l"];
		return [NASAL[cls], "n"];
	}
	return [CODAS[t] ?? "", plainInitial];
}

/** True when the character is a precomposed Hangul syllable. */
export function isHangulSyllable(ch: string): boolean {
	return decompose(ch) !== null;
}

/** True when the text carries at least one Hangul syllable. */
export function hasHangul(text: string): boolean {
	return [...text].some(isHangulSyllable);
}

/** Romaja for a Hangul text; other characters pass through. */
export function romajaOf(text: string): string {
	const chars = [...text];
	const syllables = chars.map(decompose);
	let out = "";
	let pendingInitial: string | null = null;
	for (let i = 0; i < chars.length; i++) {
		const cur = syllables[i] ?? null;
		if (!cur) {
			pendingInitial = null;
			out += chars[i] ?? "";
			continue;
		}
		const next = syllables[i + 1] ?? null;
		const initial = pendingInitial ?? INITIALS[cur.initial] ?? "";
		const [coda, nextInitial] = boundary(cur, next);
		out += initial + (VOWELS[cur.vowel] ?? "") + coda;
		pendingInitial = next ? nextInitial : null;
	}
	return out;
}
