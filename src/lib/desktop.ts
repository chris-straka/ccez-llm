import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { tauriBackendAvailable } from "./secrets";

/**
 * Desktop summon kit + study-sheet output: thin
 * frontend over the Rust `desktop.rs` bridge (tray, single instance,
 * global summon, `ccez://` deep links, sleep guard, sheet export) plus
 * the user-visible half — share-out and print-to-PDF of a chat.
 *
 * Every function fails cleanly outside the Tauri shell (plain
 * `vite dev`, Vitest): `invoke` rejects, probes resolve null/false,
 * and share/print ride web fallbacks. Mirrors the `nativeTts.ts`
 * three-runtime contract.
 */

/** In-app summon chord (mirrors `SUMMON_SHORTCUT` in `desktop.rs`). */
export const SUMMON_SHORTCUT_LABEL = "Cmd/Ctrl+Shift+Space";

/** Window event the Rust side emits for `ccez://` links. */
export const DEEP_LINK_EVENT = "deep-link";

/** One chat message for sheet export (`role` is user/assistant). */
export interface StudyLine {
	role: string;
	content: string;
}

export type DeepLink =
	{ kind: "open-chat"; chatId: string } | { kind: "new-chat" };

export type ShareOutcome = "shared" | "copied" | "downloaded" | "unavailable";

/**
 * Parse a `ccez://` URL (mirrors `parse_deep_link` in `desktop.rs`):
 * `ccez://chat/<id>`, `ccez://chat?id=<id>`, `ccez://new`. Foreign
 * input is null, never a throw. Pure and unit-tested.
 */
export function parseCcezDeepLink(url: string): DeepLink | null {
	const rest = url.trim().match(/^ccez:\/\/([\s\S]*)$/);
	if (!rest) return null;
	const after = rest[1] ?? "";
	const queryIndex = after.indexOf("?");
	const path = queryIndex < 0 ? after : after.slice(0, queryIndex);
	const query = queryIndex < 0 ? "" : after.slice(queryIndex + 1);
	if (path === "new") return { kind: "new-chat" };
	if (path === "chat") {
		const id = queryValue(query, "id");
		if (id === null) return null;
		const clean = cleanLinkId(id);
		return clean === null ? null : { kind: "open-chat", chatId: clean };
	}
	if (path.startsWith("chat/")) {
		const clean = cleanLinkId(safeDecode(path.slice("chat/".length)));
		return clean === null ? null : { kind: "open-chat", chatId: clean };
	}
	return null;
}

function queryValue(query: string, key: string): string | null {
	for (const pair of query.split("&")) {
		const equals = pair.indexOf("=");
		if (equals < 0) continue;
		if (pair.slice(0, equals) === key)
			return safeDecode(pair.slice(equals + 1));
	}
	return null;
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value.replace(/\+/g, " "));
	} catch {
		return value;
	}
}

function cleanLinkId(id: string): string | null {
	const trimmed = id.trim();
	if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) return null;
	return trimmed.slice(0, 200);
}

/**
 * In-app summon chord matcher for the window keydown handler: Space
 * with Command (macOS) or Control (elsewhere) plus Shift. Pure and
 * unit-tested — the OS-global half lives in `desktop.rs`.
 */
export function isSummonHotkey(event: {
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	code: string;
}): boolean {
	return (
		(event.metaKey || event.ctrlKey) &&
		event.shiftKey &&
		!event.altKey &&
		event.code === "Space"
	);
}

/**
 * Render a chat as study-sheet Markdown (mirrors
 * `study_sheet_markdown` in `desktop.rs`, same vectors in both test
 * suites). The shell build delegates to the backend; the browser
 * preview and tests use this copy.
 */
export function studySheetMarkdown(
	title: string,
	messages: StudyLine[]
): string {
	const MAX_CHARS = 200_000;
	const cleanTitle = title.trim() || "Untitled chat";
	const kept: Array<{ heading: string; text: string }> = [];
	for (const message of messages) {
		const text = message.content.trim();
		if (!text) continue;
		const heading =
			message.role === "user"
				? "You"
				: message.role === "assistant"
					? "Ccez"
					: message.role;
		kept.push({ heading, text });
	}
	let out = `# ${cleanTitle}\n\n*Ccez LLM study sheet — ${kept.length} message${kept.length === 1 ? "" : "s"}.*\n`;
	for (const { heading, text } of kept) {
		out += `\n---\n\n## ${heading}\n\n${text}\n`;
	}
	if (out.length > MAX_CHARS) {
		out = `${out.slice(0, MAX_CHARS)}\n\n*(…truncated — the chat is longer than one study sheet.)*\n`;
	}
	return out;
}

