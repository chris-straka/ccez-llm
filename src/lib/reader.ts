/**
 * Big-word reader (low-vision read-aloud): a message read one short
 * phrase at a time, each phrase filling the screen while it is spoken.
 *
 * The reader speaks phrase by phrase itself instead of syncing to word
 * events: every engine (web, macOS native, Android) reports a natural
 * end, few report words reliably. Two paces: "follow" moves on when a
 * phrase finishes; "tap" speaks one phrase and waits for a tap. The
 * page owns speech and the overlay; this module owns phrasing, the
 * session steps, keys, and the font fit. Pure and unit-tested.
 */

export type ReaderMode = "off" | "follow" | "tap";

export interface ReaderPhrase {
	text: string;
	/** The sentence it belongs to (the faded line under the phrase). */
	sentence: string;
	sentenceIndex: number;
}

/** Characters per phrase before a break (a word never splits). */
export const PHRASE_MAX_CHARS = 18;

function sentencesOf(text: string): string[] {
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		const seg = new Intl.Segmenter(undefined, { granularity: "sentence" });
		return [...seg.segment(text)].map((s) => s.segment.trim()).filter(Boolean);
	}
	return text
		.split(/(?<=[.!?。！？])\s+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

function wordSegments(sentence: string): { segment: string; word: boolean }[] {
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		const seg = new Intl.Segmenter(undefined, { granularity: "word" });
		return [...seg.segment(sentence)].map((s) => ({
			segment: s.segment,
			word: s.isWordLike === true
		}));
	}
	return sentence
		.split(/(\s+)/)
		.filter(Boolean)
		.map((s) => ({ segment: s, word: /\S/.test(s) }));
}

/**
 * Split text into screen-sized phrases: sentences first, then words
 * grouped up to `maxChars` (punctuation rides with its word, and a
 * word longer than the cap stands alone). CJK splits on ICU word
 * boundaries, so Japanese phrases break between words too.
 */
export function readerPhrases(
	text: string,
	maxChars = PHRASE_MAX_CHARS
): ReaderPhrase[] {
	const out: ReaderPhrase[] = [];
	sentencesOf(text.replace(/\s+/g, " ")).forEach((sentence, sentenceIndex) => {
		let buf = "";
		const flush = (): void => {
			const t = buf.trim();
			if (t) out.push({ text: t, sentence, sentenceIndex });
			buf = "";
		};
		for (const { segment, word } of wordSegments(sentence)) {
			if (word && buf.trim() && (buf + segment).trim().length > maxChars)
				flush();
			buf += segment;
		}
		flush();
	});
	return out;
}

/** Index of the first phrase of the sentence holding character `offset`. */
export function phraseIndexAtOffset(
	text: string,
	phrases: readonly ReaderPhrase[],
	offset: number
): number {
	const sentences = sentencesOf(text.replace(/\s+/g, " "));
	const flat = text.replace(/\s+/g, " ");
	// Map the offset onto the normalized text by counting collapsed runs.
	const normalizedOffset = text.slice(0, offset).replace(/\s+/g, " ").length;
	let at = 0;
	let sentenceIndex = 0;
	for (let i = 0; i < sentences.length; i++) {
		const s = sentences[i] ?? "";
		const start = flat.indexOf(s, at);
		if (start === -1) break;
		if (normalizedOffset < start + s.length) {
			sentenceIndex = i;
			break;
		}
		at = start + s.length;
		sentenceIndex = i;
	}
	const hit = phrases.findIndex((p) => p.sentenceIndex === sentenceIndex);
	return hit === -1 ? 0 : hit;
}

export interface ReaderState {
	phrases: ReaderPhrase[];
	index: number;
	mode: "follow" | "tap";
	paused: boolean;
	/** The last phrase finished: the next tap closes. */
	done: boolean;
}

export type ReaderEvent = "tap" | "next" | "prev" | "spoken";

export interface ReaderEffects {
	/** Speak the (new) current phrase from its start. */
	speak: boolean;
	/** Stop speech now (pause). */
	stop: boolean;
	close: boolean;
}

const NONE: ReaderEffects = { speak: false, stop: false, close: false };

export function startReader(
	phrases: ReaderPhrase[],
	mode: "follow" | "tap",
	index = 0
): ReaderState {
	return {
		phrases,
		index: Math.min(Math.max(0, index), Math.max(0, phrases.length - 1)),
		mode,
		paused: false,
		done: false
	};
}

