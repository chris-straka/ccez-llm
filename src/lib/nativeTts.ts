import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { identifyLangOffline } from "./langId";
import { hasPinyinTones, ttsLangFor } from "./reading";
import {
	effectiveSpeechLang,
	speechLangsFor,
	splitSentences,
	splitSpeechSegments,
	type SpeakCallbacks
} from "./voice";

/**
 * Native macOS voice engine (Stage 6 / A4): thin invoke wrapper over the
 * Rust `AVSpeechSynthesizer` bridge (`src-tauri/src/tts.rs`). Same callback
 * contract as web `speakText` — sentence progress is derived from native
 * word-boundary events — so callers just pick an engine.
 *
 * Every function fails cleanly outside the Tauri shell (plain `vite dev`,
 * Vitest): `invoke` rejects, support probes false, speech no-ops to onError.
 */

/** One installed macOS system voice (mirrors the Rust `NativeVoice`). */
export interface NativeVoice {
	id: string;
	name: string;
	lang: string;
	/** 1 = default, 2 = enhanced, 3 = premium. */
	quality: number;
}

interface WordPayload {
	id: number;
	location: number;
	length: number;
}

interface DonePayload {
	id: number;
	finished: boolean;
}

let supportedCache: boolean | null = null;

/**
 * Last native-bridge failure message (probe or inventory), for UI that must
 * tell "the bridge failed" apart from "no quality voices installed".
 * Reset on every probe attempt; never throws.
 */
let lastNativeError: string | null = null;

/** Last recorded native-bridge failure, or null when the last probe worked. */
export function nativeTtsLastError(): string | null {
	return lastNativeError;
}

function recordError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	lastNativeError = message;
	return message;
}

/**
 * True only inside a Tauri shell on a build with the native engine. Never
 * throws. Success caches; failure does NOT — a cold-start transient (the
 * bridge worker still spinning up) must not hide System voices all session.
 */
export async function nativeTtsSupported(): Promise<boolean> {
	if (supportedCache) return true;
	lastNativeError = null;
	try {
		supportedCache = await invoke<boolean>("tts_supported");
	} catch (error) {
		recordError(error);
		return false;
	}
	if (!supportedCache) lastNativeError = "Native speech is not available in this build.";
	return supportedCache;
}

/**
 * Installed system voices; empty outside the Tauri shell or when the probe
 * fails (see `nativeTtsLastError()` to tell the two apart). Never throws.
 */
export async function nativeVoices(): Promise<NativeVoice[]> {
	lastNativeError = null;
	try {
		return await invoke<NativeVoice[]>("tts_voices");
	} catch (error) {
		recordError(error);
		return [];
	}
}

/**
 * Bundle id of the checked keyboard input-menu entry (macOS shell only),
 * e.g. `com.apple.keylayout.US`. `null` outside the shell, on other
 * platforms, or when the context cannot be read — the caller maps it with
 * `voiceLocaleForInputSource` and leaves the language alone on `null`.
 * Never throws.
 */
export async function currentKeyboardInputSource(): Promise<string | null> {
	try {
		const id = await invoke<string | null>("current_input_source");
		return id?.trim() ? id.trim() : null;
	} catch {
		return null;
	}
}

/**
 * Raw bridge/invoke errors translated into something actionable, mirroring
 * the mic-error mapping in the page. Pure and unit-tested.
 */
export function friendlyNativeError(message: string): string {
	if (/not allowed|capabilit|permission|denied/i.test(message)) {
		return "System voices are blocked by the app's permissions — rebuild the app and try again.";
	}
	if (/timeout|timed out/i.test(message)) {
		return "System voices timed out — try again.";
	}
	if (/requires macos/i.test(message)) {
		return "System voices need the Mac app (this preview only has web voices).";
	}
	return message;
}

/**
 * Language for a highlighted quote: script detection first (reliable for
 * CJK/Arabic/…, needs no bridge), then the language recognizer for
 * Latin scripts (French vs English) — Apple's `NLLanguageRecognizer`
 * in the shell, the offline stop-word scorer elsewhere — else the
 * fallback. Never throws.
 */
