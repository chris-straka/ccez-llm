import { test, expect, type Page } from "@playwright/test";

/**
 * Touch action-row modes: the overlay pill (default) floats over the
 * chat and shrink-wraps its buttons, while the opt-out in-flow row
 * reserves its line and fades like the desktop rows.
 */
test.use({
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

async function seedChat(page: Page, settings: Record<string, unknown>): Promise<void> {
	await page.addInitScript((extra: Record<string, unknown>) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify(extra));
		const msg = (id: string, role: string, content: string) => ({ id, role, content, usage: null, error: null });
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [msg("m1", "user", "do it with a much longer message so the bubble spans the full phone width"), msg("m2", "assistant", "done")] }
			])
		);
	}, settings);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
}

/** Synthetic horizontal swipe (untrusted TouchEvents hit window listeners). */
async function swipeX(page: Page, x0: number, x1: number): Promise<void> {
	await page.evaluate(
		({ x0, x1 }: { x0: number; x1: number }) => {
			const touch = (x: number, y: number) =>
				new Touch({ identifier: 9, target: document.body, clientX: x, clientY: y });
			window.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(x0, 600)] })
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(x1, 604)]
				})
			);
		},
		{ x0, x1 }
	);
}

/** Synthetic swipe starting on one element (the app decides fold vs
sidebar from where the stroke begins — window dispatch can't test that). */
async function swipeFrom(page: Page, selector: string, dx: number): Promise<void> {
	await page
		.locator(selector)
		.first()
		.evaluate((el, dx) => {
			const r = el.getBoundingClientRect();
			const x0 = r.x + r.width / 2;
			const y = r.y + r.height / 2;
			const touch = (x: number) => new Touch({ identifier: 9, target: el, clientX: x, clientY: y });
			el.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(x0)] })
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(x0 + dx)]
				})
			);
		}, dx);
}

test("scrolling the action row folds nothing and summons no sidebar", async ({ page }) => {
	await seedChat(page, {});
	const row = "article.assistant .actions";
	// Open the row like a tap would, so the stroke starts on live buttons.
	await page.locator("article.assistant .rendered").first().click();
	await expect(page.locator(row).first()).toHaveCSS("opacity", "1");
	// Leftward (the overflow scroll that used to open settings)...
	await swipeFrom(page, `${row} >> nth=0`, -150);
	await expect(page.locator(".settings-panel")).toHaveClass(/closed/);
	// ...and rightward (the same stroke used to fold the message).
	await swipeFrom(page, `${row} >> nth=0`, 150);
	await expect(page.locator(".settings-panel")).toHaveClass(/closed/);
	await expect(page.locator("article.assistant .actions .icon-btn").first()).not.toHaveClass(/folded/);
	// Control: the same leftward stroke off the row still opens settings,
	// proving the harness gesture reaches the app at all.
	await swipeX(page, 300, 150);
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
});

test("overlay checkbox ships checked under Messages", async ({ page }) => {
	await seedChat(page, {});
	await swipeX(page, 408, 268);
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	const messages = page.locator("fieldset", { has: page.locator("legend", { hasText: "Messages" }) });
	const box = messages.locator('label.check:has-text("Switch message buttons to overlay menu") input');
	await expect(box).toBeChecked();
});

test("overlay pill hugs the buttons, anchored to the message side", async ({ page }) => {
	await seedChat(page, {});
	const userRow = page.locator("article.user .actions").first();
	await page.locator("article.user .rendered").first().click();
	await expect(userRow).toHaveCSS("opacity", "1");
	await expect(userRow).toHaveCSS("position", "absolute");
	const userFit = await userRow.evaluate((el) => {
		const r = el.getBoundingClientRect();
		const kids = [...el.children].filter((k) => getComputedStyle(k).display !== "none");
		const last = kids[kids.length - 1]?.getBoundingClientRect();
		const article = el.closest("article")?.getBoundingClientRect();
		return { pillRight: r.x + r.width, lastRight: (last?.x ?? 0) + (last?.width ?? 0), articleRight: (article?.x ?? 0) + (article?.width ?? 0), pillW: r.width, articleW: article?.width ?? 0 };
	});
	// No dead span past the last button; the pill is narrower than the article...
	expect(userFit.pillRight - userFit.lastRight).toBeLessThanOrEqual(12);
	expect(userFit.pillW).toBeLessThan(userFit.articleW - 20);
	// ...and hugs the right edge for own rows.
	expect(userFit.articleRight - userFit.pillRight).toBeLessThanOrEqual(8);
	// The idle speaking dot takes no slot in the overlay.
	const dot = await userRow.locator(".speaking-dot").evaluate((el) => getComputedStyle(el).display);
	expect(dot).toBe("none");
	// Assistant rows hug the left edge instead.
	const asstRow = page.locator("article.assistant .actions").first();
	await page.locator("article.assistant .rendered").first().click();
	await expect(asstRow).toHaveCSS("opacity", "1");
	const asstFit = await asstRow.evaluate((el) => {
		const r = el.getBoundingClientRect();
		const article = el.closest("article")?.getBoundingClientRect();
		return { pillX: r.x, articleX: article?.x ?? 0, pillW: r.width, articleW: article?.width ?? 0 };
	});
	expect(asstFit.pillX - asstFit.articleX).toBeLessThanOrEqual(8);
	expect(asstFit.pillW).toBeLessThan(asstFit.articleW - 20);
});

test("overlay open and close never move the chat", async ({ page }) => {
	await seedChat(page, {});
	const asst = page.locator("article.assistant").first();
	const top = async () => (await asst.boundingBox())?.y ?? -1;
	const before = await top();
	await page.locator("article.assistant .rendered").first().click();
	await expect(page.locator("article.assistant .actions").first()).toHaveCSS("opacity", "1");
	expect(await top()).toBeCloseTo(before, 0);
	await expect(page.locator("article.assistant .actions").first()).toHaveCSS("opacity", "0", { timeout: 5000 });
	expect(await top()).toBeCloseTo(before, 0);
});

test("in-flow rows reserve space and wear no pill", async ({ page }) => {
	await seedChat(page, { overlayActions: false });
	const row = page.locator("article.assistant .actions").first();
	await expect(row).toHaveCSS("position", "static");
	await expect(row).toHaveCSS("opacity", "0");
	const reserved = await row.evaluate((el) => el.getBoundingClientRect().height);
	expect(reserved).toBeGreaterThan(10);
	const bg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
	expect(bg).toBe("rgba(0, 0, 0, 0)");
	const asst = page.locator("article.assistant").first();
	const top = async () => (await asst.boundingBox())?.y ?? -1;
	const before = await top();
	const boxes = async () =>
		row.evaluate((el) =>
			[...el.children].map((k) => {
				const b = k.getBoundingClientRect();
				return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10).join(",");
			})
		);
	const buttonsBefore = await boxes();
	await page.locator("article.assistant .rendered").first().click();
	await expect(row).toHaveCSS("opacity", "1");
	expect(await top()).toBeCloseTo(before, 0);
	// Fade only: every button keeps its box to the subpixel.
	expect(await boxes()).toEqual(buttonsBefore);
});
