/**
 * Kuroshiro-shaped reading HTML from analyzed tokens, without kuroshiro.
 *
 * Kuroshiro's furigana mode wraps each kanji run in ruby; this wraps it
 * in plain positioned spans instead —
 * `<span class="frb">KANJI<span class="frt">reading</span></span>` —
 * because native ruby reserves the annotation's width in every engine
 * that matters here (WebKit ignores out-of-flow positioning on `rt`
 * entirely), pushing base characters onto the next line. Absolutely
 * positioned spans render the same readings above the base with zero
 * layout footprint in all engines. Everything else passes through
 * untouched: okurigana splits off plain on both sides (食(た)べ,
 * お|会(あ)|い), kana/romaji/numbers never take readings. The output
 * stays raw (unsanitized) exactly like kuroshiro's — the caller
 * sanitizes downstream, unchanged.
 *
 * Pure and unit-tested against kuroshiro's own outputs. The tokenizer
 * behind the tokens (lindera, kuromoji before it) only supplies
 * surface + katakana reading per token.
 */
export interface RubyToken {
	surface: string;
	/** Katakana reading (IPAdic details), or null/"*" when unknown. */
	reading: string | null | undefined;
}

/** CJK unified + extension A + compatibility (kuroshiro's kanji test). */
const KANJI = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
/** Hiragana + katakana (prolonged mark included). */
const KANA = /[\u3040-\u309F\u30A0-\u30FF]/;
/** Kanji iteration mark joins kanji runs (one ruby for 様々). */
const ITERATION_MARK = "\u3005";

function isKanjiChar(ch: string): boolean {
	return KANJI.test(ch) || ch === ITERATION_MARK;
}

function hasKanji(text: string): boolean {
	return [...text].some((ch) => isKanjiChar(ch));
}

/**
 * Ruby HTML for one token stream. `toHiragana` converts the katakana
 * reading (wanakana in production); injected so tests stay dependency-
 * free and the mapping stays visibly somebody else's job.
 */
export function rubyHtmlForTokens(
	tokens: RubyToken[],
	toHiragana: (katakana: string) => string
): string {
	let out = "";
	for (const token of tokens) {
		out += rubyToken(token, toHiragana);
	}
	return out;
}

/**
 * Reading HTML for one token stream aligned back to its source text.
 * Morphological tokenizers drop whitespace (and can skip clock
 * numerals, emoji, and other unknowns), so joining token surfaces
 * alone corrupts the text — "Here are three" comes back
 * "Herearethree". Each token is matched sequentially against the
 * source; whatever sits between matches (spaces, punctuation the
 * tokenizer skipped) passes through verbatim, exactly like a
 * kanji-less token surface does. A token that matches nowhere (the
 * tokenizer normalized or reordered it) still renders rather than
 * silently dropping its content. Raw like rubyToken's passthrough —
 * the caller sanitizes downstream.
 */
export function rubyHtmlForText(
	text: string,
	tokens: RubyToken[],
	toHiragana: (katakana: string) => string
): string {
	let out = "";
	let pos = 0;
	for (const token of tokens) {
		const surface = token.surface;
		if (!surface) continue;
		const at = text.indexOf(surface, pos);
		if (at < 0) {
			out += rubyToken(token, toHiragana);
			continue;
		}
		out += text.slice(pos, at);
		pos = at + surface.length;
		out += rubyToken(token, toHiragana);
	}
	out += text.slice(pos);
	return out;
}

interface SurfaceRun {
	text: string;
	kanji: boolean;
}

/**
 * One reading-annotated token. Kana runs anchor the reading: leading and
 * trailing okurigana split off plain (食(た)べ, お|会(あ)|い), and kana
 * *inside* a token pins the split between kanji runs (感(かん)じ取(と) —
 * lindera segments coarser than kuromoji did, so per-token edge
 * stripping alone would ruby the whole 感じ取 as one blur). Each kanji
 * run takes the reading up to the next kana anchor (or the end).
 * Anything the alignment cannot explain passes through untouched — a
 * missing ruby beats a wrong one.
 */