export async function quoteLangFor(quote: string, fallback: string): Promise<string> {
	const scriptLang = ttsLangFor(quote, "");
	if (scriptLang) return scriptLang;
	// Toned pinyin is Latin-script, so script detection stays silent —
	// but the recognizer below reads it as Vietnamese (~0.98) and a
	// highlighted pinyin line would speak with the Linh voice. The tone
	// marks are pinyin-exclusive, so they route to Chinese first.
	if (hasPinyinTones(quote)) return "zh-CN";
	try {
		const tag = await invoke<string | null>("tts_identify_lang", { text: quote });
		if (tag?.trim()) return tag.trim();
	} catch {
		// Bridge unavailable (browser preview, tests): offline scorer below.
	}
	return identifyLangOffline(quote) ?? fallback;
}

/**
 * Language seed for the Latin-script sentences inside `text` (feeds
 * `speechLangsFor`): whole-text script detection returns the CJK voice
 * for mixed content (first non-Latin script wins), which used to seed
 * every Latin sentence — a Japanese+English reply read its English
 * sentences in the Japanese voice, and an English highlight inside a
 * Japanese message never stood a chance. The recognizer only ever
 * sees the Latin sentences, so each keeps its own language; with no
 * Latin content the fallback (the whole-text voice) rides through for
 * Han-fragment inheritance. Never throws.
 */
export async function latinSentencesLang(text: string, fallback: string): Promise<string> {
	const latin = splitSentences(text)
		.filter((sentence) => ttsLangFor(sentence, "") === "")
		.join(" ")
		.trim();
	if (!latin) return fallback;
	return quoteLangFor(latin, fallback);
}

/**
 * Per-sentence voice resolver for a whole utterance — message or
 * highlight — in every language the device has a voice for. Unambiguous
 * scripts resolve sync from the sentence itself (Japanese, Arabic,
 * Korean, Russian, Greek, Hebrew, Thai, Hindi, … need no bridge), and
 * every Latin-script sentence gets its own recognizer pass, so a
 * Japanese+English+French highlight reads each part in the right voice
 * instead of sharing one. Short or ambiguous Latin sentences land on
 * the whole-Latin seed (which falls back to `fallback`, the
 * message/surrounding voice, so Han fragments keep their
 * inheritance). Resolves before speech starts; callers pass the result
 * straight to startSpeech. Never throws — per-sentence misses keep the
 * seed through quoteLangFor's own fallback.
 */
export async function sentenceLangsFor(
	text: string,
	fallback: string,
	voices: ReadonlyArray<{ lang: string }>
): Promise<(sentence: string) => string> {
	const latin = splitSentences(text).filter((sentence) => ttsLangFor(sentence, "") === "");
	const seed = latin.length > 0 ? await latinSentencesLang(text, fallback) : fallback;
	const perSentence = new Map<string, string>();
	await Promise.all(
		latin.map(async (sentence) => {
			perSentence.set(sentence, await quoteLangFor(sentence, seed));
		})
	);
	const base = speechLangsFor(seed, voices);
	const cache = new Map<string, string>();
	return (sentence: string) => {
		const hit = cache.get(sentence);
		if (hit !== undefined) return hit;
		const tag = perSentence.get(sentence);
		const lang = tag === undefined ? base(sentence) : effectiveSpeechLang(tag, voices);
		cache.set(sentence, lang);
		return lang;
	};
}

/**
 * Sentence holding a quote, for voice resolution below: the recognizer
 * needs surrounding text (two kanji identify nothing), so a short
 * highlight speaks with its sentence's voice. Null when the quote
 * isn't found (rendered text and markdown differ).
 */
export function sentenceForQuote(context: string, quote: string): string | null {
	const needle = contextQuoteKey(quote);
	if (!needle) return null;
	for (const sentence of splitSentences(context)) {
		if (contextQuoteKey(sentence).includes(needle)) return sentence;
	}
	return null;
}

function contextQuoteKey(text: string): string {
	return text.replace(/\s+/g, "");
}

/**
 * Language for a highlighted quote with its message as context: Han
 * without kana is Chinese/Japanese-ambiguous, so the surrounding
 * sentence picks the voice (kana in it? Apple's recognizer on the full
 * sentence?). Anything unambiguous takes today's path untouched, and a
 * silent bridge still lands on Chinese, the old default. Never throws.
 */
