import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Waypoint jump menu renders in Waypoints.svelte; the page keeps the
 * open flag (shared with the composer trigger and keyboard nav), the
 * wrap node, the points, and jump. The wrap node crosses as $bindable
 * (page keyboard nav and nearness read it); the swipe-start Y stays
 * component-local (only the sheet gesture reads it).
 */
function componentSource(): string {
	return readFileSync(new URL("./Waypoints.svelte", import.meta.url), "utf8");
}

function componentStyle(): string {
	const source = componentSource();
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("Waypoints.svelte has no <style> block");
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

describe("waypoints contract", () => {
	it("owns the nav, ticks, menu, and sheet from page-owned props", () => {
		const source = componentSource();
		expect(source).toContain("export interface WaypointsActions");
		expect(source).toContain('aria-label="Waypoints"');
		expect(source).toContain('class="wp-btn"');
		expect(source).toContain('class="wp-tick"');
		expect(source).toContain('class="wp-menu"');
		expect(source).toContain('class="wp-veil"');
		expect(source).toContain('class="wp-sheet-head"');
		expect(source).toContain('class="wp-dot"');
		expect(source).toContain("{#if points.length > 3 && !settingsOpen && !previewing}");
		expect(source).toContain("waypointLabel(target?.content");
	});

	it("binds the open flag and wrap node the page drives", () => {
		const source = componentSource();
		expect(source).toContain("open = $bindable(false)");
		expect(source).toContain("wrapEl = $bindable()");
		expect(source).toContain("bind:this={wrapEl}");
	});

	it("keeps open state, points, and jump paged", () => {
		const page = pageSource();
		expect(page).toContain("<Waypoints");
		expect(page).toContain("bind:open={wpOpen}");
		expect(page).toContain("bind:wrapEl={wpWrap}");
		expect(page).toContain("function jumpTo(");
		expect(page).toContain('closest(".wp-wrap")');
	});

	it("keeps no waypoint selector in page style", () => {
		const css = pageStyle();
		for (const selector of [
			".wp-wrap",
			".wp-btn",
			".wp-tick",
			".wp-menu",
			".wp-veil",
			".wp-sheet-head",
			".wp-dot",
			"wp-sheet-in",
			'nav[aria-label="Waypoints"]'
		]) {
			expect(css, selector).not.toContain(selector);
		}
	});

	it("keeps the waypoint surfaces scoped to the nav", () => {
		const css = componentStyle();
		expect(css).toContain('nav[aria-label="Waypoints"]');
		expect(css).toContain(".wp-wrap.open .wp-menu");
		expect(css).toContain("@keyframes wp-sheet-in");
		expect(css).toContain(".wp-wrap:global(.wp-near) .wp-btn");
	});
});
