/**
 * Per-kanji shares of a compound's word-level reading: 露軍 ろぐん
 * splits ろ|ぐん, so one kanji picked out of a word reads the way it
 * sounds in that word (露 there is ろ, not its standalone つゆ).
 *
 * Each kanji's candidates come from Unihan (on in kana, kun plus its
 * stems, since Unihan kun carries okurigana: ARAWARERU), with the
 * sound changes compounds make: rendaku voicing (か→が, ほ→ぼ/ぽ) and
 * the small っ a non-final kanji ends on (いち→いっ in 一歩 いっぽ). A
 * cheapest split wins; at most one kanji may take an unexplained
 * share (日本 にほん: 日 に, 本 ほん), and only beside readings that
 * match outright. Jukujikun like 今日 きょう and 大人 おとな have no
 * split and stay whole. Pure.
 */
import { toHiragana } from "wanakana";
import { UNIHAN } from "./unihan.generated";

/** Voiced (and half-voiced) forms of a kana's first sound. */
const VOICED: Record<string, string[]> = {
	か: ["が"],
	き: ["ぎ"],
	く: ["ぐ"],
	け: ["げ"],
	こ: ["ご"],
	さ: ["ざ"],
	し: ["じ"],
	す: ["ず"],
	せ: ["ぜ"],
	そ: ["ぞ"],
	た: ["だ"],
	ち: ["ぢ", "じ"],
	つ: ["づ", "ず"],
	て: ["で"],
	と: ["ど"],
	は: ["ば", "ぱ"],
	ひ: ["び", "ぴ"],
	ふ: ["ぶ", "ぷ"],
	へ: ["べ", "ぺ"],
	ほ: ["ぼ", "ぽ"]
};

/** Final kana a non-final kanji can clip to っ (学 がく → がっこう). */
const CLIPS = new Set(["つ", "く", "ち", "き"]);

const COST_EXACT = 0;
const COST_CHANGED = 1;
const COST_STEM = 2;
const COST_FREE = 6;
/** A free share beside guessed stems is a guess on a guess (一人
ひ|とり, 大人 お|とな are jukujikun): such splits stay whole. */
const COST_MAX = COST_FREE + COST_CHANGED;

/** Candidate shares for one kanji with their costs; empty when unknown. */
function candidates(ch: string, last: boolean): Map<string, number> {
	const out = new Map<string, number>();
	const entry = UNIHAN[ch];
	if (!entry) return out;
	const add = (kana: string, cost: number): void => {
		if (kana === "") return;
		const prev = out.get(kana);
		if (prev === undefined || cost < prev) out.set(kana, cost);
	};
	const words = (raw: string | undefined): string[] =>
		(raw ?? "")
			.split(/\s+/)
			.filter((r) => r !== "")
			.map((r) => toHiragana(r.toLowerCase()));
	const base = new Map<string, number>();
	for (const on of words(entry.on)) base.set(on, COST_EXACT);
	for (const kun of words(entry.kun)) {
		if (!base.has(kun)) base.set(kun, COST_EXACT);
		for (let n = 1; n < kun.length; n++) {
			const stem = kun.slice(0, n);
			if (!base.has(stem)) base.set(stem, COST_STEM);
		}
	}
	for (const [kana, cost] of base) {
		add(kana, cost);
		const head = kana[0] ?? "";
		for (const voiced of VOICED[head] ?? [])
			add(voiced + kana.slice(1), cost + COST_CHANGED);
		const tail = kana[kana.length - 1] ?? "";
		if (!last && kana.length > 1 && CLIPS.has(tail)) {
			const clipped = `${kana.slice(0, -1)}っ`;
			add(clipped, cost + COST_CHANGED);
			for (const voiced of VOICED[head] ?? [])
				add(voiced + clipped.slice(1), cost + 2 * COST_CHANGED);
		}
	}
	return out;
}

/**
 * The reading share of each kanji in `surface`, in order, or null when
 * the reading can't be explained kanji by kanji (jukujikun, unknown
 * kanji, or a surface that isn't all kanji). A single kanji gets the
 * whole reading.
 */
export function splitCompoundReading(
	surface: string,
	reading: string
): string[] | null {
	const chars = [...surface];
	const kana = [...reading];
	if (chars.length === 0 || kana.length === 0) return null;
	if (chars.length === 1) return [reading];
	if (kana.length < chars.length) return null;
	const cands = chars.map((ch, i) => candidates(ch, i === chars.length - 1));
	// solve(i, j, f): cheapest split of chars[i..] over kana[j..] with
	// f free shares already used (0 or 1).
	type Step = { cost: number; take: number; nextFree: number } | null;
	const memo = new Map<string, Step>();
	const solve = (i: number, j: number, free: number): Step => {
		if (i === chars.length)
			return j === kana.length ? { cost: 0, take: 0, nextFree: free } : null;
		const key = `${i}:${j}:${free}`;
		if (memo.has(key)) return memo.get(key) ?? null;
		let best: Step = null;
		const room = kana.length - j - (chars.length - i - 1);
		for (let take = 1; take <= room; take++) {
			const share = kana.slice(j, j + take).join("");
			const known = cands[i]?.get(share);
			const options: [number, number][] = [];
			if (known !== undefined) options.push([known, free]);
			if (free === 0) options.push([COST_FREE, 1]);
			for (const [cost, nextFree] of options) {
				const rest = solve(i + 1, j + take, nextFree);
				if (!rest) continue;
				const total = cost + rest.cost;
				if (!best || total < best.cost) best = { cost: total, take, nextFree };
			}
		}
		memo.set(key, best);
		return best;
	};
	if ((solve(0, 0, 0)?.cost ?? Infinity) > COST_MAX) return null;
	const out: string[] = [];
	let j = 0;
	let free = 0;
	for (let i = 0; i < chars.length; i++) {
		const step = solve(i, j, free);
		if (!step) return null;
		out.push(kana.slice(j, j + step.take).join(""));
		j += step.take;
		free = step.nextFree;
	}
	return out;
}

/**
 * The reading of `surface.slice(from, to)` (code-unit offsets into a
 * kanji run) inside the word `surface` reads as `reading`: the covered
 * kanji's shares joined. The whole reading when the run is fully
 * covered, holds kana (okurigana trims elsewhere), or can't be split.
 */
export function partialReading(
	surface: string,
	reading: string,
	from: number,
	to: number
): string {
	if (from <= 0 && to >= surface.length) return reading;
	if (!/^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3005]+$/u.test(surface))
		return reading;
	const shares = splitCompoundReading(surface, reading);
	if (!shares) return reading;
	const chars = [...surface];
	let at = 0;
	let out = "";
	for (let i = 0; i < chars.length; i++) {
		const len = chars[i]?.length ?? 1;
		if (at + len > from && at < to) out += shares[i] ?? "";
		at += len;
	}
	return out === "" ? reading : out;
}
