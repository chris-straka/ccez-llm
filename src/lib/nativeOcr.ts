import { invoke } from "@tauri-apps/api/core";

/**
 * On-device OCR (Stage: learner OCR): thin invoke wrapper over the Rust
 * `ocr_supported` / `ocr_recognize` commands (`src-tauri/src/ocr.rs`,
 * macOS-only Vision text recognition, `#[cfg]`-gated with stubs
 * elsewhere — same pattern as `nativeTts.ts` / `nativeDictate.ts`).
 *
 * The recognized text comes back as plain selectable text, so callers
 * hand it to the existing pinyin/furigana pipeline (composer insert →
 * message render) with no new rendering path.
 *
 * Every function fails cleanly outside the Tauri shell (plain `vite dev`,
 * Vitest): `invoke` rejects, the support probe is false, and recognition
 * surfaces a friendly error instead of throwing raw bridge text.
 */

/** One recognized line: top candidate plus its confidence in [0, 1]. */
export interface OcrLine {
	text: string;
	confidence: number;
}

/** Shaped result (mirrors the Rust `OcrOutput`). */
export interface OcrResult {
	/** Lines joined with `\n` — what the caller inserts. */
	text: string;
	lines: OcrLine[];
	/** Mean line confidence, 0 when nothing was recognized. */
	confidence: number;
}

let supportedCache: boolean | null = null;

/**
 * True only inside a Tauri shell on a build with on-device OCR (the Mac
 * app today). Never throws. Success caches; failure does NOT — a
 * cold-start transient must not hide the affordance all session.
 */
export async function ocrSupported(): Promise<boolean> {
	if (supportedCache) return true;
	try {
		supportedCache = await invoke<boolean>("ocr_supported");
	} catch {
		return false;
	}
	return supportedCache;
}

/**
 * Recognize text in an image. `image` is a data URL (as stored on
 * composer attachments) or raw base64; `lang` is an optional BCP-47
 * hint for the recognition languages (the backend takes a learner
 * default without one). Resolves with the shaped text; rejects with a
 * raw bridge message the caller maps through `friendlyOcrError`.
 */
export async function recognizeImageText(
	image: string,
	lang: string | null = null
): Promise<OcrResult> {
	return await invoke<OcrResult>("ocr_recognize", { image, lang });
}

/**
 * True for rejections that mean "no on-device OCR in this build" — the
 * caller falls back instead of retrying. Pure and unit-tested.
 */
export function isOcrUnsupported(message: string): boolean {
	return /requires macos|not supported|no on-device ocr/i.test(message);
}

/**
 * Tesseract traineddata for a reply-language code (per
 * `languages.ts`): every non-Latin script the menu offers maps to its
 * model — Devanagari, Arabic-script, Thai, Hebrew, Greek, Armenian,
 * Ethiopic, Cyrillic dialects, CJK — while Latin-script replies read
 * through English alone. English always rides along otherwise —
 * pasted UI and mixed text are rarely script-pure. Pure and
 * unit-tested.
 */
export function ocrFallbackLangs(code: string | null): string[] {
	switch (code) {
		case "ja":
			return ["jpn", "eng"];
		case "zh":
			return ["chi_sim", "eng"];
		case "yue":
			return ["chi_tra", "eng"];
		case "ko":
			return ["kor", "eng"];
		case "uk":
			return ["ukr", "eng"];
		case "ru":
			return ["rus", "eng"];
		case "bg":
			return ["bul", "eng"];
		case "sr":
			return ["srp", "eng"];
		case "ar":
			return ["ara", "eng"];
		case "fa":
			return ["fas", "eng"];
		case "ur":
			return ["urd", "eng"];
		case "he":
			return ["heb", "eng"];
		case "hi":
			return ["hin", "eng"];
		case "sa":
			return ["san", "eng"];
		case "bn":
			return ["ben", "eng"];
		case "ta":
			return ["tam", "eng"];
		case "th":
			return ["tha", "eng"];
		case "vi":
			return ["vie", "eng"];
		case "hy":
			return ["hye", "eng"];
		case "am":
			return ["amh", "eng"];
		case "el":
			return ["ell", "eng"];
		case "grc":
			return ["grc", "eng"];
		default:
			return ["eng"];
	}
}

