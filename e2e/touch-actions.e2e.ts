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
	// ...and rightward (message fold is the leftward stroke now; the
	// row swipe folds nothing either way).
	await swipeFrom(page, `${row} >> nth=0`, 150);
	await expect(page.locator(".settings-panel")).toHaveClass(/closed/);
	await expect(page.locator("article.assistant .actions .icon-btn").first()).not.toHaveClass(/folded/);
	// Control: a leftward stroke off the row DOES open settings (the
	// remap kept mid-screen one-finger left as the settings stroke —
	// see the edge-swipes spec and the shortcuts menu), while a
	// rightward stroke summons the chats list — proving the harness
	// gesture reaches the app.
	await swipeX(page, 300, 150);
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	// The first rightward stroke dismisses settings; the second
	// summons the list (the chats stroke yields to an open panel).
	await swipeX(page, 100, 250);
	await swipeX(page, 100, 250);
	await expect(page.locator("aside:has(button.side-chat)").first()).not.toHaveClass(/collapsed/);
});

/** Synthetic two-finger swipe left: the phone gesture that opens settings. */
async function swipeTwoFingerLeft(page: Page): Promise<void> {
	await page.evaluate(() => {
		const touch = (id: number, x: number, y: number) =>
			new Touch({ identifier: id, target: document.body, clientX: x, clientY: y });
		window.dispatchEvent(
			new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(1, 300, 500), touch(2, 340, 500)] })
		);
		window.dispatchEvent(
			new TouchEvent("touchmove", { bubbles: true, cancelable: true, composed: true, touches: [touch(1, 150, 500), touch(2, 190, 500)] })
		);
		window.dispatchEvent(
			new TouchEvent("touchend", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [],
				changedTouches: [touch(1, 150, 500), touch(2, 190, 500)]
			})
		);
	});
}

test("overlay checkbox ships checked under Messages", async ({ page }) => {
	await seedChat(page, {});
	await swipeTwoFingerLeft(page);
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	const messages = page.locator("fieldset", { has: page.locator("legend", { hasText: "Messages" }) });
	const box = messages.locator('label.check:has-text("Switch message buttons to overlay menu") input');
	await expect(box).toBeChecked();
});

test("overlay pill centers on the tap, clamped to the viewport", async ({ page }) => {
	await seedChat(page, {});
	const userRendered = page.locator("article.user .rendered").first();
	const userRow = page.locator("article.user .actions").first();
	const tap = await userRendered.boundingBox().then((b) => ({ x: (b?.x ?? 0) + (b?.width ?? 0) / 2, y: (b?.y ?? 0) + (b?.height ?? 0) / 2 }));
	await userRendered.click();
	await expect(userRow).toHaveCSS("opacity", "1");
	await expect(userRow).toHaveCSS("position", "absolute");
	const userFit = await userRow.evaluate((el) => {
		const r = el.getBoundingClientRect();
		const kids = [...el.children].filter((k) => getComputedStyle(k).display !== "none");
		const last = kids[kids.length - 1]?.getBoundingClientRect();
		return {
			cx: r.x + r.width / 2,
			top: r.y,
			right: r.x + r.width,
			pillRight: r.x + r.width,
			lastRight: (last?.x ?? 0) + (last?.width ?? 0)
		};
	});
	// Centered on the tap (a line below it), never past the screen edge...
	expect(Math.abs(userFit.cx - tap.x)).toBeLessThanOrEqual(14);
	expect(userFit.top).toBeGreaterThanOrEqual(tap.y);
	expect(userFit.right).toBeLessThanOrEqual(412);
	// ...and snug around the buttons with no dead span.
	expect(userFit.pillRight - userFit.lastRight).toBeLessThanOrEqual(12);
	// The idle speaking dot takes no slot in the overlay.
	const dot = await userRow.locator(".speaking-dot").evaluate((el) => getComputedStyle(el).display);
	expect(dot).toBe("none");
	// Assistant rows center the same way (no side anchoring).
	const asstRendered = page.locator("article.assistant .rendered").first();
	const asstRow = page.locator("article.assistant .actions").first();
	const asstTap = await asstRendered.boundingBox().then((b) => ({ x: (b?.x ?? 0) + (b?.width ?? 0) / 2, y: (b?.y ?? 0) + (b?.height ?? 0) / 2 }));
	await asstRendered.click();
	await expect(asstRow).toHaveCSS("opacity", "1");
	const asstFit = await asstRow.evaluate((el) => {
		const r = el.getBoundingClientRect();
		return { cx: r.x + r.width / 2, top: r.y, x: r.x };
	});
	expect(Math.abs(asstFit.cx - asstTap.x)).toBeLessThanOrEqual(14);
	expect(asstFit.top).toBeGreaterThanOrEqual(asstTap.y);
	expect(asstFit.x).toBeGreaterThanOrEqual(0);
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

test("refs-only messages show every pill button", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
		const msg = (id: string, role: string, content: string) => ({ id, role, content, usage: null, error: null });
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [msg("m1", "user", "Annotated selections:\n1. \"first quote\"\n2. \"second quote\"")]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
	// The own row shrinks to its dash, but the floating pill sizes to
	// its buttons — never to the article.
	await page.locator("article.user .rendered").first().click();
	const row = page.locator("article.user .actions").first();
	await expect(row).toHaveCSS("opacity", "1");
	const fit = await row.evaluate((el) => ({
		scrollW: el.scrollWidth,
		clientW: el.clientWidth,
		buttons: [...el.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().width))
	}));
	expect(fit.buttons.length).toBeGreaterThan(2);
	expect(Math.min(...fit.buttons)).toBeGreaterThan(0);
	expect(fit.scrollW).toBeLessThanOrEqual(fit.clientW + 1);
});

test("a second tap shuts the pill where it opened", async ({ page }) => {
	await seedChat(page, {});
	const article = page.locator("article.assistant").first();
	await page.locator("article.assistant .rendered").first().click();
	const row = page.locator("article.assistant .actions").first();
	await expect(row).toHaveCSS("opacity", "1");
	const anchored = await article.evaluate((el) => el.style.getPropertyValue("--actions-top"));
	expect(anchored).not.toBe("");
	// Toggle shut keeps the tap anchor for the fade: dropping it would
	// yank the pill to the end-anchored fallback mid-fade.
	await page.locator("article.assistant .rendered").first().click();
	await expect(article).toHaveAttribute("data-actions-open", "false");
	expect(await article.evaluate((el) => el.style.getPropertyValue("--actions-top"))).toBe(anchored);
});
