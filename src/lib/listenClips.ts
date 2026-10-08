/**
 * Listening drill clips: YouTube json3 captions into timed tokens,
 * then sentence-sized clips (about 2-8 s) cut on word timings. Pure.
 *
 * Two caption shapes arrive. Speech recognition of the track
 * (`<lang>-orig`) carries one seg per word with its own offset;
 * uploaded subtitles carry one seg per cue with no offsets, so their
 * words get times spread across the cue by length.
 */

export interface Token {
	/** Display text, punctuation attached ("peste."). */
	text: string;
	/** Seconds into the track. */
	start: number;
	end: number;
	/** A space goes before this token when joining. */
	space: boolean;
}

export interface ClipSpan {
	/** 0-based clip number. */
	i: number;
	/** Padded playback window, seconds. */
	start: number;
	end: number;
	/** What is said, joined from the tokens. */
	text: string;
}

interface Json3Seg {
	utf8?: string;
	tOffsetMs?: number;
}

interface Json3Event {
	tStartMs?: number;
	dDurationMs?: number;
	segs?: Json3Seg[];
}

/** Scripts written without spaces between words. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** Punctuation that ends a sentence (Latin, CJK, Arabic, Devanagari). */
const SENTENCE_END = /[.!?…。！？؟।]["'»”’)\]]*$/u;
const CLAUSE_END = /[,;:—–،、，；：]["'»”’)\]]*$/u;
/** A token made only of closing punctuation joins the word before. */
const TRAILING_PUNCT = /^[\p{Po}\p{Pe}\p{Pf}]+$/u;
/** Zero-width and bidi marks that uploaded subtitles sprinkle in. */
const INVISIBLE = /[​-‏⁠﻿]/g;
/** Sound tags: [Musique], [Applause], (rires), ♪. */
const SOUND_TAG = /^[[(].*[\])]$|^♪+$/u;

/** Rough spoken length of a word with no end time (seconds). */
function spokenLength(text: string): number {
	const chars = [...text].length;
	const perChar = UNSPACED.test(text) ? 0.16 : 0.065;
	return Math.min(1.2, Math.max(0.15, chars * perChar + 0.08));
}

function cleanSeg(raw: string): string {
	return raw.replace(INVISIBLE, "").replace(/\s+/g, " ");
}

interface RawToken {
	text: string;
	start: number;
	/** Known end (cue split) or NaN (word seg: next word decides). */
	end: number;
	space: boolean;
}

/**
 * Parse a json3 caption document into tokens. Duplicate cues (some
 * uploads repeat every cue) and sound tags drop out.
 */
export function parseJson3(doc: string): Token[] {
	let events: Json3Event[];
	try {
		const parsed = JSON.parse(doc) as { events?: Json3Event[] };
		events = Array.isArray(parsed.events) ? parsed.events : [];
	} catch {
		return [];
	}
	const raw: RawToken[] = [];
	const seen = new Set<string>();
	for (const ev of events) {
		const segs = ev.segs ?? [];
		const t0 = (ev.tStartMs ?? 0) / 1000;
		const dur = (ev.dDurationMs ?? 0) / 1000;
		const text = segs.map((s) => s.utf8 ?? "").join("");
		if (cleanSeg(text).trim() === "") continue;
		const key = `${ev.tStartMs ?? 0}|${text}`;
		if (seen.has(key)) continue;
		seen.add(key);
		// Recognition segs carry offsets (all but the first); styled
		// uploaded cues split into several segs without any.
		const timed = segs.some((s) => typeof s.tOffsetMs === "number");
		if (timed) {
			segs.forEach((seg, k) => {
				const cleaned = cleanSeg(seg.utf8 ?? "");
				const word = cleaned.trim();
				if (!word) return;
				const space =
					cleaned.startsWith(" ") || (k === 0 && !UNSPACED.test(word[0] ?? ""));
				raw.push({ text: word, start: t0 + (seg.tOffsetMs ?? 0) / 1000, end: NaN, space });
			});
		} else {
			// One cue: words take their natural length from the cue's
			// start (squeezed to fit a short cue, stretched at most
			// 1.3x); a cue held on screen through a pause leaves the
			// rest as silence instead of slowing every word.
			// A cue opening on "…" continues the last one; the marker
			// is subtitle layout, not speech.
			const cue = cleanSeg(text).trim().replace(/^(?:…|\.\.\.)\s*/u, "");
			if (!cue) continue;
			const words = UNSPACED.test(cue) && !cue.includes(" ") ? [...cue] : cue.split(" ");
			const natural = words.reduce((n, w) => n + spokenLength(w), 0);
			const scale = dur > 0 ? Math.min(1.3, dur / natural) : 1;
			let at = t0;
			words.forEach((w, k) => {
				const share = spokenLength(w) * scale;
				raw.push({
					text: w,
					start: at,
					end: at + share,
					space: k > 0 ? !UNSPACED.test(w) || cue.includes(" ") : !UNSPACED.test(w[0] ?? "")
				});
				at += share;
			});
		}
	}
	raw.sort((a, b) => a.start - b.start);

	const tokens: Token[] = [];
	let skipping = false;
	for (const [k, tok] of raw.entries()) {
		// Sound tags may arrive split over several segs ("[", "Musique]").
		if (skipping || tok.text.startsWith("[")) {
			skipping = !tok.text.includes("]");
			continue;
		}
		if (SOUND_TAG.test(tok.text)) continue;
		const next = raw[k + 1];
		const end = Number.isNaN(tok.end)
			? Math.min(next ? next.start : Infinity, tok.start + spokenLength(tok.text))
			: tok.end;
		const prev = tokens.at(-1);
		if (prev && TRAILING_PUNCT.test(tok.text)) {
			// French puts a space before ? ! : ; keep whatever the track had.
			prev.text += (tok.space ? " " : "") + tok.text;
			prev.end = Math.max(prev.end, end);
			continue;
		}
		tokens.push({ text: tok.text, start: tok.start, end: Math.max(end, tok.start + 0.05), space: tok.space });
	}
	if (tokens[0]) tokens[0].space = false;
	return tokens;
}

/** Join tokens back into a line. */
export function joinTokens(tokens: readonly Token[]): string {
	return tokens
		.map((t, k) => (k > 0 && t.space ? ` ${t.text}` : t.text))
		.join("")
		.trim();
}

export interface SegmentOptions {
	/** Shortest clip worth a guess (s). */
	minSec: number;
	/** Longest clip before it must split (s). */
	maxSec: number;
	/** Lead-in and tail padding (s), never past half the gap. */
	padBefore: number;
	padAfter: number;
}

export const DEFAULT_SEGMENT: SegmentOptions = {
	minSec: 2.2,
	maxSec: 8,
	padBefore: 0.15,
	padAfter: 0.35
};

/** How good a cut after token k is: 0 none … 4 sentence end + pause. */
function cutStrength(tokens: readonly Token[], k: number): number {
	const tok = tokens[k];
	if (!tok) return 0;
	const next = tokens[k + 1];
	const gap = next ? next.start - tok.end : Infinity;
	let score = 0;
	if (SENTENCE_END.test(tok.text)) score = 3;
	else if (CLAUSE_END.test(tok.text)) score = 2;
	if (gap >= 0.6) score += 1;
	else if (gap >= 0.3) score += 0.5;
	return score;
}

/**
 * Cut tokens into sentence-sized clips. A sentence ends a clip once
 * the clip is long enough; short sentences ride along with the next.
 * A clip running past `maxSec` splits at its best boundary (clause,
 * then pause, then the latest word).
 */
export function segmentClips(
	tokens: readonly Token[],
	opts: SegmentOptions = DEFAULT_SEGMENT
): ClipSpan[] {
	const groups: Token[][] = [];
	let from = 0;
	while (from < tokens.length) {
		const first = tokens[from];
		if (!first) break;
		let cut = -1;
		let best = -1;
		let bestScore = -1;
		for (let k = from; k < tokens.length; k++) {
			const tok = tokens[k];
			if (!tok) break;
			const dur = tok.end - first.start;
			const score = cutStrength(tokens, k);
			if (dur >= opts.minSec && score >= 3) {
				cut = k;
				break;
			}
			// A long silence ends a clip even without punctuation
			// (captions from speech recognition can lack it).
			if (dur >= opts.minSec && score >= 1 && (tokens[k + 1]?.start ?? Infinity) - tok.end >= 1.2) {
				cut = k;
				break;
			}
			if (dur > opts.maxSec) {
				cut = best >= from ? best : Math.max(from, k - 1);
				break;
			}
			if (dur >= opts.minSec * 0.6 && score >= bestScore) {
				best = k;
				bestScore = score;
			}
		}
		if (cut < 0) cut = tokens.length - 1;
		groups.push(tokens.slice(from, cut + 1));
		from = cut + 1;
	}
	// A short tail joins the clip before it when that stays listenable.
	const last = groups.at(-1);
	const prev = groups.at(-2);
	if (last && prev && groups.length > 1) {
		const lastDur = (last.at(-1)?.end ?? 0) - (last[0]?.start ?? 0);
		const joined = (last.at(-1)?.end ?? 0) - (prev[0]?.start ?? 0);
		if (lastDur < opts.minSec && joined <= opts.maxSec + 2) {
			groups.splice(-2, 2, [...prev, ...last]);
		}
	}
	return groups.map((g, i) => {
		const head = g[0];
		const tail = g.at(-1);
		const before = groups[i - 1]?.at(-1);
		const after = groups[i + 1]?.[0];
		const start = head?.start ?? 0;
		const end = tail?.end ?? start;
		const roomBefore = before ? (start - before.end) / 2 : opts.padBefore;
		const roomAfter = after ? (after.start - end) / 2 : opts.padAfter;
		return {
			i,
			start: Math.max(0, start - Math.min(opts.padBefore, Math.max(0, roomBefore))),
			end: end + Math.min(opts.padAfter, Math.max(0, roomAfter)),
			text: joinTokens(g)
		};
	});
}