/** Filename-safe stem for the exported sheet (mirrors the backend). */
export function sanitizeFileStem(title: string): string {
	let stem = "";
	let dash = false;
	for (const ch of title) {
		if (/[A-Za-z0-9]/.test(ch)) {
			stem += ch.toLowerCase();
			dash = false;
		} else if (!dash && stem) {
			stem += "-";
			dash = true;
		}
		if (stem.length >= 40) break;
	}
	stem = stem.replace(/^-+|-+$/g, "");
	return stem || "chat";
}

/** Default export filename for a sheet (`<stem>-study-sheet.md`). */
export function studySheetFilename(title: string): string {
	return `${sanitizeFileStem(title)}-study-sheet.md`;
}

/**
 * Sheet title from the chat itself: first non-empty line, capped at
 * 60 chars. Pure and unit-tested.
 */
export function sheetTitle(messages: StudyLine[]): string {
	for (const message of messages) {
		const first = message.content.trim().split("\n", 1)[0]?.trim() ?? "";
		if (first) return first.length > 60 ? `${first.slice(0, 60)}…` : first;
	}
	return "Untitled chat";
}

/**
 * Listen for Rust `deep-link` events, draining the pending cold-start
 * link first (same pending-then-live shape as the annotate bridge).
 * Resolves null outside the shell. Never throws.
 */
export async function listenDeepLinks(
	callback: (link: DeepLink) => void
): Promise<UnlistenFn | null> {
	if (!tauriBackendAvailable()) return null;
	try {
		const stop = await listen<{ action: string; chat_id?: string | null }>(
			DEEP_LINK_EVENT,
			(event) => {
				const link = payloadToLink(event.payload);
				if (link) callback(link);
			}
		);
		try {
			const pending = await invoke<{
				action: string;
				chat_id?: string | null;
			} | null>("desktop_drain_pending_link");
			const link = pending ? payloadToLink(pending) : null;
			if (link) callback(link);
		} catch {
			// Live events still flow; the drain is best-effort.
		}
		try {
			// Android turn-notice taps park under the same payload
			// shape; the desktop drain above throws off-shell, so a
			// parked tap waits here instead. Same take-once contract.
			const parked = await invoke<{
				action: string;
				chat_id?: string | null;
			} | null>("turn_drain_pending_chat");
			const tap = parked ? payloadToLink(parked) : null;
			if (tap) callback(tap);
		} catch {
			// Desktop shells own no turn drain; nothing parked to lose.
		}
		return stop;
	} catch {
		return null;
	}
}

/**
 * Capture-chord listener: the OS-global ⇧⌘/Ctrl+O in desktop.rs emits
 * `game-capture` while another app is focused, and the page runs the
 * capture→OCR→send pipeline off it. Null outside the shell (same
 * three-runtime contract as `listenDeepLinks`).
 */
export async function listenGameCapture(
	callback: () => void
): Promise<UnlistenFn | null> {
	if (!tauriBackendAvailable()) return null;
	try {
		return await listen("game-capture", () => callback());
	} catch {
		return null;
	}
}

/** Area-picker report from the overlay (`submit_area_rect`). */
export interface AreaPick {
	rect: { x: number; y: number; width: number; height: number } | null;
	clear: boolean;
}

/**
 * Open the set-area overlay (the ⇧⌘U chord). True when the backend
 * accepted; false outside the shell, where the caller toasts.
 */
export async function openAreaPicker(): Promise<boolean> {
	if (!tauriBackendAvailable()) return false;
	try {
		await invoke("open_area_picker");
		return true;
	} catch {
		return false;
	}
}

/**
 * Area-picker listener: the overlay reports saves and clears through
 * `area-picked` (Esc cancels silently, no event). Null outside the
 * shell.
 */
