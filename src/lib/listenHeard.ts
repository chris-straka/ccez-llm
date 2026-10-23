/**
 * Caption words timed by what a speech recognizer heard in the track
 * (`listen_heard`, Apple's recognizer on the Mac). The recognizer's
 * words carry real starts and ends but its own spelling; the captions
 * carry the text the drill shows. Lining the two word lists up gives
 * each caption word the time it was actually said. Pure.
 */

import type { Token } from "./listenClips";

/** One recognized word, seconds into the track. */
export interface HeardWord {
	text: string;
	start: number;
	end: number;
}

/** One recognized piece of the track (`listen_heard`). */
export interface HeardChunk {
	words: HeardWord[];
	start: number;
	end: number;
	/** How many pieces the track has. */
	chunks: number;
}

/** Caption words timed by the recognizer. */
export interface HeardTimes {
	tokens: Token[];
	/** The last token the recognizer timed; later ones keep the times
	 * they came with (that part of the track isn't heard yet). */
	upTo: number;
}

/** A caption and a heard word this far apart (s) never pair. */
const BAND_SEC = 10;
/** Heard words lined up per pass, and how many of them a pass keeps
 * (the rest are lined up again with the next pass's context). */
const WINDOW = 240;
const COMMIT = 160;
/** A paired word whose offset strays this far (s) from its
 * neighbors' is a chance match of a common word elsewhere. */
const STRAY_SEC = 1;
/** Neighbors either side that judge a stray. */
const STRAY_SPAN = 6;
/** Fewer paired caption words than this share means the recognizer
 * heard something else (another language, music). */
const MIN_PAIRED = 0.3;

/** Scripts written without spaces: each character is a unit. */
const UNSPACED =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

interface Unit {
	text: string;
	/** The token (caption) or word (heard) it comes from. */
	from: number;
	/** Whether it starts or ends its token. */
	first: boolean;
	last: boolean;
	start: number;
	end: number;
}

/** A word's comparable pieces with times spread across it by length:
 * letters and digits only, lowercased; each character of an unspaced
 * script stands alone. */
function units(text: string, from: number, start: number, end: number): Unit[] {
	const pieces: { text: string; at: number }[] = [];
	const flat = text.normalize("NFKC").toLowerCase();
	const re = /[\p{L}\p{N}\p{M}]+/gu;
	for (const m of flat.matchAll(re)) {
		const at = m.index;
		if (UNSPACED.test(m[0]))
			for (const [k, ch] of [...m[0]].entries())
				pieces.push({ text: ch, at: at + k });
		else pieces.push({ text: m[0], at });
	}
	const len = Math.max(1, [...flat].length);
	const span = Math.max(0, end - start);
	return pieces.map((p, k) => ({
		text: p.text,
		from,
		first: k === 0,
		last: k === pieces.length - 1,
		start: start + (span * p.at) / len,
		end:
			k === pieces.length - 1
				? end
				: start + (span * (pieces[k + 1] as { at: number }).at) / len
	}));
}

/** How alike two units are: 2 the same, 1 a likely spelling variant
 * (a shared start on a long word), else 0. */
function likeness(a: string, b: string): number {
	if (a === b) return 2;
	if (a.length >= 5 && b.length >= 5 && a.slice(0, 4) === b.slice(0, 4))
		return 1;
	return 0;
}

/** Pairs of (caption unit, heard unit) indexes, both increasing: the
 * best line-up within the time band, pass by pass along the heard
 * words. */
function lineUp(cap: Unit[], heard: Unit[]): [number, number][] {
	const pairs: [number, number][] = [];
	let c0 = 0;
	for (let h0 = 0; h0 < heard.length; h0 += COMMIT) {
		const h1 = Math.min(heard.length, h0 + WINDOW);
		const lastWindow = h1 === heard.length;
		const first = heard[h0] as Unit;
		const last = heard[h1 - 1] as Unit;
		while (c0 < cap.length && (cap[c0] as Unit).start < first.start - BAND_SEC)
			c0++;
		let c1 = c0;
		while (c1 < cap.length && (cap[c1] as Unit).start <= last.start + BAND_SEC)
			c1++;
		const n = c1 - c0;
		const m = h1 - h0;
		if (n === 0) continue;
		// score[i][j]: best line-up of cap[c0..c0+i) with heard[h0..h0+j).
		const w = m + 1;
		const score = new Int32Array((n + 1) * w);
		for (let i = 1; i <= n; i++) {
			const cu = cap[c0 + i - 1] as Unit;
			for (let j = 1; j <= m; j++) {
				const hu = heard[h0 + j - 1] as Unit;
				let best = Math.max(
					score[(i - 1) * w + j] ?? 0,
					score[i * w + j - 1] ?? 0
				);
				if (Math.abs(hu.start - cu.start) <= BAND_SEC) {
					const s = likeness(cu.text, hu.text);
					if (s > 0)
						best = Math.max(best, (score[(i - 1) * w + j - 1] ?? 0) + s);
				}
				score[i * w + j] = best;
			}
		}
		const found: [number, number][] = [];
		for (let i = n, j = m; i > 0 && j > 0;) {
			const here = score[i * w + j] ?? 0;
			if (here === (score[(i - 1) * w + j] ?? 0)) i--;
			else if (here === (score[i * w + j - 1] ?? 0)) j--;
			else {
				found.push([c0 + i - 1, h0 + j - 1]);
				i--;
				j--;
			}
		}
		found.reverse();
		for (const pair of found) {
			if (!lastWindow && pair[1] >= h0 + COMMIT) break;
			pairs.push(pair);
			c0 = pair[0] + 1;
		}
		if (lastWindow) break;
	}
	return pairs;
}

