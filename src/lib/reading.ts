import type { ChatProvider } from "./providers/types";
import { annRefsFor } from "./annotations";
import { escapeHtml } from "./render-math";

/**
 * Reading aids + speech, generalized across languages (A6).
 *
 * Two separate concerns live here:
 * - Reading aids: only scripts whose orthography hides readings get a ruby
 *   aid (Chinese pinyin, Japanese furigana). Anything the app cannot compute
 *   locally goes through the generic model-aid path (tashkeel is the first
 *   entry, not a special case).
 * - Speech: every word in any language resolves to a voice locale via
 *   Unicode script. Latin script cannot self-identify (French vs German vs
 *   English look alike), so callers pass the user's learning-language
 *   fallback from settings.
 */

/** Scripts with a dedicated ruby reading aid. */
export type AidScript = "zh" | "ja" | "ar";

/**
 * Characters that can carry ruby: kana plus Han (kanji are Han), with
 * the CJK iteration mark. Marks which rendered paragraphs reserve
 * ruby's vertical room — English paragraphs never do, so their text
 * selection stays tight.
 */
export const RUBY_SCRIPT_RE =
	/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\u3005]/;
/** Kept for existing import sites. */
export type DetectedScript = AidScript;

/**
 * Every aid script present in the text, in aid priority order. Arabic
 * and kana are message-wide signals, but Han is shared: kanji are Han
 * characters, so a Han run only counts as Chinese on a line with no
 * kana. Pure Japanese (kana mixed through every line) reports just
 * `ja`, while a message with its own Chinese section reports both —
 * so the row can offer furigana and pinyin side by side.
 */
const KANA_RE = /[\u3040-\u309F\u30A0-\u30FF]/;

/**
 * Lines tagged code-aware: ``` fence lines toggle fenced runs, and
 * fenced runs (plus their fences) never convert. Fences own the whole
 * rest on unclosed input, exactly like the markdown renderer.
 */
export function codeAwareLines(
	text: string
): Array<{ line: string; code: boolean }> {
	const out: Array<{ line: string; code: boolean }> = [];
	let fenced = false;
	for (const line of text.split("\n")) {
		if (/^\s*```/.test(line)) {
			fenced = !fenced;
			out.push({ line, code: true });
			continue;
		}
		out.push({ line, code: fenced });
	}
	return out;
}

/**
 * Detection text for aid buttons: fenced code blocks are out, and
 * inline code spans read as empty, so Japanese/Chinese living only in
 * code never summons the pinyin/furigana buttons. Pure and unit-tested.
 */
export function stripCodeForDetection(text: string): string {
	return codeAwareLines(text)
		.filter((entry) => !entry.code)
		.map((entry) => entry.line.replace(/`[^`\n]*`/g, ""))
		.join("\n");
}

export function detectScripts(text: string): AidScript[] {
	const scripts: AidScript[] = [];
	if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) scripts.push("ar");
	if (KANA_RE.test(text)) scripts.push("ja");
	if (
		text
			.split("\n")
			.some((line) => /\p{Script=Han}/u.test(line) && !KANA_RE.test(line))
	) {
		scripts.push("zh");
	}
	return scripts;
}

/**
 * Which local aid owns one rendered line: kana lines read as Japanese,
 * anything else converts nothing. A Han-only line is genuinely
 * ambiguous — kanji are Han characters in both languages — so the
 * chat's reply language breaks the tie when one is set, and Chinese
 * wins by default exactly as before. Kana is unambiguous: no pill
 * ever overrides it. Dual-aid rendering applies each aid only to its
 * own lines, so pinning both reads a mixed message end to end.
 */
export function classifyAidLine(
	line: string,
	preferred: LocalAid | null = null
): LocalAid | null {
	if (KANA_RE.test(line)) return "furigana";
	if (/\p{Script=Han}/u.test(line)) return preferred ?? "pinyin";
	return null;
}

/**
 * True when the text holds a Han-only line (Han, no kana): the lines
 * no script test can own, where the reply-language pill decides.
 */
export function hasAmbiguousAidLine(text: string): boolean {
	return text
		.split("\n")
		.some((line) => /\p{Script=Han}/u.test(line) && !KANA_RE.test(line));
}

// --- Han character overlay language (components overlay) ---

/**
 * Overlay reading locale for a Han selection: kana present means
 * Japanese, anything else defaults to Chinese — the same rule as
 * `ttsLangFor` (kana → ja-JP, Han → zh-CN) and `classifyAidLine`
 * (kana lines → furigana, Han-only → pinyin).
 */
