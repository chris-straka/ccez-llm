import { test, expect } from "@playwright/test";
import { seedChat, rowBoxes, expectBoxesStable } from "./helpers";

const ARTICLE = "article.assistant";
const AID_TITLE = "Add tashkeel";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "مرحبا بالعالم" }]);
	await page.goto("/");
	await expect(page.locator(`${ARTICLE} .actions`)).toBeVisible({ timeout: 60_000 });
});

test("hovering the action row moves no button and leaves no stuck hover", async ({
	page
}) => {
	const row = page.locator(`${ARTICLE} .actions`);
	const aidBtn = page.locator(`${ARTICLE} .actions button[data-tip="${AID_TITLE}"]`);

	// Hover-reveal is on: the row starts hidden.
	await expect(row).toHaveCSS("opacity", "0");
	const before = await rowBoxes(page, ARTICLE);

	// Hover the aid button: the row fades in and the button takes its
	// hover color, but no box anywhere in the row may shift.
	await aidBtn.hover();
	await expect(row).toHaveCSS("opacity", "1");
	await expect(aidBtn).toHaveCSS("color", "rgb(28, 28, 30)");
	expectBoxesStable(before, await rowBoxes(page, ARTICLE));

	// Move away: the row hides again and the button color returns to
	// base — a stuck :hover fails this.
	await page.mouse.move(2, 2);
	await expect(row).toHaveCSS("opacity", "0");
	await expect(aidBtn).toHaveCSS("color", "rgb(110, 110, 115)");
	expectBoxesStable(before, await rowBoxes(page, ARTICLE));
});

test("clicking tashkeel pins it, and show-original restores the text", async ({
	page
}) => {
	const body = page.locator(`${ARTICLE} .rendered`);
	const aidBtn = page.locator(`${ARTICLE} .actions button[data-tip="${AID_TITLE}"]`);

	await aidBtn.hover();
	await aidBtn.click();
	// The mock provider resolves immediately: the aid pins, and the
	// revert control reads in Arabic, not generic English.
	const showOriginal = page.locator(
		`${ARTICLE} .actions button[data-tip="Back to the original text"]`
	);
	await expect(showOriginal).toHaveText("إبداعي");
	await expect(body).toContainText("Mock reply to:");

	await showOriginal.click();
	await expect(aidBtn).toBeVisible();
	await expect(body).toContainText("مرحبا");
});

/** Tashkeel composes with pinyin: pinning the model aid keeps the
ruby on the Chinese lines instead of replacing it. */
test("tashkeel keeps pinned pinyin up", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "你好世界\nمرحبا بالعالم" }]);
	await page.goto("/");
	const actions = page.locator(`${ARTICLE} .actions`);
	const body = page.locator(`${ARTICLE} .rendered`);
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await actions.locator('button:has-text("拼音")').click();
	await expect(body.locator("ruby").first()).toBeVisible({ timeout: 60_000 });
	const aidBtn = page.locator(`${ARTICLE} .actions button[data-tip="${AID_TITLE}"]`);
	await aidBtn.hover();
	await aidBtn.click();
	await expect(body).toContainText("Mock reply to:", { timeout: 60_000 });
	// Both: vocalized text shows, ruby still on the Chinese.
	expect(await body.locator("ruby").count()).toBeGreaterThan(0);
});

/** Tashkeel on a multilingual message vocalizes the Arabic line only:
other scripts stay byte-identical instead of vanishing with the
whole-text replace. */
test("tashkeel keeps non-Arabic paragraphs", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "日本語の文です\nمرحبا بالعالم\nEnglish text" }]);
	await page.goto("/");
	const body = page.locator(`${ARTICLE} .rendered`);
	await expect(page.locator(`${ARTICLE} .actions`)).toBeVisible({ timeout: 60_000 });
	const aidBtn = page.locator(`${ARTICLE} .actions button[data-tip="${AID_TITLE}"]`);
	await aidBtn.hover();
	await aidBtn.click();
	await expect(body).toContainText("Mock reply to:", { timeout: 60_000 });
	// The Arabic line went to the model; the rest never moved.
	await expect(body).toContainText("日本語の文です");
	await expect(body).toContainText("English text");
});

/** Arabic+Japanese+Chinese offers all three aids side by side. */
test("a trilingual message offers tashkeel, furigana, and pinyin", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "مرحبا بالعالم\nこんにちは！\n你好！" }
	]);
	await page.goto("/");
	const actions = page.locator(`${ARTICLE} .actions`);
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await expect(actions.locator(`button[data-tip="${AID_TITLE}"]`)).toBeVisible();
	await expect(actions.locator('button:has-text("読み仮名")')).toBeVisible();
	await expect(actions.locator('button:has-text("拼音")')).toBeVisible();
});

/** Pinning pinyin keeps code and math blocks: ruby stamps onto the
rendered HTML, so equations stay rendered and fences stay fenced. */
test("pinyin keeps code and math blocks", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "中文段落在这里。\n\n```python\nprint('你好')\n```\n\n$$E = mc^2$$" }
	]);
	await page.goto("/");
	const actions = page.locator(`${ARTICLE} .actions`);
	const body = page.locator(`${ARTICLE} .rendered`);
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await actions.locator('button:has-text("拼音")').click();
	await expect(body.locator("ruby").first()).toBeVisible({ timeout: 60_000 });
	// The fence is still a code block and the equation still KaTeX —
	// never raw source text (the hidden raw pre keeps the TeX for
	// copy, so assert renderedness, not absence).
	await expect(body.locator(".ccez-code pre code")).toBeVisible();
	expect(await body.locator(".ccez-math .katex").count()).toBeGreaterThan(0);
	await expect(body.locator(".ccez-math-raw")).toBeHidden();
	await expect(body).not.toContainText("```python");
});
