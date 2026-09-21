import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Phone viewports can't fit the 15-language Europe list above the
 * pills, so on touch it renders as a capped sheet: the whole list box
 * must stay inside the viewport (it used to fly off the top).
 */
test.use({
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 },
	hasTouch: true,
	isMobile: true
});

test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".empty-state h1")).toBeVisible({
		timeout: 60_000
	});
});

test("europe list stays inside a phone viewport", async ({ page }) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	const box = await list.boundingBox();
	expect(box, "language list has a box").toBeTruthy();
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(412);
	expect(box!.y + box!.height).toBeLessThanOrEqual(915);
});

/** Picking a language must not hand focus to the composer on phones:
auto-focus pops the keyboard over it instead of pushing it up. */
test("picking a language leaves the composer unfocused", async ({ page }) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	await list.getByRole("menuitem", { name: "French" }).click();
	await expect(list).toHaveCount(0);
	await expect(page.locator(".prompt .ta-input")).not.toBeFocused();
});

/** The last menu hugs the right edge: its long nowrap names used to
trail off the page (left-anchored like the rest). */
test("classics list stays inside a phone viewport", async ({ page }) => {
	await page.locator('.lang-menu button:has-text("Classics")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	const box = await list.boundingBox();
	expect(box, "language list has a box").toBeTruthy();
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(412);
	expect(box!.y + box!.height).toBeLessThanOrEqual(915);
});

/** Long sheets center shrink-wrapped on the screen: the top/bottom
pin read as a massive empty panel (Europe stretched full-band). */
test("europe sheet centers shrink-wrapped on the screen", async ({
	page
}) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	const box = await list.boundingBox();
	expect(box, "language list has a box").toBeTruthy();
	expect(box!.height, "sheet caps instead of stretching").toBeLessThan(915);
	const center = (915 - box!.height) / 2;
	expect(
		Math.abs(box!.y - center),
		"sheet centers vertically on the screen"
	).toBeLessThan(16);
});

/** Short sheets drop under their own pill like a plain menu instead
of floating mid-screen away from the button that opened them. */
test("africa sheet drops shrink-wrapped under its pill", async ({
	page
}) => {
	const pill = page.locator('.lang-menu button:has-text("Africa")');
	await pill.click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	await expect(list).toHaveClass(/lang-list-drop/);
	const pillBox = await pill.boundingBox();
	const box = await list.boundingBox();
	expect(box, "language list has a box").toBeTruthy();
	expect(box!.height, "short sheet shrink-wraps").toBeLessThan(400);
	expect(box!.y, "sheet hugs its pill").toBeGreaterThanOrEqual(
		pillBox!.y + pillBox!.height + 2
	);
	expect(box!.y, "sheet hugs its pill").toBeLessThanOrEqual(
		pillBox!.y + pillBox!.height + 14
	);
});

/** S24-width viewport (360 CSS px): the pill row and sheets must
fit the real phone, not just the 412 default above. */
test.describe("360px phone viewport", () => {
	test.use({ viewport: { width: 360, height: 780 } });

	test.beforeEach(async ({ page }) => {
		await seedChat(page, []);
		await page.goto("/");
		await expect(page.locator(".empty-state h1")).toBeVisible({
			timeout: 60_000
		});
	});

	test("pill row fits without overflow", async ({ page }) => {
		const fit = await page.evaluate(() => {
			const row = document.querySelector(".lang-menus")!;
			const pills = [...row.querySelectorAll(".lang-menu > button")].map(
				(b) => {
					const r = b.getBoundingClientRect();
					return { x: r.x, w: r.width };
				}
			);
			return {
				scrollW: row.scrollWidth,
				clientW: row.clientWidth,
				pills
			};
		});
		expect(fit.scrollW, "pill row never scrolls").toBeLessThanOrEqual(
			fit.clientW + 1
		);
		for (const p of fit.pills) {
			expect(p.x, "pill starts on screen").toBeGreaterThanOrEqual(-1);
			expect(p.x + p.w, "pill ends on screen").toBeLessThanOrEqual(361);
		}
	});

	test("classics sheet fits the narrow viewport", async ({ page }) => {
		await page.locator('.lang-menu button:has-text("Classics")').click();
		const list = page.locator(".lang-list");
		await expect(list).toBeVisible();
		const box = await list.boundingBox();
		expect(box, "language list has a box").toBeTruthy();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(360);
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.y + box!.height).toBeLessThanOrEqual(780);
	});

	test("africa sheet drops under its pill on the narrow viewport", async ({
		page
	}) => {
		const pill = page.locator('.lang-menu button:has-text("Africa")');
		await pill.click();
		const list = page.locator(".lang-list");
		await expect(list).toBeVisible();
		await expect(list).toHaveClass(/lang-list-drop/);
		const pillBox = await pill.boundingBox();
		const box = await list.boundingBox();
		expect(box, "language list has a box").toBeTruthy();
		expect(box!.height, "short sheet shrink-wraps").toBeLessThan(400);
		expect(box!.y, "sheet hugs its pill").toBeGreaterThanOrEqual(
			pillBox!.y + pillBox!.height + 2
		);
		expect(box!.y, "sheet hugs its pill").toBeLessThanOrEqual(
			pillBox!.y + pillBox!.height + 14
		);
	});
});

/** Tapping away closes the sheet without handing the composer focus:
the dead-space tap must not summon the keyboard behind the menu. */
test("tapping away closes the sheet and leaves focus alone", async ({
	page
}) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	// Dead space between the pills and the composer (zone "empty",
	// the tap that used to arm the 380ms summon).
	const pt = await page.evaluate(() => {
		const menus = document
			.querySelector(".lang-menus")!
			.getBoundingClientRect();
		const prompt = document.querySelector(".prompt")!.getBoundingClientRect();
		return {
			x: 200,
			y: Math.round((menus.bottom + prompt.top) / 2)
		};
	});
	await page.touchscreen.tap(pt.x, pt.y);
	await expect(list).toHaveCount(0);
	// Past the dead-space summon window: focus must still be away.
	await page.waitForTimeout(700);
	await expect(page.locator(".prompt .ta-input")).not.toBeFocused();
});
