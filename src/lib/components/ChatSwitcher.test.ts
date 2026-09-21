import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The phone chat switcher renders from `ChatSwitcher.svelte` through
 * the shared `Modal.svelte` shell, not the page. The page owns chat
 * state and the open flag; the component owns the card, the
 * mint/delete actions, and their surfaces. Svelte scoping binds CSS
 * to the component that renders it, so the `.switcher-*` rules moved
 * with the markup — a paged rule would silently stop matching (see
 * the toast red-pairing regression that set this precedent). Shell
 * chrome (veil seating, card box) lives in `Modal.svelte`, which
 * renders those elements; the shared veil/box base stays paged until
 * the last dialog moves through the shell.
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

describe("chat switcher extraction", () => {
	it("renders the switcher from the component, not the page", () => {
		expect(switcherSource()).toContain('class="switcher-actions"');
		expect(switcherSource()).toContain('aria-label="Older chat"');
		expect(switcherSource()).toContain('aria-label="Newer chat"');
		expect(switcherSource()).toContain('aria-label="Delete chat"');
		// The box variant rides the shared shell as a class prop (the
		// box renders in Modal.svelte — a missing pass silently drops
		// the card class and its surface).
		expect(switcherSource()).toContain('cardClass="switcher-card"');
		expect(pageSource()).toContain("<ChatSwitcher");
		expect(pageSource()).not.toContain('class="switcher-actions"');
		expect(pageSource()).not.toContain('class="switcher-card"');
		expect(pageSource()).not.toContain("stepSwitcher(-1)");
	});

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
