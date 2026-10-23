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
const UNSPACED =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** Punctuation that ends a sentence (Latin, CJK, Arabic, Devanagari). */
const SENTENCE_END = /[.!?…。！？؟।]["'»”’)\]]*$/u;
const CLAUSE_END = /[,;:—–،、，；：]["'»”’)\]]*$/u;
/** A token made only of closing punctuation joins the word before. */
const TRAILING_PUNCT = /^[\p{Po}\p{Pe}\p{Pf}]+$/u;
/** Zero-width and bidi marks that uploaded subtitles sprinkle in. */
const INVISIBLE = /[\u200b-\u200f\u2060\ufeff]/g;
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
				raw.push({
					text: word,
					start: t0 + (seg.tOffsetMs ?? 0) / 1000,
					end: NaN,
					space
				});
			});
		} else {
			// One cue: words take their natural length from the cue's
			// start (squeezed to fit a short cue, stretched at most
			// 1.3x); a cue held on screen through a pause leaves the
			// rest as silence instead of slowing every word.
			// A cue opening on "…" continues the last one; the marker
			// is subtitle layout, not speech.
			const cue = cleanSeg(text)
				.trim()
				.replace(/^(?:…|\.\.\.)\s*/u, "");
			if (!cue) continue;
			const words =
				UNSPACED.test(cue) && !cue.includes(" ") ? [...cue] : cue.split(" ");
			const natural = words.reduce((n, w) => n + spokenLength(w), 0);
			const scale = dur > 0 ? Math.min(1.3, dur / natural) : 1;
			let at = t0;
			words.forEach((w, k) => {
				const share = spokenLength(w) * scale;
				raw.push({
					text: w,
					start: at,
					end: at + share,
					space:
						k > 0
							? !UNSPACED.test(w) || cue.includes(" ")
							: !UNSPACED.test(w[0] ?? "")
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
			? Math.min(
					next ? next.start : Infinity,
					tok.start + spokenLength(tok.text)
				)
			: tok.end;
		const prev = tokens.at(-1);
		if (prev && TRAILING_PUNCT.test(tok.text)) {
			// French puts a space before ? ! : ; keep whatever the track had.
			prev.text += (tok.space ? " " : "") + tok.text;
			prev.end = Math.max(prev.end, end);
			continue;
		}
		tokens.push({
			text: tok.text,
			start: tok.start,
			end: Math.max(end, tok.start + 0.05),
			space: tok.space
		});
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
	/** Token gaps are the track's own pauses (`alignTokens`): a
	 * boundary without one is mid-speech, a weak place to cut. */
	aligned?: boolean;
}

export const DEFAULT_SEGMENT: SegmentOptions = {
	minSec: 2.2,
	maxSec: 8,
	padBefore: 0.15,
	padAfter: 0.35
};

/** How good a cut after token k is: 0 none … 4 sentence end + pause. */
function cutStrength(
	tokens: readonly Token[],
	k: number,
	aligned = false
): number {
	const tok = tokens[k];
	if (!tok) return 0;
	const next = tokens[k + 1];
	const gap = next ? next.start - tok.end : Infinity;
	let score = 0;
	if (SENTENCE_END.test(tok.text)) score = 3;
	else if (CLAUSE_END.test(tok.text)) score = 2;
	if (gap >= 0.6) score += 1;
	else if (gap >= 0.3) score += 0.5;
	else if (aligned && gap < 0.08) score = Math.min(score, 0.5);
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
			const score = cutStrength(tokens, k, opts.aligned);
			if (dur >= opts.minSec && score >= 3) {
				cut = k;
				break;
			}
			// A long silence ends a clip even without punctuation
			// (captions from speech recognition can lack it).
			if (
				dur >= opts.minSec &&
				score >= 1 &&
				(tokens[k + 1]?.start ?? Infinity) - tok.end >= 1.2
			) {
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
			start: Math.max(
				0,
				start - Math.min(opts.padBefore, Math.max(0, roomBefore))
			),
			end: end + Math.min(opts.padAfter, Math.max(0, roomAfter)),
			text: joinTokens(g)
		};
	});
}

/** Loudness frames per second in a track's envelope (20 ms each, one
 * byte per frame: dB + 100, clamped to 0-100). */
export const ENVELOPE_FPS = 50;

/** A quiet run in the track (seconds), and how clearly quiet (0-1). */
export interface Pause {
	start: number;
	end: number;
	strength: number;
}

/** Shortest quiet run that counts as a pause (frames: 80 ms). */
const MIN_PAUSE_FRAMES = 4;

/** Value at percentile `p` (0-1) of a byte histogram. */
function percentile(hist: readonly number[], total: number, p: number): number {
	let seen = 0;
	for (const [v, n] of hist.entries()) {
		seen += n;
		if (seen >= total * p) return v;
	}
	return hist.length - 1;
}

/**
 * The pauses in a track's loudness envelope. "Quiet" sits well below
 * the track's speaking level, so breaths between words don't count
 * but the gap between two sentences does. A track with no quiet to
 * speak of (a music bed under the voice) has none.
 */
export function findPauses(
	env: Uint8Array,
	fps: number = ENVELOPE_FPS
): Pause[] {
	const hist = new Array<number>(101).fill(0);
	for (const v of env)
		hist[Math.min(100, v)] = (hist[Math.min(100, v)] ?? 0) + 1;
	const floor = percentile(hist, env.length, 0.05);
	const loud = percentile(hist, env.length, 0.6);
	if (loud - floor < 15) return [];
	const quiet = floor + 0.4 * (loud - floor);
	const pauses: Pause[] = [];
	let from = -1;
	let sum = 0;
	const close = (to: number): void => {
		const frames = to - from;
		if (frames >= MIN_PAUSE_FRAMES) {
			const depth = Math.min(
				1,
				Math.max(0, (quiet - sum / frames) / (quiet - floor))
			);
			pauses.push({
				start: from / fps,
				end: to / fps,
				strength: Math.min(1, frames / fps / 0.5) * (0.5 + 0.5 * depth)
			});
		}
		from = -1;
		sum = 0;
	};
	for (const [k, v] of env.entries()) {
		if (v < quiet) {
			if (from < 0) from = k;
			sum += v;
		} else if (from >= 0) close(k);
	}
	if (from >= 0) close(env.length);
	return pauses;
}

/** Caption timings can run up to this far late against the audio
 * (auto-dubs: phrase by phrase, never steadily) … */
const ALIGN_LATE_SEC = 4;
/** … or this far early. */
const ALIGN_EARLY_SEC = 2;
/** How far back a matched boundary may look for the one before. */
const ALIGN_LOOKBACK = 8;
/** Cost per second of shift change between neighboring matches. */
const ALIGN_SHIFT_COST = 0.8;
/** Cost per second of shift itself (ties go to the nearer pause). */
const ALIGN_NEAR_COST = 0.15;

interface Boundary {
	/** Token before the boundary. */
	k: number;
	/** Caption time of the boundary (midpoint of its gap). */
	at: number;
	weight: number;
}

/**
 * Move caption tokens onto the audio they transcribe. Sentence and
 * clause ends (and caption gaps) are matched to pauses in the track,
 * keeping the shift between neighbors smooth and the order intact;
 * the words in between stretch to fill the speech between the
 * matched pauses. Null when nothing could be matched (no pauses, or
 * no punctuation): the captions' own timings stand.
 */
export function alignTokens(
	tokens: readonly Token[],
	pauses: readonly Pause[]
): Token[] | null {
	if (tokens.length < 2 || pauses.length === 0) return null;
	const bounds: Boundary[] = [];
	for (let k = 0; k + 1 < tokens.length; k++) {
		const tok = tokens[k];
		const next = tokens[k + 1];
		if (!tok || !next) continue;
		const gap = next.start - tok.end;
		const weight = SENTENCE_END.test(tok.text)
			? 3
			: CLAUSE_END.test(tok.text)
				? 2
				: gap >= 0.25
					? 1
					: 0.4;
		if (weight > 0) bounds.push({ k, at: (tok.end + next.start) / 2, weight });
	}
	if (bounds.length === 0) return null;
	const mid = (p: Pause): number => (p.start + p.end) / 2;

	// Candidates per boundary: pause indexes within the window.
	const cands: number[][] = [];
	let lo = 0;
	for (const b of bounds) {
		while (
			lo < pauses.length &&
			mid(pauses[lo] as Pause) < b.at - ALIGN_LATE_SEC
		)
			lo++;
		const list: number[] = [];
		for (let j = lo; j < pauses.length; j++) {
			const p = pauses[j] as Pause;
			if (mid(p) > b.at + ALIGN_EARLY_SEC) break;
			list.push(j);
		}
		cands.push(list);
	}

	// Best chain ending in (boundary b, candidate c): its score and
	// the link before it.
	const score: number[][] = [];
	const prev: ([number, number] | null)[][] = [];
	let best = -Infinity;
	let bestAt: [number, number] | null = null;
	for (const [b, bound] of bounds.entries()) {
		const list = cands[b] ?? [];
		score.push([]);
		prev.push([]);
		for (const [c, j] of list.entries()) {
			const p = pauses[j] as Pause;
			const shift = mid(p) - bound.at;
			const gain =
				bound.weight * p.strength - ALIGN_NEAR_COST * Math.abs(shift);
			let top = gain - ALIGN_SHIFT_COST * Math.abs(shift);
			let link: [number, number] | null = null;
			for (let pb = Math.max(0, b - ALIGN_LOOKBACK); pb < b; pb++) {
				const before = bounds[pb] as Boundary;
				for (const [pc, pj] of (cands[pb] ?? []).entries()) {
					if (pj >= j) break;
					const s = score[pb]?.[pc];
					if (s === undefined) continue;
					const q = pauses[pj] as Pause;
					// Speech between the two matches can't be wildly
					// faster or slower than the captions say.
					const said = bound.at - before.at;
					const heard = mid(p) - mid(q);
					if (said > 0.5 && (heard < said * 0.4 || heard > said * 2.5))
						continue;
					const v =
						s +
						gain -
						ALIGN_SHIFT_COST * Math.abs(shift - (mid(q) - before.at));
					if (v > top) {
						top = v;
						link = [pb, pc];
					}
				}
			}
			(score[b] as number[])[c] = top;
			(prev[b] as ([number, number] | null)[])[c] = link;
			if (top > best) {
				best = top;
				bestAt = [b, c];
			}
		}
	}
	if (!bestAt || best <= 0) return null;

	// The matched boundaries, in order: a boundary's last word ends
	// where its pause starts; the next word starts where it ends.
	const matched: { k: number; pause: Pause }[] = [];
	for (let at: [number, number] | null = bestAt; at;) {
		const [b, c]: [number, number] = at;
		const bound = bounds[b] as Boundary;
		matched.push({ k: bound.k, pause: pauses[cands[b]?.[c] ?? -1] as Pause });
		at = prev[b]?.[c] ?? null;
	}
	matched.reverse();
	// Each run of words between two matched pauses stretches onto the
	// speech between them; words before the first or after the last
	// shift with their neighbor.
	const out: Token[] = [];
	let m = 0;
	for (const [j, tok] of tokens.entries()) {
		while (m < matched.length && (matched[m] as { k: number }).k < j) m++;
		const left = matched[m - 1];
		const right = matched[m];
		const x0 = left ? (tokens[left.k + 1] as Token).start : NaN;
		const y0 = left ? left.pause.end : NaN;
		const x1 = right ? (tokens[right.k] as Token).end : NaN;
		const y1 = right ? right.pause.start : NaN;
		let map: (t: number) => number;
		if (left && right && x1 > x0)
			map = (t) => y0 + ((t - x0) * (y1 - y0)) / (x1 - x0);
		else if (left) map = (t) => t + (y0 - x0);
		else map = (t) => t + (y1 - x1);
		const start = Math.max(0, map(tok.start));
		out.push({ ...tok, start, end: Math.max(start + 0.05, map(tok.end)) });
	}
	return out;
}

/** Which clip each token belongs to, by the clips' text (a clip's
 * text is its tokens joined); null when the texts don't add up. */
function ownersByText(
	clips: readonly ClipSpan[],
	tokens: readonly Token[]
): number[] | null {
	const owner: number[] = [];
	let k = 0;
	for (const clip of clips) {
		const from = k;
		const want = clip.text.length;
		while (k < tokens.length && joinTokens(tokens.slice(from, k)).length < want)
			k++;
		if (joinTokens(tokens.slice(from, k)) !== clip.text) return null;
		for (let j = from; j < k; j++) owner.push(clip.i);
	}
	return k === tokens.length ? owner : null;
}

/**
 * Move clips onto new times for the same tokens (`alignTokens`, or
 * what a recognizer heard): each clip keeps its words and text, and
 * its window follows those words' new times, padded into the quiet
 * around them. A token belongs to the clip whose text it is part of,
 * else to the clip its `from` start falls in. Clips holding a token
 * past `upTo` keep their window (those words aren't timed yet). Null
 * when the clips don't come from these tokens.
 */
export function retimeClips(
	clips: readonly ClipSpan[],
	from: readonly Token[],
	to: readonly Token[],
	opts: SegmentOptions = DEFAULT_SEGMENT,
	upTo = Infinity
): ClipSpan[] | null {
	if (from.length !== to.length) return null;
	let owner = ownersByText(clips, from);
	if (!owner) {
		owner = [];
		let c = 0;
		for (const tok of from) {
			while (
				c + 1 < clips.length &&
				tok.start >= (clips[c + 1] as ClipSpan).start
			)
				c++;
			owner.push(c);
		}
	}
	const firsts = new Map<number, number>();
	const lasts = new Map<number, number>();
	for (const [k, i] of owner.entries()) {
		if (!firsts.has(i)) firsts.set(i, k);
		lasts.set(i, k);
	}
	const out: ClipSpan[] = [];
	for (const clip of clips) {
		const first = firsts.get(clip.i);
		const last = lasts.get(clip.i);
		if (last !== undefined && last > upTo) {
			out.push(clip);
			continue;
		}
		const head = first === undefined ? undefined : to[first];
		const tail = last === undefined ? undefined : to[last];
		if (!head || !tail) return null;
		const before = first === undefined ? undefined : to[first - 1];
		const after = last === undefined ? undefined : to[last + 1];
		const roomBefore = before ? (head.start - before.end) / 2 : opts.padBefore;
		const roomAfter = after ? (after.start - tail.end) / 2 : opts.padAfter;
		out.push({
			...clip,
			start: Math.max(
				0,
				head.start - Math.min(opts.padBefore, Math.max(0, roomBefore))
			),
			end: tail.end + Math.min(opts.padAfter, Math.max(0, roomAfter))
		});
	}
	return out;
}
