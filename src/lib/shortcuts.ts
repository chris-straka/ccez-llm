import { altKeyLabel, modKeyLabel } from "./platform";

/** One row of the shortcuts / gestures modal. */
export interface ShortcutRow {
	name: string;
	keys: string;
}

/** Touch gestures list, data-driven so the modal filter can search it. */
export function touchShortcuts(): ShortcutRow[] {
	return [
		{ name: "Chats list", keys: "Double-tap empty space · swipe right · two-finger swipe right" },
		{ name: "fold chat msg", keys: "Swipe left" },
		{ name: "Settings", keys: "Chats list button · two-finger swipe left" },
		{ name: "Newer / older chat", keys: "Three-finger swipe right / left" },
		{ name: "Top of chat", keys: "Two-finger swipe up · gg" },
		{ name: "Bottom of chat", keys: "Two-finger swipe down · G" },
		{ name: "Chat switcher", keys: "Two-finger hold" },
		{ name: "Delete current chat", keys: "Double two-finger tap" },
		{ name: "Delete every chat", keys: "Double three-finger tap" },
		{ name: "Annotate", keys: "Select text · Annotate" },
		{ name: "Message buttons", keys: "Tap a message · double-tap jumps to its end" },
		{ name: "Fold a message", keys: "Swipe left on it" }
	];
}

/**
 * Desktop shortcuts, data-driven so the modal filter can search them.
 * Modifier labels derive from isMac so the modal never drifts from the
 * keyboard router. Rows deliberately removed (New line, Stage message,
 * Scroll messages, Export chat, Translate selection) must stay out —
 * shortcuts.test.ts pins the full list.
 */
export function desktopShortcuts(isMac: boolean): ShortcutRow[] {
	const altm = altKeyLabel(isMac);
	const mod = modKeyLabel(isMac);
	const meta = isMac ? "⌘" : "Ctrl+";
	return [
		{ name: "Shortcuts show/hide", keys: `${isMac ? "⇧⌘/" : "Ctrl+Shift+/"} · middle-click` },
		{ name: "Summon / hide window", keys: `${isMac ? "⇧⌘Space" : "Ctrl+Shift+Space"}` },
		{ name: "Switch model / key", keys: `Ctrl+${altm}+← / →` },
		{ name: "Thinking level", keys: `Ctrl+${altm}+↓ / ↑` },
		{
			name: "Scroll",
			keys: "j/k, ctrl+u/ctrl+d, gg/G, z/Z, h/l"
		},
		{ name: "Exit fullscreen", keys: "Hold Esc 2s · Esc+F" },
		{
			name: "Chat list",
			keys: `${isMac ? "⌘B / ⇧⌘H" : "Ctrl+B / Ctrl+Shift+H"} · J / K walk · Space enters`
		},
		{
			name: "Search chats",
			keys: `${meta}P`
		},
		{
			name: "Find in chat",
			keys: `${meta}F`
		},
		{ name: "Fullscreen", keys: `${isMac ? "⌘E, F" : "Ctrl+Meta+F"}` },
		{
			name: "Newer / older chat",
			keys: `${isMac ? "⇧⌘J / ⇧⌘K" : "Ctrl+Shift+J / Ctrl+Shift+K"}`
		},
		{ name: "New chat", keys: `${isMac ? "⌘N or ⇧⌘N" : "Ctrl+N or Ctrl+Shift+N"}` },
		{ name: "Voice readback on/off", keys: `Ctrl+${altm}+S` },
		{ name: "Pasted text expand/collapse", keys: "Ctrl+O" },
		{
			name: "Browser side panel",
			keys: `${meta}T`
		},
		{ name: "Stop voice / close", keys: "Esc" },
		{ name: "Speak text aloud", keys: "Right-click" },
		// ⌘D is meta-only (Ctrl+D fast-scrolls in scroll mode); Shift+D works everywhere.
		{
			name: "Delete a message",
			keys: isMac ? "Hover + ⌘D / Shift+D" : "Hover + Shift+D"
		},
		{
			name: "Fold / unfold message",
			keys: `Hover + F / ${isMac ? "Option" : "Alt"}-click`
		},
		{
			name: "Fold / unfold code",
			keys: "Right-click toggles · left-click unfolds"
		},
		{ name: "Rerun a prompt", keys: "Rerun button · deletes after" },
		{
			name: "Reply language",
			keys: `${isMac ? "⌘1, ⌘0" : "Ctrl+1, Ctrl+0"} · repeat to clear`
		},
		{ name: "Delete this chat", keys: `${meta}Delete` },
		{ name: "Delete every chat", keys: `${isMac ? "⇧⌘Delete" : "Ctrl+Shift+Delete"}` },
		{ name: "Cut message", keys: "x" },
		{ name: "Edit own message", keys: "hover + e" },
		{ name: "Reading aid toggle", keys: "Hover + A · M pinyin · N furigana" },
		{ name: "prev/next stroke step", keys: "H / L with Inspect open" },
		{ name: "Text size up / down", keys: `${mod}+ / ${mod}−` },
		{ name: "Chat width + / −", keys: `⇧${mod}+ / ⇧${mod}−` }
	];
}

/** Modal filter: matches action or keys, case-insensitive. */
export function filteredShortcuts(rows: ShortcutRow[], query: string): ShortcutRow[] {
	const q = query.trim().toLowerCase();
	if (!q) return rows;
	return rows.filter((row) => `${row.name} ${row.keys}`.toLowerCase().includes(q));
}
