import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { friendlyMicError } from "./voice";

/**
 * Native-first dictation: thin invoke wrapper over the Rust
 * `dictate_start` / `dictate_stop` commands (Android, macOS, Windows —
 * see `src-tauri/src/dictation.rs` for the shared contract). Transcripts
 * arrive as `dictate-result` window events shaped
 * `{transcript: string, final: boolean}`: partial hypotheses with
 * `final=false`, the completed utterance with `final=true`. An empty
 * transcript with `final=true` is the last-resort async-error signal —
 * the recognizer died after `dictate_start` already resolved.
 *
 * Every function fails cleanly outside the Tauri shell (plain `vite
 * dev`, Vitest): `invoke` rejects, startup resolves to "fallback", and
 * the caller rides the web `dictateOnce` path instead.
 */

export interface NativeDictateCallbacks {
	onPartial?: (transcript: string) => void;
	onFinal?: (transcript: string) => void;
	onError?: (message: string) => void;
}

export type NativeDictateOutcome =
	| { kind: "started"; stop: () => void }
	| { kind: "fallback" }
	| { kind: "error"; message: string };

/**
 * `dictate_start` rejections that mean "no native recognizer here" —
 * unsupported platform, missing recognizer, uninitialized bridge — so
 * the caller falls back to web dictation silently. Anything else (mic
 * denied, recognizer busy) is a real error the user should see. Pure
 * and unit-tested.
 */
export function nativeDictateFallback(message: string): boolean {
	return /not supported|requires (android|macos|windows|linux)|bridge not initialized|no recognizer|recognizer (absent|unavailable|missing)/i.test(
		message
	);
}

/**
 * Raw native-bridge errors translated into something actionable,
 * mirroring `friendlyMicError` for the web path. Pure and unit-tested.
 */
export function friendlyNativeDictateError(message: string): string {
	if (/not allowed|capabilit/i.test(message)) {
		return "Dictation is blocked by the app's permissions — rebuild the app and try again.";
	}
	if (/busy|occupied/i.test(message)) {
		return "The recognizer is busy — wait a moment and try again.";
	}
	if (/permission|denied|not-allowed/i.test(message)) {
		return "Mic permission denied — allow the microphone and try again.";
	}
	if (/no-speech|didn't catch|empty/i.test(message)) {
		return "Didn't catch anything — try again.";
	}
	return friendlyMicError(message);
}

/**
 * Try one native utterance. Resolves "started" with a stop function
 * when the OS recognizer is listening (results stream to the
 * callbacks), "fallback" when there is no native recognizer (caller
 * rides the web path), or "error" with a display-ready message. Never
 * throws.
 */
export async function startNativeDictation(
	lang: string,
	callbacks: NativeDictateCallbacks = {}
): Promise<NativeDictateOutcome> {
	let unlisten: UnlistenFn | null = null;
	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		try {
			unlisten?.();
		} catch {
			// Teardown must never throw from UI paths.
		}
		unlisten = null;
		invoke("dictate_stop").catch(() => {
			// Already ended or never started; nothing to stop.
		});
	};
	const route = (transcript: string, isFinal: boolean): void => {
		if (stopped) return;
		const text = transcript.trim();
		if (!isFinal) {
			if (text) callbacks.onPartial?.(text);
			return;
		}
		if (text) callbacks.onFinal?.(text);
		else callbacks.onError?.(friendlyNativeDictateError("no-speech"));
	};
	try {
		unlisten = await listen<{ transcript: string; final: boolean }>(
			"dictate-result",
			(event) =>
				route(event.payload.transcript ?? "", event.payload.final === true)
		);
	} catch {
		// No event bridge (plain browser): fall back to web dictation.
		return { kind: "fallback" };
	}
	try {
		await invoke("dictate_start", { lang });
	} catch (error) {
		stop();
		const message = error instanceof Error ? error.message : String(error);
		if (nativeDictateFallback(message)) return { kind: "fallback" };
		return { kind: "error", message: friendlyNativeDictateError(message) };
	}
	return { kind: "started", stop };
}