function rubyToken(
	token: RubyToken,
	toHiragana: (katakana: string) => string
): string {
	const surface = token.surface;
	if (!surface || !hasKanji(surface)) return surface;
	const reading = token.reading;
	if (!reading || reading === "*") return surface;
	const hira = [...toHiragana(reading)];
	// Maximal kanji / non-kanji runs ([感][じ][取][れ]).
	const runs: SurfaceRun[] = [];
	for (const ch of [...surface]) {
		const last = runs[runs.length - 1];
		const kanji = isKanjiChar(ch);
		if (last && last.kanji === kanji) last.text += ch;
		else runs.push({ text: ch, kanji });
	}
	// Only pure-kana runs can anchor: romaji, numbers, and punctuation
	// inside a kanji token have no clean reading alignment.
	if (runs.some((r) => !r.kanji && ![...r.text].every((ch) => KANA.test(ch)))) {
		return surface;
	}
	let pos = 0;
	let out = "";
	for (let i = 0; i < runs.length; i++) {
		const run = runs[i];
		if (!run) return surface;
		if (!run.kanji) {
			const want = [...run.text];
			if (hira.slice(pos, pos + want.length).join("") !== run.text)
				return surface;
			pos += want.length;
			out += run.text;
			continue;
		}
		const nextKana = runs.slice(i + 1).find((r) => !r.kanji);
		let share: string;
		if (nextKana) {
			// Readings are BMP kana, so the UTF-16 index is a char index.
			const at = hira.slice(pos).join("").indexOf(nextKana.text);
			if (at <= 0) return surface;
			share = hira.slice(pos, pos + at).join("");
			pos += at;
		} else {
			share = hira.slice(pos).join("");
			pos = hira.length;
		}
		if (!share) return surface;
		out += `<span class="frb">${run.text}<span class="frt">${share}</span></span>`;
	}
	if (pos !== hira.length) return surface;
	return out;
}

/** One analyser token: surface plus its IPAdic details (reading at 7). */
export interface MorphToken {
	surface: string;
	details: string[];
}

/**
 * One token of an N-best path. Byte offsets locate it exactly in the
 * line, so a compound covering a run of best-path tokens is found even
 * when the same characters appear twice.
 */
export interface NbestToken extends MorphToken {
	byteStart: number;
	byteEnd: number;
	unknown: boolean;
}

/** One N-best path: the tokens covering the line, cheapest first. */
export interface NbestPath {
	cost: number;
	tokens: NbestToken[];
}

/**
 * Words whose analyser reading is the less common one. The everyday
 * reading replaces it, but only when the analyser gave one of the
 * known alternatives: names (明日 あけび), fixed phrases (日本銀行
 * にっぽんぎんこう is its own token anyway) and other senses (一日
 * ついたち, the first of the month) keep theirs.
 */
export const EVERYDAY_READINGS: Readonly<
	Record<string, { everyday: string; alternatives: readonly string[] }>
> = {
	日本: { everyday: "にほん", alternatives: ["にっぽん"] },
	日本語: { everyday: "にほんご", alternatives: ["にっぽんご"] },
	日本人: { everyday: "にほんじん", alternatives: ["にっぽんじん"] },
	一日: { everyday: "いちにち", alternatives: ["ひといち", "いちじつ"] },
	今日: { everyday: "きょう", alternatives: ["こんにち", "こんじつ"] },
	明日: { everyday: "あした", alternatives: ["あす", "みょうにち"] },
	昨日: { everyday: "きのう", alternatives: ["さくじつ"] },
	今朝: { everyday: "けさ", alternatives: ["こんちょう"] },
	大人: { everyday: "おとな", alternatives: ["たいじん"] },
	二十歳: {
		everyday: "はたち",
		alternatives: ["にじゅうさい", "にじゅっさい", "にじっさい"]
	}
};

const encoder = new TextEncoder();
const byteLen = (s: string): number => encoder.encode(s).length;

function morphReading(m: MorphToken): string | null {
	const reading = m.details[7];
	return reading && reading !== "*" ? reading : null;
}

/** A best-path token that may join a compound: one kanji, a word, a reading. */
function mergeable(m: MorphToken): boolean {
	if ((m.details[0] ?? "") === "記号") return false;
	const chars = [...m.surface];
	if (chars.length !== 1 || !isKanjiChar(chars[0] ?? "")) return false;
	return morphReading(m) !== null;
}

/**
 * The word-level reading for a span from the N-best lattice: a single
 * dictionary token covering exactly the span (一歩 イッポ loses to
 * 一|歩 on cost, but it is there). Proper nouns lose to common words
 * (一人 ヒトリ beats the name カズト); names only win when nothing else
 * covers the span. Null when the dictionary has no such compound.
 */
function compoundReading(
	span: string,
	byteStart: number,
	byteEnd: number,
	nbest: readonly NbestPath[]
): string | null {
	let word: { cost: number; reading: string } | null = null;
	let name: { cost: number; reading: string } | null = null;
	for (const path of nbest) {
		for (const t of path.tokens) {
			if (t.unknown || t.surface !== span) continue;
			if (t.byteStart !== byteStart || t.byteEnd !== byteEnd) continue;
			if (t.details[0] === "記号") continue;
			const reading = morphReading(t);
			if (!reading) continue;
			const cand = { cost: path.cost, reading };
			if (t.details[1] === "固有名詞") {
				if (!name || path.cost < name.cost) name = cand;
			} else if (!word || path.cost < word.cost) word = cand;
		}
	}
	return (word ?? name)?.reading ?? null;
}

