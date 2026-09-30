import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Learner news renders from `NewsPanel.svelte` under the hero pills.
 * The page owns the panel state (fetch, region, picker, launch);
 * the component owns the cards markup and their surfaces. Story
 * buttons are icon-only by explicit user call (emoji with text
 * alternatives); option rows expand inline under their card.
 * Region chips hide for single-edition languages; world chips show
 * icons with label alternatives, home chips plain country labels.
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
			const at = source.indexOf(`actions.launch(story.link, "${kind}")}`);
			expect(at).toBeGreaterThan(0);
			const end = source.indexOf("</button>", at);
			const inner = source.slice(at, end).split(">").pop()?.trim();
			expect(inner).toBe(emoji);
		}
	});

	it("opens one menu from the whole card, click or right-click", () => {
		const source = panelSource();
		expect(source).toContain("actions.menu(story.link)");
		expect(source).toContain("oncontextmenu");
		expect(source).toContain("aria-expanded");
		expect(source).toContain("news-hint");
		// One neutral ellipsis, never the action emoji it isn't.
		expect(source).toContain("⋯");
		expect(source).not.toContain("🗣️ 📰");
		expect(source).toContain('aria-label="Story options"');
		expect(source).toContain("transition:slide");
		expect(source).toContain("in:fly");
		expect(source).toContain("motionMs");
		// Hover affordances live on the card surface alone, so the
		// underline and the pointer cursor never disagree — and the
		// title color eases instead of snapping.
		expect(source).toContain(".news-open:hover .news-card-title");
		expect(source).not.toContain(".news-card:hover .news-card-title");
		const css = source.split("<style>")[1] ?? "";
		const title = css.match(/\.news-card-title\s*\{[^}]*\}/)?.[0] ?? "";
		expect(title).toContain("transition: color");
		// The hint overlays instead of reserving card space.
		const hint = css.match(/\.news-hint\s*\{[^}]*\}/)?.[0] ?? "";
		expect(hint).toContain("position: absolute");
	});

	it("menus launch icon-only at the selected level and length", () => {
		const source = panelSource();
		expect(source).toContain('aria-label="Level"');
		expect(source).toContain('aria-label="Summary length"');
		expect(source).toContain("CEFR_LEVELS");
		expect(source).toContain("SUMMARY_SIZES");
		// Level and length select without launching; the icons launch.
		expect(source).toContain("actions.level(story.link, level.level)");
		expect(source).toContain("actions.size(story.link, size.size)");
		expect(source).toContain('picker?.level ?? "B2"');
		expect(source).toContain('picker?.size ?? "medium"');
		expect(source).toContain('actions.launch(story.link, "talk")');
		expect(source).toContain('actions.launch(story.link, "read")');
	});

	it("chips world icons with label alternatives, hidden for single editions", () => {
		const source = panelSource();
		expect(source).toContain("panel.regions.length > 1");
		expect(source).not.toContain("🌍 Global");
		expect(source).toContain("{region.icon ?? region.label}");
		expect(source).toContain("aria-label={region.label}");
		expect(source).toContain("aria-pressed");
		expect(source).toContain("news-sep");
		expect(source).toContain(".news-chip.icon");
	});

	it("yields card presses to live headline selections", () => {
		// The card carries its story link for headline anchoring;
		// drags and standing selections own the press, never the menu.
		const source = panelSource();
		expect(source).toContain("data-story-link={story.link}");
		expect(source).toContain("newsCardPressOpensMenu({");
	});

	it("never shows fallback headlines in English", () => {
		// Fallback editions translate into the learner's language
		// (their regions carry translate), so no English note exists;
		// the translated-from line attributes the source instead.
		const source = panelSource();
		expect(source).not.toContain("headlines in English");
		expect(source).toContain("Translated from {activeRegion.label} headlines.");
	});

	it("notes translated regions with the source edition", () => {
		const source = panelSource();
		expect(source).toContain("?.translate");
		expect(source).toContain("Translated from {activeRegion.label} headlines.");
		// Only once loaded — never over the loading crumbs.
		expect(source).toContain('activeRegion?.translate && panel.status === "ready"');
		expect(source).toContain("Translating headlines into");
	});

	it("lays cards out as a responsive grid", () => {
		const css = panelSource().split("<style>")[1] ?? "";
		expect(css).toContain("display: grid");
		expect(css).toContain("auto-fill");
		// Uniform cards: titles pad to three lines, sources to one.
		expect(css).toContain("min-height: 4.05em");
		expect(css).toContain("text-overflow: ellipsis");
	});

	it("shows feed thumbnails when present, lazy and tile-falling", () => {
		const source = panelSource();
		expect(source).toContain("{#if resolved && !broken[story.link]}");
		expect(source).toContain('class="news-img"');
		expect(source).toContain('loading="lazy"');
		// A dead hotlink falls back to the outlet initial (same
		// box), never a bare gap.
		expect(source).toContain("broken[story.link] = true");
		expect(source).not.toContain("currentTarget.remove()");
	});

	it("keeps headlines selectable on a keyboard-operated card", () => {
		// Buttons swallow drag-selection in browsers, so the card is
		// a div wearing the button contract (role, tab stop, menu
		// on Enter/Space) — text selects natively for annotate.
		const source = panelSource();
		expect(source).toContain('role="button"');
		expect(source).toContain('tabindex="0"');
		expect(source).toContain("onkeydown");
		expect(source).toContain('e.key === "Enter" || e.key === " "');
		// The card surface itself is the div, not a button.
		const openAt = source.indexOf('class="news-open"');
		expect(openAt).toBeGreaterThan(0);
		const tagStart = source.lastIndexOf("<", openAt);
		expect(source.slice(tagStart, openAt)).toContain("<div");
	});

	it("presses buttons in and kills all motion when reduced", () => {
		const css = panelSource().split("<style>")[1] ?? "";
		expect(css).toContain(".news-go:active");
		expect(css).toContain("scale(0.96)");
		expect(css).toContain("prefers-reduced-motion: reduce");
		expect(css).toContain("transition: none !important");
	});

	it("skeletons pending scrapes, still under reduced motion", () => {
		const source = panelSource();
		expect(source).toContain("images[story.link]");
		expect(source).toContain("news-skel");
		expect(source).toContain("prefers-reduced-motion: no-preference");
		// Resolved misses hold the same box with the outlet initial.
		expect(source).toContain("news-img-fallback");
		expect(source).toContain("story.source.trim().charAt(0)");
	});

	it("covers every fetch state with retry where retry helps", () => {
		const source = panelSource();
		for (const status of [
			'"loading"',
			'"translating"',
			'"error"',
			'"unsupported"',
			'"needs-shell"'
		]) {
			expect(source).toContain(`panel.status === ${status}`);
		}
		expect(source).toContain("actions.retry()");
		// Busy cards announce and fold the menu away.
		expect(source).toContain('role="status"');
		expect(source).toContain("open && busy === null");
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