export async function quoteLangForContext(
	quote: string,
	context: string,
	fallback: string
): Promise<string> {
	const scriptLang = ttsLangFor(quote, "");
	if (scriptLang && scriptLang !== "zh-CN") return scriptLang;
	if (scriptLang !== "zh-CN") return quoteLangFor(quote, fallback);
	const probe = sentenceForQuote(context, quote) ?? context;
	const sentenceLang = ttsLangFor(probe, "");
	if (sentenceLang && sentenceLang !== "zh-CN") return sentenceLang;
	try {
		const tag = await invoke<string | null>("tts_identify_lang", { text: probe });
		if (tag?.trim()) return tag.trim();
	} catch {
		// Bridge unavailable (browser preview, tests): offline scorer below.
	}
	return identifyLangOffline(probe) ?? "zh-CN";
}

/**
 * Render `text` to an audio file with the same voice pick as live
 * speech (macOS writes through `AVSpeechSynthesizer`; Android through
 * `synthesizeToFile`). Resolves with the saved file path. Rejects
 * outside the Tauri shell and on platforms without a file renderer.
 *
 * Device note: the Android path is code-only — no Android hardware
 * was available to run it, so it is reported as unverified on device.
 * Never throws synchronously; failures reject the promise.
 */
export async function saveNativeSpeech(
	text: string,
	lang: string,
	voiceId: string | null = null
): Promise<string> {
	return invoke<string>("tts_save_speech", { text, lang, voice: voiceId });
}

/** Open System Settings at the Accessibility pane (voice downloads). */
export async function openVoiceSettings(): Promise<void> {
	await invoke("open_voice_settings");
}

/**
 * Map a UTF-16 offset in `utterance` to its sentence index. Pure and
 * unit-tested; offsets come from native word-boundary events, which use the
 * same units as the string we send.
 */
export function sentenceAtOffset(sentences: string[], utterance: string, offset: number): number {
	let cursor = 0;
	for (let i = 0; i < sentences.length; i++) {
		const sentence = sentences[i];
		if (sentence === undefined) continue;
		const at = utterance.indexOf(sentence, cursor);
		const start = at === -1 ? cursor : at;
		if (offset < start + sentence.length) return i;
		cursor = start + sentence.length;
	}
	return sentences.length - 1;
}

/** Watchdog for a wedged bridge: cleared on every settle or teardown. */
let watchdog: ReturnType<typeof setTimeout> | undefined;

function clearWatchdog(): void {
	if (watchdog !== undefined) {
		clearTimeout(watchdog);
		watchdog = undefined;
	}
}

let unlisteners: UnlistenFn[] = [];
/**
 * Backend-assigned utterance id the listeners below accept events for. The
 * match uses the id `tts_speak` returns — never a frontend counter, which
 * would restart at 1 on every page reload while the backend keeps
 * incrementing, so every later `tts-done` would be ignored and the UI would
 * stay stuck "speaking".
 */
let expectedId: number | null = null;
/** Bumps on every teardown so stale invokes can't arm or kill newer speech. */
let generation = 0;

function teardown(): void {
	generation += 1;
	expectedId = null;
	clearWatchdog();
	const pending = unlisteners;
	unlisteners = [];
	for (const unlisten of pending) {
		try {
			unlisten();
		} catch {
			// Already torn down.
		}
	}
}

/**
 * Speak `text` through `AVSpeechSynthesizer`. Returns false when there is
 * nothing to say; invoke failures surface via `onError`. In-flight events
 * from an older utterance are ignored via the backend-assigned id.
 */
