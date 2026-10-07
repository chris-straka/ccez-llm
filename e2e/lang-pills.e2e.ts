import { expect, test } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * The region pills under the hero share one row and one height in
 * both engines: WebKit gives an emoji-presentation sequence (the
 * Classics 🏛️) a taller line box than plain emoji.
 */
test("region pills share one row and one height", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	const pills = page.locator(".lang-menus .lang-menu > button");
	await expect(pills).toHaveCount(4, { timeout: 60_000 });
	const boxes = await pills.evaluateAll((els) =>
		els.map((el) => {
			const r = el.getBoundingClientRect();
			return { top: Math.round(r.top), height: Math.round(r.height) };
		})
	);
	expect(new Set(boxes.map((b) => b.top)).size).toBe(1);
	expect(new Set(boxes.map((b) => b.height)).size).toBe(1);
});
