import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * The middle-click shortcuts toggle must interrupt speech: opening a
 * modal over talking audio strands the voice with no visible stop
 * (Esc already interrupts the same way). Headless has no speech
 * engine, so this asserts on +page.svelte's source the way
 * actions-reveal.test.ts does for untestable-in-jsdom behavior.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

describe("middle-click shortcuts toggle", () => {
	it("interrupts speech when toggling the modal", () => {
		const source = pageSource();
		const toggle = source.match(
			/const onMiddleClick = \(event: MouseEvent\) => \{([\s\S]*?)\n\t\t\};/
		);
		expect(
			toggle,
			"onMiddleClick is gone or reshaped — keep the speech interrupt with it"
		).toBeTruthy();
		expect(toggle![1]).toContain("stopVoice()");
	});
});
