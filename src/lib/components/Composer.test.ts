import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Composer card renders in Composer.svelte; the page keeps the editor
 * instance, all composer state, and every behavior. Element refs the
 * page drives (editor mount node, send-button geometry) cross as
 * $bindable, like Sidebar's search/searchEl. The file input lives
 * with the card (the page never touches it); the inline attach error
 * stays paged in the shared `.error` look.
 */
function componentSource(): string {
	return readFileSync(new URL("./Composer.svelte", import.meta.url), "utf8");
}

function componentStyle(): string {
	const source = componentSource();
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("Composer.svelte has no <style> block");
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

describe("composer contract", () => {
	it("owns the card, tools, send, and banner from page-owned props", () => {
		const source = componentSource();
		expect(source).toContain("export interface ComposerActions");
		expect(source).toContain('class="prompt"');
		expect(source).toContain('class="prompt-tools"');
		expect(source).toContain('class="send-btn"');
		expect(source).toContain('class="attach-btn"');
		expect(source).toContain('class="mic-btn"');
		expect(source).toContain('class="voice-float"');
		expect(source).toContain('class="wp-jump"');
		expect(source).toContain('class="error-banner"');
		expect(source).toContain('class="hidden-input"');
		expect(source).toContain("<ReviewDock");
		// Gates ride props, not page state.
		expect(source).toContain("class:prompt-idle={parked}");
		expect(source).toContain("disabled={!canSubmit && !hasAnnEdit}");
		expect(source).toContain("{#if banner && !android}");
		expect(source).toContain("{#if canMic && micEnabled}");
	});

	it("binds the editor mount and send geometry nodes", () => {
		const source = componentSource();
		expect(source).toContain("promptEl = $bindable()");
		expect(source).toContain("sendBtnEl = $bindable(null)");
		expect(source).toContain("bind:this={promptEl}");
		expect(source).toContain("bind:this={sendBtnEl}");
	});

	it("keeps the editor instance and every behavior paged", () => {
		const page = pageSource();
		expect(page).toContain("<Composer");
		expect(page).toContain("bind:promptEl");
		expect(page).toContain("bind:sendBtnEl");
		expect(page).toContain("createTextareaEditor(promptEl,");
		expect(page).toContain("function promptParked()");
		expect(page).toContain("intakeFiles:");
		expect(page).toContain("holdStart:");
		// The inline error stays paged in the shared error look.
		expect(page).toContain('class="error attach-error"');
	});

	it("keeps no composer selector in page style", () => {
		const css = pageStyle();
		for (const selector of [
			".prompt",
			".send-btn",
			".prompt-tools",
			".error-banner",
			".ann-dock",
			"hidden-input",
			"wp-jump",
			"attach-btn",
			"mic-btn",
			"voice-float",
			"send-hold"
		]) {
			expect(css, selector).not.toContain(selector);
		}
		// The in-place message editor keeps its own field rules.
		expect(css).toContain(".msg-edit-box :global(.ta-input)");
	});

	it("keeps the composer surfaces scoped to the card", () => {
		const css = componentStyle();
		expect(css).toContain(":global(.app[data-android]) .prompt");
		expect(css).toContain(".send-btn");
		expect(css).toContain(".prompt-tools");
		expect(css).toContain(".error-banner");
	});
});
