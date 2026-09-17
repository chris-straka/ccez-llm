import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { OFFLINE_FALLBACK_ID } from "../offline";
import { tauriBackendAvailable } from "../secrets";

/**
 * On-device chat seam (verdict: ML Kit GenAI Prompt API over AICore /
 * Gemini Nano — corrects the earlier MediaPipe LLM Inference pick,
 * which is in maintenance mode).
 *
 * The send path (`chat.ts`, owned by a sibling workflow) must NOT
 * branch on this yet: the one-line hookup stays `if
 * (isOnDeviceProvider(id)) return generateOnDevice(prompt)` —
 * everything else (status, errors, download progress) already flows
 * through this module. Binding is local-gemma only: Muse/deepseek
 * paths are untouched, and a missing model throws the short
 * `no-model` copy — never a silent reroute to another provider.
 *
 * Native contract (`src-tauri/src/ondevice.rs`, Android leg in
 * `OnDevice.kt`): two Tauri commands, `ondevice_status` -> status
 * payload and `ondevice_generate` {prompt, maxTokens} -> completion
 * text, backed on Android by `com.google.mlkit:genai-prompt`
 * (1.0.0-beta4, `Generation.getClient()` over the AICore system app —
 * no bundled weights, no API key). Native availability maps onto the
 * existing states: AICore AVAILABLE -> ready, DOWNLOADING ->
 * downloading, DOWNLOADABLE -> unavailable/no-model (status kicks off
 * the download, so reconnecting once then works offline),
 * UNAVAILABLE -> unavailable/unsupported. No manifest change (INTERNET
 * is already granted; AICore downloads through Play) and no settings
 * change (keyless — Gemini Nano needs no API key).
 *
 * Field note: the dep is pinned to genai-prompt beta3, not beta4 —
 * beta4's Kotlin 2.3 metadata needs kotlin-gradle-plugin 2.3, which
 * rejects Tauri's own bundled script (upstream tauri#15694,
 * unreleased). beta3 reads cleanly under KGP 2.2.21. Native leg
 * compiles locally but is still unverified on device (see
 * `OnDevice.kt`).
 *
 * Every function degrades cleanly across the three runtimes: outside
 * the Tauri shell (browser preview, jsdom/node tests) status reads
 * `unavailable` and generate throws the unavailable copy — `invoke`
 * is never touched there. The invoke handle injects for tests.
 */

/** The on-device provider id (the entry the offline drop parks on). */
export const ONDEVICE_PROVIDER_ID = OFFLINE_FALLBACK_ID;

/** True for the on-device provider id (plain string: untrusted input). */
export function isOnDeviceProvider(id: string): boolean {
	return id === ONDEVICE_PROVIDER_ID;
}

/** Lifecycle of the on-device bridge + model bundle. */
export type OnDeviceState = "unavailable" | "downloading" | "ready" | "error";

export interface OnDeviceStatus {
	state: OnDeviceState;
	/** 0..1 model-download progress; present only while downloading. */
	progress?: number;
	/**
	 * Bytes downloaded so far; present only while downloading. The
	 * native API reports no total, so no percent exists — the UI
	 * renders whole megabytes, never a fabricated fraction.
	 */
	downloadedBytes?: number;
	/** Machine-readable reason; UI shows `onDeviceErrorCopy` of it. */
	reason?: string;
}

/**
 * True when the probe positively reports an unsupported device (no
 * AICore / no Gemini Nano): callers hide the Gemma entry instead of
 * letting it fail at send time. Anything else — no model yet,
 * mid-download, probe garbage — keeps the entry listed. Pure.
 */
export function onDeviceUnsupported(status: OnDeviceStatus): boolean {
	return status.state === "unavailable" && status.reason === "unsupported";
}

/**
 * Whole-megabyte copy for the settings note (`"48 MB"`); null when
 * the count is missing or nonsense. Pure.
 */
export function downloadedMB(bytes: unknown): string | null {
	if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
	return `${Math.floor(bytes / 1048576)} MB`;
}

export interface OnDeviceGenerateOpts {
	/** Cap on completion tokens; clamped to 1..4096, default 512. */
	maxTokens?: number;
}