/**
 * Ruby tokens for one line from lindera's best path plus its N-best
 * lattice. The best path splits some compounds into single kanji (一|歩,
 * 露|軍) whose readings are wrong in context (いち|ほ), so runs of
 * adjacent single-kanji tokens rejoin first: the reading comes from the
 * lattice's whole-span token (一歩 いっぽ), else from the joined token
 * readings (露軍 ろぐん). Either way it sits over the whole compound;
 * only kana anchors split a reading (see rubyToken). A space breaks a
 * run, and without N-best paths nothing merges. Everyday readings then
 * replace known less-common analyser readings (日本 にっぽん → にほん).
 */
export function rubyTokensForLine(
	text: string,
	morphs: readonly MorphToken[],
	nbest: readonly NbestPath[],
	toHiragana: (katakana: string) => string
): RubyToken[] {
	const aligned: { morph: MorphToken; start: number; end: number }[] = [];
	let pos = 0;
	for (const m of morphs) {
		if (!m.surface) continue;
		const at = text.indexOf(m.surface, pos);
		if (at < 0) {
			// Unalignable tokens never merge; rubyHtmlForText still
			// renders them where they fall.
			aligned.push({ morph: m, start: -1, end: -1 });
			continue;
		}
		aligned.push({ morph: m, start: at, end: at + m.surface.length });
		pos = at + m.surface.length;
	}
	const words: { surface: string; reading: string | null }[] = [];
	for (let i = 0; i < aligned.length;) {
		const first = aligned[i];
		if (!first) break;
		let end = i + 1;
		if (nbest.length > 0 && first.start >= 0 && mergeable(first.morph)) {
			for (let prev = first; end < aligned.length; end++) {
				const next = aligned[end];
				if (!next || next.start !== prev.end || !mergeable(next.morph)) break;
				prev = next;
			}
		}
		if (end - i < 2) {
			words.push({
				surface: first.morph.surface,
				reading: morphReading(first.morph)
			});
			i += 1;
			continue;
		}
		const run = aligned.slice(i, end);
		const span = run.map((r) => r.morph.surface).join("");
		const byteStart = byteLen(text.slice(0, first.start));
		const reading =
			compoundReading(span, byteStart, byteStart + byteLen(span), nbest) ??
			run.map((r) => morphReading(r.morph) ?? "").join("");
		words.push({ surface: span, reading });
		i = end;
	}
	return words.map(({ surface, reading }) => {
		const everyday = EVERYDAY_READINGS[surface];
		if (reading && everyday?.alternatives.includes(toHiragana(reading)))
			return { surface, reading: everyday.everyday };
		return { surface, reading };
	});
}

/** The lindera tokenizer calls the conversion uses (the worker's, or a test's). */
export interface LinderaTokenizer {
	tokenize(text: string): unknown;
	tokenizeNbest(text: string, n: number): unknown;
}

function asDetails(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}

/** N-best paths as plain data (20 deep: compounds sit well below the best path); never throws. */
function nbestPaths(tokenizer: LinderaTokenizer, text: string): NbestPath[] {
	try {
		const paths = tokenizer.tokenizeNbest(text, 20);
		if (!Array.isArray(paths)) return [];
		const out: NbestPath[] = [];
		for (const p of paths as { tokens?: unknown; cost?: unknown }[]) {
			if (!p || !Array.isArray(p.tokens)) continue;
			const tokens: NbestToken[] = [];
			for (const t of p.tokens as Record<string, unknown>[]) {
				if (!t || typeof t.surface !== "string") continue;
				if (typeof t.byteStart !== "number" || typeof t.byteEnd !== "number")
					continue;
				tokens.push({
					surface: t.surface,
					details: asDetails(t.details),
					byteStart: t.byteStart,
					byteEnd: t.byteEnd,
					unknown: t.isUnknown === true
				});
			}
			const cost = Number(p.cost);
			out.push({
				cost: Number.isFinite(cost) ? cost : Number.MAX_SAFE_INTEGER,
				tokens
			});
		}
		return out;
	} catch {
		return [];
	}
}

/** Raw (unsanitized) furigana HTML for one line through a lindera tokenizer. */
export function furiganaLineHtml(
	tokenizer: LinderaTokenizer,
	text: string,
	toHiragana: (katakana: string) => string
): string {
	const raw = tokenizer.tokenize(text);
	const morphs: MorphToken[] = (Array.isArray(raw) ? raw : []).map(
		(t: { surface?: unknown; details?: unknown }) => ({
			surface: typeof t.surface === "string" ? t.surface : "",
			details: asDetails(t.details)
		})
	);
	const tokens = rubyTokensForLine(
		text,
		morphs,
		nbestPaths(tokenizer, text),
		toHiragana
	);
	return rubyHtmlForText(text, tokens, toHiragana);
}
