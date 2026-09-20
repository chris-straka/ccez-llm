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

test("right-clicking a mixed highlight shows one panel per kanji group", async ({
	page
}) => {
	const selected = await selectAll(page);
	expect(selected).toContain("咲き誇る");
	await clickOnText(page);
	const panels = page.locator(".sel-pinyin");
	// Cold worker builds the dictionary first (tens of seconds):
	// wait for the group panels, not just the pending mark.
	await expect(panels.locator(".spr").first()).toBeVisible({
		timeout: 120_000
	});
	// Kana-separated kanji anchor apart: 咲 and 誇 land in different
	// panels, each holding furigana only — zero kanji, zero kana.
	expect(await panels.count()).toBeGreaterThanOrEqual(2);
	for (const char of ["咲", "き", "誇", "り", "花", "春"]) {
		await expect(panels.filter({ hasText: char })).toHaveCount(0);
	}
	expect(await panels.locator(".spb").count()).toBe(0);
	// The document kanji glow in their popup color: the first tint
	// matches the first panel reading exactly.
	const body = page.locator("article.assistant .rendered");
	expect(await body.locator('[class*="frbt"]').count()).toBeGreaterThanOrEqual(
		1
	);
	const match = await page.evaluate(() => {
		const tint = document.querySelector(
			"article.assistant .rendered [class*=frbt]"
		);
		const reading = document.querySelector(".sel-pinyin .srt");
		if (!(tint instanceof Element) || !(reading instanceof Element))
			return false;
		return (
			getComputedStyle(tint).color === getComputedStyle(reading).color
		);
	});
	expect(match).toBe(true);
	// Escape dismisses the panels and unwraps the tint.
	await page.keyboard.press("Escape");
	await expect(panels).toHaveCount(0);
	expect(await body.locator('[class*="frbt"]').count()).toBe(0);
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

async function spoken(page: Page): Promise<string[]> {
	return page.evaluate(
		() => (window as unknown as { __spoken: string[] }).__spoken ?? []
	);
}

test("right-clicking kanji shows its sentence reading and speaks kana", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "彼は生まれる" }]);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
	// Highlight just 生: isolated it converts to せい, in 生まれる
	// it reads う — the popup must show the sentence reading.
	const selected = await page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const text = p?.firstChild;
		if (!text) return "";
		window.getSelection()?.setBaseAndExtent(text, 2, text, 3);
		return window.getSelection()?.toString() ?? "";
	});
	expect(selected).toBe("生");
	// Click inside the highlight: a right mousedown outside it moves
	// the caret and collapses it (native), landing on the word path.
	const at = await page.evaluate(() => {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return null;
		const rect = selection.getRangeAt(0).getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	});
	if (!at) throw new Error("no selection rect");
	await page.mouse.click(at.x, at.y, { button: "right" });
	const panels = page.locator(".sel-pinyin");
	await expect(panels.locator(".spr").first()).toBeVisible({
		timeout: 120_000
	});
	await expect(panels).toContainText("う");
	await expect(panels).not.toContainText("せい");
	await expect(panels).not.toContainText("生");
	// Speech reads the kana, never the raw kanji. Speech waits for
	// the worker conversion, so this covers a cold dictionary build
	// like the panel wait above.
	await expect.poll(() => spoken(page), { timeout: 120_000 }).toContain("う");
});
