import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Right-clicking a mixed kanji+kana highlight shows one annotated
 * popup: each kanji keeps its own word-context reading (both
 * accent), okurigana repeats plain. A kana-only highlight shows no
 * popup at all — nobody needs furigana for kana.
 */

test.setTimeout(180_000);

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { __spoken: string[] }).__spoken = [];
		const synth = window.speechSynthesis;
		if (synth) {
			synth.speak = ((utterance: SpeechSynthesisUtterance) => {
				(window as unknown as { __spoken: string[] }).__spoken.push(
					utterance.text
				);
			}) as typeof synth.speak;
		}
	});
	await seedChat(page, [{ role: "assistant", content: "花が咲き誇る春" }]);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
});

/** Highlight the whole paragraph (mixed kanji + kana). */
async function selectAll(page: Page) {
	return page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		if (!p) return "";
		const range = document.createRange();
		range.selectNodeContents(p);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		return selection?.toString() ?? "";
	});
}

/** Highlight just the き (kana only, no Han). */
async function selectKanaOnly(
	page: Page
) {
	return page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const text = p?.firstChild;
		if (!text) return "";
		const selection = window.getSelection();
		selection?.setBaseAndExtent(text, 3, text, 4);
		return selection?.toString() ?? "";
	});
}

async function clickOnText(page: Page) {
	const box = await page
		.locator("article.assistant .rendered p")
		.first()
		.boundingBox();
	if (!box) throw new Error("missing para box");
	await page.mouse.click(box.x + 8, box.y + box.height / 2, {
		button: "right"
	});
}

test("right-clicking a mixed highlight shows per-kanji readings", async ({
	page
}) => {
	const selected = await selectAll(page);
	expect(selected).toContain("咲き誇る");
	await clickOnText(page);
	const panel = page.locator(".sel-pinyin");
	// Cold worker builds the dictionary first (tens of seconds):
	// wait for the annotated pairs, not just the pending mark.
	await expect(panel.locator(".spr").first()).toBeVisible({
		timeout: 120_000
	});
	// One annotated pair per kanji run, readings stacked above.
	const pairs = panel.locator(".spr");
	expect(await pairs.count()).toBeGreaterThanOrEqual(1);
	expect(await panel.locator(".srt").count()).toBe(await pairs.count());
	expect(await panel.locator(".spb").count()).toBe(await pairs.count());
	// Pair colors: the first kanji run leads the palette, and its
	// reading shares its own kanji's color exactly.
	const first = pairs.first();
	await expect(first).toHaveClass(/pk0/);
	const pairColor = await first.evaluate((el) => {
		const reading = el.querySelector(".srt");
		const base = el.querySelector(".spb");
		if (!reading || !base) return null;
		const color = getComputedStyle(reading).color;
		return color === getComputedStyle(base).color ? color : null;
	});
	expect(pairColor).not.toBeNull();
	// Okurigana repeats in the popup, plain (uncolored).
	await expect(panel).toContainText("き");
	// Escape dismisses the panel.
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
});

test("right-clicking a kana-only highlight shows no popup", async ({
	page
}) => {
	const selected = await selectKanaOnly(page);
	expect(selected).toBe("き");
	await clickOnText(page);
	await page.waitForTimeout(1000);
	await expect(page.locator(".sel-pinyin")).toHaveCount(0);
});
