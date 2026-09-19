import { test, expect, type Page } from "@playwright/test";

/**
 * Touch action rows: every row sits in flow under its message and
 * fades like the desktop rows. Tapping a message reveals its row
 * for 3s; double-tapping pins it open while word-selecting natively
 * (the message-end jump moved to the two-finger double-tap). There
 * is no overlay pill and no overlay checkbox.
 */
test.use({
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

async function seedChat(
	page: Page,
	settings: Record<string, unknown>
): Promise<void> {
	await page.addInitScript((extra: Record<string, unknown>) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify(extra));
		const msg = (id: string, role: string, content: string) => ({
			id,
			role,
			content,
			usage: null,
			error: null
		});
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						msg(
							"m1",
							"user",
							"do it with a much longer message so the bubble spans the full phone width"
						),
						msg("m2", "assistant", "done")
					]
				}
			])
		);
	}, settings);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
}

/** Synthetic horizontal swipe (untrusted TouchEvents hit window listeners). */
async function swipeX(page: Page, x0: number, x1: number): Promise<void> {
	await page.evaluate(
		({ x0, x1 }: { x0: number; x1: number }) => {
			const touch = (x: number, y: number) =>
				new Touch({
					identifier: 9,
					target: document.body,
					clientX: x,
					clientY: y
				});
			window.dispatchEvent(
				new TouchEvent("touchstart", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [touch(x0, 600)]
				})
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

/** Synthetic left-edge swipe: the only stroke that summons the chats
list (mid-screen rightward never opens it — those collide with
message gestures). */
async function swipeFromLeftEdge(page: Page): Promise<void> {
	await page.evaluate(() => {
		const touch = (x: number, y: number) =>
			new Touch({
				identifier: 7,
				target: document.body,
				clientX: x,
				clientY: y
			});
		window.dispatchEvent(
			new TouchEvent("touchstart", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [touch(4, 600)]
			})
		);
		window.dispatchEvent(
			new TouchEvent("touchend", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [],
				changedTouches: [touch(144, 604)]
			})
		);
	});
}

/** Synthetic swipe starting on one element (the app decides fold vs
sidebar from where the stroke begins — window dispatch can't test that). */
async function swipeFrom(
	page: Page,
	selector: string,
	dx: number
): Promise<void> {
	await page
		.locator(selector)
		.first()
		.evaluate((el, dx) => {
			const r = el.getBoundingClientRect();
			const x0 = r.x + r.width / 2;
			const y = r.y + r.height / 2;
			const touch = (x: number) =>
				new Touch({ identifier: 9, target: el, clientX: x, clientY: y });
			el.dispatchEvent(
				new TouchEvent("touchstart", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [touch(x0)]
				})
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

test("scrolling the action row folds nothing and summons no sidebar", async ({
	page
}) => {
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
	await expect(
		page.locator("article.assistant .actions .icon-btn").first()
	).not.toHaveClass(/folded/);
	// Control: a leftward stroke off the row DOES open settings (the
	// remap kept mid-screen one-finger left as the settings stroke —
	// see the edge-swipes spec and the shortcuts menu), proving the
	// harness gesture reaches the app.
	await swipeX(page, 300, 150);
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	// A rightward stroke dismisses the open settings; the list itself
	// summons from the left edge only (mid-screen rightward never
	// opens it — those strokes collide with message gestures).
	await swipeX(page, 100, 250);
	await expect(page.locator(".settings-panel")).toHaveClass(/closed/);
	await swipeFromLeftEdge(page);
	await expect(
		page.locator("aside:has(button.side-chat)").first()
	).not.toHaveClass(/collapsed/);
});

/** Synthetic two-finger swipe left: the phone gesture that opens settings. */
async function swipeTwoFingerLeft(page: Page): Promise<void> {
	await page.evaluate(() => {
		const touch = (id: number, x: number, y: number) =>
			new Touch({
				identifier: id,
				target: document.body,
				clientX: x,
				clientY: y
			});
		window.dispatchEvent(
			new TouchEvent("touchstart", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [touch(1, 300, 500), touch(2, 340, 500)]
			})
		);
		window.dispatchEvent(
			new TouchEvent("touchmove", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [touch(1, 150, 500), touch(2, 190, 500)]
			})
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

test("no overlay menu checkbox under Messages", async ({ page }) => {
	await seedChat(page, {});
	await swipeTwoFingerLeft(page);
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	const messages = page.locator("fieldset", {
		has: page.locator("legend", { hasText: "Messages" })
	});
	await expect(
		messages.locator('label.check:has-text("overlay menu")')
	).toHaveCount(0);
});

test("revealed rows sit in flow under the message", async ({ page }) => {
	await seedChat(page, {});
	const userRendered = page.locator("article.user .rendered").first();
	const userRow = page.locator("article.user .actions").first();
	const article = page.locator("article.user").first();
	await userRendered.click();
	await expect(userRow).toHaveCSS("opacity", "1");
	// In flow, never a floating pill: static position, no tap anchor.
	await expect(userRow).toHaveCSS("position", "static");
	expect(
		await article.evaluate((el) => el.style.getPropertyValue("--actions-top"))
	).toBe("");
	// The row sits below the text it belongs to.
	const layout = await page.evaluate(() => {
		const art = document.querySelector("article.user")!;
		const text = art.querySelector(".rendered")!.getBoundingClientRect();
		const row = art.querySelector(".actions")!.getBoundingClientRect();
		return { textBottom: text.bottom, rowTop: row.top, rowWidth: row.width };
	});
	expect(layout.rowTop).toBeGreaterThanOrEqual(layout.textBottom - 4);
	expect(layout.rowWidth).toBeGreaterThan(100);
	// Assistant rows behave the same way.
	const asstRow = page.locator("article.assistant .actions").first();
	await page.locator("article.assistant .rendered").first().click();
	await expect(asstRow).toHaveCSS("opacity", "1");
	await expect(asstRow).toHaveCSS("position", "static");
});

test("in-flow open and close never move the chat", async ({ page }) => {
	await seedChat(page, {});
	const asst = page.locator("article.assistant").first();
	const top = async () => (await asst.boundingBox())?.y ?? -1;
	const before = await top();
	await page.locator("article.assistant .rendered").first().click();
	await expect(page.locator("article.assistant .actions").first()).toHaveCSS(
		"opacity",
		"1"
	);
	expect(await top()).toBeCloseTo(before, 0);
	await expect(page.locator("article.assistant .actions").first()).toHaveCSS(
		"opacity",
		"0",
		{ timeout: 5000 }
	);
	expect(await top()).toBeCloseTo(before, 0);
});

test("in-flow rows reserve space and wear no pill", async ({ page }) => {
	await seedChat(page, {});
	const row = page.locator("article.assistant .actions").first();
	await expect(row).toHaveCSS("position", "static");
	await expect(row).toHaveCSS("opacity", "0");
	const reserved = await row.evaluate(
		(el) => el.getBoundingClientRect().height
	);
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
				return [b.x, b.y, b.width, b.height]
					.map((n) => Math.round(n * 10) / 10)
					.join(",");
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
		const msg = (id: string, role: string, content: string) => ({
			id,
			role,
			content,
			usage: null,
			error: null
		});
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						msg(
							"m1",
							"user",
							'Annotated selections:\n1. "first quote"\n2. "second quote"'
						)
					]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	// The in-flow row sizes to its buttons — never to the article.
	await page.locator("article.user .rendered").first().click();
	const row = page.locator("article.user .actions").first();
	await expect(row).toHaveCSS("opacity", "1");
	const fit = await row.evaluate((el) => ({
		scrollW: el.scrollWidth,
		clientW: el.clientWidth,
		buttons: [...el.querySelectorAll("button")].map((b) =>
			Math.round(b.getBoundingClientRect().width)
		)
	}));
	expect(fit.buttons.length).toBeGreaterThan(2);
	expect(Math.min(...fit.buttons)).toBeGreaterThan(0);
	expect(fit.scrollW).toBeLessThanOrEqual(fit.clientW + 1);
});

test("a second tap shuts the in-flow row", async ({ page }) => {
	await seedChat(page, {});
	const article = page.locator("article.assistant").first();
	await page.locator("article.assistant .rendered").first().click();
	const row = page.locator("article.assistant .actions").first();
	await expect(row).toHaveCSS("opacity", "1");
	// Toggling shut leaves no tap anchor behind: rows sit in flow now.
	await page.locator("article.assistant .rendered").first().click();
	await expect(article).toHaveAttribute("data-actions-open", "false");
	expect(
		await article.evaluate((el) => el.style.getPropertyValue("--actions-top"))
	).toBe("");
	await expect(row).toHaveCSS("position", "static");
});
