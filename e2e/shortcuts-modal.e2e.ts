import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Shortcuts-modal pile: the first entry names the modal toggle
 * ("Shortcuts show/hide" + middle-click), the list stays pithy
 * with no parentheticals, right-click speak is listed again,
 * and middle-click anywhere opens the modal.
 */
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "hello" },
		{ role: "assistant", content: "hi there" }
	]);
	await page.goto("/");
	await page.locator(".prompt .cm-content").waitFor({ timeout: 60_000 });
});

async function openShortcuts(page): Promise<void> {
	await page.keyboard.press("Control+Shift+Slash");
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeVisible({
		timeout: 10_000
	});
}

test("first entry toggles the modal; list is pithy with current keys", async ({ page }) => {
	await openShortcuts(page);
	const keys = page.locator(".modal .keys");
	// First entry owns the modal toggle.
	expect(await keys.locator("div > dt").first().innerText()).toBe("Shortcuts show/hide");
	await expect(keys.locator("div").first()).toContainText("middle-click");
	// Newer global keys are folded in.
	for (const name of ["Scroll", "New chat", "Edit own message", "Summon / hide window"]) {
		await expect(keys.locator("div > dt", { hasText: name })).toBeVisible();
	}
	await expect(keys.locator("div", { hasText: "ctrl+u/ctrl+d" })).toBeVisible();
	// Right-click speak is listed (a second right-click restarts, never stops).
	await expect(keys.locator("div > dt", { hasText: "Speak text aloud" })).toBeVisible();
	// No paren spam in the entry copy (each dd reads flat).
	const details = await keys.locator("dd").allInnerTexts();
	expect(details.join("\n")).not.toContain("(");
});

test("middle-click opens the shortcuts modal", async ({ page }) => {
	await openShortcuts(page);
	await page.keyboard.press("Escape");
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeHidden({
		timeout: 10_000
	});
	await page.mouse.click(640, 300, { button: "middle" });
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeVisible({
		timeout: 10_000
	});
});

test("filter narrows the list and reports no matches", async ({ page }) => {
	await openShortcuts(page);
	const filter = page.locator(".shortcuts-filter");
	await expect(filter).toBeVisible();
	await filter.fill("delete every");
	const rows = page.locator(".modal .keys div > dt");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toHaveText("Delete every chat");
	await filter.fill("zzz-no-such-row");
	await expect(page.locator(".modal .keys-empty")).toBeVisible();
	await expect(rows).toHaveCount(0);
});

test("Cmd+F focuses the modal filter, never chat find", async ({ page }) => {
	await openShortcuts(page);
	const filter = page.locator(".shortcuts-filter");
	await page.keyboard.press("Control+f");
	await expect(filter).toBeFocused();
	await expect(page.locator(".find-bar")).toHaveCount(0);
	// Typing in the filter triggers no bindings: no edit box opens.
	await filter.pressSequentially("edit");
	await expect(page.locator(".msg-edit")).toHaveCount(0);
	await expect(page.locator(".find-bar")).toHaveCount(0);
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeVisible();
});

/** j/k/u/d scroll the open modal like the main chat, contained: the
messages column never moves. */
test("modal j/k/u/d scroll contained", async ({ page }) => {
	// Long thread behind a short viewport: the main column scrolls,
	// so containment (it never moves) actually proves something.
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(30);
	await page.addInitScript((text: string) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
		const turns = [0, 1, 2, 3, 4, 5].flatMap((n) => [
			{ id: `e2e-m${n}a`, role: "user", content: `question ${n} ${text}`, usage: null, error: null },
			{ id: `e2e-m${n}b`, role: "assistant", content: `answer ${n} ${text}`, usage: null, error: null }
		]);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: turns }])
		);
	}, long);
	await page.setViewportSize({ width: 1280, height: 400 });
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
	await openShortcuts(page);
	const modal = page.locator(".modal-veil .modal");
	await expect(modal).toBeVisible();
	// Body focus (not the filter field): keys scroll, never type.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
	const boxTop = await page.evaluate(() => document.querySelector(".messages")?.scrollTop ?? -1);
	const half = await modal.evaluate((el) => Math.floor(el.clientHeight / 2));
	expect(half).toBeGreaterThan(0);
	await page.keyboard.press("d");
	await expect
		.poll(() => modal.evaluate((el) => el.scrollTop), { timeout: 10_000 })
		.toBeGreaterThan(half * 0.8);
	expect(await page.evaluate(() => document.querySelector(".messages")?.scrollTop ?? -2)).toBe(boxTop);
	await page.keyboard.press("u");
	await expect.poll(() => modal.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBe(0);
	await page.keyboard.press("j");
	await expect.poll(() => modal.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(0);
	expect(await page.evaluate(() => document.querySelector(".messages")?.scrollTop ?? -2)).toBe(boxTop);
});
