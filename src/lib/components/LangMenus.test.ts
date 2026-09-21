import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Reply-language pills render in LangMenus.svelte (hero and composer
 * call sites); the page keeps the open menu, the phone sheet anchor,
 * the active code, and every behavior. Both call sites share one
 * actions object (no call-site closures).
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

describe("language menus contract", () => {
	it("owns the pill row, lists, and badges from page-owned props", () => {
		const source = componentSource();
		expect(source).toContain("export interface LangMenusActions");
		expect(source).toContain('class="lang-menus"');
		expect(source).toContain('class="lang-menu"');
		expect(source).toContain('class="lang-list"');
		expect(source).toContain('class="badge"');
		expect(source).toContain("{#if openId === menu.id}");
		expect(source).toContain("inert={previewing}");
		expect(source).toContain("actions.toggle(menu.id, e.currentTarget)");
		expect(source).toContain("actions.pick(lang)");
	});

	it("keeps the open menu, anchor, code, and behaviors paged", () => {
		const page = pageSource();
		expect(page).toContain("<LangMenus");
		expect(page).toContain("actions={langMenusActions}");
		expect(page).toContain("function toggleLangMenu(");
		expect(page).toContain("pick: (lang: ReplyLanguage) =>");
		expect(page).not.toContain("{#snippet langMenus()}");
		expect(page).not.toContain("{@render langMenus()}");
	});

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
		expect(css).toContain(":global(.app[data-android]) .lang-menus");
		expect(css).toContain(":global(main.empty) .lang-menus");
	});
});
