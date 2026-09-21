import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The floating selection menu (Annotate/Copy/Inspect) renders from
 * `SelMenu.svelte`, not the page. The page owns the menu state,
 * placement, drag, and idle-dismiss; the component owns the buttons
 * and their surfaces. Svelte scoping binds CSS to the component that
 * renders it, so the `.sel-menu` rules moved with the markup — a
 * paged rule would silently stop matching (see the toast red-pairing
 * regression that set this precedent).
 */
function selMenuSource(): string {
	return readFileSync(new URL("./SelMenu.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function selMenuStyle(): string {
	const match = selMenuSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("SelMenu.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("selection menu extraction", () => {
	it("renders the menu from the component, not the page", () => {
		expect(selMenuSource()).toContain('role="menu"');
		expect(selMenuSource()).toContain(">Annotate</button");
		expect(selMenuSource()).toContain(">Copy</button");
		expect(selMenuSource()).toContain(">Inspect</button");
		// The page keeps JS guard strings (closest(".sel-menu")) but no
		// menu element of its own (other role="menu" elements — the
		// language and waypoint menus — are later seams).
		expect(pageSource()).not.toContain('class="sel-menu"');
		expect(pageSource()).not.toContain("sel-menu-drag={");
	});

	it("keeps the menu surfaces scoped to the component", () => {
		const css = selMenuStyle();
		expect(css).toMatch(/\.sel-menu\s*\{[^}]*position:\s*fixed/);
		expect(css).toContain(".sel-menu button");
		expect(css).toContain(".sel-menu.sel-menu-drag");
		expect(pageStyle()).not.toMatch(/\.sel-menu\s*\{/);
	});
});