/**
 * Vision recognition-language primaries, probe-verified on-device
 * (macOS 26 accurate revision, Sep 2026): `supportedRecognitionLanguages`
 * reports ar ar-SA/ars-SA cs da de en es fr id it ja ko ms nb nl nn
 * no pl pt-BR ro ru sv th tr uk vi-VT yue zh-Hans/Hant. Notably
 * absent: Hindi, Hebrew, Greek, Persian, Bengali, Tamil, Armenian,
 * Amharic, Mongolian, Sanskrit — those scripts have no Vision model
 * at all, so the caller routes them to the WASM fallback instead of
 * a doomed native pass.
 */
const VISION_PRIMARIES = new Set([
	"ar",
	"ars",
	"cs",
	"da",
	"de",
	"en",
	"es",
	"fr",
	"id",
	"it",
	"ja",
	"ko",
	"ms",
	"nb",
	"nl",
	"nn",
	"no",
	"pl",
	"pt",
	"ro",
	"ru",
	"sv",
	"th",
	"tr",
	"uk",
	"vi",
	"yue",
	"zh"
]);

/** Reply codes in Latin script with no dedicated Vision model — the
 * default pass reads them through its English model. */
const LATIN_SCRIPT_CODES = new Set(["hu", "fi", "sk", "tl", "sw", "la"]);

/** Reply codes in Cyrillic with no dedicated Vision model — the
 * shared Cyrillic base (ru/uk request) reads them on retry. */
const CYRILLIC_BASE_CODES = new Set(["bg", "sr"]);

/** BCP-47 primary subtag, lowercased, for menu codes and tags. */
function primaryOf(code: string): string {
	return code.split(/[-_]/)[0]?.toLowerCase().trim() ?? "";
}

/**
 * True when a native OCR pass can read the reply language's script:
 * a Vision model exists, or the default pass covers it (Latin through
 * English, unmodeled Cyrillic through the shared base). False for
 * scripts Vision lacks entirely (Devanagari, Hebrew, Greek, …) —
 * the caller reads those through the WASM fallback's matching
 * traineddata instead. Null/empty means no reply language: the
 * learner default covers English + CJK. Pure and unit-tested.
 */
export function visionSupports(code: string | null): boolean {
	if (code === null || code.trim() === "") return true;
	const primary = primaryOf(code);
	return (
		VISION_PRIMARIES.has(primary) ||
		LATIN_SCRIPT_CODES.has(primary) ||
		CYRILLIC_BASE_CODES.has(primary)
	);
}

/**
 * Mean-confidence floor for a native first pass: below it the
 * default (CJK-led) models may be reading the wrong script —
 * Cyrillic screenshots come back as punctuation fragments — so the
 * caller retries once with a reply-led hint and keeps the better
 * pass. Pure and unit-tested.
 */
export const OCR_RETRY_BELOW = 0.6;

/** Backend hint for the retry pass: lead with the reply's own
 * language (Cyrillic without its own model shares the Ukrainian
 * base; Russian stays Russian). Scripts Vision lacks never reach the
 * native path (see `visionSupports`) — passing them through is
 * harmless (`recognition_languages` maps unknown to English). Pure
 * and unit-tested. */
export function ocrRetryHint(code: string | null): string {
	if (code === null || code.trim() === "") return "uk";
	const primary = primaryOf(code);
	if (primary === "ru") return "ru";
	if (primary === "bg" || primary === "sr") return "uk";
	return primary || "uk";
}

