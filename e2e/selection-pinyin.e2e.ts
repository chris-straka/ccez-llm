import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Right-clicking a Han character with a live highlight shows pinyin
 * for just the highlighted text (never pinned, never per-message).
 * The highlight clearing dismisses it; anything else right-clicked
 * with a selection keeps speaking as before.
 */
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
	await seedChat(page, [{ role: "assistant", content: "你好世界" }]);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
});

async function spoken(page: Page): Promise<string[]> {
	return page.evaluate(
		() => (window as unknown as { __spoken: string[] }).__spoken ?? []
	);
}

/** Highlight the first two Hanzi of the paragraph via the live selection. */
async function selectFirstTwo(page: Page): Promise<string> {
	return page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const text = p?.firstChild;
		if (!text) return "";
		const selection = window.getSelection();
		selection?.setBaseAndExtent(text, 0, text, 2);
		return selection?.toString() ?? "";
	});
}

async function clickOnText(page: Page): Promise<void> {
	const box = await page
		.locator("article.assistant .rendered p")
		.first()
		.boundingBox();
	if (!box) throw new Error("missing para box");
	await page.mouse.click(box.x + 8, box.y + box.height / 2, {
		button: "right"
	});
}

test("right-clicking a hanzi highlight shows its pinyin only", async ({
	page
}) => {
	const selected = await selectFirstTwo(page);
	expect(selected).toBe("你好");
	await clickOnText(page);
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	// Readings only: the characters are right there in the highlight.
	await expect(panel).toContainText("nǐ");
	await expect(panel).not.toContainText("你好");
	// Speech always runs too: the panel is a silent extra.
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.toContain(selected);
	// Escape dismisses the panel.
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
});

test("clicking off dismisses the panel with the highlight live", async ({
	page
}) => {
	await selectFirstTwo(page);
	await clickOnText(page);
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	// The panel centers on the highlight and hugs it (above when
	// there is headroom, else below).
	const box = await panel.boundingBox();
	const sel = await page.evaluate(() => {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return null;
		const rect = selection.getRangeAt(0).getBoundingClientRect();
		return {
			cx: rect.left + rect.width / 2,
			top: rect.top,
			bottom: rect.bottom
		};
	});
	expect(box).not.toBeNull();
	expect(sel).not.toBeNull();
	expect(
		Math.abs((box?.x ?? -999) + (box?.width ?? 0) / 2 - (sel?.cx ?? -999))
	).toBeLessThan(10);
	const above = await panel.evaluate((el) => el.classList.contains("above"));
	const gap = above
		? (sel?.top ?? -999) - ((box?.y ?? -999) + (box?.height ?? 0))
		: (box?.y ?? -999) - (sel?.bottom ?? -999);
	expect(gap).toBeGreaterThanOrEqual(0);
	expect(gap).toBeLessThan(12);
	await page.mouse.click(5, 5);
	await expect(panel).toHaveCount(0);
});

test("scrolling carries the panel with the highlight", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(
		60
	);
	await seedChat(page, [{ role: "assistant", content: `你好世界\n\n${long}` }]);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
	await selectFirstTwo(page);
	await clickOnText(page);
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	const before = await panel.boundingBox();
	await page.evaluate(() => {
		document.querySelector(".messages")?.scrollBy({ top: 300 });
	});
	await page.waitForTimeout(300);
	const after = await panel.boundingBox();
	expect(before).not.toBeNull();
	expect(after).not.toBeNull();
	// The highlight moved up 300px; the panel rode with it.
	expect((before?.y ?? 0) - (after?.y ?? 0)).toBeGreaterThan(200);
});

test("clearing the highlight dismisses the panel", async ({ page }) => {
	await selectFirstTwo(page);
	await clickOnText(page);
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	await expect(panel).toHaveCount(0);
});

test("a highlight ending mid-sentence keeps one voice", async ({ page }) => {
	// Recording utterance locales, not text: a selection ending in
	// a kana-less fragment ("ます。自然") must not flip to Chinese
	// at the boundary.
	await page.addInitScript(() => {
		const synth = window.speechSynthesis;
		if (synth) {
			synth.speak = ((utterance: SpeechSynthesisUtterance) => {
				const langs = ((window as unknown as { __langs?: string[] }).__langs ??=
					[]);
				langs.push(`${utterance.lang}::${utterance.text}`);
			}) as typeof synth.speak;
		}
	});
	await seedChat(page, [
		{ role: "assistant", content: "昨日は雨が降ります。自然が多かったです。" }
	]);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
	const selected = await page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const text = p?.firstChild;
		if (!text?.textContent) return "";
		const at = text.textContent.indexOf("ます");
		window.getSelection()?.setBaseAndExtent(text, at, text, at + 5);
		return window.getSelection()?.toString() ?? "";
	});
	expect(selected).toBe("ます。自然");
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
	// Two segments ("ます。" + the kana-less fragment "自然"): both
	// must read Japanese — no flip to Chinese at the boundary.
	await expect
		.poll(
			() =>
				page.evaluate(
					() => (window as unknown as { __langs?: string[] }).__langs ?? []
				),
			{ timeout: 10_000 }
		)
		.toEqual(["ja-JP::ます。", "ja-JP::自然"]);
});

test("right-clicking hanzi with no highlight still speaks", async ({
	page
}) => {
	await clickOnText(page);
	await expect.poll(() => spoken(page), { timeout: 10_000 }).not.toEqual([]);
	await expect(page.locator(".sel-pinyin")).toHaveCount(0);
});

test("right-clicking kanji in japanese shows furigana and speaks", async ({
	page
}) => {
	// Like Inspect, a lone Han char reads its locale from the
	// surrounding sentence: kana nearby means Japanese.
	await seedChat(page, [{ role: "assistant", content: "漢字を読む" }]);
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
	expect(selected).toBe("漢字");
	await clickOnText(page);
	const panel = page.locator(".sel-pinyin");
	// Conversion runs in the dictionary worker: the pending mark
	// lands at once, readings follow when the load finishes.
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await expect(panel).toContainText("かんじ", { timeout: 60_000 });
	await expect(panel).not.toContainText("漢字");
	await expect.poll(() => spoken(page), { timeout: 10_000 }).toContain("漢字");
});
