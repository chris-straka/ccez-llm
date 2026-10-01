import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The phone chat switcher's surfaces live in `ChatSwitcher.svelte`.
 * Svelte scoping binds CSS to the component that renders it, so a
 * paged rule would silently stop matching (see the toast
 * red-pairing regression that set this precedent). Shell chrome
 * (veil seating, card box) lives in `Modal.svelte`.
 */
function switcherSource(): string {
	return readFileSync(
		new URL("./ChatSwitcher.svelte", import.meta.url),
		"utf8"
	);
}

function modalSource(): string {
	return readFileSync(new URL("./Modal.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function switcherStyle(): string {
	const match = switcherSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("ChatSwitcher.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function modalStyle(): string {
	const match = modalSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("Modal.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("chat switcher surfaces", () => {
	it("keeps the switcher surfaces scoped to the components", () => {
		expect(switcherStyle()).toContain(".switcher-actions");
		expect(switcherStyle()).toContain(".switcher-arrow");
		expect(switcherStyle()).toContain(".switcher-pos");
		const modal = modalStyle();
		expect(modal).toMatch(/\.modal-veil\s*\{[^}]*position:\s*fixed/);
		expect(modal).toContain(".modal-veil.chat-switcher");
		expect(modal).toContain(".switcher-card");
		expect(pageStyle()).not.toContain(".switcher-actions");
		expect(pageStyle()).not.toContain(".switcher-card");
	});
});