export async function listenAreaPicked(
	callback: (pick: AreaPick) => void
): Promise<UnlistenFn | null> {
	if (!tauriBackendAvailable()) return null;
	try {
		return await listen<AreaPick>("area-picked", (event) =>
			callback(event.payload)
		);
	} catch {
		return null;
	}
}

function payloadToLink(payload: {
	action: string;
	chat_id?: string | null;
}): DeepLink | null {
	if (payload.action === "new-chat") return { kind: "new-chat" };
	if (payload.action === "open-chat" && payload.chat_id) {
		const clean = cleanLinkId(payload.chat_id);
		return clean === null ? null : { kind: "open-chat", chatId: clean };
	}
	return null;
}

/**
 * Native share-out of a study sheet: the OS share sheet where
 * available (`navigator.share`), else the clipboard, else a `.md`
 * download. Never throws; the outcome tells the caller what to toast.
 */
export async function shareStudySheet(
	title: string,
	markdown: string
): Promise<ShareOutcome> {
	// `navigator.share` is typed on the DOM lib but only exists in
	// runtimes with an OS sheet (mobile browsers, some desktops) —
	// the `typeof` guard keeps node/jsdom on the fallbacks below.
	if (
		typeof navigator !== "undefined" &&
		typeof navigator.share === "function"
	) {
		try {
			await navigator.share({ title, text: markdown });
			return "shared";
		} catch (error) {
			// User-cancelled shares reject (AbortError): not a failure,
			// and not a fallback trigger — the user already decided.
			if (error instanceof Error && error.name === "AbortError")
				return "shared";
		}
	}
	try {
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			await navigator.clipboard.writeText(markdown);
			return "copied";
		}
	} catch {
		// Fall through to download.
	}
	try {
		if (typeof document === "undefined") return "unavailable";
		const blob = new Blob([markdown], { type: "text/markdown" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = studySheetFilename(title);
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
		return "downloaded";
	} catch {
		return "unavailable";
	}
}

/**
 * Print the current chat as a study sheet (the print stylesheet shows
 * only `#study-sheet-print`; Save as PDF in the dialog writes the
 * file). False outside a DOM runtime. Never throws.
 */
export function printStudySheet(): boolean {
	try {
		if (typeof window === "undefined" || typeof window.print !== "function")
			return false;
		window.print();
		return true;
	} catch {
		return false;
	}
}

/**
 * Block OS sleep while speech or a reply streams (macOS `caffeinate`,
 * Win32 execution state, Linux `systemd-inhibit` — see `desktop.rs`).
 * Resolves null outside the shell or where unsupported, so the caller
 * can ride the Screen Wake Lock fallback instead. Never throws.
 */
export async function desktopSleepBlock(
	reason: string
): Promise<number | null> {
	if (!tauriBackendAvailable()) return null;
	try {
		return await invoke<number>("desktop_sleep_block", { reason });
	} catch {
		return null;
	}
}

/** Drop a claim from `desktopSleepBlock`. Never throws. */
export async function desktopSleepUnblock(id: number): Promise<void> {
	if (!tauriBackendAvailable()) return;
	try {
		await invoke("desktop_sleep_unblock", { id });
	} catch {
		// The guard is refcounted backend-side; a failed release must
		// never break teardown.
	}
}

/**
 * Write the chat as a study-sheet file via the backend (native
 * share-out reads this path). Null outside the shell — the caller
 * falls back to `shareStudySheet`. Never throws.
 */
export async function exportStudySheet(
	title: string,
	messages: StudyLine[]
): Promise<string | null> {
	if (!tauriBackendAvailable()) return null;
	try {
		return await invoke<string>("desktop_export_study_sheet", {
			title,
			messages
		});
	} catch {
		return null;
	}
}

/**
 * Toast for a study-sheet share outcome (REFACTOR §6): one toast
 * names where the sheet landed; unavailable is the error path.
 */
export function shareOutcomeToast(
	outcome: ShareOutcome,
	saved: string | null
): { error: boolean; text: string } {
	if (outcome === "shared") {
		return {
			error: false,
			text: saved ? `Study sheet shared (${saved})` : "Study sheet shared"
		};
	}
	if (outcome === "copied")
		return { error: false, text: "Study sheet copied — paste it anywhere" };
	if (outcome === "downloaded")
		return { error: false, text: "Study sheet downloaded" };
	return { error: true, text: "Sharing is unavailable here" };
}
