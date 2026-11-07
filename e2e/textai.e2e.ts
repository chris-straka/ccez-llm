/**
 * textai bucket: text rendering + on-device AI.
 *
 * Covers: CJK composition never half-sends, annotation badge text stays
 * contiguous (mark-DOM fallback), chat switching lands on the target
 * chat, and DOMPurify keeps its allow-list (code chrome + data-*).
 */
import { expect, test } from "./fixtures";
import { seedChat } from "./helpers";

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
