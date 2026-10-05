import { readdirSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Color-token invariants (see docs/design/colors.md): component styles name
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

/**
 * Every component <style> under src/, plus panels.css (a raw sheet).
 * Globbed so extractions are scanned wherever the markup lands.
 * .voice-error is the documented always-dark exception (see
 * docs/design/colors.md): it keeps raw dark hexes in both themes, so
 * it scans outside the pairing rule.
 */
const srcDir = new URL("../", import.meta.url);
const componentStyle = readdirSync(srcDir, { recursive: true })
	.map(String)
	.filter((path) => path.endsWith(".svelte"))
	.sort()
	.map((path) => {
		const source = readFileSync(new URL(path, srcDir), "utf8");
		return source.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? "";
	})
	.join("\n")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/\.voice-error\s*\{[^}]*\}/g, "");
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
			"--pair3:",
			"--bg-overlay:",
			"--line-overlay:",
			"--overlay-hover:",
			"--overlay-glass:",
			"--shadow-overlay:",
			"--scrim:"
		]) {
			expect(app).toContain(token);
		}
		// The accent is one blue with a dark-theme twin, not two blues.
		expect(app).toContain("--accent: #007aff");
		expect(app).toContain("--accent: #0a84ff");
	});

	it("names tokens in components, never bare accent hexes", () => {
		expect(unpairedHexLines(componentStyle)).toEqual([]);
		expect(unpairedHexLines(panelsStyle)).toEqual([]);
	});

	it("references every token somewhere", () => {
		const all = componentStyle + panelsStyle;
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
			"var(--pair3)",
			"var(--bg-overlay)",
			"var(--line-overlay)",
			"var(--overlay-hover)",
			"var(--overlay-glass)",
			"var(--shadow-overlay)",
			"var(--scrim)"
		]) {
			expect(all).toContain(token);
		}
	});
});

describe("own-message ink", () => {
	/** Swatch, light twin, dark twin (see docs/design/colors.md). */
	const OWN_INKS: Array<[string, string, string]> = [
		["pink", "#be185d", "#f9a8d4"],
		["blue", "#1d4ed8", "#93c5fd"],
		["green", "#15803d", "#86efac"],
		["amber", "#b45309", "#fcd34d"],
		["purple", "#7e22ce", "#d8b4fe"],
		["white", "#1c1c1e", "#ffffff"]
	];
	it("defines every swatch per theme in app.css", () => {
		const app = readFileSync(new URL("../app.css", import.meta.url), "utf8");
		for (const [choice, light, dark] of OWN_INKS) {
			expect(app).toContain(`--own-${choice}: ${light}`);
			expect(app).toContain(`--own-${choice}: ${dark}`);
		}
	});
	it("pairs every swatch rule in MessageArticle (fallback hex, then the token)", () => {
		const style = styleOf("../lib/components/MessageArticle.svelte");
		for (const [choice, light] of OWN_INKS) {
			expect(style).toContain(`main[data-own-ink="${choice}"]`);
			expect(style).toMatch(
				new RegExp(
					`color: ${light};\\s*color: var\\(--own-${choice}\\);`
				)
			);
		}
		// Off has no rule — plain ink.
		expect(style).not.toContain('data-own-ink="off"');
	});
});