export function speakNative(
	text: string,
	lang: string,
	callbacks: SpeakCallbacks = {},
	voiceId: string | null = null
): boolean {
	teardown();
	const gen = generation;
	const sentences = splitSentences(text);
	if (sentences.length === 0) return false;
	const utterance = sentences.join(" ");
	let settled = false;
	const fail = (error: unknown) => {
		if (settled || gen !== generation) return;
		settled = true;
		teardown();
		callbacks.onError?.(error instanceof Error ? error.message : String(error));
	};
	// A wedged bridge (no word events, no done, no error) must never leave
	// the UI stuck "speaking": generous ceiling over the utterance length,
	// then stop and say so. Cleared on every settle and teardown.
	watchdog = setTimeout(
		() => {
			if (settled || gen !== generation) return;
			settled = true;
			teardown();
			invoke("tts_stop").catch(() => {
				// Best effort; the error below already explains.
			});
			callbacks.onError?.("Speech timed out — stopped. Try again.");
		},
		Math.min(300_000, Math.max(30_000, utterance.length * 250))
	);
	// Listeners first so nothing slips between invoke and registration; the
	// backend id lands right after and arms the match below.
	Promise.all([
		listen<WordPayload>("tts-word", (event) => {
			if (event.payload.id !== expectedId) return;
			const index = sentenceAtOffset(sentences, utterance, event.payload.location);
			callbacks.onProgress?.({
				sentence: index + 1,
				sentences: sentences.length,
				current: sentences[index] ?? ""
			});
		}),
		listen<DonePayload>("tts-done", (event) => {
			if (event.payload.id !== expectedId) return;
			const finished = event.payload.finished;
			teardown();
			callbacks.onEnd?.();
			if (finished) callbacks.onNaturalEnd?.();
		})
	])
		.then(([unword, undone]) => {
			unlisteners.push(unword, undone);
			return invoke<number>("tts_speak", { text: utterance, lang, voice: voiceId });
		})
		.then((rustId) => {
			if (gen === generation) expectedId = rustId;
		})
		.catch(fail);
	return true;
}

/**
 * Speak `text` with a voice locale per sentence (see
 * splitSpeechSegments): each sentence goes out as its own utterance with
 * its own lang, chained through natural ends. The saved `voiceId` rides
 * every segment — the bridge auto-picks the locale voice wherever the
 * saved voice belongs to another language. Stopping mid-chain halts it
 * (no natural end follows a cancel). Same contract as speakNative.
 */
export function speakNativeMulti(
	text: string,
	langForSentence: (sentence: string) => string,
	callbacks: SpeakCallbacks = {},
	voiceId: string | null = null
): boolean {
	const segments = splitSpeechSegments(text, langForSentence);
	if (segments.length === 0) return false;
	// Sentence counts up front so progress maps across segments.
	const counts = segments.map((segment) => splitSentences(segment.text).length);
	const total = counts.reduce((a, b) => a + b, 0);
	let index = 0;
	let offset = 0;
	let stopped = false;
	const step = (): void => {
		const segment = segments[index];
		if (segment === undefined || stopped) return;
		const ok = speakNative(
			segment.text,
			segment.lang,
			{
				onProgress: (progress) =>
					callbacks.onProgress?.({
						sentence: offset + progress.sentence,
						sentences: total,
						current: progress.current
					}),
				onNaturalEnd: () => {
					offset += counts[index] ?? 0;
					index += 1;
					if (index >= segments.length) {
						callbacks.onEnd?.();
						callbacks.onNaturalEnd?.();
					} else step();
				},
				onError: (message) => {
					stopped = true;
					callbacks.onError?.(message);
				}
			},
			voiceId
		);
		if (!ok) {
			stopped = true;
			callbacks.onError?.("Voice not available.");
		}
	};
	step();
	return true;
}

/**
 * One-shot word readback (hover / Option-click); no progress events needed.
 * Deliberately leaves in-flight message listeners alone: the bridge
 * serializes audio anyway, and the interrupted message clears its own UI
 * through its cancel event. Never throws.
 */
export function speakNativeWord(
	word: string,
	lang: string,
	onError?: (message: string) => void,
	voiceId: string | null = null
): void {
	invoke<number>("tts_speak", { text: word, lang, voice: voiceId }).catch((error: unknown) => {
		onError?.(error instanceof Error ? error.message : String(error));
	});
}

/** Stop native speech and invalidate in-flight event listeners. Never throws. */
export function stopNative(): void {
	teardown();
	invoke("tts_stop").catch(() => {
		// Stopping must never throw from UI teardown paths.
	});
}
