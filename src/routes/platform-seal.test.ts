import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Platform seal: `data-android` means any phone (iOS included) while
 * `data-ios` is iOS-only, so the iOS divergences below must stay on
 * the iOS gate. Which OS a rule reaches is invisible to jsdom and to
 * desktop Playwright, so these assert on source.
 */
function bodySource(): string {
	return readFileSync(
		new URL("../lib/components/MessageBody.svelte", import.meta.url),
		"utf8"
	);
}

function appHtml(): string {
	return readFileSync(new URL("../app.html", import.meta.url), "utf8");
}

describe("platform seal", () => {
	it("keeps the iOS furigana nudge on its own override", () => {
		expect(bodySource()).toContain(":global(.app[data-ios]) .rendered :global(.frt)");
	});

	it("keeps the iOS pinyin fit on its own override", () => {
		expect(bodySource()).toContain(":global(.app[data-ios]) .rendered :global(rt)");
	});

	it("keeps the Android furigana nudge off the iOS gate", () => {
		expect(bodySource()).toContain(
			":global(.app[data-android]:not([data-ios])) .rendered :global(.frt)"
		);
	});

	it("keeps resizes-content on the viewport meta (keyboard glides, no pan)", () => {
		expect(appHtml()).toContain("interactive-widget=resizes-content");
	});
});
