import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Phone sidebar rows: no hover exists on touch, so the tooltip's
 * breakdown prints inline after the timestamp — and the export
 * button hides where no export path works (shell phone: no picker,
 * no native dialog bridge, clipboard denied).
 *
 * Asserts on +page.svelte source because the shell-phone branch
 * (Tauri backend present) never runs in jsdom or browser e2e.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

describe("phone sidebar rows", () => {
	it("prints a short visible-message count after the timestamp on phones", () => {
		// The row shows "· N msgs" (never the tooltip's full split,
		// which truncated into "..."), skipping empty chats, and the
		// in-flight empty placeholder never counts.
		const source = pageSource();
		expect(source).toContain("visibleMessageCount(chatState, item)");
		expect(source).toContain('{n === 1 ? "msg" : "msgs"}');
		expect(source).not.toContain("sideTip(item) ||");
	});

	it("hides export where the shell phone has no export path", () => {
		const source = pageSource();
		expect(source).toMatch(
			/\{#if !\(androidUI && tauriBackendAvailable\(\)\)\}[\s\S]*?class="exp"/
		);
	});
});