export type HanOverlayLang = "ja" | "zh";

/** BCP-47 tag per overlay locale (matches `ttsLangFor` outputs). */
export const HAN_OVERLAY_LANG_TAG: Record<HanOverlayLang, string> = {
	ja: "ja-JP",
	zh: "zh-CN"
};

/** Kana present = Japanese, else Chinese default. */
export function hanOverlayLangFor(text: string): HanOverlayLang {
	return KANA_RE.test(text) ? "ja" : "zh";
}

/**
 * True when the guess is uncertain: the text holds Han but no kana,
 * so kanji and hanzi are indistinguishable and the overlay offers a
 * small JP/中文 toggle to flip a wrong prediction.
 */
export function isHanOverlayLangUncertain(text: string): boolean {
	return (
		/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text) &&
		!KANA_RE.test(text)
	);
}

/**
 * The chat reply pill's local aid, if it has one: Japanese owns
 * kanji-only lines, Chinese and Cantonese keep the default. Anything
 * else (and no pill) leaves ownership untouched.
 */
export function preferredLocalAid(code: string | null): LocalAid | null {
	if (code === "ja") return "furigana";
	if (code === "zh" || code === "yue") return "pinyin";
	return null;
}

/** Arabic first (its block is distinct), then kana, then Han. */
export function detectScript(text: string): DetectedScript | null {
	return detectScripts(text)[0] ?? null;
}

export const SCRIPT_LABEL: Record<DetectedScript, string> = {
	zh: "中文",
	ja: "日本語",
	ar: "العربية"
};

export const AID_LABEL: Record<DetectedScript, string> = {
	zh: "pinyin",
	ja: "furigana",
	ar: "tashkeel"
};

