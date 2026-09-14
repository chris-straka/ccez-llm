import { devices, expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** Staging (Alt+Enter, no reply stream) pins the scroller to the true
bottom: measuring in the send tick reads the pre-append height and the
scroll stops short by the new message (the short-landing send bug —
a tall viewport can still show the message, so assert the scroller,
not visibility). */
test("staging pins the scroller to the true bottom", async ({ page }) => {
	const history = Array.from({ length: 12 }, (_, i) => ({
		role: i % 2 === 0 ? "user" : "assistant",
		content: `history filler paragraph ${i} with enough words to wrap several lines on any phone or desktop column`
	}));
	await seedChat(page, [...history, { role: "assistant", content: "ready" }]);
	await page.goto("/");
	// seedChat presets never-idle, so the composer is clickable even
	// with thirteen messages overflowing the viewport.
	await page.locator(".cm-content").click();
	await page.keyboard.type("staged hello");
	await page.keyboard.press("Alt+Enter");
	await expect(page.locator("article.user").last()).toContainText("staged hello");
	// The smooth scroll lands after the render: poll past the motion.
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const el = document.querySelector("main .messages");
				return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 999;
			})
		)
		.toBeLessThanOrEqual(2);
});

/** The composer box dwarfs a one-line draft: tapping its empty floor
focuses the editor instead of dying on the container. */
test("clicking the composer floor focuses and types", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	// Mounted only — never clicked, so only the floor tap can focus.
	await page.locator(".cm-content").first().waitFor({ timeout: 60_000 });
	const box = await page.locator(".prompt").boundingBox();
	if (!box) throw new Error("composer lost its box");
	await page.mouse.click(box.x + 30, box.y + box.height - 12);
	await page.keyboard.type("floor tap");
	await expect(page.locator(".cm-content")).toContainText("floor tap");
});

test("phone floor tap focuses the textarea", async ({ browser }) => {
	const ctx = await browser.newContext({ ...devices["iPhone 15"] });
	const page = await ctx.newPage();
	try {
		await seedChat(page, []);
		await page.goto("/");
		await page.locator(".ta-input").first().waitFor({ timeout: 60_000 });
		const box = await page.locator(".prompt").boundingBox();
		if (!box) throw new Error("composer lost its box");
		await page.touchscreen.tap(box.x + 30, box.y + box.height - 12);
		await expect(page.locator(".ta-input")).toBeFocused();
	} finally {
		await ctx.close();
	}
});

test("prompt types and sends without vim", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".cm-content").click();
	await page.keyboard.type("hello world");
	await expect(page.locator(".cm-content")).toContainText("hello world");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.user .rendered")).toContainText("hello world");
	// Ctrl+G still hops out to scroll mode.
	await page.locator(".cm-content").click();
	await page.keyboard.press("Control+g");
	await expect(page.locator(".cm-content")).toContainText("ctrl+g to hop back in");
});

/** j past the newest message drops back into the prompt. */
test("j on the newest message returns to the prompt", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "one" },
		{ role: "assistant", content: "two" }
	]);
	await page.goto("/");
	await page.locator(".cm-content").click();
	await page.keyboard.press("Control+g");
	await expect(page.locator('.app[data-focus-mode="scroll"]')).toHaveCount(1);
	// G lands on the newest message; j past it hops back to edit mode.
	await page.keyboard.press("G");
	await page.keyboard.press("j");
	await expect(page.locator('.app[data-focus-mode="edit"]')).toHaveCount(1);
});

/** The prompt grows with the draft, then stops and scrolls inside. */
test("long drafts cap the prompt height and scroll", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".cm-content").click();
	for (let i = 0; i < 15; i++) {
		await page.keyboard.type(`draft line ${i + 1}`);
		await page.keyboard.press("Shift+Enter");
	}
	const sizes = await page.evaluate(() => {
		const scroller = document.querySelector(".prompt .cm-scroller");
		if (!(scroller instanceof HTMLElement)) return null;
		return { client: scroller.clientHeight, scroll: scroller.scrollHeight };
	});
	if (!sizes) throw new Error("prompt scroller missing");
	// 12rem cap ≈ 192px at the default root size; stay well under it
	// while the content overflows into a scroll.
	expect(sizes.client).toBeLessThanOrEqual(210);
	expect(sizes.scroll).toBeGreaterThan(sizes.client);
});

