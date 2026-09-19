import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "hello there" },
		{ role: "assistant", content: "hi back at you" }
	]);
	await page.goto("/");
	await expect(page.locator("article.user .actions")).toBeVisible({
		timeout: 60_000
	});
});

for (const role of ["user", "assistant"] as const) {
	test(`${role} row reveals on message hover, hides on leave`, async ({
		page
	}) => {
		const row = page.locator(`article.${role} .actions`);
		const body = page.locator(`article.${role} .rendered`);
		// Hover-reveal is on: the row starts hidden.
		await expect(row).toHaveCSS("opacity", "0");
		// Hovering the message (not just the row) reveals it...
		await body.hover();
		await expect(row).toHaveCSS("opacity", "1");
		// ...moving between body and row keeps it up...
		await row.hover();
		await expect(row).toHaveCSS("opacity", "1");
		// ...leaving the article hides it again.
		await page.mouse.move(2, 2);
		await expect(row).toHaveCSS("opacity", "0");
	});

	test(`${role} row stays while its button holds focus`, async ({ page }) => {
		const row = page.locator(`article.${role} .actions`);
		await row.hover();
		await expect(row).toHaveCSS("opacity", "1");
		// Clicking focuses the button: focus-within keeps the row up
		// after the pointer leaves...
		await page
			.locator(`article.${role} .actions button[data-tip="Copy as plain text"]`)
			.click();
		await page.mouse.move(2, 2);
		await expect(row).toHaveCSS("opacity", "1");
		// ...releasing focus hides it again.
		await page.evaluate(() => {
			if (document.activeElement instanceof HTMLElement)
				document.activeElement.blur();
		});
		await expect(row).toHaveCSS("opacity", "0");
	});
}

test("assistant row hides after fold jumps the layout", async ({ page }) => {
	const row = page.locator("article.assistant .actions");
	await row.hover();
	await expect(row).toHaveCSS("opacity", "1");
	await page
		.locator(
			'article.assistant .actions button[data-tip="Fold this message (F or Option-click)"]'
		)
		.click();
	// The collapse moves the row: leaving it must not trap it visible.
	await page.mouse.move(2, 2);
	await expect(row).toHaveCSS("opacity", "0");
});

test("assistant row stays up after speak click", async ({ page }) => {
	const row = page.locator("article.assistant .actions");
	await row.hover();
	await expect(row).toHaveCSS("opacity", "1");
	// Engaging playback (or focusing its button) keeps the row up: the
	// stop button must stay clickable after the pointer leaves.
	await page
		.locator(
			'article.assistant .actions button[data-tip="Read this message aloud"]'
		)
		.click();
	await page.mouse.move(2, 2);
	await expect(row).toHaveCSS("opacity", "1");
});

test("row stays visible while its button holds keyboard focus", async ({
	page
}) => {
	// No mouse involved: tab-focus must keep its row readable, and
	// releasing focus hides it again. This is the one state where
	// buttons legitimately outlast hovering.
	const row = page.locator("article.assistant .actions");
	const btn = page.locator(
		'article.assistant .actions button[data-tip="Copy as plain text"]'
	);
	await expect(row).toHaveCSS("opacity", "0");
	await btn.focus();
	await expect(row).toHaveCSS("opacity", "1");
	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement)
			document.activeElement.blur();
	});
	await expect(row).toHaveCSS("opacity", "0");
});

/** X cuts the hovered message (clipboard first, then delete);
Shift+D drops it and copies nothing; bare Delete never deletes. */
test("x cuts, shift+D drops, bare Delete spares the hovered message", async ({
	page,
	context
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, [
		{ role: "assistant", content: "cut me" },
		{ role: "assistant", content: "drop me" }
	]);
	await page.goto("/");
	const first = page.locator("article .rendered").first();
	await expect(first).toBeVisible();
	// The prompt autofocuses on load: click empty gutter first so the
	// keystroke reaches the window handler, not the composer.
	await page.mouse.click(8, 200);
	await first.hover();
	await page.keyboard.press("x");
	await expect(page.locator(".toast")).toContainText("Cut to clipboard");
	await expect(
		page.evaluate(() => navigator.clipboard.readText())
	).resolves.toBe("cut me");
	await expect(page.locator("article .rendered")).toHaveCount(1);
	const remaining = page.locator("article .rendered").first();
	await expect(remaining).toContainText("drop me");
	await remaining.hover();
	// Bare Delete is harmless while reading.
	await page.keyboard.press("Delete");
	await expect(page.locator("article .rendered")).toHaveCount(1);
	// Shift+D drops it and copies nothing.
	await page.keyboard.press("Shift+d");
	await expect(page.locator("article .rendered")).toHaveCount(0);
	await expect(
		page.evaluate(() => navigator.clipboard.readText())
	).resolves.toBe("cut me");
});

/** Toasts clear the camera hole: parked below the island even with no
safe-area inset (the WebView may report env() = 0). */
test("toast sits below the status area", async ({ page, context }) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, [{ role: "assistant", content: "cut me" }]);
	await page.goto("/");
	const first = page.locator("article .rendered").first();
	await expect(first).toBeVisible();
	await page.mouse.click(8, 200);
	await first.hover();
	await page.keyboard.press("x");
	const toast = page.locator(".toast");
	await expect(toast).toContainText("Cut to clipboard");
	const top = await toast.evaluate((el) => el.getBoundingClientRect().top);
	expect(top).toBeGreaterThanOrEqual(48);
});