const WORD_BREAK =
	/[\s，。！？、；：「」『』（）［］【】《》〈〉…—–·,.!?;:"'()[\]{}<>・、。؟؛،«»‹›„“”‘’\n\r\t]/;

export function isWordChar(char: string | undefined): boolean {
	return char !== undefined && char !== "" && !WORD_BREAK.test(char);
}

/** Expand `offset` to the full word (maximal run of word chars). */
export function extractWordAt(text: string, offset: number): string {
	if (offset < 0 || offset >= text.length || !isWordChar(text[offset]))
		return "";
	let start = offset;
	while (start > 0 && isWordChar(text[start - 1])) start--;
	let end = offset;
	while (end < text.length && isWordChar(text[end])) end++;
	return text.slice(start, end);
}

const SENTENCE_END = /[.!?。！？．]/;

/**
 * Sentence span containing `offset`: from after the previous
 * sentence-ending mark (plus its trailing spaces) through the next
 * one. Western and CJK terminators both end a sentence; a caret
 * parked past the final mark selects the last sentence, never an
 * empty span. Pure — backs triple-tap sentence select.
 */
export function sentenceBounds(text: string, offset: number): [number, number] {
	const at = Math.min(Math.max(offset, 0), text.length);
	let end = text.length;
	for (let i = at; i < text.length; i++) {
		if (SENTENCE_END.test(text[i] ?? "")) {
			end = i + 1;
			break;
		}
	}
	let start = 0;
	for (let i = at - 1; i >= 0; i--) {
		if (SENTENCE_END.test(text[i] ?? "")) {
			start = i + 1;
			break;
		}
	}
	while (start < end && /\s/.test(text[start] ?? "")) start++;
	if (start >= end) return sentenceBounds(text, at - 1);
	return [start, end];
}

// --- Speech locale: Unicode script → BCP-47, Latin falls back ---

/** Non-Latin scripts map to a voice locale; order matters (check callers). */
const SCRIPT_LOCALE: Array<{ test: (word: string) => boolean; lang: string }> =
	[
		{
			test: (w) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(w),
			lang: "ar-SA"
		},
		{ test: (w) => /[\u3040-\u309F\u30A0-\u30FF]/.test(w), lang: "ja-JP" },
		{ test: (w) => /\p{Script=Hangul}/u.test(w), lang: "ko-KR" },
		{ test: (w) => /\p{Script=Han}/u.test(w), lang: "zh-CN" },
		{ test: (w) => /\p{Script=Cyrillic}/u.test(w), lang: "ru-RU" },
		{ test: (w) => /\p{Script=Greek}/u.test(w), lang: "el-GR" },
		{ test: (w) => /\p{Script=Hebrew}/u.test(w), lang: "he-IL" },
		{ test: (w) => /\p{Script=Thai}/u.test(w), lang: "th-TH" },
		{ test: (w) => /\p{Script=Devanagari}/u.test(w), lang: "hi-IN" },
		{ test: (w) => /\p{Script=Armenian}/u.test(w), lang: "hy-AM" },
		{ test: (w) => /\p{Script=Georgian}/u.test(w), lang: "ka-GE" }
	];

/**
 * BCP-47 voice locale for a word. Non-Latin scripts resolve by Unicode
 * script; Latin-script words (French, German, English, …) use `fallback`,
 * which callers take from the user's voice-language setting.
 */
export function ttsLangFor(word: string, fallback = "en-US"): string {
	for (const { test, lang } of SCRIPT_LOCALE) {
		if (test(word)) return lang;
	}
	return fallback;
}

/**
 * Script-run key for one character: Latin letters report `"latin"`;
 * kana and Han share `"han"` (a kanji mid-Japanese must not split the
 * run — kana presence already decides Japanese at the sentence
 * level); every other non-Latin script keeps its own key; anything
 * scriptless (space, punctuation, digits, emoji) reports `"other"`
 * for callers to glue onto the current run.
 */
export function scriptRunKey(ch: string): string {
	if (/\p{Script=Latin}/u.test(ch)) return "latin";
	const lang = ttsLangFor(ch, "");
	if (lang === "ja-JP" || lang === "zh-CN") return "han";
	return lang === "" ? "other" : lang;
}

/**
 * Whether `text` carries Hanyu pinyin tone marks: the caron vowels
 * (ǎ ǐ ǒ ǔ ě) and the u-umlaut series (ǖ ǘ ǚ ǜ), in either case. Those
 * marks occur in no other Latin orthography — Vietnamese, the closest
 * lookalike, uses acute/grave/hook/tilde/dot but never caron or
 * diaeresis-u — so toned pinyin is unambiguously Mandarin. Apple's
 * language recognizer disagrees (it reads a toned-pinyin sentence as
 * Vietnamese at ~0.98), so callers check this before the bridge and
 * route pinyin to the Chinese voice. Toneless pinyin stays genuinely
 * ambiguous Latin and is left alone. Pure.
 */
export function hasPinyinTones(text: string): boolean {
	return /[ǎǍǐǏǒǑǔǓěĚǖǘǚǜǕǗǙǛ]/.test(text);
}

export interface SpeakResult {
	spoken: boolean;
	lang: string;
}

/** Read one word aloud. False when speech synthesis is unavailable. */
export function speakWord(word: string, fallback = "en-US"): SpeakResult {
	const lang = ttsLangFor(word, fallback);
	if (typeof speechSynthesis === "undefined") return { spoken: false, lang };
	try {
		speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(word);
		utterance.lang = lang;
		const voice = speechSynthesis
			.getVoices()
			.find((v) =>
				v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())
			);
		if (voice) utterance.voice = voice;
		speechSynthesis.speak(utterance);
		return { spoken: true, lang };
	} catch {
		return { spoken: false, lang };
	}
}

// --- Model-assisted reading aids (tashkeel first, not special) ---

export interface ModelAid {
	id: string;
	label: string;
	button: string;
	title: string;
	/** Revert control once applied, in the aid's own script. */
	revert: string;
	/** Tooltip for the revert control. */
	revertTip: string;
	instruction: string;
}

export const MODEL_AIDS: Record<string, ModelAid> = {
	tashkeel: {
		id: "tashkeel",
		label: "tashkeel",
		button: "تشكيل",
		title: "Add tashkeel",
		revert: "إبداعي",
		revertTip: "Back to the original text",
		instruction:
			"Add full Arabic diacritics (tashkeel) to the following text. " +
			"Reply with the vocalized text only, one line per input line, no explanations."
	}
};

/** Lines carrying Arabic script: the only lines tashkeel may touch. */
const ARABIC_LINE_RE = /[\u0600-\u06FF\u0750-\u077F]/;

export function aidTargetLines(text: string): number[] {
	const indexes: number[] = [];
	text.split("\n").forEach((line, i) => {
		if (ARABIC_LINE_RE.test(line)) indexes.push(i);
	});
	return indexes;
}

