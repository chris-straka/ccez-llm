import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Phone sidebar rows: no hover exists on touch, so the tooltip's
 * breakdown prints inline after the timestamp — and the export
 * button hides where no export path works (shell phone: no picker,
 * no native dialog bridge, clipboard denied).
 *
 * Asserts on source because the shell-phone branch (Tauri backend
 * present) never runs in jsdom or browser e2e: row markup moved to
 * Sidebar.svelte, while the page still wires the android/shell flags.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

function sidebarSource(): string {
	return readFileSync(new URL("../lib/components/Sidebar.svelte", import.meta.url), "utf8");
}

describe("phone sidebar rows", () => {
	it("shows a bare timestamp on phones, never a count suffix", () => {
		// The row used to print "· N msgs" after the timestamp, but
		// the suffix truncated into "· ..." on narrow rows — pure
		// noise beside the date. Rows render the timestamp alone.
		const source = pageSource();
		expect(source).not.toContain("visibleMessageCount");
		expect(source).not.toContain("side-count");
		expect(source).not.toContain('{n === 1 ? "msg" : "msgs"}');
		expect(source).not.toContain("sideTip(item) ||");
	});

	it("hides export where the shell phone has no export path", () => {
		const source = sidebarSource();
		expect(source).toMatch(/\{#if !\(android && shell\)\}[\s\S]*?class="exp"/);
		// The page feeds the gate from the same live flags the old
		// inline row read: no export path hides instead of failing.
		const page = pageSource();
		expect(page).toContain("android={androidUI}");
		expect(page).toContain("shell={tauriBackendAvailable()}");
	});
});
