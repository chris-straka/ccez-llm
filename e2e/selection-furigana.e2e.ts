import { expect, test, type Page } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

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
	// The tint surgery keeps the live highlight: splits and wraps
	// preserve the range (no removeAllRanges), so the selection — and
	// on phones its handles — survives the popup.
	const kept = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(kept).toBe(selected);
	// Escape dismisses the panels and unwraps the tint.
	await page.keyboard.press("Escape");
	await expect(panels).toHaveCount(0);
	expect(await body.locator('[class*="frbt"]').count()).toBe(0);
});

/**
 * Creating an annotation keeps its furigana panel: the pill steals
 * focus (collapsing the selection) while the worker is still
 * resolving, but creation pins its panels — the loading mark must
 * resolve into readings and stay up while the pill is open, exactly
 * like a right-click panel. (Without the re-pin the collapse
 * dismisses the panel mid-resolve and only "..." ever shows.)
 */
test("creating an annotation keeps its furigana panel", async ({ page }) => {
	await dragQuote(page, 0, "咲き誇る");
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	const panels = page.locator(".sel-pinyin");
	await expect(panels.locator(".spr").first()).toBeVisible({
		timeout: 120_000
	});
	// Still up while the pill is open (not dismissed on the focus
	// collapse), holding kana readings (panels never repeat the
	// kanji — the highlighted word upstream is the title).
	await expect(page.locator(".ann-pop")).toBeVisible();
	await expect(panels.locator(".srt").first()).not.toBeEmpty();
	// And above the kanji, never stranded at the viewport corner
	// (a detached-range zero rect must never place a panel).
	const word = await page.evaluate(() => {
		const el = document.querySelector("article.assistant .rendered");
		if (!el) return null;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (node.parentElement?.tagName === "RT") continue;
			const i = (node.textContent ?? "").indexOf("咲き誇る");
			if (i >= 0) {
				const r = document.createRange();
				r.setStart(node, i);
				r.setEnd(node, i + 4);
				const rect = r.getBoundingClientRect();
				return {
					top: rect.top,
					left: rect.left,
					right: rect.right
				};
			}
		}
		return null;
	});
	if (!word) throw new Error("quote lost its rect");
	const placed = await panels.evaluateAll((els) =>
		els.map((el) => {
			const r = (el as HTMLElement).getBoundingClientRect();
			return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
		})
	);
	expect(placed.length).toBeGreaterThan(0);
	for (const g of placed) {
		expect(g.top).toBeGreaterThan(8);
		expect(g.left).toBeGreaterThan(8);
		expect(word.top - g.bottom).toBeLessThanOrEqual(24);
	}
	await page.keyboard.press("Escape");
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

/** Click the middle of the live highlight: a right mousedown outside
it moves the caret and collapses it (native). */
async function clickInsideHighlight(page: Page) {
	const at = await page.evaluate(() => {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return null;
		const rect = selection.getRangeAt(0).getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	});
	if (!at) throw new Error("no selection rect");
	await page.mouse.click(at.x, at.y, { button: "right" });
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
	await clickInsideHighlight(page);
	const panels = page.locator(".sel-pinyin");
	await expect(panels.locator(".spr").first()).toBeVisible({
		timeout: 120_000
	});
	await expect(panels).toContainText("う");
	await expect(panels).not.toContainText("せい");
	await expect(panels).not.toContainText("生");
	// Speech reads the kana, never the raw kanji — exactly the
	// highlight (う for 生, the sentence token's reading), never a
	// completed tail. Speech waits for the worker conversion, so
	// this covers a cold dictionary build like the panel wait above.
	await expect.poll(() => spoken(page), { timeout: 120_000 }).toEqual(["う"]);
});

