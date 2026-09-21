import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Find-in-chat bar renders in FindBar.svelte; the page owns the find
 * object (query/cursor/hits), hit landing, and focus. Query and input
 * element cross as bindables (sidebar-search pattern): typing resets
 * the cursor and lands, Enter cycles or closes on a lone hit.
 */
function componentSource(): string {
	return readFileSync(new URL("./FindBar.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(new URL("../../routes/+page.svelte", import.meta.url), "utf8");
}

describe("find bar contract", () => {
	it("binds query and input while reading hits and cursor", () => {
		const source = componentSource();
		expect(source).toContain('query = $bindable("")');
		expect(source).toContain("inputEl = $bindable(undefined)");
		expect(source).toContain("bind:value={query}");
		expect(source).toContain("bind:this={inputEl}");
		// One hit is done (close with the bar); several cycle.
		expect(source).toContain("if (hitCount === 1) actions.close()");
	});

	it("renders the browser-style count text", () => {
		const source = componentSource();
		expect(source).toContain('"No matches"');
		expect(source).toContain("Math.min(cursor + 1, hitCount)");
		expect(source).toContain('aria-live="polite"');
	});

	it("delegates landing, cycling, and closing through actions", () => {
		const source = componentSource();
		expect(source).toContain("input: () => void");
		expect(source).toContain("enter: (shift: boolean) => void");
		expect(source).toContain("step: (dir: -1 | 1) => void");
		expect(source).toContain("close: () => void");
	});

	it("feeds the bar from the page behind its phone gate", () => {
		const page = pageSource();
		expect(page).toContain("<FindBar");
		expect(page).toContain("bind:query={find.query}");
		expect(page).toContain("bind:inputEl={findInputEl}");
		expect(page).toContain("hitCount={currentFindHits().length}");
		expect(page).toContain("step: stepFind,");
		expect(page).toContain("close: closeFind");
	});
});
