/**
 * Game-line overlay bridge ("Game line", see src-tauri/src/game_line.rs):
 * event names shared by the main window and the overlay route, the
 * open/close invokes, and the one-line translation call (one model
 * call per line, cached). The main window owns lines, translations,
 * and filing; the overlay only renders and reports selections.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ChatProvider, ChatResult } from "./providers/types";

/** Main → overlay: the current line, its translation, the app theme. */
export const GAME_LINE_EVENT = "game-line";
/** Overlay → main on boot: push the current line, if any. */
export const GAME_LINE_OPEN_EVENT = "game-line-open";
/** Overlay → main: file this selection into the Game chat. */
export const GAME_LINE_FILE_EVENT = "game-line-file";
/** Backend → main: the overlay window closed (mirror the toggle). */
export const GAME_LINE_CLOSED_EVENT = "game-line-closed";

/** Payload for [`GAME_LINE_EVENT`]. */
export interface GameLinePayload {
	line: string;
	translation: string | null;
	theme: string;
}

/** Payload for [`GAME_LINE_FILE_EVENT`]. */
export interface GameLineFile {
	quote: string;
	comment: string;
}

/** Open (or focus) the overlay. Rejects outside the shell. */
export async function openGameLine(): Promise<void> {
	await invoke("open_game_line");
}

/** Close the overlay if it is open. Rejects outside the shell. */
export async function closeGameLine(): Promise<void> {
	await invoke("close_game_line");
}

/**
 * One-shot messages translating a game line: the reply is the
 * translation alone, so the overlay renders it verbatim.
 */
export function gameLineTranslationMessages(line: string): ChatMessage[] {
	return [
		{
			role: "system",
			content:
				"Translate the user's Japanese game line into English in one line. " +
				"Reply with the translation only, no quotes or explanation."
		},
		{ role: "user", content: line }
	];
}

const translationCache = new Map<string, string>();
const TRANSLATION_CACHE_CAP = 200;

/** Cached translation for a line, if the model already saw it. */
export function gameLineCached(line: string): string | undefined {
	return translationCache.get(line.trim());
}

/** Translate one line, caching per trimmed line (cap 200). */
export async function translateGameLine(
	provider: Pick<ChatProvider, "chat">,
	line: string
): Promise<string> {
	const key = line.trim();
	const hit = translationCache.get(key);
	if (hit !== undefined) return hit;
	const result: ChatResult = await provider.chat(
		gameLineTranslationMessages(key)
	);
	const text = result.content.trim();
	if (translationCache.size >= TRANSLATION_CACHE_CAP) translationCache.clear();
	translationCache.set(key, text);
	return text;
}

/** Drop cached translations (tests). */
export function clearGameLineCache(): void {
	translationCache.clear();
}
