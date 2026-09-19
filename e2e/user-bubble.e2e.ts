import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/** A short own message stays on one line: the bubble shrink-wraps the
text instead of squeezing it into an early wrap with dead space left. */
test("short own message stays on one line", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "Give me a paragraph in english" }
	]);
	await page.goto("/");
	const rendered = page.locator("article.user .rendered").first();
	await expect(rendered).toBeVisible();
	const lines = await rendered.evaluate((el) => {
		const text = el.querySelector("p")?.firstChild;
		if (!text) return -1;
		const range = document.createRange();
		range.selectNodeContents(text);
		return [...range.getClientRects()].filter((r) => r.width > 1).length;
	});
	expect(lines).toBe(1);
});

/** Maximum text size keeps the own-message bubble intact: radius and
padding stop tracking the font scale past 2x, so the background never
domes into an arch or squeezes the text into a padded tower. */
test("own bubble stays intact at maximum text size", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "Give me a paragraph in english" }
	]);
	await page.addInitScript(() => {
		const raw = window.localStorage.getItem("ccez-llm-settings-v1");
		const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ ...settings, ownBubble: true, fontScale: 6 })
		);
	});
	await page.goto("/");
	const bubble = page.locator("article.user .bubble").first();
	await expect(bubble).toBeVisible();
	const geo = await bubble.evaluate((el) => {
		const style = getComputedStyle(el);
		const rect = el.getBoundingClientRect();
		const text = el.querySelector(".rendered")?.getBoundingClientRect();
		return {
			radius: Number.parseFloat(style.borderTopLeftRadius),
			padLeft: Number.parseFloat(style.paddingLeft),
			bg: style.backgroundColor,
			bubble: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
			text: text
				? { x: text.x, y: text.y, w: text.width, h: text.height }
				: null
		};
	});
	// Capped at the 2x scale point (3.5rem radius, 2rem side padding).
	expect(geo.radius).toBeLessThanOrEqual(60);
	expect(geo.padLeft).toBeLessThanOrEqual(40);
	expect(geo.bg).not.toBe("rgba(0, 0, 0, 0)");
	if (!geo.text) throw new Error("own message text missing");
	expect(geo.text.x).toBeGreaterThan(geo.bubble.x + 8);
	expect(geo.text.y).toBeGreaterThan(geo.bubble.y + 8);
	expect(geo.bubble.x + geo.bubble.w).toBeGreaterThan(
		geo.text.x + geo.text.w + 8
	);
	expect(geo.bubble.y + geo.bubble.h).toBeGreaterThan(
		geo.text.y + geo.text.h + 8
	);
});
