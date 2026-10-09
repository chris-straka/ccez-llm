import { altKeyLabel, modKeyLabel } from "./platform";

/** One row of the shortcuts / gestures modal. */
export interface ShortcutRow {
	name: string;
	/** Alternatives separated by " · " (the modal draws one chip each). */
	keys: string;
	/** Section heading; rows arrive grouped in section order. */
	group: string;
}

/** A modal section: heading plus its rows, in list order. */
export interface ShortcutGroup {
	group: string;
	rows: ShortcutRow[];
}

/** Rows to sections, keeping first-seen section order. */
export function groupShortcuts(rows: ShortcutRow[]): ShortcutGroup[] {
	const out: ShortcutGroup[] = [];
	for (const row of rows) {
		const last = out[out.length - 1];
		if (last?.group === row.group) last.rows.push(row);
		else out.push({ group: row.group, rows: [row] });
	}
	return out;
}

/** Split a keys string into its " · " alternatives. */
export function keyChips(keys: string): string[] {
	return keys.split(" · ").filter((k) => k.length > 0);
}

/** Touch gestures list, data-driven so the modal filter can search it.
Sections run by where the finger is: moving around, a message, a
selection. */
export function touchShortcuts(): ShortcutRow[] {
	const move = "Moving around";
	const msg = "Messages";
	const sel = "Selected text";
	return [
		{ group: move, name: "Chats list", keys: "Swipe right · two-finger swipe right" },
		{
			group: move,
			name: "Quick switcher",
			keys: "Two-finger hold · double-tap empty space · swipe to cycle"
		},
		{ group: move, name: "Search chats", keys: "Quick switcher, then magnifier" },
		{ group: move, name: "Newer / older chat", keys: "Three-finger swipe left / right" },
		{ group: move, name: "Top of chat", keys: "Two-finger swipe up" },
		{ group: move, name: "Bottom of chat", keys: "Two-finger swipe down" },
		{
			group: move,
			name: "Settings",
			keys: "Swipe left off messages · two-finger swipe left · chats list button"
		},
		{ group: move, name: "Rename a chat", keys: "Long-press it in the chats list" },
		{ group: msg, name: "Message buttons", keys: "Tap a message" },
		{ group: msg, name: "Text size", keys: "Pinch the messages" },
		{ group: msg, name: "Fold a message", keys: "Swipe left on it" },
		{ group: msg, name: "Delete a message", keys: "Three-finger tap" },
		{ group: msg, name: "Delete this chat", keys: "Three-finger hold" },
		{ group: sel, name: "Select a word", keys: "Double-tap · long-press" },
		{ group: sel, name: "Annotate", keys: "Select text, then Annotate" },
		{ group: sel, name: "Copy", keys: "Select text, then Copy" },
		{ group: sel, name: "Speak", keys: "Select text, then Speak" },
		{ group: sel, name: "Inspect character", keys: "Select one Han character, then Inspect" },
		{ group: sel, name: "Move the selection menu", keys: "Drag it" },
		{ group: sel, name: "Pin / unpin annotation", keys: "Double-tap badge" },
		{ group: sel, name: "Cancel an annotation", keys: "Tap away · scrolling keeps it" }
	];
}

/**
 * Desktop shortcuts, data-driven so the modal filter can search them.
 * Modifier labels derive from isMac so the modal never drifts from the
 * keyboard router. Rows deliberately removed (New line, Stage message,
 * Scroll messages, Export chat, Translate selection) must stay out —
 * shortcuts.test.ts pins the full list. Rows run in section order,
 * most-used first within each section; the hovered-message section
 * leads (hover a message, press a key) and its keys drop the "Hover +".
 *
 * inShell is false in the browser preview, where browser-claimed
 * chords (tab switching, find, print, bookmarks, page zoom) and
 * browser-eaten ones (new window) never reach the page: advertising
 * them would lie, so the modal drops those rows there. Every dropped
 * feature keeps a click equivalent.
 */
