import { altKeyLabel, modKeyLabel } from "./platform";

/** One row of the shortcuts / gestures modal. */
export interface ShortcutRow {
	name: string;
	keys: string;
}

/** Alphabetical by name (case-insensitive): the modal lists both menus A-Z. */
function byName(a: ShortcutRow, b: ShortcutRow): number {
	const x = a.name.toLowerCase();
	const y = b.name.toLowerCase();
	return x < y ? -1 : x > y ? 1 : 0;
}

/** Touch gestures list, data-driven so the modal filter can search it. */
export function touchShortcuts(): ShortcutRow[] {
	return [
		{ name: "Chats list", keys: "Swipe right · two-finger swipe right" },
		{ name: "fold chat msg", keys: "Swipe left" },
		{
			name: "Settings",
			keys: "Swipe left off messages · chats list button · two-finger swipe left"
		},
		{ name: "Newer / older chat", keys: "Three-finger swipe left / right" },
		{ name: "Top of chat", keys: "Two-finger swipe up · gg" },
		{ name: "Bottom of chat", keys: "Two-finger swipe down · G" },
		{
			name: "Chat switcher",
			keys: "Two-finger hold · double-tap empty space · swipe cycles · loops"
		},
		{ name: "Delete a message", keys: "Three-finger tap" },
		{ name: "Delete this chat", keys: "Three-finger hold" },
		{ name: "Annotate", keys: "Hover + A · Select + Annotate" },
		{ name: "Speak selection", keys: "Select text · Speak" },
		{
			name: "Inspect character",
			keys: "Select one Han character · Inspect"
		},
		{
			name: "Copy selection",
			keys: "Select text · Copy"
		},
		{ name: "Move the selection menu", keys: "Drag it" },
		{
			name: "Keep an annotation while scrolling",
			keys: "Scroll freely · only tap-away cancels"
		},
		{
			name: "Message buttons",
			keys: "Tap a message · double-tap selects the word"
		},
		{ name: "Fold a message", keys: "Swipe left on it" }
	].sort(byName);
}

/**
 * Desktop shortcuts, data-driven so the modal filter can search them.
 * Modifier labels derive from isMac so the modal never drifts from the
 * keyboard router. Rows deliberately removed (New line, Stage message,
 * Scroll messages, Export chat, Translate selection) must stay out —
 * shortcuts.test.ts pins the full list. Returned A-Z (byName), so new
 * rows land sorted without hand-placement.
 *
 * inShell is false in the browser preview, where browser-claimed
 * chords (tab switching, find, print, bookmarks, page zoom) and
 * browser-eaten ones (new window) never reach the page: advertising
 * them would lie, so the modal drops those rows there. Every dropped
 * feature keeps a click equivalent.
 */
const WEB_HIDDEN_ROWS = new Set([
	"Search chats",
	"Find in chat",
	"Reply language",
	"Text size up / down",
	"Chat width + / −",
	"Prompt text size up / down",
	"Prompt width + / −",
	"New chat",
	// No backend answers in the preview: the chord fires, then toasts.
	"Capture window text"
]);

export function desktopShortcuts(isMac: boolean, inShell = true): ShortcutRow[] {
	const altm = altKeyLabel(isMac);
	const mod = modKeyLabel(isMac);
	const meta = isMac ? "⌘" : "Ctrl+";
	const rows: ShortcutRow[] = [
		{
			name: "Shortcuts show/hide",
			keys: `${isMac ? "⇧⌘/" : "Ctrl+Shift+/"} · middle-click`
		},
		{
			name: "Summon / hide window",
			keys: `${isMac ? "⇧⌘Space" : "Ctrl+Shift+Space"}`
		},
		{ name: "Switch model / key", keys: `Ctrl+${altm}+← / →` },
		{ name: "Thinking level", keys: `Ctrl+${altm}+↓ / ↑` },
		{
			name: "Scroll",
			keys: "j/k, u/d, ctrl+u/ctrl+d, gg/G, z/Z, h/l"
		},
		{ name: "Annotate hovered word", keys: "Hover + A" },
		{ name: "Annotate instantly", keys: "Right-click Annotate" },
		{ name: "Delete annotation", keys: "Hover badge + Delete" },
		{ name: "Pin annotation", keys: "Double-click badge" },
		{ name: "Select sentence / paragraph", keys: "Triple-click / quadruple-click" },
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
			keys: `${
				isMac ? "⇧⌘J / ⇧⌘K / ⌘↑ / ⌘↓" : "Ctrl+Shift+J / Ctrl+Shift+K / Ctrl+↑ / Ctrl+↓"
			}`
		},
		{
			name: "New chat",
			keys: `${isMac ? "⌘N, ⇧⌘N, ⌘T" : "Ctrl+N, Ctrl+Shift+N, Ctrl+T"}`
		},
		{ name: "Voice readback on/off", keys: `Ctrl+${altm}+S` },
		{
			name: "Capture window text",
			keys: `${isMac ? "⇧⌘O" : "Ctrl+Shift+O"}`
		},
		{ name: "Pasted text expand/collapse", keys: "Ctrl+O" },
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
		{ name: "Fold message by drag", keys: "Middle-drag left / right" },
		{ name: "Switch chat by drag", keys: "Middle-drag up / down" },
		{
			name: "Fold / unfold code",
			keys: "Right-click toggles · left-click unfolds"
		},
		{ name: "Rerun a prompt", keys: "Rerun button · deletes after" },
		{
			name: "Reply language",
			keys: `${
				isMac ? "⌘1, ⌘0" : "Ctrl+1, Ctrl+0"
			} · repeat clears · empty picks · always picks`
		},
		{
			name: "Delete this chat",
			keys: isMac ? "⌘Delete · ⇧⌘Delete" : "Ctrl+Delete · Ctrl+Shift+Delete"
		},
		{ name: "Cut message", keys: "x" },
		{ name: "Edit own message", keys: "hover + e" },
		{ name: "Copy message", keys: "Hover + C" },
		{ name: "Branch from here", keys: "Hover + Shift+C" },
		{ name: "Speak message", keys: "Hover + Shift+R" },
		{ name: "Speak word", keys: "Hover + Shift+W" },
		{ name: "Speak sentence", keys: "Hover + Shift+S" },
		{ name: "Speak paragraph", keys: "Hover + Shift+P" },
		{ name: "Reading aid toggle", keys: "M pinyin · N furigana" },
		{ name: "prev/next stroke step", keys: "H / L with Inspect open" },
		{ name: "Text size up / down", keys: `${mod}+ / ${mod}−` },
		{ name: "Chat width + / −", keys: `⇧${mod}+ / ⇧${mod}−` },
		{ name: "Prompt text size up / down", keys: `${mod}[ / ${mod}]` },
		{ name: "Prompt width + / −", keys: `⇧${mod}[ / ⇧${mod}]` }
	];
	return (inShell ? rows : rows.filter((row) => !WEB_HIDDEN_ROWS.has(row.name))).sort(
		byName
	);
}

/** Modal filter: matches action or keys, case-insensitive. */
export function filteredShortcuts(
	rows: ShortcutRow[],
	query: string
): ShortcutRow[] {
	const q = query.trim().toLowerCase();
	if (!q) return rows;
	return rows.filter((row) =>
		`${row.name} ${row.keys}`.toLowerCase().includes(q)
	);
}