/** Test seam; defaults are the live shell probe and Tauri invoke. */
export interface OnDeviceDeps {
	/** Shell detection override (tests); defaults to `tauriBackendAvailable()`. */
	shell?: boolean;
	invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

const DEFAULT_MAX_TOKENS = 512;
const MIN_MAX_TOKENS = 1;
const MAX_MAX_TOKENS = 4096;

/** Clamp a requested completion cap into the bridge range. Pure. */
export function clampMaxTokens(value: number | undefined): number {
	if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_MAX_TOKENS;
	if (value < MIN_MAX_TOKENS) return MIN_MAX_TOKENS;
	if (value > MAX_MAX_TOKENS) return MAX_MAX_TOKENS;
	return Math.floor(value);
}

function clampProgress(value: unknown): number | undefined {
	if (typeof value !== "number" || Number.isNaN(value)) return undefined;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function liveInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
	return tauriInvoke<unknown>(cmd, args);
}

/**
 * Normalize a native status payload. Accepts the `{state, progress?,
 * downloadedBytes?, reason?}` object or a bare state string; anything
 * else is an error (bridge bug, never a crash). Pure.
 */
export function parseOnDeviceStatus(payload: unknown): OnDeviceStatus {
	const states: OnDeviceState[] = ["unavailable", "downloading", "ready", "error"];
	if (typeof payload === "string") {
		const state = (states as string[]).includes(payload) ? (payload as OnDeviceState) : "error";
		return state === "error" && payload !== "error"
			? { state, reason: "bad-status" }
			: { state };
	}
	if (typeof payload === "object" && payload !== null) {
		const raw = payload as Record<string, unknown>;
		const state =
			typeof raw["state"] === "string" && (states as string[]).includes(raw["state"])
				? (raw["state"] as OnDeviceState)
				: "error";
		const out: OnDeviceStatus = { state };
		const progress = clampProgress(raw["progress"]);
		if (state === "downloading" && progress !== undefined) out.progress = progress;
		const downloaded = raw["downloadedBytes"];
		if (
			state === "downloading" &&
			typeof downloaded === "number" &&
			Number.isFinite(downloaded) &&
			downloaded >= 0
		) {
			out.downloadedBytes = Math.floor(downloaded);
		}
		if (typeof raw["reason"] === "string" && raw["reason"]) out.reason = raw["reason"];
		if (state === "error" && out.reason === undefined) out.reason = "bad-status";
		return out;
	}
	return { state: "error", reason: "bad-status" };
}

/**
 * Short user-facing copy for every on-device failure. Each string fits
 * the existing error-toast slot (8s self-clear, `ERROR_TOAST_TIMEOUT_MS`
 * in `notices.ts`) — one plain sentence, never a gigantic dump.
 * Unknown reasons fall through to the default. Pure.
 */
export function onDeviceErrorCopy(reason: unknown): string {
	const code = typeof reason === "string" ? reason : "";
	switch (code) {
		case "no-model":
			return "On-device model isn't downloaded yet. Reconnect to download it once, then it works offline.";
		case "downloading":
			return "On-device model is still downloading. Try again in a bit.";
		case "no-bridge":
		case "unsupported":
			return "On-device chat isn't available on this device.";
		case "busy":
			return "On-device chat is busy. Try again in a moment.";
		case "too-long":
			return "That message is too long for on-device chat. Shorten it and try again.";
		case "cancelled":
			return "On-device reply stopped.";
		default:
			return "On-device chat failed. Try again.";
	}
}

/** Failure reason out of an invoke rejection (native code or message). */
function reasonFrom(error: unknown): string {
	if (typeof error === "string" && error) return error;
	if (error instanceof Error && error.message) return error.message;
	return "failed";
}

/**
 * Bridge + model readiness. Outside the shell this is `unavailable`
 * without touching invoke; native rejections also read `unavailable`
 * (the bridge isn't there), never throw. Success caches nothing —
 * download progress must keep flowing.
 */
export async function onDeviceStatus(deps?: OnDeviceDeps): Promise<OnDeviceStatus> {
	const shell = deps?.shell ?? tauriBackendAvailable();
	if (!shell) return { state: "unavailable", reason: "no-bridge" };
	const run = deps?.invoke ?? liveInvoke;
	try {
		return parseOnDeviceStatus(await run("ondevice_status"));
	} catch (error) {
		return { state: "unavailable", reason: reasonFrom(error) };
	}
}

/**
 * One-shot on-device completion (the future send-path seam). Resolves
 * the text; throws `Error(onDeviceErrorCopy(...))` when the bridge is
 * missing, busy, or fails — so the caller toasts `error.message`
 * straight into the existing error-toast slot.
 */
export async function generateOnDevice(
	prompt: string,
	opts?: OnDeviceGenerateOpts,
	deps?: OnDeviceDeps
): Promise<string> {
	const shell = deps?.shell ?? tauriBackendAvailable();
	if (!shell) throw new Error(onDeviceErrorCopy("no-bridge"));
	const run = deps?.invoke ?? liveInvoke;
	try {
		const out = await run("ondevice_generate", {
			prompt,
			maxTokens: clampMaxTokens(opts?.maxTokens)
		});
		if (typeof out === "string" && out) return out;
		throw new Error(onDeviceErrorCopy("failed"));
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("On-device")) throw error;
		throw new Error(onDeviceErrorCopy(reasonFrom(error)), { cause: error });
	}
}
