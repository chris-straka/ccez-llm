import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Learner news renders from `NewsPanel.svelte` under the hero pills.
 * The page owns the panel state (fetch, region, picker, launch);
 * the component owns the cards markup and their surfaces. Story
 * buttons are icon-only by explicit user call (emoji with text
 * alternatives); option rows expand inline under their card.
 * Region chips hide for single-edition languages; chips show plain
 * country labels, and fallback editions note their English headlines.
 * All color rides theme tokens.
 */
function panelSource(): string {
	return readFileSync(new URL("./NewsPanel.svelte", import.meta.url), "utf8");
}

describe("news panel contract", () => {
	it("renders icon-only session buttons with text alternatives", () => {
		const source = panelSource();
		expect(source).toContain('aria-label="Discuss this story"');
		expect(source).toContain('aria-label="Summarize this story"');
		expect(source).toContain("🗣️");
		expect(source).toContain("📰");
		// No text siblings inside the session buttons: past the last
		// attribute bracket, each holds exactly its emoji.
		for (const [kind, emoji] of [
			["talk", "🗣️"],
			["read", "📰"]
		]) {
			const at = source.indexOf(`actions.toggle(story.link, "${kind}")}`);
			expect(at).toBeGreaterThan(0);
			const end = source.indexOf("</button>", at);
			const inner = source.slice(at, end).split(">").pop()?.trim();
			expect(inner).toBe(emoji);
		}
	});

	it("expands CEFR and length pickers inline per card", () => {
		const source = panelSource();
		expect(source).toContain('aria-label="Conversation level"');
		expect(source).toContain('aria-label="Summary level"');
		expect(source).toContain('aria-label="Summary length"');
		expect(source).toContain("CEFR_LEVELS");
		expect(source).toContain("SUMMARY_SIZES");
		expect(source).toContain("aria-expanded");
		// Summary levels select without launching (length taps launch).
		expect(source).toContain("actions.level(story.link, level.level)");
		expect(source).toContain('picker.level ?? "B1"');
	});

	it("chips plain country labels, hidden for single editions", () => {
		const source = panelSource();
		expect(source).toContain("panel.regions.length > 1");
		expect(source).not.toContain("🌍 Global");
		expect(source).toContain("{region.label}");
		expect(source).toContain("aria-pressed");
	});

	it("notes fallback English headlines with sessions in-language", () => {
		const source = panelSource();
		expect(source).toContain("panel.fallback");
		expect(source).toContain("headlines in English; sessions run in");
	});

	it("lays cards out as a responsive grid", () => {
		const css = panelSource().split("<style>")[1] ?? "";
		expect(css).toContain("display: grid");
		expect(css).toContain("auto-fill");
	});

	it("covers every fetch state with retry where retry helps", () => {
		const source = panelSource();
		for (const status of [
			'"loading"',
			'"error"',
			'"unsupported"',
			'"needs-shell"'
		]) {
			expect(source).toContain(`panel.status === ${status}`);
		}
		expect(source).toContain("actions.retry()");
		// Busy cards announce and lock their buttons.
		expect(source).toContain('role="status"');
		expect(source).toContain("disabled={busy !== null}");
	});

	it("paints only theme tokens, never raw hex", () => {
		const css = panelSource().split("<style>")[1] ?? "";
		const hexes = css.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) ?? [];
		// Every hex is a first-paint fallback directly above its var.
		for (const hex of hexes) {
			const idx = css.indexOf(hex);
			const after = css.slice(idx, idx + 120);
			expect(after).toContain("var(--");
		}
		expect(css).toContain("var(--ink)");
		expect(css).toContain("var(--muted)");
		expect(css).toContain("var(--accent)");
		expect(css).toContain("var(--bg-raised)");
	});
});
