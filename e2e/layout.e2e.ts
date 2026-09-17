import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** The chat pill spans the full row width flush with the + button
(the row × overlays instead of reserving its slot). */
test("active chat pill sits flush with the new-chat button", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.waitForTimeout(600);
	const edges = await page.evaluate(() => {
		const rect = (s: string) => document.querySelector(s)?.getBoundingClientRect();
		const pill = rect("aside ul button.side-chat");
		const plus = rect("aside button.new");
		if (!pill || !plus) throw new Error("no sidebar rows");
		return { pillRight: pill.x + pill.width, plusRight: plus.x + plus.width };
	});
	expect(Math.abs(edges.pillRight - edges.plusRight)).toBeLessThanOrEqual(1);
});

/** Double-clicking the empty gutters opens the nearby sidebar. */
test("gutter double-click opens the nearby sidebar", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.mouse.dblclick(8, 300);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).toHaveClass(/collapsed/);
	const width = await page.evaluate(() => window.innerWidth);
	await page.mouse.dblclick(width - 8, 300);
	await expect(page.locator(".settings-panel")).toBeVisible();
});

/** ⌘+ / ⌘− steps the UI text scale with a percent toast. */
test("command plus and minus scale text", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible();
	await page.keyboard.press("Meta+=");
	await expect(page.locator(".toast")).toContainText("Text size 110%");
	await page.keyboard.press("Meta+-");
	await expect(page.locator(".toast")).toContainText("Text size 100%");
});

/** ⇧⌘+ / ⇧⌘− widens and narrows the chat column with a rem toast. */
test("shift command plus and minus scale chat width", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible();
	await page.keyboard.press("Meta+Shift+=");
	await expect(page.locator(".toast")).toContainText("Chat width 38 rem");
	await page.keyboard.press("Meta+Shift+-");
	await expect(page.locator(".toast")).toContainText("Chat width 36 rem");
});

/** Text size scales messages, never the composer input; annotation
badges track it at a dampened rate (30%: 600% reads ≈2.5× badges). */
test("text size scales messages and badges, not the composer", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	const px = (sel: string) =>
		page.evaluate((s) => {
			const el = document.querySelector(s);
			if (!el) throw new Error(`missing ${s}`);
			return parseFloat(getComputedStyle(el as HTMLElement).fontSize);
		}, sel);
	// A badge in the message rides the same scale var at the dampened rate.
	await page.evaluate(() => {
		const rendered = document.querySelector("article .rendered");
		const badge = document.createElement("button");
		badge.className = "ccez-ann-badge";
		badge.textContent = "1";
		rendered?.appendChild(badge);
	});
	const msgBefore = await px("article .rendered");
	const editorBefore = await px(".prompt .ta-input");
	const badgeBefore = await px("button.ccez-ann-badge");
	await page.keyboard.press("Meta+=");
	await expect(page.locator(".toast")).toContainText("Text size 110%");
	expect(await px("article .rendered")).toBeCloseTo(msgBefore * 1.1, 1);
	expect(await px(".prompt .ta-input")).toBeCloseTo(editorBefore, 1);
	expect(await px("button.ccez-ann-badge")).toBeCloseTo(badgeBefore * 1.03, 1);
});
