import { describe, it, expect } from "vitest";
import {
	desktopShortcuts,
	filteredShortcuts,
	HOVER_GROUP,
	keyChips
} from "./shortcuts";

/**
 * Shortcuts-menu copy guard: removed rows kept finding their way back
 * into the modal, so the full grouped list is pinned here (unit-fast) in
 * addition to the e2e pithiness spec. Edit this file deliberately when
 * the menu intentionally changes.
 */
// Section order, then usage order within each section.
const MAC_SECTIONS: Array<[string, string[]]> = [
	[
		"Hovered message",
		[
			"Fold / unfold",
			"Copy",
			"Read aloud",
			"Read word / sentence / paragraph",
			"Annotate word",
			"Clear its annotations",
			"Edit your message",
			"Rerun / regenerate",
			"Cut",
			"Branch from here",
			"Trim above here",
			"Jump to its start / end",
			"Delete",
			"Undo delete"
		]
	],
	[
		"Chats",
		[
			"Search chats",
			"Search filters",
			"Find in chat",
			"Chat list",
			"New chat",
			"Newer / older chat",
			"Read a chat's name",
			"Rename a chat",
			"Delete this chat",
			"Chat position"
		]
	],
	[
		"Prompt & model",
		[
			"Edit newest message",
			"Stop the reply",
			"Rerun a prompt",
			"Pasted text expand / collapse",
			"Reply language",
			"Switch model / key",
			"Thinking level"
		]
	],
	[
		"Reading & study",
		[
			"Voice readback on / off",
			"Annotation answers in English / the passage's language",
			"Stop voice / close",
			"Reply to an open note",
			"Reword an open note",
			"Reading aids",
			"Stroke order step",
			"Capture window text",
			"Set capture area"
		]
	],
	[
		"Video drills",
		[
			"Play / pause",
			"Stop playing",
			"Replay from the start",
			"Slow replay",
			"Show the text",
			"Next clip",
			"Ask about the video"
		]
	],
	[
		"Mouse & selection",
		[
			"Speak text aloud",
			"Annotate and send",
			"Ask to expand",
			"Select sentence / paragraph",
			"Delete annotation",
			"Fold / unfold code"
		]
	],
	["Scrolling", ["Scroll", "Scroll further", "Half page", "Top / bottom"]],
	[
		"Window & view",
		[
			"Shortcuts",
			"Settings",
			"Summon / hide window",
			"Fullscreen",
			"Exit fullscreen",
			"Text size",
			"Chat width",
			"Prompt text size",
			"Prompt width"
		]
	],
	[
		"Browser",
		[
			"Browser beside the chat",
			"New tab / close tab",
			"Address bar",
			"Next / previous tab",
			"Expand the browser",
			"In the page: back, forward, reload",
			"In the page: find, zoom",
			"In the page: annotate the selection"
		]
	]
];
const MAC_NAMES = MAC_SECTIONS.flatMap(([, names]) => names);

/** Rows deliberately removed — asserting absence, not presence. */
const REMOVED = [
	"New line",
	"Stage message",
	"Scroll messages",
	"Export chat",
	"Translate selection"
];

