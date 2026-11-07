import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Per-message article row surfaces live in MessageArticle.svelte; no
 * article selector stays paged. The in-place editor matches the
 * message it replaces and grows to its content.
 */
function componentSource(): string {
	return readFileSync(
		new URL("./MessageArticle.svelte", import.meta.url),
		"utf8"
	);
}

function componentStyle(): string {
	const source = componentSource();
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("MessageArticle.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("message article surfaces", () => {
	/** Body of the exact desktop rule (never the data-android override). */
	function desktopRule(css: string, selector: string): string {
		const match = css.match(new RegExp(`(^|\\n)\\t${selector} \\{([^}]*)\\}`));
		if (!match?.[2]) throw new Error(`${selector} has no desktop rule`);
		return match[2];
	}

	it("grows the desktop edit field to its content (no one-row clip)", () => {
		// The editor stands down from manual sizing wherever the
		// engine claims field-sizing support, so the desktop rule
		// must own the height like the composer and phone rules do —
		// without it only the first wrapped line shows.
		const css = componentStyle();
		const body = desktopRule(css, "\\.msg-edit-box :global\\(\\.ta-input\\)");
		expect(body).toContain("field-sizing: content");
	});

	it("edits inline: the box matches the message it replaces", () => {
		// No editing frame: shaded messages edit on the same wash,
		// plain ones on no background at all — only the cursor says
		// editing. Tinted ink matches too.
		const css = componentStyle();
		const body = desktopRule(css, "article\\.user \\.msg-edit");
		expect(body).toContain("background: var(--bg-wash)");
		expect(body).not.toContain("var(--bg-raised)");
		expect(body).not.toContain("1px solid");
		expect(css).toContain(":global(main.plain-user) article.user .msg-edit");
		for (const ink of ["pink", "blue", "green", "amber", "purple", "white"]) {
			expect(css).toContain(
				`:global(main[data-own-ink="${ink}"]) article.user .msg-edit`
			);
		}
	});
});
