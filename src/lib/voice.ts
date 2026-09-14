import { ttsLangFor } from "./reading";
import type { VoiceEngine } from "./settings";

/**
 * Voice mode (Stage 6): sentence-chunked speech queue with skip-midway,
 * per-sentence progress for live display, and guarded mic dictation.
 * Web Speech engine only; every function no-ops cleanly where the API
 * is missing (SSR, tests, unsupported browsers).
 */

/** Split text into speakable sentences (keeps delimiters, drops empties). */
export function splitSentences(text: string): string[] {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (!cleaned) return [];
	const matches = cleaned.match(/[^.!?…。！？؛\n]+[.!?…。！？؛]+["»”’)]?|\S[^.!?…。！？；]*$/g);
	if (!matches) return [cleaned];
	return matches.map((s) => s.trim()).filter(Boolean);
}

/**
 * Reduce reply markdown to speakable plain text: drop fenced code blocks,
 * image/paste markers, and lightweight markdown formatting.
 */
export function speechText(markdown: string): string {
	return (
		markdown
			.replace(/```[\s\S]*?```/g, " ")
			.replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
			.replace(/\[Pasted an image\]/g, " ")
			.replace(/\[paste \d+ chars\]/g, "pasted content")
			.replace(/\[Pasted content \d+ chars\]/g, "pasted content")
			.split("\n")
			.map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^>\s?/, "").replace(/^[-*]\s+/, ""))
			.join("\n")
			.replace(/[*_`~|]/g, "")
			.replace(/[ \t]+/g, " ")
			.replace(/\n{2,}/g, "\n")
			.trim()
	);
}

/** Locale for a whole reply: first non-Latin script wins, else the fallback. */
export function replyLangFor(text: string, fallback: string): string {
	return ttsLangFor(text.replace(/```[\s\S]*?```/g, " "), fallback);
}

/**
 * Whether a web voice exists for `lang` (two-letter prefix match, the
 * same routing queueUtterances uses). An empty inventory means voices
 * haven't loaded yet — never disable UI on a guess, so that reads as
 * available. The voice list rides as a parameter so the check stays
 * pure: call sites pass `speechSynthesis.getVoices()`, tests pass
 * literals.
 */
export function webVoiceAvailable(lang: string, voices: ReadonlyArray<{ lang: string }>): boolean {
	if (voices.length === 0) return true;
	const prefix = lang.slice(0, 2).toLowerCase();
	if (!prefix) return false;
	return voices.some((v) => v.lang.toLowerCase().startsWith(prefix));
}

/**
 * Stand-in locale until a dedicated voice exists: Latin reads with an
 * Italian voice, Sanskrit with a Hindi voice (the same pair the reply
 * pills already use). Null when the language needs no stand-in.
 */
export function spokenFallbackFor(lang: string): string | null {
	const table: Record<string, string> = { la: "it-IT", sa: "hi-IN" };
	return table[lang.slice(0, 2).toLowerCase()] ?? null;
}

/**
 * Locale to actually speak: the request when a voice exists, else its
 * stand-in when one does, else the request unchanged so the error path
 * explains. An unloaded inventory passes everything through (see
 * webVoiceAvailable) — never route on a guess.
 */
export function effectiveSpeechLang(lang: string, voices: ReadonlyArray<{ lang: string }>): string {
	if (webVoiceAvailable(lang, voices)) return lang;
	const fallback = spokenFallbackFor(lang);
	if (fallback && webVoiceAvailable(fallback, voices)) return fallback;
	return lang;
}

/** One speakable sentence with its own voice locale. */
export interface SpeechSegment {
	text: string;
	lang: string;
}

/**
 * Voice locale for one sentence inside a larger utterance: kana (and
 * other unambiguous scripts) decide for themselves, Latin falls back
 * to the surrounding voice, and Han-only sentences keep Chinese when
 * complete — but a highlight can end mid-sentence, and that trailing
 * fragment has no kana left to identify it. Fragments (no closing
 * punctuation) inherit the surrounding voice instead of flipping to
 * Chinese at the boundary.
 */
export function sentenceSpeechLang(sentence: string, fallbackLang: string): string {
	const direct = ttsLangFor(sentence, "");
	if (direct !== "" && direct !== "zh-CN") return direct;
	if (direct === "") return fallbackLang;
	return /[.!?…。！？；"»”’」』）)\]]$/.test(sentence.trim()) ? direct : fallbackLang;
}

/**
 * Split text into per-sentence voice runs: every sentence resolves its
 * own locale (non-Latin scripts by Unicode, Latin by the shared
 * `langForSentence` fallback), so a Japanese+Chinese+English reply reads
 * each part in the right voice instead of the whole thing in one.
 */
export function splitSpeechSegments(
	text: string,
	langForSentence: (sentence: string) => string
): SpeechSegment[] {
	return splitSentences(text).map((sentence) => ({ text: sentence, lang: langForSentence(sentence) }));
}

/** Latin-script fallback voice locale: the pinned voice language, else US English. */
export function latinFallback(voiceLang: string | null | undefined): string {
	return voiceLang?.trim() || "en-US";
}

/**
 * Sync speech locale for message content: the same sentence routing
 * speakReply uses, minus the async recognizer (Latin-script text
 * lands on the voice-language fallback either way on devices
 * without the bridge), resolved through the stand-in map (Latin
 * reads Italian, Sanskrit Hindi). Feeds the no-voice gate below.
 */
export function messageSpeechLang(
	content: string,
	fallback: string,
	voices: ReadonlyArray<{ lang: string }>
): string {
	return effectiveSpeechLang(replyLangFor(speechText(content), fallback), voices);
}

/**
 * Whether attempting speech makes sense: the web engine with no
 * installed voice for the locale (Latin with no Latin voice, …)
 * would only raise the error banner, so callers disable or skip
 * instead. Native availability is bridge-side and stays on the
 * error path; an unloaded inventory never disables.
 */
export function speechAttemptable(
	engine: VoiceEngine,
	lang: string,
	voices: ReadonlyArray<{ lang: string }>
): boolean {
	if (engine !== "web") return true;
	return webVoiceAvailable(lang, voices);
}

/**
 * Banner when an utterance never starts: quiet background readbacks
 * stay silent throughout, otherwise an empty inventory means no TTS
 * engine/data on the device (check the OS text-to-speech settings)
 * while voices present but throwing is a different fault. Null says
 * nothing failed loudly enough to banner.
 */
export function startSpeechError(facts: {
	quiet: boolean;
	useNative: boolean;
	inventoryEmpty: boolean;
}): string | null {
	if (facts.quiet) return null;
	if (!facts.useNative && facts.inventoryEmpty) {
		return "No voices on this device — check its text-to-speech settings.";
	}
	return "Voice not available.";
}

/**
 * Voice locale per sentence: non-Latin scripts resolve sync from the
 * sentence itself (reliable, needs no bridge); Latin sentences share
 * one recognizer pass (`latinLang`), since French vs English look
 * alike. Results cache per sentence (a plain Map: the cache is never
 * rendered, so no reactivity needed).
 */
export function speechLangsFor(
	latinLang: string,
	voices: ReadonlyArray<{ lang: string }>
): (sentence: string) => string {
	const cache = new Map<string, string>();
	return (sentence: string) => {
		const hit = cache.get(sentence);
		if (hit !== undefined) return hit;
		// Stand-ins resolve per sentence too: a Latin sentence with
		// no Latin voice reads Italian rather than failing.
		// Han-only fragments inherit the surrounding voice (see
		// sentenceSpeechLang) instead of flipping to Chinese.
		const lang = effectiveSpeechLang(sentenceSpeechLang(sentence, latinLang), voices);
		cache.set(sentence, lang);
		return lang;
	};
}

export interface VoiceProgress {
	sentence: number;
	sentences: number;
	/** Current sentence text (for the "now speaking" display). */
	current: string;
}

export interface SpeakCallbacks {
	onProgress?: (progress: VoiceProgress) => void;
	onEnd?: () => void;
	/**
	 * Fires only when the utterance plays to its natural end (never on
	 * stop/cancel). The downloader hook rides this: a stopped readback
	 * must not mint an audio file.
	 */
	onNaturalEnd?: (() => void) | undefined;
	onError?: (message: string) => void;
}

function synthesis(): SpeechSynthesis | null {
	try {
		return typeof speechSynthesis === "undefined" ? null : speechSynthesis;
	} catch {
		return null;
	}
}

/**
 * Queue one utterance per segment (voice matched per segment locale).
 * Single-lang input queues exactly what the old per-sentence loop did.
 */
function queueUtterances(
	synth: SpeechSynthesis,
	segments: SpeechSegment[],
	callbacks: SpeakCallbacks
): void {
	let cancelled = false;
	segments.forEach((segment, index) => {
		const utterance = new SpeechSynthesisUtterance(segment.text);
		utterance.lang = segment.lang;
		try {
			const voice = synth
				.getVoices()
				.find((v) => v.lang.toLowerCase().startsWith(segment.lang.slice(0, 2).toLowerCase()));
			if (voice) utterance.voice = voice;
		} catch {
			// Voice matching is best-effort; lang still routes correctly.
		}
		utterance.onstart = () => {
			if (!cancelled) {
				callbacks.onProgress?.({
					sentence: index + 1,
					sentences: segments.length,
					current: segment.text
				});
			}
		};
		utterance.onerror = (event) => {
			if (!cancelled && event.error !== "canceled") {
				cancelled = true;
				callbacks.onError?.(String(event.error || "speech error"));
			}
		};
		if (index === segments.length - 1) {
			utterance.onend = () => {
				if (!cancelled) {
					callbacks.onEnd?.();
					callbacks.onNaturalEnd?.();
				}
			};
		}
		synth.speak(utterance);
	});
}

/**
 * Speak `text` sentence by sentence so skip lands between sentences and
 * progress stays live. Returns false when speech is unavailable.
 */
export function speakText(text: string, lang: string, callbacks: SpeakCallbacks = {}): boolean {
	return speakMultilingual(text, () => lang, callbacks);
}

/**
 * Speak `text` with a voice locale per sentence (see
 * splitSpeechSegments). Single-language input behaves exactly like
 * speakText; mixed input switches voices mid-queue. Same contract and
 * return: false when speech is unavailable.
 */
export function speakMultilingual(
	text: string,
	langForSentence: (sentence: string) => string,
	callbacks: SpeakCallbacks = {}
): boolean {
	const synth = synthesis();
	const segments = splitSpeechSegments(text, langForSentence);
	if (!synth || segments.length === 0) return false;
	try {
		synth.cancel();
		queueUtterances(synth, segments, callbacks);
		return true;
	} catch {
		return false;
	}
}

export function stopSpeaking(): void {
	try {
		synthesis()?.cancel();
	} catch {
		// Stopping must never throw from UI teardown paths.
	}
}

export function isSpeaking(): boolean {
	try {
		return synthesis()?.speaking ?? false;
	} catch {
		return false;
	}
}

interface DictationResultEvent {
	results?: Array<Array<{ transcript?: string }>>;
}

export interface SpeechRecognitionInstance {
	lang: string;
	interimResults: boolean;
	onresult: ((event: DictationResultEvent) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function recognitionCtor(): SpeechRecognitionCtor | null {
	try {
		if (typeof window === "undefined") return null;
		return (
			(window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null
		);
	} catch {
		return null;
	}
}

export function micAvailable(): boolean {
	return recognitionCtor() !== null;
}

/**
 * Dictate once into the prompt box. Returns a stop function, or null where
 * the mic API is missing. Secondary input path — failures only surface text.
 */
export function dictateOnce(
	lang: string,
	onResult: (transcript: string) => void,
	onError: (message: string) => void
): (() => void) | null {
	const Ctor = recognitionCtor();
	if (!Ctor) return null;
	try {
		const recognition = new Ctor();
		recognition.lang = lang;
		recognition.interimResults = false;
		recognition.onresult = (event) => {
			const transcript = event.results?.[0]?.[0]?.transcript ?? "";
			if (transcript.trim()) onResult(transcript);
		};
		recognition.onerror = (event) => onError(friendlyMicError(String(event.error || "mic error")));
		recognition.onend = null;
		recognition.start();
		return () => {
			try {
				recognition.stop();
			} catch {
				// Already ended; nothing to stop.
			}
		};
	} catch {
		return null;
	}
}

/**
 * Browser recognition error codes are terse ("network", "not-allowed"):
 * translate them before they reach a toast. Pure and unit-tested.
 */
export function friendlyMicError(message: string): string {
	if (/service-not-allowed/i.test(message)) {
		return "Dictation is blocked in this window — it needs Chrome or Safari.";
	}
	if (/not-allowed|permission/i.test(message)) {
		return "Mic permission denied — allow the microphone and try again.";
	}
	if (/no-speech/i.test(message)) return "Didn't catch anything — try again.";
	if (/audio-capture|not-found|no-microphone/i.test(message)) return "No microphone found.";
	if (/network/i.test(message)) {
		try {
			if (typeof navigator !== "undefined" && navigator.onLine === false) {
				return "You're offline — reconnect and try dictation again.";
			}
		} catch {
			// Navigator unreadable; fall through to the generic guidance.
		}
		return "Couldn't reach the transcription service — check your connection (or VPN/ad-blocker) and try again.";
	}
	return message;
}
