/**
 * Platform APIs TypeScript's DOM lib does not declare (or only declares
 * behind lib flags this project never enables): File Handling
 * launchQueue, the File System Access save picker, Tauri internals, Web
 * Speech recognition, CSS custom highlights, and compile-time build
 * stamps. Every use stays runtime-guarded (typeof checks, ?? fallbacks)
 * for the browser-dev / jsdom / Tauri runtimes — the declarations only
 * delete the per-site `as unknown as {...}` repeats, never the guards.
 */
import type { HighlightRegistry } from "./annHighlights";
import type { LaunchQueueLike } from "./launchFiles";
import type { SaveHandleLike, SavePickerOptions } from "./chatExport";
import type { SpeechRecognitionInstance } from "./voice";

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

declare global {
	interface Window {
		/** File Handling API: launches that arrive while running. */
		launchQueue?: LaunchQueueLike;
		/** File System Access save picker (Chromium only). */
		showSaveFilePicker?: (
			options: SavePickerOptions
		) => Promise<SaveHandleLike>;
		/** Tauri v2 internals marker (__TAURI__ was v1). */
		__TAURI_INTERNALS__?: unknown;
		__TAURI__?: unknown;
		/** Web Speech recognition (unprefixed + WebKit). */
		SpeechRecognition?: SpeechRecognitionCtor;
		webkitSpeechRecognition?: SpeechRecognitionCtor;
	}

	interface CSS {
		/** Custom Highlights registry (Chromium only). */
		highlights?: HighlightRegistry;
	}

	/** CSS Custom Highlights constructor (Chromium only). */
	var Highlight: (new (...ranges: Range[]) => object) | undefined;
}

export {};
