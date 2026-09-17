import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * One tag look for pasted-image/file tags, brackets included.
 *
 * `[Pasted image]` tokenizes as markdown Link: the text takes an
 * underline class, the brackets a muted-gray one, and both class names
 * are obfuscated per build — so the tag look must ride every inner
 * span structurally, in the light theme object and in the dark page
 * rules alike. The .cm-attach-tag mark's own color/decoration never
 * reach those inner spans.
 *
 * These assert on stylesheet source because the cascade they guard
 * (which sheet wins, inner spans vs. mark) is invisible to jsdom.
 * Comments are stripped first so prose can't trip the assertions.
 */
function themeSource(): string {
	const src = readFileSync(new URL("./editorTheme.ts", import.meta.url), "utf8");
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "");
}

function darkPageStyle(): string {
	const src = readFileSync(new URL("../routes/+page.svelte", import.meta.url), "utf8");
	const match = src.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("attach-tag inner highlight spans", () => {
	it("clears the light tag's inner underline and bracket gray", () => {
		const src = themeSource();
		expect(src).toMatch(/"\.cm-attach-tag span": \{\s*color: "inherit !important"/);
		expect(src).toMatch(/\.cm-attach-tag span": \{\s*[^}]*textDecoration: "none !important"/);
	});

	it("rides the dark tag gray onto the inner spans, underline-free", () => {
		const css = darkPageStyle();
		expect(css).toContain(":global(.cm-attach-tag span)");
		const rule = css.match(/\.cm-attach-tag span\)\s*\{[^}]*\}/)?.[0] ?? "";
		expect(rule).toMatch(/color:\s*#98989f !important/);
		expect(rule).toMatch(/text-decoration:\s*none !important/);
	});
});