/**
 * Splice vocalized lines back into the original line structure, so a
 * model aid on a multilingual message replaces only its own script —
 * Japanese/Chinese/English paragraphs stay byte-identical, and the
 * model call itself carries (and bills) only the Arabic. Null when
 * the shape doesn't fit (one result line per sent line), so callers
 * fall back to the whole-text replace rather than scrambling.
 */
export function spliceAidResult(
	original: string,
	indexes: number[],
	result: string
): string | null {
	const out = result.split("\n");
	if (out.length !== indexes.length) return null;
	const lines = original.split("\n");
	indexes.forEach((lineIdx, k) => {
		const replacement = out[k];
		if (lineIdx < lines.length && replacement !== undefined)
			lines[lineIdx] = replacement;
	});
	return lines.join("\n");
}

/** Aid-script → model-aid id. Local-compute aids (pinyin, furigana) map to null. */
export const MODEL_AID_FOR_SCRIPT: Record<AidScript, string | null> = {
	zh: null,
	ja: null,
	ar: "tashkeel"
};

/** Locally computed ruby rendering (message body changes when the aids
toggle flips). Model-aid scripts (Arabic tashkeel) render identically
either way until their aid button is applied — the toggle only reveals
the button. */
export type LocalAid = "pinyin" | "furigana";

/** Native-script labels for the per-message local-aid buttons. */
export const LOCAL_AID_BUTTON: Record<LocalAid, string> = {
	pinyin: "拼音",
	furigana: "読み仮名"
};

/** "Show original" in the aid's own script (button state after pinning). */
export const LOCAL_AID_SHOW_ORIGINAL: Record<LocalAid, string> = {
	pinyin: "显示原件",
	furigana: "オリジナルを表示"
};

/** English titles for the per-message local-aid buttons. */
export const LOCAL_AID_ADD_TITLE: Record<LocalAid, string> = {
	pinyin: "Add pinyin",
	furigana: "Add furigana"
};
export function localAidFor(script: DetectedScript | null): LocalAid | null {
	if (script === "zh") return "pinyin";
	if (script === "ja") return "furigana";
	return null;
}

/** Local aids for every script present: furigana before pinyin, matching
 * detectScripts priority. Arabic (model aid) contributes none. */
export function localAidsFor(scripts: AidScript[]): LocalAid[] {
	const aids: LocalAid[] = [];
	if (scripts.includes("ja")) aids.push("furigana");
	if (scripts.includes("zh")) aids.push("pinyin");
	return aids;
}

/**
 * Which local-aid kinds a message body renders: pinned kinds it still
 * offers (edited text may offer fewer), plus a hover-peeked kind
 * previewed alongside them. Pure — the caller memoizes the reference
 * (see createRefMemo): the render effect subscribes to the array
 * identity, so a fresh array per parent render (every hover near an
 * aid button) rebuilt every body and re-stamped its badges, flickering
 * the text whenever several marks were mounted.
 */
export function resolveAidKinds(
	offered: LocalAid[],
	pinned: LocalAid[],
	peek: LocalAid | null
): LocalAid[] {
	if (offered.length === 0) return [];
	const kept = pinned.filter((kind) => offered.includes(kind));
	if (peek !== null && offered.includes(peek) && !kept.includes(peek)) {
		return [...kept, peek];
	}
	return kept;
}

/**
 * Text the reading aids see: baked annotation blocks are metadata, not
 * prose — detecting or converting them would reserve ruby's room for
 * hidden text and grow annotated history.
 */
export function aidDisplayText(content: string): string {
	return annRefsFor(content)?.text ?? content;
}

/**
 * Local aids a message offers: every script's own aid, plus the chat
 * reply pill's aid when the text holds kanji-only lines no script test
 * can own (preferred first — it names the chat's language). Without a
 * pill, or without ambiguous lines, this is exactly the script-only
 * list as before.
 */
export function offeredLocalAids(
	text: string,
	replyCode: string | null
): LocalAid[] {
	// Code never summons reading aids: detection reads the prose
	// with fenced blocks and inline spans stripped out.
	const prose = stripCodeForDetection(text);
	const kinds = localAidsFor(detectScripts(prose));
	const preferred = preferredLocalAid(replyCode);
	if (preferred && hasAmbiguousAidLine(prose) && !kinds.includes(preferred))
		kinds.unshift(preferred);
	return kinds;
}

const aidCache = new Map<string, string>();

