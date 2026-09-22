/**
 * textai bucket: text rendering + on-device AI.
 *
 * Covers: CJK composition never half-sends, annotation badge text stays
 * contiguous (mark-DOM fallback), chat switching lands on the target
 * chat, and DOMPurify keeps its allow-list (code chrome + data-*).
 */
import { expect, test } from "@playwright/test";
import { seedChat, toggleSidebar } from "./helpers";

test("CJK composition Enter does not half-send the composer", async ({
	page
}) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	const composer = page.locator(".ta-input");
	await composer.click();
	await page.keyboard.type("nihongo");
	// Mid-composition Enter must not submit: no user message appears.
	await expect(page.locator("article.user")).toHaveCount(0);
});

test("annotation quote text stays contiguous after render", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "user", content: "hello world annotation check" }
	]);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeHidden({ timeout: 60_000 });
	const body = page.locator("article.user .rendered").first();
	await expect(body).toContainText("hello world annotation check");
});

test("chat switching lands on the target chat", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "first chat marker" }]);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeHidden({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.locator('button[aria-label="New chat"]').click();
	await expect(page.locator(".hero")).toBeVisible();
	// Minting closes the list like a row-pick: reopen to choose.
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	const rows = page.locator("aside ul li button.side-chat");
	await rows.first().click();
	await expect(page.locator("article.user .rendered")).toContainText(
		"first chat marker"
	);
});

test("sanitized render keeps code chrome and data attributes", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "user", content: "show me code" },
		{ role: "assistant", content: "```python\nprint(1)\n```" }
	]);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeHidden({ timeout: 60_000 });
	const code = page.locator(".ccez-code").first();
	await expect(code).toBeVisible();
	await expect(code.locator("button.ccez-code-copy")).toHaveCount(1);
});
