import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Learner-news page wiring jsdom cannot see (idle parking, key
 * gates, selection locks), asserted on source instead.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

describe("news-mode composer", () => {
	it("parks the composer on the idle path while headlines show", () => {
		const source = pageSource();
		const at = source.indexOf("function enterNewsMode(");
		expect(at).toBeGreaterThan(0);
		const body = source.slice(at, source.indexOf("void fetchNewsStories();", at));
		expect(body).toContain("promptIdle = true");
	});

	it("restores the composer when news closes or the language clears", () => {
		const source = pageSource();
		const closeAt = source.indexOf("close: () => {");
		expect(closeAt).toBeGreaterThan(0);
		expect(source.slice(closeAt, closeAt + 200)).toContain("restorePrompt()");
		const clearAt = source.indexOf("function clearReplyLang(");
		expect(clearAt).toBeGreaterThan(0);
		expect(source.slice(clearAt, clearAt + 300)).toContain("restorePrompt()");
	});

	it("skips the pick-to-composer focus while headlines show", () => {
		const source = pageSource();
		expect(source).toContain("if (!androidUI && news === null) editor?.focus();");
	});
});

describe("headline annotate wiring", () => {
	it("resolves hover words over headlines without a message index", () => {
		const source = pageSource();
		expect(source).toContain('closest(".rendered, .news-card-title")');
		expect(source).toContain("(hoveredIdx >= 0 || news !== null)");
		expect(source).toContain("hoverHot: hoverHit !== null");
	});

	it("locks cross-card drags to the anchor title like messages", () => {
		const source = pageSource();
		expect(source).toContain("lockSelectionToMessage(live, (n) => articleOf(n) ?? headlineOf(n))");
	});

	it("hands headline marks and badge actions to the cards", () => {
		const source = pageSource();
		expect(source).toContain("buildNewsMarks(annotations, pendingAnn)");
		expect(source).toContain("newsMarks={newsMarks}");
		expect(source).toContain("badge: (id: AnnotationId, x: number, y: number) => {");
		expect(source).toContain("openBadgeClick(id, { x, y });");
		expect(source).toContain("badgeHover: (id: string | null) => {");
	});
});
