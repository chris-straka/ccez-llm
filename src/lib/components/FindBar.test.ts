import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Find-in-chat bar count text: browser-style "No matches" / "n of m"
 * in a polite live region.
 */
function componentSource(): string {
	return readFileSync(new URL("./FindBar.svelte", import.meta.url), "utf8");
}

describe("find bar count text", () => {
	it("renders the browser-style count text", () => {
		const source = componentSource();
		expect(source).toContain('"No matches"');
		expect(source).toContain("Math.min(cursor + 1, hitCount)");
		expect(source).toContain('aria-live="polite"');
	});
});
