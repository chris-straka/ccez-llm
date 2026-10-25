import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { dragQuote } from "./helpers";
import { seedArticle } from "./news-article";

/**
 * The note editor (create pill and edit card) is the answer card's
 * sibling: it opens just below its quote, stays inside the article
 * column, wraps and grows downward as the note gets longer, then
 * scrolls, and never covers the quote it belongs to.
 */

const LONG =
	"Here 'a succédé' is the passé composé of succéder: she took over from Karoline Leavitt on 9 October. Succéder à quelqu'un means to follow someone in a post, not to succeed at something; réussir is the word for that.";

interface Geometry {
	pop: { left: number; right: number; top: number; bottom: number };
	column: { left: number; right: number };
	quoteBottom: number;
}

/** The open editor's box, its article's column, and the bottom of
the quote it hangs off (the live wash). */
async function geometry(page: Page, row: number): Promise<Geometry> {
	return page.evaluate((n) => {
		const pop = document.querySelector(".ann-pop")!.getBoundingClientRect();
		const article = document
			.querySelectorAll("article")
			[n]!.getBoundingClientRect();
		const reg = (CSS as unknown as { highlights: Map<string, Iterable<Range>> })
			.highlights;
		// The wash takes a deeper name where it overlaps other inks
		// (ccez-ann-d1 … -d3): read whichever it has.
		const wash = [...reg]
			.filter(([name]) => /^ccez-ann(-d\d)?$/.test(name))
			.flatMap(([, ranges]) => [...ranges]);
		const quoteBottom = Math.max(
			...wash.map((r) => r.getBoundingClientRect().bottom)
		);
		return {
			pop: {
				left: pop.left,
				right: pop.right,
				top: pop.top,
				bottom: pop.bottom
			},
			column: { left: article.left, right: article.right },
			quoteBottom
		};
	}, row);
}

function expectInColumn(g: Geometry): void {
	expect(g.pop.left).toBeGreaterThanOrEqual(Math.max(8, g.column.left) - 1);
	expect(g.pop.right).toBeLessThanOrEqual(g.column.right + 1);
	// Just below the quote, never over it.
	expect(g.pop.top).toBeGreaterThanOrEqual(g.quoteBottom);
	expect(g.pop.top - g.quoteBottom).toBeLessThan(40);
}

async function openCreate(
	page: Page,
	row: number,
	quote: string,
	root: string
): Promise<Locator> {
	await dragQuote(page, row, quote, root);
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	const pop = page.locator(".ann-pop.note.placed");
	await expect(pop).toBeVisible();
	await expect(pop.locator("textarea")).toBeFocused();
	return pop;
}

test("body note opens below its quote, grows down inside the column, then scrolls", async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await seedArticle(page);
	const pop = await openCreate(page, 1, "a succédé", "article .rendered");
	const start = await geometry(page, 1);
	expectInColumn(start);
	const field = pop.locator("textarea");
	await page.keyboard.type("Here ");
	await field.fill(LONG);
	await expect
		.poll(async () => (await geometry(page, 1)).pop.bottom)
		.toBeGreaterThan(start.pop.bottom);
	const grown = await geometry(page, 1);
	expectInColumn(grown);
	// Growing goes down, never up over the quote.
	expect(grown.pop.top).toBeCloseTo(start.pop.top, 0);
	// Past the height cap the field scrolls; the card stays on screen.
	await field.fill([LONG, LONG, LONG, LONG, LONG].join(" "));
	await expect
		.poll(() => field.evaluate((el) => el.scrollHeight > el.clientHeight + 1))
		.toBe(true);
	const capped = await geometry(page, 1);
	expect(capped.pop.bottom).toBeLessThanOrEqual(900);
	expectInColumn(capped);
	await page.keyboard.press("Escape");
	await expect(page.locator(".ann-pop")).toHaveCount(0);
});

test("headline note hangs below the headline quote inside the column", async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await seedArticle(page);
	const pop = await openCreate(
		page,
		0,
		"nouvelle voix du trumpisme",
		".launch-title .rendered"
	);
	await pop.locator("textarea").fill(LONG);
	expectInColumn(await geometry(page, 0));
	await page.keyboard.press("Escape");
});

test("narrow window: the note stays on screen below its quote", async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await seedArticle(page);
	const pop = await openCreate(page, 1, "a succédé", "article .rendered");
	await pop.locator("textarea").fill(LONG);
	const g = await geometry(page, 1);
	expectInColumn(g);
	expect(g.pop.left).toBeGreaterThanOrEqual(8);
	expect(g.pop.right).toBeLessThanOrEqual(390 - 8);
	await page.keyboard.press("Escape");
});

test("edit card opens below its quote in the same bubble", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await seedArticle(page);
	const badge = page.locator('[data-ann-badge="ann-debuts"]');
	await badge.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator(".ann-answer")).toBeVisible();
	await page.keyboard.press("e");
	const pop = page.locator(".ann-pop.note.placed:not(.fresh)");
	await expect(pop).toBeVisible();
	await pop.locator("textarea").fill(LONG);
	expectInColumn(await geometry(page, 1));
	// Same surface as the answer card it replaces, tail included.
	const look = await pop.evaluate((el) => {
		const s = getComputedStyle(el);
		const tail = getComputedStyle(el, "::before");
		return { radius: s.borderTopLeftRadius, tail: tail.content };
	});
	expect(look).toEqual({ radius: "14px", tail: '""' });
	await page.keyboard.press("Escape");
});