/** The prompt review card fades in on hover and out on leave (opacity
and visibility transition, never a display snap). */
test("prompt review card fades in and out", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "fading review card" }]);
	await page.goto("/");
	await page.locator('article .rendered:has-text("fading review card")').first().selectText();
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.press("Enter");
	const pill = page.locator(".prompt-tools .ann-pill");
	await expect(pill).toBeVisible();
	const card = page.locator(".ann-wrap .review");
	const opacity = () => card.evaluate((el) => getComputedStyle(el).opacity);
	// Closed: invisible but laid out (display fade needs the box).
	expect(await opacity()).toBe("0");
	const box = await pill.boundingBox();
	if (!box) throw new Error("pill has no box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect.poll(opacity, { timeout: 2000 }).toBe("1");
	await page.mouse.move(4, 300);
	await expect.poll(opacity, { timeout: 2000 }).toBe("0");
});

/** The draft text uses the same typeface as the chat messages — the
composer is a message being written, not a code editor. */
test("prompt typeface matches the chat typeface", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "same typeface" }]);
	await page.goto("/");
	// Raw evaluate does not auto-wait like locators do: hold for
	// hydration before reading computed styles.
	await page.locator(".prompt .cm-content").waitFor();
	await page.locator('article[id^="msg-"] .rendered').waitFor();
	const fonts = await page.evaluate(() => {
		const cm = document.querySelector(".prompt .cm-content");
		const msg = document.querySelector('article[id^="msg-"] .rendered');
		if (!(cm instanceof HTMLElement) || !(msg instanceof HTMLElement)) return null;
		return {
			prompt: getComputedStyle(cm).fontFamily,
			message: getComputedStyle(msg).fontFamily,
		};
	});
	if (!fonts) throw new Error("prompt or message node missing");
	expect(fonts.prompt).toBe(fonts.message);
	expect(fonts.prompt).not.toMatch(/fira|mono/i);
});

/** The document never scrolls: every pane moves inside .app, so iOS
can't pan the page (and the header pill) up when the keyboard opens.
Real keyboard travel is device-only; this pins the rule. */
test("document scroll is locked", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".cm-content").first().waitFor({ timeout: 60_000 });
	const overflow = await page.evaluate(() => ({
		html: getComputedStyle(document.documentElement).overflow,
		body: getComputedStyle(document.body).overflow
	}));
	expect(overflow.html).toBe("hidden");
	expect(overflow.body).toBe("hidden");
});

/** A cleared highlight drops the menu at once — taps elsewhere and
handle collapses never pass through the summon paths, so without a
selectionchange dismiss the menu stranded until the 2.5s timer. */
test("a cleared highlight drops the menu at once", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "prompt halo" }]);
	await page.goto("/");
	await page.locator('article .rendered:has-text("prompt halo")').first().selectText();
	await page.mouse.up();
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	await expect(menu).toHaveCount(0, { timeout: 1500 });
});

/** Scrolling never dismisses a live selection menu on desktop: the
menu tracks its highlight (trackSelMenu) instead of dying in
noteScrolling. */
test("scrolling keeps a live selection menu", async ({ page }) => {
	const history = Array.from({ length: 12 }, (_, i) => ({
		role: i % 2 === 0 ? "user" : "assistant",
		content: `history filler paragraph ${i} with enough words to wrap several lines on any phone or desktop column`
	}));
	await seedChat(page, [...history, { role: "assistant", content: "halo keeper" }]);
	await page.goto("/");
	await page.locator('article .rendered:has-text("halo keeper")').first().selectText();
	await page.mouse.up();
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	await page.mouse.wheel(0, -400);
	await page.waitForTimeout(600);
	await expect(menu).toBeVisible();
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("halo");
});

/** Sidebar hover preview yields to a live highlight: glancing at
another chat neither swaps the column nor drops the menu. */
test("sidebar hover keeps a live highlight and its menu", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		const chat = (id: string, content: string) => ({
			id,
			createdAt: 1,
			replyLang: null,
			messages: [{ id: `${id}-m0`, role: "assistant", content, usage: null, error: null }]
		});
		// The first chat is active on load.
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([chat("e2e-active", "halo keeper"), chat("e2e-other", "other chat body")])
		);
	});
	await page.goto("/");
	await page.locator('article .rendered:has-text("halo keeper")').first().selectText();
	await page.mouse.up();
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	// The other chat's row: without the yield this previews it (menu
	// gone, column swapped); with it, nothing moves.
	await page.locator("aside ul li button.side-chat").nth(1).hover();
	await page.waitForTimeout(400);
	await expect(menu).toBeVisible();
	await expect(page.locator("main .messages")).toContainText("halo keeper");
	await expect(page.locator("main .messages")).not.toContainText("other chat body");
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("halo");
});
