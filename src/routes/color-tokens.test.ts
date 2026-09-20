import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Color-token invariants (see docs/colors.md): component styles name
 * tokens instead of hardcoding accents, so the palette keeps one
 * source of truth in src/app.css. jsdom cannot see paint, so these
 * assert on source instead.
 */
function styleOf(path: string): string {
	const source = readFileSync(new URL(path, import.meta.url), "utf8");
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error(`${path} has no <style> block`);
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Accent hexes that may only appear as a fallback line (hex, then the
var() line) or a token definition — never as the final word. */
const PAIRED = [
	"007aff",
	"5a9bf7",
	"0a84ff",
	"ff3b30",
	"ff6b62",
	"fdecea",
	"3d1008",
	"ffb4a2",
	"e0a392",
	"7a2a1c",
	"c0362c",
	"fafafc",
	"e6f4ea",
	"12351f"
];

/** Lines carrying a paired hex whose next line is not the var() twin. */
function unpairedHexLines(css: string): string[] {
	const lines = css.split("\n");
	const hex = new RegExp(`#(?:${PAIRED.join("|")})\\b`, "i");
	const bad: string[] = [];
	lines.forEach((line, i) => {
		if (!hex.test(line)) return;
		const next = lines.slice(i + 1).find((l) => l.trim() !== "") ?? "";
		if (!/:\s*var\(--/.test(next)) bad.push(line.trim());
	});
	return bad;
}

function pageStyle(): string {
	// .voice-error is the documented always-dark exception (see
	// docs/colors.md): it keeps raw dark hexes in both themes, so it
	// scans outside the pairing rule.
	return styleOf("./+page.svelte").replace(/\.voice-error\s*\{[^}]*\}/g, "");
}

const messageBodyStyle = styleOf("../lib/components/MessageBody.svelte");
// panels.css is a raw stylesheet (no <style> wrapper): read it whole.
const panelsStyle = readFileSync(
	new URL("../lib/components/settings/panels.css", import.meta.url),
	"utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("color tokens", () => {
	it("defines the palette once in app.css, per theme", () => {
		const app = readFileSync(new URL("../app.css", import.meta.url), "utf8");
		for (const token of [
			"--accent:",
			"--accent-ink:",
			"--error-bg:",
			"--error-ink:",
			"--error-line:",
			"--alarm:",
			"--danger:",
			"--sel-tint:",
			"--ok-wash:",
			"--pair0:",
			"--pair1:",
			"--pair2:",
			"--pair3:"
		]) {
			expect(app).toContain(token);
		}
		// The accent is one blue with a dark-theme twin, not two blues.
		expect(app).toContain("--accent: #007aff");
		expect(app).toContain("--accent: #0a84ff");
	});

	it("names tokens in components, never bare accent hexes", () => {
		expect(unpairedHexLines(pageStyle())).toEqual([]);
		expect(unpairedHexLines(messageBodyStyle)).toEqual([]);
		expect(unpairedHexLines(panelsStyle)).toEqual([]);
	});

	it("references every token somewhere", () => {
		const all = pageStyle() + messageBodyStyle + panelsStyle;
		for (const token of [
			"var(--accent)",
			"var(--accent-ink)",
			"var(--error-bg)",
			"var(--error-ink)",
			"var(--error-line)",
			"var(--alarm)",
			"var(--sel-tint)",
			"var(--ok-wash)",
			"var(--pair0)",
			"var(--pair1)",
			"var(--pair2)",
			"var(--pair3)"
		]) {
			expect(all).toContain(token);
		}
	});
});