export function buildAidMessages(
	aidId: string,
	text: string
): Array<{ role: string; content: string }> {
	const aid = MODEL_AIDS[aidId];
	if (!aid) throw new Error(`Unknown reading aid: ${aidId}.`);
	return [
		{ role: "system", content: aid.instruction },
		{ role: "user", content: text }
	];
}

/** Run a model-assisted reading aid, cached by aid + exact input. */
export async function runModelAid(
	provider: ChatProvider,
	aidId: string,
	text: string,
	signal?: AbortSignal
): Promise<string> {
	const trimmed = text.trim();
	if (!trimmed) throw new Error("Nothing to vocalize.");
	const key = `${aidId}:${trimmed}`;
	const cached = aidCache.get(key);
	if (cached !== undefined) return cached;
	const result = await provider.chat(
		buildAidMessages(aidId, trimmed) as Array<{
			role: "system" | "user" | "assistant";
			content: string;
		}>,
		{ signal }
	);
	const aided = result.content.trim();
	if (!aided) throw new Error("Empty aid result.");
	aidCache.set(key, aided);
	return aided;
}

/** Back-compat wrapper: tashkeel is `MODEL_AIDS.tashkeel`. */
export function buildVocalizeMessages(
	text: string
): Array<{ role: string; content: string }> {
	return buildAidMessages("tashkeel", text);
}

/** Back-compat wrapper: tashkeel is `MODEL_AIDS.tashkeel`. */
export function vocalizeArabic(
	provider: ChatProvider,
	text: string,
	signal?: AbortSignal
): Promise<string> {
	return runModelAid(provider, "tashkeel", text, signal);
}

/**
 * Readings alone from ruby markup: the characters are right there in
 * the highlight, so the overlay carries only their pronunciations
 * (pinyin space-joined, furigana run together). Pure over strings
 * (parses, never touches live DOM). The result is always inert —
 * `escapeHtml` over textContent, or null when nothing matches — so
 * overlay `{@html}` sinks stay XSS-clean by construction.
 */
export function readingsOnly(
	html: string,
	joiner: string,
	selector: string
): string | null {
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString(html, "text/html");
	} catch {
		return null;
	}
	const parts = [...doc.querySelectorAll(selector)]
		.map((el) => el.textContent?.trim() ?? "")
		.filter((part) => part !== "");
	return parts.length > 0 ? escapeHtml(parts.join(joiner)) : null;
}

/** One annotated run for the selection popup: a kanji slice with its
contextual reading, or plain text (okurigana repeats uncolored). */
export interface AnnotatedRun {
	text: string;
	reading: string | null;
}

/**
 * Split ruby HTML into annotated runs for the selection popup: each
 * `.frb` span becomes a kanji run with its `.frt` reading, every
 * other element is transparent (real converter output wraps runs in
 * paragraphs), and text passes through as plain runs. Returns null
 * when no kanji run carries a reading — the popup stays shut, same
 * as the flat path. Parsing (not string-splitting) keeps hostile
 * markup inert: only span text is ever read out, and the Svelte
 * renderer escapes it again on the way in.
 */
/** One annotated run plus its plain-text span: `start`/`end` index
into the concatenated run texts (reading/`rt` text excluded). */
export interface AnnotatedRunWithOffsets extends AnnotatedRun {
	start: number;
	end: number;
}

/**
 * Ruby HTML parsed into annotated runs with plain-text offsets: each
 * run carries its `start`/`end` into the concatenated run texts, so a
 * full-sentence conversion can be sliced down to a highlight. Reading
 * (`rt`/`.frt`) text never advances the offsets — only base/plain
 * text counts. Same parse and null contract as `annotatedRuns`
 * (null when no kanji run carries a reading); strings only, so
 * hostile markup stays inert.
 */