const WEB_HIDDEN_ROWS = new Set([
	"Search chats",
	"Search filters",
	"Find in chat",
	"Reply language",
	"Text size",
	"Chat width",
	"Prompt text size",
	"Prompt width",
	"New chat",
	// No backend answers in the preview: the chord fires, then toasts.
	"Capture window text",
	"Set capture area",
	// Shell-only chords: the browser claims ⌘E and ⇧⌘R out there.
	"Edit newest message",
	"Flashcards"
]);

/** Rows whose feature only exists on macOS (screen capture). */
const MAC_ONLY_ROWS = new Set(["Capture window text", "Set capture area"]);

export const HOVER_GROUP = "Hovered message";

export function desktopShortcuts(
	isMac: boolean,
	inShell = true,
	flashcards = true,
	isWindows = false
): ShortcutRow[] {
	const altm = altKeyLabel(isMac);
	const mod = modKeyLabel(isMac);
	const meta = isMac ? "⌘" : "Ctrl+";
	const shiftMeta = isMac ? "⇧⌘" : "Ctrl+Shift+";
	const hover = HOVER_GROUP;
	const chats = "Chats";
	const prompt = "Prompt & model";
	const reading = "Reading & study";
	const mouse = "Mouse & selection";
	const scroll = "Scrolling";
	const view = "Window & view";
	const rows: ShortcutRow[] = [
		{ group: hover, name: "Fold / unfold", keys: `F · ${isMac ? "Option" : "Alt"}-click` },
		{ group: hover, name: "Copy", keys: "C" },
		{ group: hover, name: "Read aloud", keys: "Shift+R" },
		{ group: hover, name: "Read word / sentence / paragraph", keys: "Shift+W / Shift+S / Shift+P" },
		{ group: hover, name: "Annotate word", keys: "A" },
		{ group: hover, name: "Edit your message", keys: "E" },
		{ group: hover, name: "Cut", keys: "X" },
		{ group: hover, name: "Branch from here", keys: "Shift+C" },
		{ group: hover, name: "Trim above here", keys: "T" },
		{ group: hover, name: "Jump to its start / end", keys: "z / Z" },
		// ⌘D is meta-only (Ctrl+D fast-scrolls in scroll mode); Shift+D works everywhere.
		{
			group: hover,
			name: "Delete",
			keys: isMac ? "⌘Delete · ⌘D · Shift+D" : "Ctrl+Delete · Shift+D"
		},
		{ group: chats, name: "Search chats", keys: isMac ? "⌘P" : "Ctrl+K · Ctrl+P" },
		{ group: chats, name: "Search filters", keys: '"exact phrase" · from:me · from:ai · in:notes' },
		{ group: chats, name: "Find in chat", keys: `${meta}F` },
		{
			group: chats,
			name: "Chat list",
			keys: `${meta}B · ${shiftMeta}H · J / K walk · Space enters`
		},
		{ group: chats, name: "New chat", keys: `${meta}N · ${shiftMeta}N · ${meta}T` },
		{
			group: chats,
			name: "Newer / older chat",
			keys: `${shiftMeta}J / ${shiftMeta}K · ${meta}↑ / ${meta}↓`
		},
		{ group: chats, name: "Read a chat's name", keys: "Hover it in the list + Shift+R" },
		{ group: chats, name: "Rename a chat", keys: "Hover it in the list, then the pencil" },
		{ group: chats, name: "Delete this chat", keys: `${shiftMeta}Delete` },
		{ group: prompt, name: "Edit newest message", keys: `${meta}E` },
		{ group: prompt, name: "Rerun a prompt", keys: "Rerun button · deletes after" },
		{ group: prompt, name: "Pasted text expand / collapse", keys: "Ctrl+O" },
		{
			group: prompt,
			name: "Reply language",
			keys: `${meta}1 – ${meta}0 · repeat clears`
		},
		{ group: prompt, name: "Switch model / key", keys: `Ctrl+${altm}+← / →` },
		{ group: prompt, name: "Thinking level", keys: `Ctrl+${altm}+↓ / ↑` },
		{ group: reading, name: "Voice readback on / off", keys: `Ctrl+${altm}+S` },
		{ group: reading, name: "Annotation answers in English / the passage's language", keys: `Ctrl+${altm}+L` },
		{ group: reading, name: "Stop voice / close", keys: "Esc" },
		{ group: reading, name: "Reading aids", keys: "M pinyin · N furigana" },
		{ group: reading, name: "Stroke order step", keys: "H / L in Inspect" },
		{
			group: reading,
			name: "Flashcards",
			keys: `${shiftMeta}R · Space flips · 1 / 2 grade`
		},
		{
			group: reading,
			name: "Listening drill",
			keys: `Space plays · S slow · ${meta}Enter · A reveals · ${altm}+Space mid-guess`
		},
		{ group: reading, name: "Capture window text", keys: `${shiftMeta}O` },
		{ group: reading, name: "Set capture area", keys: `${shiftMeta}U` },
		{ group: mouse, name: "Speak text aloud", keys: "Right-click" },
		{ group: mouse, name: "Annotate and send", keys: "Select + A · right-click Annotate" },
		{ group: mouse, name: "Ask to expand", keys: "Select + C" },
		{ group: mouse, name: "Select sentence / paragraph", keys: "Triple-click / quadruple-click" },
		{ group: mouse, name: "Delete annotation", keys: "Hover badge + Delete" },
		{ group: mouse, name: "Pin / unpin annotation", keys: "Double-click badge" },
		{ group: mouse, name: "Fold / unfold code", keys: "Right-click toggles · left-click unfolds" },
		{ group: scroll, name: "Scroll", keys: "j / k" },
		{ group: scroll, name: "Scroll further", keys: "d / u" },
		{ group: scroll, name: "Half page", keys: "Ctrl+D / Ctrl+U" },
		{ group: scroll, name: "Top / bottom", keys: "gg / G" },
		{ group: view, name: "Shortcuts", keys: `${isMac ? "⇧⌘/" : "Ctrl+Shift+/"} · middle-click` },
		{ group: view, name: "Summon / hide window", keys: `${shiftMeta}Space` },
		{ group: view, name: "Send selected text here", keys: "Ctrl+Alt+Space in any app" },
		{ group: view, name: "Fullscreen", keys: isMac ? "Ctrl+⌘F" : "F11" },
		{ group: view, name: "Exit fullscreen", keys: "Hold Esc 2s · Esc+F" },
		{ group: view, name: "Text size", keys: isMac ? `${mod}+ / ${mod}−` : "Ctrl+Plus / Ctrl+Minus" },
		{
			group: view,
			name: "Chat width",
			keys: isMac ? `⇧${mod}+ / ⇧${mod}−` : "Ctrl+Shift+Plus / Ctrl+Shift+Minus"
		},
		{ group: view, name: "Prompt text size", keys: `${meta}[ / ${meta}]` },
		{ group: view, name: "Prompt width", keys: `${shiftMeta}[ / ${shiftMeta}]` }
	];
	return rows.filter(
		(row) =>
			(inShell || !WEB_HIDDEN_ROWS.has(row.name)) &&
			(flashcards || row.name !== "Flashcards") &&
			// Window capture is macOS-only (capture.rs).
			(isMac || !MAC_ONLY_ROWS.has(row.name)) &&
			// The send-text chord lives in the Windows shell only.
			((isWindows && inShell) || row.name !== "Send selected text here")
	);
}

/** Modal filter: matches action, keys, or section, case-insensitive. */
export function filteredShortcuts(
	rows: ShortcutRow[],
	query: string
): ShortcutRow[] {
	const q = query.trim().toLowerCase();
	if (!q) return rows;
	return rows.filter((row) =>
		`${row.name} ${row.keys} ${row.group}`.toLowerCase().includes(q)
	);
}
