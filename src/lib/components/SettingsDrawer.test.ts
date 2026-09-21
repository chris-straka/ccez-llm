import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Settings drawer shell renders in SettingsDrawer.svelte; the page
 * keeps the open flag, the settings object, token labels, and every
 * behavior. The panel node crosses as $bindable (page focus
 * bookkeeping reads it).
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
	return readFileSync(new URL("../../routes/+page.svelte", import.meta.url), "utf8");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("settings drawer contract", () => {
	it("owns the drawer shell, inner, and panel usage", () => {
		const source = componentSource();
		expect(source).toContain("export interface SettingsDrawerActions");
		expect(source).toContain('class="settings-panel"');
		expect(source).toContain("class:closed={!open}");
		expect(source).toContain('class="settings-inner"');
		expect(source).toContain("inert={!open}");
		expect(source).toContain("<SettingsPanel");
		expect(source).toContain("bind:this={panelEl}");
		expect(source).toContain("actions.drawerClose()");
	});

	it("keeps the open flag, settings, labels, and behaviors paged", () => {
		const page = pageSource();
		expect(page).toContain("<SettingsDrawer");
		expect(page).toContain("open={settingsOpen}");
		expect(page).toContain("bind:panelEl={settingsEl}");
		expect(page).toContain("drawerClose: () => {");
		expect(page).toContain("panelClose: () => {");
		expect(page).not.toContain("<SettingsPanel");
	});

	it("keeps no drawer selector in page style", () => {
		const css = pageStyle();
		for (const selector of [
			".settings-panel",
			".settings-inner"
		]) {
			expect(css, selector).not.toContain(selector);
		}
	});

	it("keeps the drawer surfaces scoped to the shell", () => {
		const css = componentStyle();
		expect(css).toContain(".settings-panel {");
		expect(css).toContain(".settings-panel.closed");
		expect(css).toContain(".settings-inner");
		expect(css).toContain(
			":global(.app[data-android]) .settings-panel"
		);
		expect(css).toContain(".settings-panel[data-fade-scroll]");
	});
});