export function annotatedRunsWithOffsets(
	html: string
): AnnotatedRunWithOffsets[] | null {
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString(html, "text/html");
	} catch {
		return null;
	}
	const out: AnnotatedRunWithOffsets[] = [];
	let found = false;
	let cursor = 0;
	const plain = (text: string): void => {
		if (text !== "") {
			out.push({ text, reading: null, start: cursor, end: cursor + text.length });
			cursor += text.length;
		}
	};
	// Same walk as `annotatedRuns`: plain elements are transparent,
	// only .frb is special; offsets advance on emitted text alone.
	const walk = (node: Node): void => {
		if (node.nodeType === Node.TEXT_NODE) {
			plain(node.textContent ?? "");
			return;
		}
		if (node instanceof Element && node.classList.contains("frb")) {
			const reading = node.querySelector(".frt")?.textContent?.trim() ?? "";
			const base = [...node.childNodes]
				.filter((kid) => kid.nodeType === Node.TEXT_NODE)
				.map((kid) => kid.textContent ?? "")
				.join("");
			if (base !== "" && reading !== "") {
				out.push({
					text: base,
					reading,
					start: cursor,
					end: cursor + base.length
				});
				cursor += base.length;
				found = true;
			} else {
				plain(node.textContent ?? "");
			}
			return;
		}
		node.childNodes.forEach(walk);
	};
	doc.body.childNodes.forEach(walk);
	return found ? out : null;
}

/** One popup's kanji: back-to-back reading runs share a panel, and
colors restart at 0 per group — solo furigana always the lead color,
shared popups split boundaries by color. Kana/plain runs split
groups and never render. `start`/`end` index into the concatenated
run texts (the highlight), so panels anchor and tint by span. Pure
over runs. */
export interface GroupedRun extends AnnotatedRun {
	group: number;
	color: number;
	start: number;
	end: number;
}
export function groupRuns(runs: AnnotatedRun[], size = 4): GroupedRun[] {
	const out: GroupedRun[] = [];
	let group = -1;
	let color = 0;
	let open = false;
	let cursor = 0;
	for (const run of runs) {
		const len = run.text.length;
		if (run.reading === null) {
			open = false;
		} else {
			if (!open) {
				group += 1;
				color = 0;
				open = true;
			}
			out.push({
				text: run.text,
				reading: run.reading,
				group,
				color,
				start: cursor,
				end: cursor + len
			});
			color = (color + 1) % size;
		}
		cursor += len;
	}
	return out;
}

/**
 * Sub-runs covering a highlight's first occurrence in a converted
 * sentence: locate `quote` in `sentencePlain` (the concatenated
 * sentence run texts) and clip overlapping `sentenceRuns` to that
 * span, preserving each run's reading on its clipped slice. Null
 * when the quote is empty, unfound, or covers no runs.
 *
 * NOTE (first-occurrence limitation): `indexOf` finds the quote's
 * FIRST occurrence, so a phrase repeated in the sentence always
 * slices that first span — never a later selected instance. The
 * +page wiring must pass the sentence containing the selection, and
 * callers needing occurrence choice must resolve the offset first.
 * Pure over strings; hostile markup stays inert (strings only, no
 * elements).
 */
export function sliceRunsForQuote(
	sentenceRuns: AnnotatedRunWithOffsets[] | null,
	sentencePlain: string,
	quote: string
): AnnotatedRun[] | null {
	if (!sentenceRuns || quote === "") return null;
	const qStart = sentencePlain.indexOf(quote);
	if (qStart < 0) return null;
	const qEnd = qStart + quote.length;
	const out: AnnotatedRun[] = [];
	for (const run of sentenceRuns) {
		const lo = Math.max(run.start, qStart);
		const hi = Math.min(run.end, qEnd);
		if (lo < hi) {
			out.push({
				text: run.text.slice(lo - run.start, hi - run.start),
				reading: run.reading
			});
		}
	}
	return out.length > 0 ? out : null;
}

export function annotatedRuns(html: string): AnnotatedRun[] | null {
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString(html, "text/html");
	} catch {
		return null;
	}
	const out: AnnotatedRun[] = [];
	let found = false;
	const plain = (text: string): void => {
		if (text !== "") out.push({ text, reading: null });
	};
	// Recursive: real converter output wraps runs in paragraphs, so
	// plain elements are transparent — only .frb is special.
	const walk = (node: Node): void => {
		if (node.nodeType === Node.TEXT_NODE) {
			plain(node.textContent ?? "");
			return;
		}
		if (node instanceof Element && node.classList.contains("frb")) {
			const reading = node.querySelector(".frt")?.textContent?.trim() ?? "";
			const base = [...node.childNodes]
				.filter((kid) => kid.nodeType === Node.TEXT_NODE)
				.map((kid) => kid.textContent ?? "")
				.join("");
			if (base !== "" && reading !== "") {
				out.push({ text: base, reading });
				found = true;
			} else {
				plain(node.textContent ?? "");
			}
			return;
		}
		node.childNodes.forEach(walk);
	};
	doc.body.childNodes.forEach(walk);
	return found ? out : null;
}


