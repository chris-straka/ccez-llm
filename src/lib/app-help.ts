import { isAndroidUserAgent, isMacPlatform } from "./platform";
import {
	desktopShortcuts,
	groupShortcuts,
	touchShortcuts,
	type ShortcutRow
} from "./shortcuts";

/**
 * How the chat model answers questions about the app itself ("how do
 * I annotate again?"): the fetch tool's description points it at this
 * reserved address (.invalid never resolves), and both engines answer
 * it with this guide instead of the network. Ordinary turns pay
 * nothing for it. The shortcut lists come from the same registry the
 * Shortcuts menu draws, so the guide can't drift from the keys.
 */
export const APP_HELP_URL = "https://ccez-llm.invalid/help";

/** The part no registry holds: what the app is and how its flows go. */
const GUIDE = `# Ccez LLM: how the app works

A chat app for language learners: bring your own API key, chat with the model, and study the replies.

## Annotating (asking about a word or phrase)
- Select text in a message (double-click a word, triple-click a sentence, four clicks a paragraph, or drag), then choose Annotate in the menu that appears. On a computer the A key annotates the selection too.
- A numbered badge appears on the text. It pulses blue while the model works and turns orange when the answer is ready. Open the badge to read it.
- A single word gets a word card: its meaning, its pieces (stem, endings, prefixes), the gender for nouns, the multi-word form it belongs to, and a note on traps. Han characters are split into their parts with the radical marked.
- In an open card, reply to argue with or ask about the answer (R on a computer).
- Dictionaries for word cards download per language the first time; Settings → Chat → Dictionaries lists and removes them.

## Reading aids
- Chinese pinyin, Japanese furigana and Arabic vowel marks can show over the text (see the shortcuts below).
- Inspect a single Han character for its components, strokes, radical and readings.

## Voice
- Messages can be read aloud with word-by-word highlighting, and dictation types what you say.
- Voice speed and volume are in Settings → Voice. On a Mac, better voices are installed in System Settings → Accessibility → Read & Speak → System Voice → Manage Voices.

## Chats
- Chats live in the chat list; messages can be folded, edited, deleted, rerun, or branched into a new chat.
- Picking a reply language turns Correct on, so your own messages in that language get corrected; Settings → Chat → "Correct me in a language" sets that default.

## Settings
- Settings has six pages: Reading, Voice, Layout, Look, Chat, and Model (provider, API key, model, thinking level). API keys are stored securely, never in plain settings.
- The full shortcut or gesture list is at the bottom of Settings.`;

/** Shortcut rows as markdown sections. */
function shortcutsText(rows: ShortcutRow[], heading: string): string {
	const sections = groupShortcuts(rows).map(
		(g) =>
			`### ${g.group}\n` +
			g.rows.map((r) => `- ${r.name}: ${r.keys}`).join("\n")
	);
	return `## ${heading}\n${sections.join("\n\n")}`;
}

/** The guide for one platform: the flows, then that platform's keys
 * or gestures. Pure. */
export function buildAppHelp(
	platform: "mac" | "windows" | "linux" | "touch"
): string {
	const shortcuts =
		platform === "touch"
			? shortcutsText(touchShortcuts(), "Gestures (phone)")
			: shortcutsText(
					desktopShortcuts(
						platform === "mac",
						true,
						true,
						platform === "windows"
					),
					"Keyboard and mouse shortcuts"
				);
	return `${GUIDE}\n\n${shortcuts}\n`;
}

/** The guide for the device this runs on. */
export function appHelpHere(): string {
	if (typeof navigator === "undefined") return buildAppHelp("mac");
	if (isAndroidUserAgent(navigator.userAgent)) return buildAppHelp("touch");
	if (isMacPlatform(navigator.platform)) return buildAppHelp("mac");
	return buildAppHelp(/win/i.test(navigator.platform) ? "windows" : "linux");
}
