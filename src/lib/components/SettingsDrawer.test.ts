import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Settings drawer surfaces live in SettingsDrawer.svelte; no drawer
 * selector stays paged.
 */
function componentSource(): string {
	return readFileSync(
		new URL("./SettingsDrawer.svelte", import.meta.url),
		"utf8"
	);
}

function componentStyle(): string {
	const source = componentSource();
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("SettingsDrawer.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("settings drawer surfaces", () => {
	it("keeps no drawer selector in page style", () => {
		const css = pageStyle();
		for (const selector of [".settings-panel", ".settings-inner"]) {
			expect(css, selector).not.toContain(selector);
		}
	});

	it("keeps the drawer surfaces scoped to the shell", () => {
		const css = componentStyle();
		expect(css).toContain(".settings-panel {");
		expect(css).toContain(".settings-panel.closed");
		expect(css).toContain(".settings-inner");
		expect(css).toContain(":global(.app[data-android]) .settings-panel");
		expect(css).toContain(".settings-panel[data-fade-scroll]");
	});
});
