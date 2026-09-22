import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Empty-chat hero renders in EmptyHero.svelte; the page keeps
 * emptiness and the pills. Pills cross as a children snippet so
 * their props stay with their own usage, not drilled through
 * the hero.
 */
function componentSource(): string {
	return readFileSync(new URL("./EmptyHero.svelte", import.meta.url), "utf8");
}

function componentStyle(): string {
	const source = componentSource();
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("EmptyHero.svelte has no <style> block");
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

describe("empty hero contract", () => {
	it("owns the hero markup and the pills slot", () => {
		const source = componentSource();
		expect(source).toContain('class="empty-state"');
		expect(source).toContain('class="hero"');
		expect(source).toContain("What can I do for you?");
		expect(source).toContain('class="mock-note"');
		expect(source).toContain("{#if mock}");
		expect(source).toContain("{@render children()}");
	});

	it("keeps emptiness and the pills paged", () => {
		const page = pageSource();
		expect(page).toContain("<EmptyHero mock={useMock}>");
		expect(page).toContain("{#if viewChat.messages.length === 0}");
	});

	it("keeps no hero selector in page style", () => {
		const css = pageStyle();
		for (const selector of [".empty-state", ".hero", "mock-note"]) {
			expect(css, selector).not.toContain(selector);
		}
	});

	it("keeps the hero surfaces scoped to the hero", () => {
		const css = componentStyle();
		expect(css).toContain(".empty-state");
		expect(css).toContain(".hero");
		expect(css).toContain(".mock-note");
	});
});