describe("shortcuts menu copy", () => {
	it("keeps ⌘D on the notes, never a bookmark", () => {
		const keys = new Map(desktopShortcuts(true).map((r) => [r.name, r.keys]));
		// ⌘D is the notes' (owner, 2026-11-05: never a bookmark).
		expect(keys.get("Clear its annotations")).toBe("⌘D · Shift+Delete");
	});

	it("drops browser-dead rows on the web, order kept", () => {
		const gone = [
			"Search chats",
			"Search filters",
			"Find in chat",
			"Reply language",
			"Text size",
			"Chat width",
			"Prompt text size",
			"Prompt width",
			"New chat",
			"Capture window text",
			"Set capture area",
			"Edit newest message",
			"Browser beside the chat",
			"New tab / close tab",
			"Address bar",
			"Next / previous tab",
			"Expand the browser",
			"In the page: back, forward, reload",
			"In the page: find, zoom",
			"In the page: annotate the selection"
		];
		for (const isMac of [true, false]) {
			const names = desktopShortcuts(isMac, false).map((r) => r.name);
			expect(names).toEqual(MAC_NAMES.filter((n) => !gone.includes(n)));
			for (const row of desktopShortcuts(isMac, false)) {
				expect(`${row.name}: ${row.keys}`).not.toContain("(");
			}
		}
		// Shell keeps the full list either way (default included).
		expect(desktopShortcuts(true).map((r) => r.name)).toEqual(MAC_NAMES);
		expect(desktopShortcuts(true, true).map((r) => r.name)).toEqual(MAC_NAMES);
	});

	it("uses Ctrl labels off-mac and drops the Mac-only capture rows", () => {
		const rows = desktopShortcuts(false);
		const macOnly = ["Capture window text", "Set capture area"];
		expect(rows.map((r) => r.name)).toEqual(
			MAC_NAMES.filter((n) => !macOnly.includes(n))
		);
		const keys = new Map(rows.map((r) => [r.name, r.keys]));
		expect(keys.get("Shortcuts")).toContain("Shift+?");
		expect(keys.get("Settings")).toBe("Shift+L · Ctrl+,");
		expect(keys.get("Search chats")).toBe("Ctrl+K · Ctrl+P");
		expect(keys.get("Delete")).toBe("Ctrl+Delete · Shift+D");
		expect(keys.get("Delete this chat")).toBe("Ctrl+Shift+Delete");
		expect(keys.get("Undo delete")).toBe("Ctrl+Z");
		expect(keys.get("Fullscreen")).toBe("F11");
		expect(keys.get("Edit newest message")).toBe("Ctrl+E");
		expect(keys.get("Text size")).toBe("Ctrl+Plus / Ctrl+Minus");
		expect(keys.get("Chat width")).toBe("Ctrl+Shift+Plus / Ctrl+Shift+Minus");
		expect(keys.get("Prompt text size")).toBe("Ctrl+[ / Ctrl+]");
		expect(keys.get("Prompt width")).toBe("Ctrl+Shift+[ / Ctrl+Shift+]");
	});

	it("never shows a Mac glyph or Meta key off-mac", () => {
		const text = desktopShortcuts(false, true, true)
			.map((r) => `${r.name} ${r.keys}`)
			.join("\n");
		for (const glyph of ["⌘", "⌥", "⇧", "Meta", "Cmd", "Option"]) {
			expect(text).not.toContain(glyph);
		}
	});

	it("lists the send-text chord in the Windows shell only", () => {
		const row = "Send selected text here";
		const names = (isMac: boolean, inShell: boolean, isWindows: boolean) =>
			desktopShortcuts(isMac, inShell, isWindows).map((r) => r.name);
		expect(names(false, true, true)).toContain(row);
		expect(names(false, false, true)).not.toContain(row);
		expect(names(false, true, false)).not.toContain(row);
		expect(names(true, true, false)).not.toContain(row);
	});

	it("never re-adds removed rows on either platform", () => {
		for (const isMac of [true, false]) {
			const names = desktopShortcuts(isMac).map((r) => r.name);
			for (const gone of REMOVED) expect(names).not.toContain(gone);
			const keys = desktopShortcuts(isMac)
				.map((r) => r.keys)
				.join("\n");
			expect(keys).not.toContain("again stops");
			expect(keys).not.toContain("past newest");
			expect(keys).not.toContain("Enter cycles");
		}
	});

	it("splits keys into chips on the middle dot", () => {
		expect(keyChips("⌘B · ⇧⌘H · J / K walk")).toEqual([
			"⌘B",
			"⇧⌘H",
			"J / K walk"
		]);
	});

	it("filters case-insensitively on name, keys, or section", () => {
		const rows = desktopShortcuts(true);
		expect(filteredShortcuts(rows, "")).toBe(rows);
		expect(filteredShortcuts(rows, "this chat").map((r) => r.name)).toEqual([
			"Delete this chat"
		]);
		expect(
			filteredShortcuts(desktopShortcuts(false), "CTRL+K").map((r) => r.name)
		).toEqual(["Search chats"]);
		expect(filteredShortcuts(rows, "zzz-no-such-row")).toEqual([]);
		expect(
			filteredShortcuts(rows, "hovered message").every(
				(r) => r.group === HOVER_GROUP
			)
		).toBe(true);
	});
});
