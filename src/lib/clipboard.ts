import { readText as readShellText } from "@tauri-apps/plugin-clipboard-manager";

import { tauriBackendAvailable } from "./secrets";

/**
 * Clipboard text for the paste button (settings key fields).
 *
 * The Android WebView denies `navigator.clipboard.readText()`, so in
 * the shell the read goes through the native clipboard plugin (the
 * tap is the user gesture; foreground reads need no permission).
 * Anywhere else it reads through the Web API. Resolves null when
 * both are unavailable — the caller names the long-press fallback.
 * Readers are injectable for tests; production passes none.
 */
export async function readClipboardText(
	shellRead: () => Promise<string> = readShellText,
	webRead: () => Promise<string> = () =>
		navigator.clipboard.readText(),
	inShell: boolean = tauriBackendAvailable()
): Promise<string | null> {
	if (inShell) {
		try {
			return await shellRead();
		} catch {
			// Fall through to the Web API below.
		}
	}
	try {
		return await webRead();
	} catch {
		return null;
	}
}
