import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

const ALPHA = "Alpha active-chat message";

const chatsAside = (page: Page) => page.locator("aside").first();
const chatRows = (page: Page) => page.locator("aside ul li button.side-chat");

async function openSidebar(page: Page): Promise<void> {
	await page.keyboard.press("Control+b");
	await expect(chatsAside(page)).not.toHaveClass(/collapsed/);
}

/** Prompt jump icon stays off desktop: the far-right ticks own jumps. */
test("no prompt jump icon on desktop", async ({ page }) => {
	await seedChat(
		page,
		Array.from({ length: 8 }, (_, i) => ({
			role: i % 2 === 0 ? "user" : ("assistant" as const),
			content: `filler message ${i} with enough words to wrap`
		}))
	);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	await expect(page.locator(".wp-jump")).toHaveCount(0);
	await expect(page.locator('nav[aria-label="Waypoints"]')).toBeVisible();
});

/** Overlay opens at the middle option; hover-outside closes it; clicking
an option jumps the history there. Hovering the tick stack reveals the
menu (the reveal covers its own trigger, so the mouse path is
hover-open — the button toggle is the keyboard path, pinned in
waypoints.e2e.ts). */
test("waypoint menu opens mid-list and dismisses on leave", async ({
	page
}) => {
	await seedChat(
		page,
		Array.from({ length: 15 }, (_, i) => ({
			role: i % 2 === 0 ? "user" : ("assistant" as const),
			content: `filler message ${i} with enough words to wrap`
		}))
	);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	const menu = page.locator(".wp-menu");
	const items = menu.locator('button[role="menuitem"]');
	const hoverTrigger = async (): Promise<void> => {
		const trigger = await page.locator(".wp-btn").boundingBox();
		if (!trigger) throw new Error("missing wp trigger");
		await page.mouse.move(
			trigger.x + trigger.width / 2,
			trigger.y + trigger.height / 2
		);
		await expect(menu).toBeVisible({ timeout: 15_000 });
	};
	// Opens at the middle option, not the top.
	await hoverTrigger();
	const count = await items.count();
	expect(count).toBeGreaterThan(2);
	const mid = Math.floor((count - 1) / 2);
	await expect
		.poll(async () => {
			const handle = await menu.elementHandle();
			if (!handle) return false;
			return items.nth(mid).evaluate((el, menuEl) => {
				const r = el.getBoundingClientRect();
				const m = (menuEl as HTMLElement).getBoundingClientRect();
				return r.top >= m.top && r.bottom <= m.bottom;
			}, handle);
		})
		.toBe(true);
	// Hovering outside (messages column) closes the menu.
	const box = await page.locator("main .messages").boundingBox();
	if (!box) throw new Error("missing messages box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect(menu).not.toBeVisible();
	// Clicking an option carries the history there, and the menu drops
	// on hover-out. The jump is smooth-scrolled, so poll through it.
	await hoverTrigger();
	const scroller = page.locator("main .messages");
	const before = await scroller.evaluate((el) => el.scrollTop);
	await items.nth(mid).click();
	await expect
		.poll(() => scroller.evaluate((el, b) => el.scrollTop - b, before))
		.toBeGreaterThan(100);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect(menu).not.toBeVisible();
});

/** Space with nothing selected focuses the prompt (the stay-vs-enter
branch itself is pinned in scrollkeys.test.ts, where sideIdx -1
provably stays put instead of clamping to the top chat). */
test("space with no selection focuses the prompt", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: ALPHA }]);
	await page.goto("/");
	await expect(page.locator("main .messages")).toContainText(ALPHA);
	await openSidebar(page);
	// Focus a row without selecting it (sideIdx stays -1).
	await chatRows(page)
		.nth(0)
		.evaluate((el) => (el as HTMLElement).focus());
	await page.keyboard.press("Space");
	// List closed, prompt focused, same chat on screen.
	await expect(chatsAside(page)).toHaveClass(/collapsed/);
	await expect(page.locator("main .messages")).toContainText(ALPHA);
	await expect
		.poll(() =>
			page.evaluate(() => document.activeElement?.closest(".ta-input") !== null)
		)
		.toBe(true);
});

/** Sidebar counter caps at 99+. */
test("message counter caps at 99+", async ({ page }) => {
	// Seed 105 directly: the seed init script re-runs on reload, so a
	// mid-test storage write would be wiped by the reload meant to show it.
	await seedChat(
		page,
		Array.from({ length: 105 }, (_, i) => ({
			role: "user" as const,
			content: `bulk message ${i} with enough words to wrap`
		}))
	);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	await openSidebar(page);
	await expect(chatRows(page).first()).toContainText("99+");
});

/** Export/del share one fixed box: no hover shift, bigger X. */
test("row buttons share a fixed box", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await openSidebar(page);
	const row = page.locator("aside ul li").first();
	await row.hover();
	const exp = row.locator(".exp");
	const del = row.locator(".del");
	const before = await exp.boundingBox();
	if (!before) throw new Error("missing exp box");
	await exp.hover();
	const after = await exp.boundingBox();
	if (!after) throw new Error("missing exp box after hover");
	expect(after.width).toBe(before.width);
	expect(after.height).toBe(before.height);
	expect(after.x).toBe(before.x);
	expect(after.y).toBe(before.y);
	const delBox = await del.boundingBox();
	if (!delBox) throw new Error("missing del box");
	expect(delBox.width).toBe(before.width);
	expect(delBox.height).toBe(before.height);
});
