import { invoke } from "@tauri-apps/api/core";
import { OCR_RETRY_BELOW } from "./nativeOcr";
import { validCaptureArea } from "./settings";

/**
 * Capture-any-window screenshots (Stage: capture OCR): thin invoke
 * wrapper over the Rust `capture_supported` / `capture_window` /
 * `capture_interactive` commands (`src-tauri/src/capture.rs`,
 * macOS-only Quartz plus the `screencapture` CLI, `#[cfg]`-gated
 * with stubs elsewhere — same pattern as `nativeOcr.ts`).
 *
 * The composer offers three static actions (no window list): the OS
 * runs its native picker for window (hover tint, camera cursor) and
 * area (crosshair). Pixels come back as base64 PNG, which feeds
 * `recognizeImageText` (raw base64 in) with no new types.
 *
 * Every function fails cleanly outside the Tauri shell (plain `vite
 * dev`, Vitest): `invoke` rejects, the support probe is false, and
 * capture surfaces a friendly error instead of throwing raw bridge
 * text.
 */

/** One-shot composer source: fullscreen, or the OS picker kind. */
export type CaptureOneShot =
	| { kind: "fullscreen" }
	| { kind: "interactive"; mode: "window" | "area" };

/** Saved chord source: an explicit window, the saved pick, or the
frontmost window — the global chord's non-area path. */
export interface ChordWindowSource {
	windowId: number | null;
	savedWindowId: number | null;
	fullscreen: boolean;
}

/** Resolved pixel source: a one-shot wins outright, else the saved
square, else the chord window source. Pure and unit-tested. */
export type CaptureSource =
	| { kind: "rect"; area: { x: number; y: number; width: number; height: number } }
	| { kind: "window"; source: ChordWindowSource }
	| { kind: "fullscreen" }
	| { kind: "interactive"; mode: "window" | "area" };

export function captureSourceFor(
	oneShot: CaptureOneShot | null | undefined,
	area: { x: number; y: number; width: number; height: number } | null,
	chord: ChordWindowSource
): CaptureSource {
	if (oneShot?.kind === "interactive")
		return { kind: "interactive", mode: oneShot.mode };
	if (oneShot?.kind === "fullscreen") return { kind: "fullscreen" };
	if (area && validCaptureArea(area)) return { kind: "rect", area };
	return { kind: "window", source: chord };
}

/**
 * Pixels for a resolved source. Resolves null on interactive cancel
 * (Esc/right-click) — the caller stays silent, never a toast.
 * Rejects with a raw bridge message the caller maps through
 * `friendlyCaptureError`.
 */
export async function capturePixels(
	source: CaptureSource
): Promise<string | null> {
	switch (source.kind) {
		case "rect":
			return await captureRect(source.area);
		case "fullscreen":
			return await captureWindow(null, null, true);
		case "interactive":
			return await captureInteractive(source.mode);
		case "window":
			return await captureWindow(
				source.source.windowId,
				source.source.savedWindowId,
				source.source.fullscreen
			);
	}
}

let supportedCache: boolean | null = null;

/**
 * True only inside a Tauri shell on a build with window capture (the
 * Mac app today). Never throws. Success caches; failure does NOT — a
 * cold-start transient must not hide the affordance all session.
 */
export async function captureSupported(): Promise<boolean> {
	if (supportedCache) return true;
	try {
		supportedCache = await invoke<boolean>("capture_supported");
	} catch {
		return false;
	}
	return supportedCache;
}

/**
 * Capture a window (or the full screen) as base64 PNG. `windowId` is
 * an explicit pick; when missing, `savedWindowId` wins if still on
 * screen, else the frontmost window. `fullscreen` ignores both. The
 * global chord runs off the saved source through this path.
 */
export async function captureWindow(
	windowId: number | null = null,
	savedWindowId: number | null = null,
	fullscreen = false
): Promise<string> {
	return await invoke<string>("capture_window", {
		windowId,
		savedWindowId,
		fullscreen
	});
}

/**
 * Capture a saved square (device pixels, global display space) as
 * base64 PNG. Rejects with a raw bridge message the caller maps
 * through `friendlyCaptureError`.
 */
export async function captureRect(area: {
	x: number;
	y: number;
	width: number;
	height: number;
}): Promise<string> {
	return await invoke<string>("capture_rect", {
		x: Math.round(area.x),
		y: Math.round(area.y),
		width: Math.round(area.width),
		height: Math.round(area.height)
	});
}

/**
 * Interactive capture: the OS picker (hover-tint window choice or
 * crosshair area drag). Resolves null when the user cancels
 * (Esc/right-click) — the caller stays silent, never a toast.
 * Rejects with a raw bridge message the caller maps through
 * `friendlyCaptureError`.
 */
export async function captureInteractive(
	mode: "window" | "area"
): Promise<string | null> {
	return await invoke<string | null>("capture_interactive", {
		kind: mode
	});
}

/**
 * True for rejections that mean "no window capture in this build" —
 * the caller hides the affordance instead of retrying. Pure and
 * unit-tested.
 */
export function isCaptureUnsupported(message: string): boolean {
	return /not supported on this platform|no capturable window/i.test(message);
}

/**
 * CSS selection → device pixels at an explicit scale: area-photo
 * frames report their own natural/displayed ratio, the live overlay
 * passes `devicePixelRatio`. Pure and unit-tested.
 */
export function scaleRectToDevice(
	rect: { x: number; y: number; width: number; height: number },
	scale: number
): { x: number; y: number; width: number; height: number } {
	return {
		x: Math.round(rect.x * scale),
		y: Math.round(rect.y * scale),
		width: Math.round(rect.width * scale),
		height: Math.round(rect.height * scale)
	};
}

/**
 * True for rejections that mean "macOS denied Screen Recording" —
 * the caller arms the error toast with the System Settings action.
 * Pure and unit-tested.
 */
export function isScreenRecordingDenial(message: string): boolean {
	return /screen recording/i.test(message);
}

/**
 * Open the OS screen-capture privacy settings (macOS System Settings
 * → Privacy & Security → Screen Recording): the denial toast's tap
 * action. Rejects off-macOS and outside the Tauri shell — the caller
 * falls back to printing the in-pane path.
 */
export async function openScreenRecordingSettings(): Promise<void> {
	await invoke("open_screen_recording_settings");
}

/**
 * Human-facing capture failure: the Screen Recording denial names its
 * fix, everything else passes through. Pure and unit-tested.
 */
export function friendlyCaptureError(message: string): string {
	if (isScreenRecordingDenial(message)) return message;
	if (isCaptureUnsupported(message))
		return "Window capture is not available on this device.";
	return message;
}

/**
 * Auto-send template: the question first, the recognized text quoted
 * below as a blockquote (the chat renders markdown, so the capture
 * reads as a citation, not a pasted blob). It asks for a learner's
 * explanation — readings, key words, one grammar point, then a
 * natural translation — never a bare direct translation. Pure and
 * unit-tested.
 */
export function capturePromptTemplate(text: string): string {
	const quoted = text
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
	return `Explain this for a language learner — readings, key words, one grammar point, then a natural translation:\n\n${quoted}`;
}

/**
 * True when the read is too weak to auto-send: below the same
 * mean-confidence floor the OCR retry uses, the text is likely a
 * misread, so the caller stages it for a check instead of spending
 * the round trip. Pure and unit-tested.
 */
export function shouldStageCapture(confidence: number): boolean {
	return confidence < OCR_RETRY_BELOW;
}
