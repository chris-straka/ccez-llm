import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Per-message action row surfaces live in MessageActions.svelte;
 * paged main/article ancestors stay `:global` so the row's reveal
 * rules still match.
 */
function componentSource(): string {
	return readFileSync(
		new URL("./MessageActions.svelte", import.meta.url),
		"utf8"
	);
}

describe("message actions surfaces", () => {
	it("keeps paged reveal ancestors global", () => {
		const source = componentSource();
		expect(source).toContain(":global(main.hover-user)");
		expect(source).toContain(":global(article.user)");
		expect(source).toContain(":global(main.hide-messages)");
		expect(source).toContain(":global(.app[data-android])");
		expect(source).toContain(":global(main.scale-actions)");
	});
});