test("back-to-back kanji share one panel with split colors", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "一人で行く" }]);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
	const selected = await page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const text = p?.firstChild;
		if (!text) return "";
		window.getSelection()?.setBaseAndExtent(text, 0, text, 2);
		return window.getSelection()?.toString() ?? "";
	});
	expect(selected).toBe("一人");
	await clickInsideHighlight(page);
	const panels = page.locator(".sel-pinyin");
	await expect(panels.locator(".spr").first()).toBeVisible({
		timeout: 120_000
	});
	// One panel, both furigana, zero kanji — and the boundary splits
	// by color (いち one color, にん another).
	await expect(panels).toHaveCount(1);
	const readings = panels.locator(".srt");
	expect(await readings.count()).toBe(2);
	await expect(panels.filter({ hasText: "一" })).toHaveCount(0);
	await expect(panels.filter({ hasText: "人" })).toHaveCount(0);
	const colors = await readings.evaluateAll((els) =>
		els.map((el) => getComputedStyle(el).color)
	);
	expect(new Set(colors).size).toBe(2);
	// Both document kanji glow, each in its popup color.
	const body = page.locator("article.assistant .rendered");
	expect(await body.locator(".frbt0").count()).toBe(1);
	expect(await body.locator(".frbt1").count()).toBe(1);
	await page.keyboard.press("Escape");
	await expect(panels).toHaveCount(0);
	expect(await body.locator('[class*="frbt"]').count()).toBe(0);
});

test("scrolling carries every group panel with the highlight", async ({
	page
}) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(
		60
	);
	await seedChat(page, [
		{ role: "assistant", content: `花が咲き誇る春\n\n${long}` }
	]);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
	await selectAll(page);
	await clickOnText(page);
	const panels = page.locator(".sel-pinyin");
	await expect(panels.locator(".spr").first()).toBeVisible({
		timeout: 120_000
	});
	const before = await panels.first().boundingBox();
	await page.evaluate(() => {
		document.querySelector(".messages")?.scrollBy({ top: 300 });
	});
	await page.waitForTimeout(300);
	const after = await panels.first().boundingBox();
	expect(before).not.toBeNull();
	expect(after).not.toBeNull();
	// The highlight moved up 300px; its first panel rode with it.
	expect((before?.y ?? 0) - (after?.y ?? 0)).toBeGreaterThan(200);
	expect(await panels.count()).toBeGreaterThanOrEqual(2);
});

/** At large type the furigana panel still hugs its word: the
panel scales with the chat size (never toy-fixed) and hangs right
above the highlight, never stranded far away. */
test("furigana panel hugs the word at large type", async ({ page }) => {
	await seedChat(
		page,
		[{ role: "assistant", content: "今日は春です" }],
		null,
		{ fontScale: 4 }
	);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
	// Select 春 (single kanji, solo panel), then right-click
	// inside the highlight for its readings (same panelXY anchor
	// the A path uses).
	const selected = await page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const text = p?.firstChild;
		if (!text) return "";
		window.getSelection()?.setBaseAndExtent(text, 3, text, 4);
		return window.getSelection()?.toString() ?? "";
	});
	expect(selected).toBe("春");
	await clickInsideHighlight(page);
	const panels = page.locator(".sel-pinyin");
	await expect(panels.locator(".spr").first()).toBeVisible({
		timeout: 120_000
	});
	// The 4x seed reached the thread: message type ≈ 64px.
	const msgSize = await page
		.locator("article.assistant .rendered p")
		.first()
		.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
	expect(msgSize).toBeGreaterThan(48);
	// Panel type scales with the chat (0.85rem at 4x ≈ 54px).
	const size = await panels.first().evaluate(
		(el) => parseFloat(getComputedStyle(el).fontSize)
	);
	expect(size).toBeGreaterThan(40);
	// The above panel's bottom sits a hair above the word's top.
	const gap = await page.evaluate(() => {
		const range = window.getSelection()?.rangeCount
			? window.getSelection()!.getRangeAt(0)
			: null;
		const word = range?.getBoundingClientRect() ?? null;
		if (!word) return null;
		let worst = 0;
		for (const el of document.querySelectorAll(".sel-pinyin.above")) {
			const r = (el as HTMLElement).getBoundingClientRect();
			worst = Math.max(worst, word.top - r.bottom);
		}
		return worst;
	});
	expect(gap).not.toBeNull();
	expect(gap!).toBeLessThanOrEqual(24);
});
