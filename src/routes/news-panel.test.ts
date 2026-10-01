import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Learner-news wiring jsdom cannot see (idle parking, key
 * gates, selection locks), asserted on source instead. The
 * cluster lives in $lib/news-mode.svelte.ts; the page keeps
 * the lang funnel (set/clearReplyLang, langMenusActions)
 * delegating into it.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

function newsModeSource(): string {
	return readFileSync(
		new URL("../lib/news-mode.svelte.ts", import.meta.url),
		"utf8"
	);
}

describe("news-mode composer", () => {
	it("parks the composer on desktop, never on phones", () => {
		const source = newsModeSource();
		const at = source.indexOf("enterNewsMode(code: string): void {");
		expect(at).toBeGreaterThan(0);
		const body = source.slice(at, source.indexOf("void this.fetchNewsStories();", at));
		// No summon gesture exists on phones: parking there would
		// strand the composer with no way to type past headlines.
		expect(body).toContain("if (!this.deps.isPhone()) this.deps.parkPrompt();");
		expect(body).not.toMatch(/^\s*this\.deps\.parkPrompt\(\);$/m);
	});

	it("restores the composer when news closes or the language clears", () => {
		const source = newsModeSource();
		const closeAt = source.indexOf("close(): void {");
		expect(closeAt).toBeGreaterThan(0);
		expect(source.slice(closeAt, closeAt + 200)).toContain("restorePrompt()");
		const page = pageSource();
		const clearAt = page.indexOf("function clearReplyLang(");
		expect(clearAt).toBeGreaterThan(0);
		expect(page.slice(clearAt, clearAt + 300)).toContain("newsMode.close()");
	});

	it("skips the pick-to-composer focus while headlines show", () => {
		const source = pageSource();
		expect(source).toContain("if (!androidUI && newsMode.news === null) editor?.focus();");
	});
});

describe("headline annotate wiring", () => {
	it("resolves hover words over headlines without a message index", () => {
		const source = pageSource();
		expect(source).toContain('closest(".rendered, .news-card-title")');
		expect(source).toContain("(hoveredIdx >= 0 || newsMode.news !== null)");
		expect(source).toContain("hoverHot: hoverHit !== null");
	});

	it("locks cross-card drags to the anchor title like messages", () => {
		const source = pageSource();
		expect(source).toContain("lockSelectionToMessage(live, (n) => annotateMode.articleOf(n) ?? annotateMode.headlineOf(n))");
	});

	it("hands headline marks and badge actions to the cards", () => {
		const source = pageSource();
		expect(source).toContain("buildNewsMarks(drafts.list, pendingAnn)");
		expect(source).toContain("newsMarks={newsMarks}");
		const mode = newsModeSource();
		expect(mode).toContain("badge: (id: AnnotationId, x: number, y: number) => {");
		expect(mode).toContain("this.deps.onBadge(id, x, y);");
		expect(mode).toContain("badgeHover: (id: string | null) => {");
		expect(source).toContain("annotateMode.openBadgeClick(id, { x, y })");
		expect(source).toContain("onBadgeHover: (id) => {");
	});
});
