import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/** Record speechSynthesis utterances (browser TTS has no audio to hear). */
async function armSpeechSpy(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as Record<string, unknown>).__spoken = seen;
		const synth = window.speechSynthesis;
		const real = synth.speak.bind(synth);
		synth.speak = (u: SpeechSynthesisUtterance) => {
			seen.push(u.text);
			real(u);
		};
	});
}

async function spoken(page: Page): Promise<string[]> {
	return page.evaluate(
		() =>
			((window as unknown as Record<string, unknown>).__spoken as string[]) ??
			[]
	);
}

/** Screen center of the first base-text occurrence of a char (readings
skipped: a hit on ruby text would speak the kana, never the kanji). */
async function charCenter(
	page: Page,
	article: string,
	char: string
): Promise<{ x: number; y: number }> {
	const point = await page.locator(article).evaluate((root, target) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (node.parentElement?.closest("rt, rp, .frt")) continue;
			const i = (node.textContent ?? "").indexOf(target);
			if (i < 0) continue;
			const range = document.createRange();
			range.setStart(node, i);
			range.setEnd(node, i + 1);
			const rect = range.getBoundingClientRect();
			if (rect.width === 0) continue;
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		}
		return null;
	}, char);
	if (!point) throw new Error(`char ${char} has no box`);
	return point;
}

async function rightClick(page: Page, x: number, y: number): Promise<void> {
	await page.mouse.click(x, y, { button: "right" });
}

test("right-click speaks ruby-wrapped pinyin words", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "如果您有任何问题或需要帮助，请随时告诉我。" }
	]);
	await armSpeechSpy(page);
	await page.goto("/");
	const body = page.locator("article.assistant .rendered");
	await expect(body).toBeVisible({ timeout: 60_000 });
	await page
		.locator('article.assistant .actions button[data-tip="Add pinyin"]')
		.click();
	await expect(body.locator("ruby, rt").first()).toBeVisible({
		timeout: 30_000
	});
	// 您 carries pinyin ruby now: the click lands on elements, but the
	// hanzi still speaks (never the reading).
	const at = await charCenter(page, "article.assistant", "您");
	await rightClick(page, at.x, at.y);
	await expect
		.poll(() => spoken(page).then((lines) => lines.length), {
			timeout: 10_000
		})
		.toBeGreaterThan(0);
	expect((await spoken(page)).join("")).toContain("您");
});

test("right-click speaks ruby-wrapped furigana words", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "どうぞお気軽にお知らせください。" }
	]);
	await armSpeechSpy(page);
	await page.goto("/");
	const body = page.locator("article.assistant .rendered");
	await expect(body).toBeVisible({ timeout: 60_000 });
	await page
		.locator('article.assistant .actions button[data-tip="Add furigana"]')
		.click();
	await expect(body.locator(".frb, .frt").first()).toBeVisible({
		timeout: 30_000
	});
	const at = await charCenter(page, "article.assistant", "知");
	await rightClick(page, at.x, at.y);
	await expect
		.poll(() => spoken(page).then((lines) => lines.length), {
			timeout: 10_000
		})
		.toBeGreaterThan(0);
	expect((await spoken(page)).join("")).toContain("知");
});

test("right-click on open message space speaks nothing", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "short" }]);
	await armSpeechSpy(page);
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	// Inside the article's own padding: no word, no selection — not a
	// listen moment, so no read starts.
	const box = await article.boundingBox();
	if (!box) throw new Error("message has no box");
	await rightClick(page, box.x + box.width - 4, box.y + box.height / 2);
	await page.waitForTimeout(800);
	expect(await spoken(page)).toEqual([]);
});
