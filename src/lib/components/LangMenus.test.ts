import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Reply-language pill surfaces live in LangMenus.svelte; no pill
 * selector stays paged. The badge box fixes its own metrics so
 * fallback-font glyphs can't stretch it.
 */
function componentSource(): string {
	return readFileSync(new URL("./LangMenus.svelte", import.meta.url), "utf8");
}

function componentStyle(): string {
	const source = componentSource();
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("LangMenus.svelte has no <style> block");
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

describe("language menus surfaces", () => {
	it("keeps no pill selector in page style", () => {
		const css = pageStyle();
		for (const selector of [
			".lang-menus",
			".lang-menu",
			".lang-list",
			".badge"
		]) {
			expect(css, selector).not.toContain(selector);
		}
	});

	it("keeps the pill surfaces scoped to the row", () => {
		const css = componentStyle();
		expect(css).toContain(".lang-menus");
		expect(css).toContain(".lang-menu > button:hover");
		expect(css).toContain(".lang-list button.selected");
		expect(css).toContain(".badge");
		expect(css).toContain(".lang-list-fixed");
		expect(css).toContain(":global(.app[data-android]) .lang-menus");
		expect(css).toContain(":global(.empty-state) .lang-menus");
		expect(css).toContain(":global(main.empty) .lang-menus");
	});

	it("fixes the badge metric box so fallback glyphs can't stretch it", () => {
		// Cuneiform badges (sux/akk) render in a fallback font with
		// taller metrics than flag emoji: the box must fix its own
		// line box and clip, never follow the glyph.
		const css = componentStyle();
		const badge = css.match(/\.badge\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(badge).toContain("line-height:");
		expect(badge).toContain("overflow:");
		expect(badge).toContain("vertical-align:");
	});
});
