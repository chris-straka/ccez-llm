import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The selection readings panels (flat pinyin + furigana groups) render
 * from `Readings.svelte`, not the page. The page owns placement,
 * tracking, and dismiss; the component owns the panels and their
 * surfaces. Svelte scoping binds CSS to the component that renders
 * it, so the `.sel-pinyin` rules moved with the markup — a paged
 * rule would silently stop matching (see the toast red-pairing
 * regression that set this precedent). The document tint
 * (`.rendered .frbtN`) stays paged: it styles message content, and
 * `:global` rules match regardless of host.
 */
function readingsSource(): string {
	return readFileSync(new URL("./Readings.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function readingsStyle(): string {
	const match = readingsSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("Readings.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function answerStyle(): string {
	const source = readFileSync(
		new URL("./AnnAnswer.svelte", import.meta.url),
		"utf8"
	);
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("AnnAnswer.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function zIndexOf(style: string, selector: string): number {
	const match = style.match(
		new RegExp(`${selector}\\s*\\{[^}]*z-index:\\s*(\\d+)`)
	);
	if (!match) throw new Error(`${selector} has no z-index`);
	return Number(match[1]);
}

describe("readings panels extraction", () => {
	it("renders the panels from the component, not the page", () => {
		expect(readingsSource()).toContain('class="sel-pinyin"');
		expect(readingsSource()).toContain("{@html pinyin.html}");
		expect(readingsSource()).toContain("pk{run.color}");
		// The page keeps placement helpers (liftSelMenuAboveReadings
		// reads ".sel-pinyin.above") and the document tint, but no
		// panel element of its own.
		expect(pageSource()).toContain("<Readings");
		expect(pageSource()).not.toContain('class="sel-pinyin"');
		expect(pageSource()).toContain(".rendered .frbt0");
	});

	it("keeps the panel surfaces scoped to the component", () => {
		const css = readingsStyle();
		expect(css).toMatch(/\.sel-pinyin\s*\{[^}]*position:\s*fixed/);
		expect(css).toContain(".sel-pinyin.above");
		expect(css).toContain(".sel-pinyin .pk3 .srt");
		// Panel type rides the chat text size, never a fixed rem.
		expect(css).toMatch(
			/\.sel-pinyin\s*\{[^}]*font-size:\s*calc\(0\.85rem \* var\(--font-scale/
		);
		expect(pageStyle()).not.toMatch(/\.sel-pinyin\s*\{/);
		expect(pageStyle()).not.toContain(".sel-pinyin .spr");
	});

	it("paints above the answer card", () => {
		// The card hangs over the highlight it answers; the readings
		// for that same highlight must stay visible above it (below
		// app chrome like toasts).
		const panels = zIndexOf(readingsStyle(), "\\.sel-pinyin");
		const card = zIndexOf(answerStyle(), "\\.ann-answer");
		expect(panels).toBeGreaterThan(card);
	});

	it("rides the popup-size setting on top of message text", () => {
		expect(readingsStyle()).toMatch(
			/font-size:\s*calc\(0\.85rem \* var\(--font-scale, 1\) \* var\(--annpop-scale, 1\)\)/
		);
	});
});
