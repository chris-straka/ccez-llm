import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").first().click();
});

/** ```lang + Shift+Enter closes the fence with the caret on the body line. */
test("fence opener plus shift-enter builds a python block", async ({ page }) => {
	const box = page.locator(".ta-input").first();
	await page.keyboard.type("```python");
	await page.keyboard.press("Shift+Enter");
	await expect(box).toHaveValue("```python\n\n```");
	// The caret sits on the empty body line: typed code lands in the block…
	await page.keyboard.type("def hi():");
	await expect(box).toHaveValue("```python\ndef hi():\n```");
	// …and Shift+Enter stays inside the block as a newline (plain Enter
	// submits the prompt by design).
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("    pass");
	await expect(box).toHaveValue("```python\ndef hi():\n    pass\n```");
});

/** A second Shift+Enter on the empty body exits past the fence. */
test("shift-enter on an empty body exits the block", async ({ page }) => {
	const box = page.locator(".ta-input").first();
	await page.keyboard.type("```js");
	await page.keyboard.press("Shift+Enter");
	await expect(box).toHaveValue("```js\n\n```");
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("hi");
	// Still one fence, and the typed text landed past its closing line.
	await expect(box).toHaveValue("```js\n\n```\nhi");
});

/** An empty fence still closes: bare ``` gets its closing line. */
test("empty fence still closes", async ({ page }) => {
	const box = page.locator(".ta-input").first();
	await page.keyboard.type("```");
	await page.keyboard.press("Shift+Enter");
	await expect(box).toHaveValue("```\n\n```");
});

/** Backticks inside a body never nest: a lang-tagged inner fence stays
body text — one block, typed text verbatim. */
test("inner backticks never nest", async ({ page }) => {
	const box = page.locator(".ta-input").first();
	await page.keyboard.type("```python");
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("x = 1");
	await page.keyboard.press("Shift+Enter");
	// Typed, never committed: inner backticks change nothing.
	await page.keyboard.type("```note");
	await expect(box).toHaveValue("```python\nx = 1\n```note\n```");
});
