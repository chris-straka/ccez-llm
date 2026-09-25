import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Weak-capture overlay contract: the staged read is editable in place,
 * Enter files it to chat (never mid-IME-composition), Esc stays on
 * the page ladder (which also returns focus). Layout is invisible to
 * jsdom, so this asserts on source like the other component contracts.
 */
function overlaySource(): string {
	return readFileSync(new URL("./CaptureOverlay.svelte", import.meta.url), "utf8");
}

describe("capture overlay", () => {
	it("renders the staged read editable with its confidence", () => {
		const source = overlaySource();
		expect(source).toContain('role="dialog"');
		expect(source).toContain('aria-label="Weak capture"');
		expect(source).toContain("Math.round(confidence * 100)");
		expect(source).toContain("bind:value={draft}");
		// Focused on mount (no autofocus attribute: the a11y lint
		// forbids it, and the fill shares the same effect).
		expect(source).toContain("input?.focus()");
	});

	it("files on Enter but never mid-composition", () => {
		const source = overlaySource();
		expect(source).toContain('event.key === "Enter"');
		expect(source).toContain("!event.isComposing");
		expect(source).toContain("actions.confirm(draft)");
		expect(source).toContain("file it to chat");
	});

	it("exposes file and cancel with no Esc of its own", () => {
		const source = overlaySource();
		// Esc rides the page ladder (which returns focus); a second
		// handler here would double-dismiss against it.
		expect(source).not.toContain("Escape");
		expect(source).toContain("actions.confirm(draft)");
		expect(source).toContain("actions.dismiss()");
	});
});
