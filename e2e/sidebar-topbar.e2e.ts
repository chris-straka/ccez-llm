import { expect, test, type Page } from "@playwright/test";

const ALPHA = "Alpha active-chat message";
const BRAVO = "Bravo second-chat message";

/** Two chats: the first is active on load (loadChats lands on chats[0]). */
async function seedTwoChats(page: Page): Promise<void> {
	await page.addInitScript(
		({ a, b }: { a: string; b: string }) => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			const chat = (id: string, content: string) => ({
				id,
				createdAt: 1,
				replyLang: null,
				messages: [{ id: `${id}-m`, role: "assistant", content, usage: null, error: null }]
			});
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([chat("chat-a", a), chat("chat-b", b)])
			);
		},
		{ a: ALPHA, b: BRAVO }
	);
}

const chatsAside = (page: Page) => page.locator("aside").first();
const chatRows = (page: Page) => page.locator("aside ul li button.side-chat");

async function openSidebar(page: Page): Promise<void> {
	await page.keyboard.press("Control+b");
	await expect(chatsAside(page)).not.toHaveClass(/collapsed/);
}

test.beforeEach(async ({ page }) => {
	await seedTwoChats(page);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
});

/** Ctrl+Delete drops the current chat and lands on the next one. */
test("ctrl-delete drops the current chat", async ({ page }) => {
	await expect(page.locator("article .rendered").first()).toContainText(ALPHA);
	// Focus leaves the composer so the chord isn't line-kill.
	await page.locator("article .rendered").first().click();
	await page.keyboard.press("Control+Delete");
	await expect(page.locator("article .rendered").first()).toContainText(BRAVO);
	await expect(page.locator("article .rendered")).toHaveCount(1);
});

/** Ctrl+Shift+Delete drops every chat, minting a blank. */
test("ctrl-shift-delete drops every chat", async ({ page }) => {
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.locator("article .rendered").first().click();
	await page.keyboard.press("Control+Shift+Delete");
	await expect(page.locator("article .rendered")).toHaveCount(0);
});

/** Row icons sit adjacent inside reserved title padding: export parks
left of delete, never on the label text (mono titles align). */
test("row export sits by delete, clear of the title", async ({ page }) => {
	await openSidebar(page);
	const row = page.locator("aside ul li").first();
	await row.hover();
	const geom = await page.evaluate(() => {
		const q = (sel: string): HTMLElement | null => document.querySelector(sel);
		const exp = q("aside ul li .exp")?.getBoundingClientRect();
		const del = q("aside ul li .del")?.getBoundingClientRect();
		const title = q("aside ul li .side-chat");
		if (!exp || !del || !title) return null;
		const st = getComputedStyle(title);
		return {
			gap: Math.round(del.left - exp.right),
			padRightPx: parseFloat(st.paddingRight),
			mono: st.fontFamily
		};
	});
	expect(geom).not.toBeNull();
	expect(geom!.gap).toBeLessThanOrEqual(8);
	expect(geom!.padRightPx).toBeGreaterThan(50);
	expect(geom!.mono).toMatch(/monospace/i);
});

/** Clicking a chat closes the sidebar and lands on that chat. */
test("clicking a chat closes the sidebar", async ({ page }) => {
	await openSidebar(page);
	await chatRows(page).nth(1).click();
	await expect(chatsAside(page)).toHaveClass(/collapsed/);
	await expect(page.locator("main .messages")).toContainText(BRAVO);
});

/** Cmd+Shift+H opens on the current chat, so j/k starts there, not the top. */
test("Ctrl+Shift+H opens on the current chat for j/k", async ({ page }) => {
	// Make chat-b (row 1) the current chat first.
	await openSidebar(page);
	await chatRows(page).nth(1).click();
	await expect(chatsAside(page)).toHaveClass(/collapsed/);

	await page.keyboard.press("Control+Shift+H");
	await expect(chatsAside(page)).not.toHaveClass(/collapsed/);
	// Focus lands on the current chat's row (index 1), not the top.
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					[...document.querySelectorAll("aside ul li button.side-chat")].indexOf(
						document.activeElement
					)
			)
		)
		.toBe(1);
	// k steps up (older) from the current chat onto chat-a.
	await page.keyboard.press("k");
	await expect(page.locator("main .messages")).toContainText(ALPHA);
});

/** Double-tap on non-button sidebar areas closes it; buttons keep working. */
test("double-tap on sidebar chrome closes it, on buttons does not", async ({ page }) => {
	await openSidebar(page);
	// A row button double-tap is a button action: the list stays open.
	await chatRows(page).nth(0).dispatchEvent("dblclick");
	await expect(chatsAside(page)).not.toHaveClass(/collapsed/);
	// Non-button sidebar chrome (the list padding) closes the list.
	await page.locator("aside ul").first().dispatchEvent("dblclick");
	await expect(chatsAside(page)).toHaveClass(/collapsed/);
});

