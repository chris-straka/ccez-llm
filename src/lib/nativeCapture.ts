import { invoke } from "@tauri-apps/api/core";
import { OCR_RETRY_BELOW } from "./nativeOcr";

/**
 * Capture-any-window screenshots (Stage: capture OCR): thin invoke
 * wrapper over the Rust `capture_supported` / `list_windows` /
 * `capture_window` commands (`src-tauri/src/capture.rs`, macOS-only
 * Quartz listing plus the `screencapture` CLI, `#[cfg]`-gated with
 * stubs elsewhere — same pattern as `nativeOcr.ts`).
 *
 * Pixels come back as base64 PNG, which feeds `recognizeImageText`
 * (raw base64 in) with no new types.
 *
 * Every function fails cleanly outside the Tauri shell (plain `vite
 * dev`, Vitest): `invoke` rejects, the support probe is false, and
 * capture surfaces a friendly error instead of throwing raw bridge
 * text.
 */

/** One on-screen window: the source menu's row model (mirrors Rust). */
export interface CaptureWindow {
	id: number;
	owner: string;
	title: string;
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
 * On-screen windows front-to-back, own app excluded (the backend
 * drops our PID so the composer button never captures itself).
 * Rejects with a raw bridge message the caller maps through
 * `friendlyCaptureError`.
 */
export async function listCaptureWindows(): Promise<CaptureWindow[]> {
	return await invoke<CaptureWindow[]>("list_windows");
}

/**
 * Capture a window (or the full screen) as base64 PNG. `windowId` is
 * the source menu's pick; when missing, `savedWindowId` wins if still
 * on screen, else the frontmost window. `fullscreen` ignores both.
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
 * Source-menu row label: "owner — title", owner alone when untitled.
 * Fullscreen is not a window and labels itself. Pure and unit-tested.
 */
export function captureSourceLabel(
	window: CaptureWindow | null,
	fullscreen: boolean
): string {
	if (fullscreen) return "Fullscreen";
	if (!window) return "Frontmost window";
	return window.title.length > 0
		? `${window.owner} — ${window.title}`
		: window.owner;
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
 * Human-facing capture failure: the Screen Recording denial names its
 * fix, everything else passes through. Pure and unit-tested.
 */
export function friendlyCaptureError(message: string): string {
	if (/screen recording/i.test(message)) return message;
	if (isCaptureUnsupported(message))
		return "Window capture is not available on this device.";
	return message;
}

/**
 * Auto-send template: the question first, the recognized text quoted
 * below as a blockquote (the chat renders markdown, so the capture
 * reads as a citation, not a pasted blob). Pure and unit-tested.
 */
export function capturePromptTemplate(text: string): string {
	const quoted = text
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
	return `What does this mean?\n\n${quoted}`;
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
