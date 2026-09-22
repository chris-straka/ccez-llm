import { describe, it, expect } from "vitest";
import {
	desktopShortcuts,
	filteredShortcuts,
	touchShortcuts
} from "./shortcuts";

/**
 * Shortcuts-menu copy guard: removed rows kept finding their way back
 * into the modal, so the full list is pinned here (unit-fast) in
 * addition to the e2e pithiness spec. Edit this file deliberately when
 * the menu intentionally changes.
 */
// A-Z (case-insensitive): shortcuts.ts sorts at return, so this pins
// the sorted order, not the source order.
const MAC_NAMES = [
	"Branch from here",
	"Chat list",
	"Chat width + / −",
	"Copy message",
	"Cut message",
	"Delete a message",
	"Delete this chat",
	"Edit own message",
	"Exit fullscreen",
	"Find in chat",
	"Fold / unfold code",
	"Fold / unfold message",
	"Fold message by drag",
	"Fullscreen",
	"New chat",
	"Newer / older chat",
	"Pasted text expand/collapse",
	"prev/next stroke step",
	"Reading aid toggle",
	"Reply language",
	"Rerun a prompt",
	"Scroll",
	"Search chats",
	"Shortcuts show/hide",
	"Speak message",
	"Speak text aloud",
	"Stop voice / close",
	"Summon / hide window",
	"Switch chat by drag",
	"Switch model / key",
	"Text size up / down",
	"Thinking level",
	"Voice readback on/off"
];

/** Rows deliberately removed — asserting absence, not presence. */
const REMOVED = [
	"New line",
	"Stage message",
	"Scroll messages",
	"Export chat",
	"Translate selection"
];

describe("shortcuts menu copy", () => {
	it("pins the exact mac list in order", () => {
		const rows = desktopShortcuts(true);
		expect(rows.map((r) => r.name)).toEqual(MAC_NAMES);
		expect(rows.find((r) => r.name === "Shortcuts show/hide")?.keys).toContain(
			"middle-click"
		);
		expect(rows.find((r) => r.name === "Scroll")?.keys).toContain("h/l");
		expect(rows.find((r) => r.name === "Reply language")?.keys).toContain(
			"⌘1, ⌘0"
		);
		expect(rows.find((r) => r.name === "Speak text aloud")?.keys).toBe(
			"Right-click"
		);
	});

	it("drops browser-dead rows on the web, still A-Z", () => {
		const gone = [
			"Search chats",
			"Find in chat",
			"Reply language",
			"Text size up / down",
			"Chat width + / −",
			"New chat"
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

	it("uses Ctrl labels off-mac with the same row names", () => {
		const rows = desktopShortcuts(false);
		expect(rows.map((r) => r.name)).toEqual(MAC_NAMES);
		expect(rows.find((r) => r.name === "Shortcuts show/hide")?.keys).toContain(
			"Ctrl+Shift+/"
		);
		expect(rows.find((r) => r.name === "Search chats")?.keys).toBe("Ctrl+P");
		expect(rows.find((r) => r.name === "Delete a message")?.keys).toBe(
			"Hover + Shift+D"
		);
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
		expect(touchShortcuts().map((r) => r.name)).toEqual([
			"Annotate",
			"Bottom of chat",
			"Chat switcher",
			"Chats list",
			"Copy selection",
			"Delete a message",
			"Delete this chat",
			"Fold a message",
			"fold chat msg",
			"Inspect character",
			"Keep an annotation while scrolling",
			"Message buttons",
			"Message end",
			"Move the selection menu",
			"Newer / older chat",
			"Settings",
			"Speak selection",
			"Top of chat"
		]);
		// Message-start left strokes fold (never settings); everywhere
		// else one finger opens it too. Chat steps moved to three
		// fingers so two-finger right can summon the list, and the
		// vertical slides read as gg / G.
		const byName = new Map(touchShortcuts().map((r) => [r.name, r.keys]));
		expect(byName.get("Chats list")).toBe(
			"Swipe right · two-finger swipe right"
		);
		expect(byName.get("Chat switcher")).toBe(
			"Two-finger hold · double-tap empty space · swipe cycles · loops"
		);
		expect(byName.get("Settings")).toBe(
			"Swipe left off messages · chats list button · two-finger swipe left"
		);
		expect(byName.get("Newer / older chat")).toBe(
			"Three-finger swipe left / right"
		);
		expect(byName.get("Top of chat")).toBe("Two-finger swipe up · gg");
		expect(byName.get("Bottom of chat")).toBe("Two-finger swipe down · G");
		expect(byName.get("Message end")).toBe("Double two-finger tap");
		expect(byName.get("Delete a message")).toBe("Three-finger tap");
		expect(byName.get("Delete this chat")).toBe("Three-finger hold");
		expect(byName.get("Copy selection")).toBe("Select text · Copy");
	});

	it("filters case-insensitively on name or keys", () => {
		const rows = desktopShortcuts(true);
		expect(filteredShortcuts(rows, "")).toBe(rows);
		expect(filteredShortcuts(rows, "this chat").map((r) => r.name)).toEqual([
			"Delete this chat"
		]);
		expect(
			filteredShortcuts(desktopShortcuts(false), "CTRL+P").map((r) => r.name)
		).toEqual(["Search chats"]);
		expect(filteredShortcuts(rows, "zzz-no-such-row")).toEqual([]);
	});
});