/** The find bar floats near the top (25%, never dead center)
instead of pushing content down, while the first message still
bleeds to the window's top edge. Pressing elsewhere dismisses it
without summoning the prompt. */
test("open find floats centered, outside press dismisses", async ({ page }) => {
	await page.keyboard.press("Control+f");
	const bar = page.locator(".find-bar");
	await expect(bar).toBeVisible();
	const geom = await page.evaluate(() => {
		const barEl = document.querySelector(".find-bar") as HTMLElement | null;
		const art = document.querySelector(".messages article") as HTMLElement | null;
		if (!barEl || !art) return null;
		const barBox = barEl.getBoundingClientRect();
		const artBox = art.getBoundingClientRect();
		const barPos = getComputedStyle(barEl).getPropertyValue("position");
		return {
			barPos,
			barCX: barBox.left + barBox.width / 2,
			barCY: barBox.top + barBox.height / 2,
			winW: window.innerWidth,
			winH: window.innerHeight,
			artTop: artBox.top
		};
	});
	expect(geom).not.toBeNull();
	expect(geom!.barPos).toBe("fixed");
	expect(Math.abs(geom!.barCX - geom!.winW / 2)).toBeLessThan(4);
	expect(Math.abs(geom!.barCY - geom!.winH / 4)).toBeLessThan(4);
	expect(geom!.artTop).toBeLessThan(geom!.winH / 2);
	const prompt = page.locator(".prompt");
	const promptBefore = await prompt.getAttribute("class");
	await page.locator("article .rendered").first().click();
	await expect(bar).toBeHidden({ timeout: 5_000 });
	// Dismissing summons nothing: the prompt is exactly as found.
	expect(await prompt.getAttribute("class")).toBe(promptBefore);
});

/** Chat rows read day + 2-digit time, never a message count. */
test("chat rows show 2-digit times with no message count", async ({ page }) => {
	await openSidebar(page);
	const rows = chatRows(page);
	await expect(rows).toHaveCount(2);
	for (let i = 0; i < 2; i++) {
		await expect(rows.nth(i)).toContainText(/\d{2}:\d{2}/);
		await expect(rows.nth(i)).not.toContainText("msg");
	}
});

/** Entering an empty chat from the list lands in a focused composer. */
test("space on an empty chat focuses the prompt", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
		const msg = (id: string, content: string) => ({
			id,
			role: "assistant",
			content,
			usage: null,
			error: null
		});
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{ id: "chat-full", createdAt: 2, replyLang: null, messages: [msg("f1", "hello there")] },
				{ id: "chat-empty", createdAt: 1, replyLang: null, messages: [] }
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
	await openSidebar(page);
	// Opening lands keyboard focus on the current row (Ctrl+Shift+H
	// would just toggle the list shut again). Step down to the empty
	// chat, enter it.
	await expect
		.poll(
			() =>
				page.evaluate(
					() => !!(document.activeElement as HTMLElement | null)?.closest("aside ul li button.side-chat")
				),
			{ timeout: 10_000 }
		)
		.toBe(true);
	await page.keyboard.press("j");
	await page.keyboard.press("Space");
	await expect(chatsAside(page)).toHaveClass(/collapsed/);
	await expect
		.poll(
			() =>
				page.evaluate(
					() => !!(document.activeElement as HTMLElement | null)?.closest(".prompt .ta-input")
				),
			{ timeout: 10_000 }
		)
		.toBe(true);
});

/** Bare Space on an empty chat lands in the composer: with no messages
there is nothing to scroll, so the key focuses the prompt instead. */
test("space on an empty chat with focus outside focuses the prompt", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([{ id: "chat-empty", createdAt: 1, replyLang: null, messages: [] }])
		);
	});
	await page.goto("/");
	await expect(page.locator(".prompt .ta-input").first()).toBeVisible({ timeout: 60_000 });
	// Leave the composer: the empty chat has nowhere to scroll.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
	await expect
		.poll(
			() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.tagName ?? "NONE"),
			{ timeout: 10_000 }
		)
		.toBe("BODY");
	await page.keyboard.press("Space");
	await expect
		.poll(
			() =>
				page.evaluate(
					() => !!(document.activeElement as HTMLElement | null)?.closest(".prompt .ta-input")
				),
			{ timeout: 10_000 }
		)
		.toBe(true);
});
