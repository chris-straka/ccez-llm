import { describe, it, expect } from "vitest";
import { desktopShortcuts, filteredShortcuts, touchShortcuts } from "./shortcuts";

/**
 * Shortcuts-menu copy guard: removed rows kept finding their way back
 * into the modal, so the full list is pinned here (unit-fast) in
 * addition to the e2e pithiness spec. Edit this file deliberately when
 * the menu intentionally changes.
 */
const MAC_NAMES = [
	"Shortcuts show/hide",
	"Summon / hide window",
	"Switch model / key",
	"Thinking level",
	"Scroll",
	"Exit fullscreen",
	"Chat list",
	"Search chats",
	"Find in chat",
	"Fullscreen",
	"Newer / older chat",
	"New chat",
	"Voice readback on/off",
	"Pasted text expand/collapse",
	"Browser side panel",
	"Stop voice / close",
	"Speak text aloud",
	"Delete a message",
	"Fold / unfold message",
	"Fold / unfold code",
	"Rerun a prompt",
	"Reply language",
	"Delete this chat",
	"Delete every chat",
	"Cut message",
	"Edit own message",
	"Reading aid toggle",
	"prev/next stroke step",
	"Text size up / down",
	"Chat width + / −"
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
		expect(rows[0]?.keys).toContain("middle-click");
		expect(rows.find((r) => r.name === "Scroll")?.keys).toContain("h/l");
		expect(rows.find((r) => r.name === "Reply language")?.keys).toContain("⌘1, ⌘0");
		expect(rows.find((r) => r.name === "Speak text aloud")?.keys).toBe("Right-click");
	});

	it("uses Ctrl labels off-mac with the same row names", () => {
		const rows = desktopShortcuts(false);
		expect(rows.map((r) => r.name)).toEqual(MAC_NAMES);
		expect(rows[0]?.keys).toContain("Ctrl+Shift+/");
		expect(rows.find((r) => r.name === "Search chats")?.keys).toBe("Ctrl+P");
		expect(rows.find((r) => r.name === "Delete a message")?.keys).toBe("Hover + Shift+D");
	});

	it("never re-adds removed rows on either platform", () => {
		for (const isMac of [true, false]) {
			const names = desktopShortcuts(isMac).map((r) => r.name);
			for (const gone of REMOVED) expect(names).not.toContain(gone);
			const keys = desktopShortcuts(isMac).map((r) => r.keys).join("\n");
			expect(keys).not.toContain("again stops");
			expect(keys).not.toContain("past newest");
			expect(keys).not.toContain("Enter cycles");
		}
	});

	it("keeps entry copy paren-free (the e2e pithiness contract)", () => {
		for (const row of [...desktopShortcuts(true), ...desktopShortcuts(false), ...touchShortcuts()]) {
			expect(`${row.name}: ${row.keys}`).not.toContain("(");
		}
	});

	it("pins the touch gestures list", () => {
		expect(touchShortcuts().map((r) => r.name)).toEqual([
			"Chats list",
			"Fold chats list",
			"Settings",
			"Newer / older chat",
			"Delete current chat",
			"Delete every chat",
			"Annotate",
			"Message buttons",
			"Fold a message"
		]);
	});

	it("filters case-insensitively on name or keys", () => {
		const rows = desktopShortcuts(true);
		expect(filteredShortcuts(rows, "")).toBe(rows);
		expect(filteredShortcuts(rows, "delete every").map((r) => r.name)).toEqual([
			"Delete every chat"
		]);
		expect(
			filteredShortcuts(desktopShortcuts(false), "CTRL+P").map((r) => r.name)
		).toEqual(["Search chats"]);
		expect(filteredShortcuts(rows, "zzz-no-such-row")).toEqual([]);
	});
});