function firstOfSentence(
	phrases: readonly ReaderPhrase[],
	sentenceIndex: number
): number {
	return phrases.findIndex((p) => p.sentenceIndex === sentenceIndex);
}

/**
 * One reader step. Follow: a tap pauses or resumes (resuming re-reads
 * the phrase), and a finished phrase moves on. Tap mode: a tap speaks
 * the next phrase, and a finished phrase waits. Arrows jump sentences
 * (back goes to this sentence's start first, then the previous one).
 * After the last phrase, a tap closes.
 */
export function readerStep(
	state: ReaderState,
	event: ReaderEvent
): { state: ReaderState; effects: ReaderEffects } {
	const last = state.phrases.length - 1;
	const current = state.phrases[state.index];
	if (!current) return { state, effects: { ...NONE, close: event === "tap" } };
	const go = (
		index: number
	): { state: ReaderState; effects: ReaderEffects } => ({
		state: { ...state, index, paused: false, done: false },
		effects: { ...NONE, speak: true }
	});
	if (event === "spoken") {
		if (state.mode === "tap" || state.paused) return { state, effects: NONE };
		if (state.index >= last)
			return { state: { ...state, done: true }, effects: NONE };
		return go(state.index + 1);
	}
	if (event === "tap") {
		if (state.done) return { state, effects: { ...NONE, close: true } };
		if (state.mode === "tap") {
			if (state.index >= last)
				return { state: { ...state, done: true }, effects: NONE };
			return go(state.index + 1);
		}
		if (state.paused) return go(state.index);
		return {
			state: { ...state, paused: true },
			effects: { ...NONE, stop: true }
		};
	}
	if (event === "next") {
		const next = firstOfSentence(state.phrases, current.sentenceIndex + 1);
		return next === -1 ? { state, effects: NONE } : go(next);
	}
	const start = firstOfSentence(state.phrases, current.sentenceIndex);
	if (state.index > start) return go(start);
	const prev = firstOfSentence(state.phrases, current.sentenceIndex - 1);
	return go(prev === -1 ? 0 : prev);
}

/** Facts the open reader's key handler reads. */
export interface ReaderKeyFacts {
	key: string;
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	repeat: boolean;
}

/**
 * Keys while the reader is open: Space/Enter tap, arrows step
 * sentences, Esc closes. Other bare keys are swallowed so the chat
 * behind stays put; modified chords pass through.
 */
export function readerKeyAction(
	facts: ReaderKeyFacts
): Exclude<ReaderEvent, "spoken"> | "close" | "swallow" | "pass" {
	if (facts.key === "Escape") return "close";
	if (facts.metaKey || facts.ctrlKey || facts.altKey) return "pass";
	if (facts.repeat) return "swallow";
	if (facts.code === "Space" || facts.key === "Enter") return "tap";
	if (facts.key === "ArrowRight") return "next";
	if (facts.key === "ArrowLeft") return "prev";
	return "swallow";
}

/** Rough glyph width in em: CJK and fullwidth are square, Latin narrower. */
function glyphEm(ch: string): number {
	return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(ch) ? 1 : 0.64;
}

/** The phrase's CSS line-height (ReaderView keeps the same value). */
export const LINE_HEIGHT = 1.1;

function widthEm(text: string): number {
	let w = 0;
	for (const ch of text) w += glyphEm(ch);
	return w;
}

/**
 * Font size (px) that fits a phrase on screen: its longest word on one
 * line, and every wrapped line inside ~60% of the screen height (one
 * line extra allowed for word-boundary slack). Floored at 32px.
 */
export function phraseFontPx(phrase: string, vw: number, vh: number): number {
	const usable = vw * 0.88;
	const words = phrase.split(/\s+/).filter(Boolean);
	const longest = Math.max(1, ...words.map(widthEm));
	const total = Math.max(1, widthEm(phrase));
	let size = Math.min(usable / longest, vh * 0.4);
	for (let i = 0; i < 40 && size > 32; i++) {
		const lines =
			Math.ceil((total * size) / usable) + (words.length > 1 ? 1 : 0);
		if (lines * size * LINE_HEIGHT <= vh * 0.6) break;
		size *= 0.92;
	}
	return Math.max(32, Math.floor(size));
}

/** Swipe or tap from a pointer gesture (px deltas, down is +y). */
export function readerGesture(dx: number, dy: number): ReaderEvent | "close" {
	if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy))
		return dx < 0 ? "next" : "prev";
	if (dy > 90 && dy > Math.abs(dx)) return "close";
	return "tap";
}