/** Drop pairs that are chance matches: a one-letter unit paired on
 * its own, or an offset far from its neighbors'. */
function trustworthy(
	pairs: [number, number][],
	cap: Unit[],
	heard: Unit[]
): [number, number][] {
	const kept = pairs.filter(([c, h], k) => {
		if ((cap[c] as Unit).text.length > 1) return true;
		const prev = pairs[k - 1];
		const next = pairs[k + 1];
		return (
			(prev !== undefined && prev[0] === c - 1 && prev[1] === h - 1) ||
			(next !== undefined && next[0] === c + 1 && next[1] === h + 1)
		);
	});
	const offset = ([c, h]: [number, number]): number =>
		(heard[h] as Unit).start - (cap[c] as Unit).start;
	return kept.filter((pair, k) => {
		const around: number[] = [];
		for (
			let j = Math.max(0, k - STRAY_SPAN);
			j <= Math.min(kept.length - 1, k + STRAY_SPAN);
			j++
		)
			if (j !== k) around.push(offset(kept[j] as [number, number]));
		if (around.length === 0) return true;
		around.sort((a, b) => a - b);
		const median = around[Math.floor(around.length / 2)] as number;
		return Math.abs(offset(pair) - median) <= STRAY_SEC;
	});
}

/**
 * Time `tokens` by `heard`, the recognizer's words so far (in order,
 * from the start of the track). A caption word the recognizer also
 * heard takes its start (and its end, when the whole word was
 * heard); the words between two heard ones spread across the time
 * between them. Null when too few words pair up to trust.
 */
export function heardTimes(
	tokens: readonly Token[],
	heard: readonly HeardWord[]
): HeardTimes | null {
	if (tokens.length === 0 || heard.length === 0) return null;
	const cap = tokens.flatMap((t, k) => units(t.text, k, t.start, t.end));
	const said = heard.flatMap((w, k) => units(w.text, k, w.start, w.end));
	const reach = (said[said.length - 1]?.end ?? 0) + 1;
	const pairs = trustworthy(lineUp(cap, said), cap, said);
	const inReach = cap.filter((u) => u.start <= reach).length;
	if (pairs.length < 2 || pairs.length < inReach * MIN_PAIRED) return null;

	// Anchors: a caption time and the time it was heard.
	const anchors = pairs.map(([c, h]) => ({
		at: (cap[c] as Unit).start,
		to: (said[h] as Unit).start
	}));
	const firstAt = (anchors[0] as { at: number }).at;
	const lastAt = (anchors[anchors.length - 1] as { at: number }).at;
	const map = (t: number): number => {
		// The last anchor at or before t (or the first one).
		let lo = 0;
		let hi = anchors.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((anchors[mid] as { at: number }).at <= t) lo = mid;
			else hi = mid - 1;
		}
		const left = anchors[lo] as { at: number; to: number };
		const right = anchors[lo + 1];
		if (t <= left.at || !right || right.at === left.at)
			return left.to + (t - left.at);
		return (
			left.to + ((t - left.at) * (right.to - left.to)) / (right.at - left.at)
		);
	};
	const startOf = new Map<number, number>();
	const endOf = new Map<number, number>();
	for (const [c, h] of pairs) {
		const cu = cap[c] as Unit;
		const hu = said[h] as Unit;
		if (cu.first) startOf.set(cu.from, hu.start);
		if (cu.last) endOf.set(cu.from, hu.end);
	}
	let upTo = -1;
	const out = tokens.map((tok, k) => {
		if (tok.start > lastAt || tok.end < firstAt) return { ...tok };
		upTo = k;
		const start = startOf.get(k) ?? map(tok.start);
		const end = Math.max(start + 0.05, endOf.get(k) ?? map(tok.end));
		return { ...tok, start, end };
	});
	return { tokens: out, upTo };
}
