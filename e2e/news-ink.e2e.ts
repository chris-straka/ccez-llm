import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { seedArticle } from "./news-article";

/**
 * Annotation ink on a news article: headline and body quotes take a
 * solid underline in their ink, repeats further down a dotted one,
 * and hovering a badge moves no ink: the wash covers the hovered
 * quote whole and nothing grows onto the text around it.
 */

/** Underlined text per highlight name as "row:text" (row 0 is the
headline), touching ranges joined (a badge anchor splits one quote
into two text nodes), sorted. */
async function inked(page: Page): Promise<Record<string, string[]>> {
	return page.evaluate(() => {
		const out: Record<string, string[]> = {};
		const rows = [...document.querySelectorAll("article")];
		const reg = (CSS as unknown as { highlights: Map<string, Iterable<Range>> })
			.highlights;
		for (const [name, hl] of reg) {
			if (!name.startsWith("ccez-rep-")) continue;
			const ranges = [...hl].sort((a, b) =>
				a.compareBoundaryPoints(Range.START_TO_START, b)
			);
			const texts: string[] = [];
			let prev: Range | null = null;
			for (const r of ranges) {
				const row = rows.indexOf(
					r.startContainer.parentElement?.closest("article") as HTMLElement
				);
				let joined = false;
				if (prev) {
					const gap = document.createRange();
					gap.setStart(prev.endContainer, prev.endOffset);
					gap.setEnd(r.startContainer, r.startOffset);
					// Only the badge digit sits between two halves.
					joined = !/\D/.test(gap.toString());
				}
				if (joined && texts.length > 0) texts[texts.length - 1] += r.toString();
				else texts.push(`${row}:${r.toString()}`);
				prev = r;
			}
			if (texts.length > 0) out[name] = texts.sort();
		}
		return out;
	});
}

/** The live hover wash's text (badge digits dropped). */
async function washed(page: Page): Promise<string> {
	return page.evaluate(() => {
		const reg = (CSS as unknown as { highlights: Map<string, Iterable<Range>> })
			.highlights;
		const hl = reg.get("ccez-ann");
		return hl
			? [...hl]
					.map((r) => r.toString())
					.join("")
					.replace(/\d/g, "")
			: "";
	});
}

const INKED = {
	// Headline: two notes, inks in reading order.
	"ccez-rep-0": ["0:de pareil", "1:proche du mouvement MAGA"],
	"ccez-rep-1": ["0:les débuts laborieux de Katie Zacharia"],
	"ccez-rep-2": ["1:a connu des débuts difficiles"],
	// The headline's quote comes back in the body: dotted.
	"ccez-rep-0-again": ["1:de pareil"]
};

test("headline and body quotes underline in their inks, repeats dotted", async ({
	page
}) => {
	await seedArticle(page);
	await expect.poll(() => inked(page)).toEqual(INKED);
	// Underlines only: the text keeps its colour.
	const style = await page.evaluate(() => {
		const rule = [...document.styleSheets]
			.flatMap((sheet) => [...sheet.cssRules])
			.find(
				(r): r is CSSStyleRule =>
					r instanceof CSSStyleRule &&
					r.selectorText.includes("::highlight(ccez-rep-0-again)") &&
					r.style.textDecorationStyle !== ""
			);
		return rule
			? { style: rule.style.textDecorationStyle, color: rule.style.color }
			: null;
	});
	expect(style).toEqual({ style: "dotted", color: "" });
});

test("badge hover keeps every ink on its own quote", async ({ page }) => {
	await seedArticle(page);
	await expect.poll(() => inked(page)).toEqual(INKED);
	for (const [id, quote] of [
		["ann-debuts", "a connu des débuts difficiles"],
		["ann-proche", "proche du mouvement MAGA"],
		["ann-laborieux", "les débuts laborieux de Katie Zacharia"]
	] as const) {
		await page.locator(`[data-ann-badge="${id}"]`).dispatchEvent("mouseover");
		await expect.poll(() => washed(page)).toBe(quote);
		// Hovering moves no ink: nothing grows onto the paragraph
		// around the hovered quote.
		expect(await inked(page)).toEqual(INKED);
		await page.locator(`[data-ann-badge="${id}"]`).dispatchEvent("mouseout");
		await expect.poll(() => washed(page)).toBe("");
	}
	expect(await inked(page)).toEqual(INKED);
	// The wash outranks the inks wherever they overlap, so the
	// hovered quote washes whole in every engine.
	const priorities = await page.evaluate(() => {
		const reg = (
			CSS as unknown as {
				highlights: Map<string, { priority: number }>;
			}
		).highlights;
		return {
			solid: reg.get("ccez-rep-0")?.priority ?? NaN,
			dotted: reg.get("ccez-rep-0-again")?.priority ?? NaN
		};
	});
	await page
		.locator('[data-ann-badge="ann-proche"]')
		.dispatchEvent("mouseover");
	await expect.poll(() => washed(page)).toBe("proche du mouvement MAGA");
	const wash = await page.evaluate(
		() =>
			(
				CSS as unknown as {
					highlights: Map<string, { priority: number }>;
				}
			).highlights.get("ccez-ann")?.priority ?? NaN
	);
	// Never negative: WebKit paints nothing below zero.
	expect(priorities.dotted).toBeGreaterThanOrEqual(0);
	expect(priorities.solid).toBeGreaterThan(priorities.dotted);
	expect(wash).toBeGreaterThan(priorities.solid);
});
