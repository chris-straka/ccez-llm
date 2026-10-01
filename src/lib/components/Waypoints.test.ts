import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Waypoint jump menu surfaces live in Waypoints.svelte; no waypoint
 * selector stays paged.
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

describe("waypoints surfaces", () => {
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
