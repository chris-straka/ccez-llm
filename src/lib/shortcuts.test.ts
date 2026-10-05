import { describe, it, expect } from "vitest";
import {
	desktopShortcuts,
	filteredShortcuts,
	groupShortcuts,
	HOVER_GROUP,
	keyChips,
	touchShortcuts
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
			"Edit your message",
			"Cut",
			"Branch from here",
			"Trim above here",
			"Jump to its start / end",
			"Delete"
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
			"Delete this chat"
		]
	],
	[
		"Prompt & model",
		[
			"Edit newest message",
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
			"Stop voice / close",
			"Reading aids",
			"Stroke order step",
			"Flashcards",
			"Capture window text",
			"Set capture area"
		]
	],
	[
		"Mouse & selection",
		[
			"Speak text aloud",
			"Annotate and send",
			"Select sentence / paragraph",
			"Delete annotation",
			"Pin / unpin annotation",
			"Fold / unfold code"
		]
	],
	["Scrolling", ["Scroll", "Scroll further", "Half page", "Top / bottom"]],
	[
		"Window & view",
		[
			"Shortcuts",
			"Summon / hide window",
			"Fullscreen",
			"Exit fullscreen",
			"Text size",
			"Chat width",
			"Prompt text size",
			"Prompt width"
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
	it("pins the exact mac list in section order", () => {
		const rows = desktopShortcuts(true);
		expect(rows.map((r) => r.name)).toEqual(MAC_NAMES);
		expect(
			groupShortcuts(rows).map((g) => [g.group, g.rows.map((r) => r.name)])
		).toEqual(MAC_SECTIONS);
		const keys = new Map(rows.map((r) => [r.name, r.keys]));
		expect(keys.get("Shortcuts")).toContain("middle-click");
		expect(keys.get("Reply language")).toContain("⌘1 – ⌘0");
		expect(keys.get("Speak text aloud")).toBe("Right-click");
		expect(keys.get("Capture window text")).toBe("⇧⌘O");
		expect(keys.get("Set capture area")).toBe("⇧⌘U");
		expect(keys.get("Fullscreen")).toBe("Ctrl+⌘F");
		expect(keys.get("Edit newest message")).toBe("⌘E");
		expect(keys.get("Delete")).toBe("⌘Delete · ⌘D · Shift+D");
		expect(keys.get("Delete this chat")).toBe("⇧⌘Delete");
		// Hover is the section's premise: its keys never repeat it.
		for (const row of rows.filter((r) => r.group === HOVER_GROUP))
			expect(row.keys).not.toMatch(/hover/i);
	});

	it("names rows in sentence case", () => {
		for (const row of [...desktopShortcuts(true), ...touchShortcuts()])
			expect(row.name[0]).toBe(row.name[0]?.toUpperCase());
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
			"Flashcards"
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
		expect(desktopShortcuts(true, true).map((r) => r.name)).toEqual(
			MAC_NAMES
		);
	});

	it("hides the Flashcards row when flashcards are off", () => {
		const names = desktopShortcuts(true, true, false).map((r) => r.name);
		expect(names).toEqual(MAC_NAMES.filter((n) => n !== "Flashcards"));
	});

	it("uses Ctrl labels off-mac with the same row names", () => {
		const rows = desktopShortcuts(false);
		expect(rows.map((r) => r.name)).toEqual(MAC_NAMES);
		const keys = new Map(rows.map((r) => [r.name, r.keys]));
		expect(keys.get("Shortcuts")).toContain("Ctrl+Shift+/");
		expect(keys.get("Search chats")).toBe("Ctrl+P");
		expect(keys.get("Delete")).toBe("Ctrl+Delete · Shift+D");
		expect(keys.get("Delete this chat")).toBe("Ctrl+Shift+Delete");
		expect(keys.get("Fullscreen")).toBe("Ctrl+Meta+F");
		expect(keys.get("Edit newest message")).toBe("Meta+E");
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

	it("keeps entry copy paren-free (the e2e pithiness contract)", () => {
		for (const row of [
			...desktopShortcuts(true),
			...desktopShortcuts(false),
			...touchShortcuts()
		]) {
			expect(`${row.name}: ${row.keys}`).not.toContain("(");
		}
	});

	it("pins the touch gestures list", () => {
		expect(
			groupShortcuts(touchShortcuts()).map((g) => [
				g.group,
				g.rows.map((r) => r.name)
			])
		).toEqual([
			[
				"Moving around",
				[
					"Chats list",
					"Quick switcher",
					"Search chats",
					"Newer / older chat",
					"Top of chat",
					"Bottom of chat",
					"Settings",
					"Rename a chat"
				]
			],
			[
				"Messages",
				[
					"Message buttons",
					"Text size",
					"Fold a message",
					"Delete a message",
					"Delete this chat"
				]
			],
			[
				"Selected text",
				[
					"Select a word",
					"Annotate",
					"Copy",
					"Speak",
					"Inspect character",
					"Move the selection menu",
					"Pin / unpin annotation",
					"Cancel an annotation"
				]
			]
		]);
		const byName = new Map(touchShortcuts().map((r) => [r.name, r.keys]));
		expect(byName.get("Chats list")).toBe(
			"Swipe right · two-finger swipe right"
		);
		expect(byName.get("Quick switcher")).toBe(
			"Two-finger hold · double-tap empty space · swipe to cycle"
		);
		expect(byName.get("Settings")).toBe(
			"Swipe left off messages · two-finger swipe left · chats list button"
		);
		expect(byName.get("Newer / older chat")).toBe(
			"Three-finger swipe left / right"
		);
		// Phones list gestures only: gg / G are keyboard keys.
		expect(byName.get("Top of chat")).toBe("Two-finger swipe up");
		expect(byName.get("Bottom of chat")).toBe("Two-finger swipe down");
		expect(byName.get("Delete a message")).toBe("Three-finger tap");
		expect(byName.get("Delete this chat")).toBe("Three-finger hold");
		expect(byName.get("Copy")).toBe("Select text, then Copy");
		expect(byName.get("Pin / unpin annotation")).toBe("Double-tap badge");
		const all = touchShortcuts().map((r) => r.keys).join("\n");
		expect(all).not.toMatch(/\bgg\b|hover/i);
	});

	it("splits keys into chips on the middle dot", () => {
		expect(keyChips("⌘B · ⇧⌘H · J / K walk")).toEqual(["⌘B", "⇧⌘H", "J / K walk"]);
	});

	it("filters case-insensitively on name, keys, or section", () => {
		const rows = desktopShortcuts(true);
		expect(filteredShortcuts(rows, "")).toBe(rows);
		expect(filteredShortcuts(rows, "this chat").map((r) => r.name)).toEqual([
			"Delete this chat"
		]);
		expect(
			filteredShortcuts(desktopShortcuts(false), "CTRL+P").map((r) => r.name)
		).toEqual(["Search chats"]);
		expect(filteredShortcuts(rows, "zzz-no-such-row")).toEqual([]);
		expect(
			filteredShortcuts(rows, "hovered message").every(
				(r) => r.group === HOVER_GROUP
			)
		).toBe(true);
	});
});