/**
 * Keep-best merge for the retry pass: a good first pass stands (no
 * contest), otherwise the higher mean confidence wins, ties keeping
 * the first observation — observed text is never discarded. Pure
 * and unit-tested.
 */
export function keepBestRecognition(first: OcrResult, second: OcrResult): OcrResult {
	if (first.confidence >= OCR_RETRY_BELOW) return first;
	if (second.confidence > first.confidence) return second;
	return first;
}

/**
 * Minimal worker surface the fallback uses (the real `Worker` type
 * stays behind the lazy import, so node/Vitest never loads the
 * engine at module scope).
 */
interface FallbackWorker {
	recognize(
		image: string,
		options?: Record<string, unknown>,
		output?: Record<string, unknown>
	): Promise<{
		data: {
			text: string;
			confidence?: number;
			lines?: Array<{ text: string; confidence: number }>;
		};
	}>;
	terminate(): Promise<unknown>;
}

/** One warm worker per language set (creating one downloads the WASM
 * core plus traineddata; IndexedDB caches both after first use). */
const fallbackWorkers = new Map<string, Promise<FallbackWorker>>();

/**
 * In-client OCR for runtimes with no native bridge (browser preview,
 * Android WebView, Linux without the system Tesseract): Tesseract WASM,
 * lazily imported so only fallback clicks ever load it. First use needs
 * one connection for the engine + language data; after that it is
 * cached offline. Resolves with the shaped text; rejects when the
 * engine or its data cannot load.
 */
export async function recognizeFallbackText(
	image: string,
	langs: string[] = ["eng"]
): Promise<OcrResult> {
	const key = [...langs].sort().join("+");
	let pending = fallbackWorkers.get(key);
	if (!pending) {
		pending = (async () => {
			const { createWorker } = await import("tesseract.js");
			// v7 shapes page/line output richer than the surface below;
			// the double cast keeps the narrow contract without
			// importing engine types at module scope.
			const worker = (await createWorker(langs)) as unknown as FallbackWorker;
			return worker;
		})().catch((error: unknown) => {
			// A failed load must not poison the slot: dropping it lets
			// the next click retry (transient offline, CDN hiccup).
			fallbackWorkers.delete(key);
			throw error;
		});
		fallbackWorkers.set(key, pending);
	}
	const worker = await pending;
	// v7 returns text alone unless block output is asked for (lines
	// carry the per-line confidence the native shape promises).
	const { text, confidence, lines } = (
		await worker.recognize(image, {}, { blocks: true })
	).data;
	const kept = (lines ?? [])
		.map((line) => ({ text: line.text.trim(), confidence: line.confidence / 100 }))
		.filter((line) => line.text !== "");
	return {
		text: text.trim(),
		lines: kept,
		confidence: kept.length > 0 ? (confidence ?? 0) / 100 : 0
	};
}

/**
 * Fallback-engine failures translated into something actionable: the
 * engine/data download is the only network the feature needs, so a
 * load failure reads as offline rather than broken. Pure and
 * unit-tested.
 */
export function friendlyFallbackError(message: string): string {
	if (/failed to fetch|networkerror|network request failed|load failed|offline/i.test(message)) {
		return "Couldn't fetch the text engine (one connection, then it works offline) — check the network and retry.";
	}
	if (/no text found/i.test(message)) {
		return "No text found in this image.";
	}
	return message;
}

/**
 * Raw bridge/invoke errors translated into something actionable,
 * mirroring `friendlyNativeError` for the speech path. Pure and
 * unit-tested.
 */
export function friendlyOcrError(message: string): string {
	if (isOcrUnsupported(message)) {
		return "Text recognition needs the Mac app (this preview has no on-device OCR).";
	}
	if (/capabilit|not allowed|permission|denied/i.test(message)) {
		return "Text recognition is blocked by the app's permissions — rebuild the app and try again.";
	}
	if (/no text found/i.test(message)) {
		return "No text found in this image.";
	}
	return message;
}
