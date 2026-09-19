import { test, expect, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

test.use({
	hasTouch: true,
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

async function seedEmpty(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [] }
			])
		);
	});
	await page.goto("/");
	await expect(page.locator(".lang-menus")).toBeVisible();
}

test.describe("gestures", () => {
	/**
	 * Android milestone (S24 Galaxy): key chords don't exist on a phone, so
	 * the shortcuts modal teaches touch gestures. Double-tap on empty
	 * space is the only sidebar opener — rightward strokes only dismiss,
	 * two-finger double-tap jumps to the bottom, three-finger tap
	 * deletes the message, three-finger hold wipes. These specs pin
	 * the UA-gated branches that ship on desktop today.
	 */
	test.beforeEach(async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "hello" }]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
	});

	/** Synthetic right-edge swipe: opens nothing on phones (it only ever
	folded the chats list) — asserts the one-finger swipe left never
	opens settings. */
	async function swipeFromRightEdge(page: Page): Promise<void> {
		const width = await page.evaluate(() => window.innerWidth);
		await page.evaluate((w: number) => {
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
					touches: [touch(w - 4, 600)]
				})
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(w - 140, 604)]
				})
			);
		}, width);
	}

	test("shortcuts modal teaches touch gestures on Android", async ({
		page
	}) => {
		// Settings opens from the chats-list button (one-finger swipes
		// never open it): summon the list, then walk the button path.
		await swipeFromLeftEdge(page);
		await page.locator("aside button.side-settings").click();
		await page.locator('button:has-text("Show all gestures")').click();
		// No title on phones: the filter owns the head row.
		await expect(page.locator("#shortcuts-heading")).toHaveCount(0);
		const modal = page.locator(".modal-veil");
		// Exact-match the row (a substring match would also hit siblings).
		await expect(modal.locator('dt:text-is("Chats list")')).toBeVisible();
		await expect(
			modal.locator('dd:has-text("Double-tap empty space")')
		).toBeVisible();
		// The list row teaches its two openers; the switcher owns the
		// double-tap now, and fold and settings rows exist.
		await expect(modal.locator('dt:text-is("Chats list") + dd')).toHaveText(
			"Swipe right · two-finger swipe right"
		);
		await expect(modal.locator('dt:text-is("fold chat msg")')).toBeVisible();
		await expect(modal.locator('dt:text-is("Settings")')).toBeVisible();
		await expect(modal.locator('dt:has-text("Chats sidebar")')).toHaveCount(0);
		await expect(modal.locator('dd:has-text("Chats list button")')).toHaveText(
			"Swipe left off messages · chats list button · two-finger swipe left"
		);
		await expect(
			modal.locator('dt:text-is("Newer / older chat")')
		).toBeVisible();
		await expect(
			modal.locator('dd:has-text("Three-finger swipe right")')
		).toHaveText("Three-finger swipe right / left");
		await expect(modal.locator('dt:text-is("Top of chat")')).toBeVisible();
		await expect(
			modal.locator('dd:has-text("Two-finger swipe up")')
		).toHaveText("Two-finger swipe up · gg");
		await expect(modal.locator('dt:text-is("Bottom of chat")')).toBeVisible();
		await expect(
			modal.locator('dd:has-text("Two-finger swipe down")')
		).toHaveText("Two-finger swipe down · G");
		await expect(modal.locator('dt:text-is("Chat switcher")')).toBeVisible();
		await expect(modal.locator('dt:text-is("Chat switcher") + dd')).toHaveText(
			"Two-finger hold · double-tap empty space · swipe cycles · loops"
		);
		await expect(modal.locator('dt:text-is("Message end")')).toBeVisible();
		await expect(modal.locator('dt:text-is("Message end") + dd')).toHaveText(
			"Double two-finger tap"
		);
		await expect(modal.locator('dt:text-is("Delete a message")')).toBeVisible();
		await expect(
			modal.locator('dt:text-is("Delete a message") + dd')
		).toHaveText("Three-finger tap");
		await expect(
			modal.locator('dt:text-is("Delete every chat")')
		).toBeVisible();
		await expect(
			modal.locator('dt:text-is("Delete every chat") + dd')
		).toHaveText("Three-finger hold");
	});

	/** Synthetic edge swipe (untrusted TouchEvents still hit window listeners). */
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
					changedTouches: [touch(140, 604)]
				})
			);
		});
	}

	/** Synthetic two-finger swipe (left opens settings, right steps
	newer — same untrusted-event path as the one-finger strokes). */
	async function swipeTwoFinger(
		page: Page,
		x0: number,
		x1: number
	): Promise<void> {
		await page.evaluate(
			({ x0, x1 }: { x0: number; x1: number }) => {
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
						touches: [touch(1, x0, 500), touch(2, x0 + 40, 500)]
					})
				);
				window.dispatchEvent(
					new TouchEvent("touchmove", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [touch(1, x1, 500), touch(2, x1 + 40, 500)]
					})
				);
				window.dispatchEvent(
					new TouchEvent("touchend", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [],
						changedTouches: [touch(1, x1, 500), touch(2, x1 + 40, 500)]
					})
				);
			},
			{ x0, x1 }
		);
	}

	test("edge swipes summon and fold the chat sidebar", async ({ page }) => {
		const aside = page.locator("aside:has(button.side-chat)");
		const panel = page.locator(".settings-panel");
		// A rightward stroke summons the list...
		await swipeFromLeftEdge(page);
		await expect(aside).not.toHaveClass(/collapsed/);
		// ...and never toggles it shut: a repeat summon is a no-op.
		await swipeFromLeftEdge(page);
		await expect(aside).not.toHaveClass(/collapsed/);
		// Only a leftward stroke folds the open list.
		await swipeMidScreen(page, 260, 150);
		await expect(aside).toHaveClass(/collapsed/);
		// ...a one-finger swipe from the right edge opens settings...
		await swipeFromRightEdge(page);
		await expect(panel).not.toHaveClass(/closed/);
		// ...and so does a two-finger swipe left...
		await swipeMidScreen(page, 4, 144);
		await expect(panel).toHaveClass(/closed/);
		await swipeTwoFinger(page, 300, 150);
		await expect(panel).not.toHaveClass(/closed/);
		// ...but a rightward stroke still dismisses an open settings.
		await swipeFromLeftEdge(page);
		await expect(panel).toHaveClass(/closed/);
		await expect(aside).toHaveClass(/collapsed/);
	});

	/** Synthetic mid-screen swipe (same untrusted-event path as edges). */
	async function swipeMidScreen(
		page: Page,
		x0: number,
		x1: number
	): Promise<void> {
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

	test("mid-screen swipe right never opens the chat sidebar", async ({
		page
	}) => {
		const aside = page.locator("aside:has(button.side-chat)");
		const panel = page.locator(".settings-panel");
		// Mid-screen rightward summons nothing (the list opens from
		// the left edge only) — and never toggles anything shut.
		await swipeMidScreen(page, 150, 260);
		await expect(aside).toHaveClass(/collapsed/);
		// The edge stroke still summons...
		await swipeFromLeftEdge(page);
		await expect(aside).not.toHaveClass(/collapsed/);
		// ...a mid-screen rightward never toggles the open list shut...
		await swipeMidScreen(page, 150, 260);
		await expect(aside).not.toHaveClass(/collapsed/);
		// ...a leftward stroke folds it back (and never opens settings)...
		await swipeMidScreen(page, 260, 150);
		await expect(aside).toHaveClass(/collapsed/);
		await expect(panel).toHaveClass(/closed/);
		// ...settings opens from a two-finger swipe left...
		await swipeTwoFinger(page, 300, 150);
		await expect(panel).not.toHaveClass(/closed/);
		// ...and a rightward stroke still dismisses an open settings.
		await swipeMidScreen(page, 150, 260);
		await expect(panel).toHaveClass(/closed/);
		await expect(aside).toHaveClass(/collapsed/);
	});

	test("mid-screen swipe left opens settings, folds the list", async ({
		page
	}) => {
		const panel = page.locator(".settings-panel");
		const aside = page.locator("aside:has(button.side-chat)");
		// Fresh load starts shut: a leftward stroke opens settings...
		await swipeMidScreen(page, 260, 150);
		await expect(panel).not.toHaveClass(/closed/);
		await expect(aside).toHaveClass(/collapsed/);
		// ...a rightward stroke closes it...
		await swipeMidScreen(page, 150, 260);
		await expect(panel).toHaveClass(/closed/);
		// ...a rightward stroke with all shut summons nothing now
		// (the list opens from the left edge only)...
		await swipeMidScreen(page, 150, 260);
		await expect(aside).toHaveClass(/collapsed/);
		// ...but with the list open, a leftward stroke folds it
		// instead of opening settings (same precedence the
		// rightward test above pins the other way).
		await swipeFromLeftEdge(page);
		await expect(aside).not.toHaveClass(/collapsed/);
		await swipeMidScreen(page, 260, 150);
		await expect(aside).toHaveClass(/collapsed/);
		await expect(panel).toHaveClass(/closed/);
		// ...while settings also opens from a two-finger swipe left.
		await swipeTwoFinger(page, 300, 150);
		await expect(panel).not.toHaveClass(/closed/);
	});
});

test.describe("share", () => {
	/**
	 * Share-into-chat (Android ACTION_SEND): the system Share sheet lists
	 * the app via the MainActivity SEND filter, MainActivity forwards
	 * EXTRA_TEXT through the annotate-external bridge, and the frontend
	 * prefills the composer (see MainActivity.handleSend and the
	 * annotate-external listener in +page.svelte). The native intent half
	 * is device-only and NOT covered here — no Android toolchain runs in
	 * this harness, so verify on a real device/CI with: share a URL from
	 * Chrome into the app cold (killed) and warm (running), and confirm
	 * the composer prefills exactly once each time. These specs pin the
	 * user-visible end state the bridge produces, through the
	 * web-reachable equivalent: shared text arriving in the phone
	 * composer lands verbatim, stays editable, and sends as a message.
	 */
	const SHARE = "Look at this\nhttps://example.com/menu";

	test("shared text lands verbatim in an empty phone composer", async ({
		page
	}) => {
		await seedEmpty(page);
		// The bridge prefills an empty draft with the share as-is.
		const box = page.locator(".prompt .ta-input");
		await box.click();
		await box.fill(SHARE);
		await expect(box).toHaveValue(SHARE);
		// Still editable: the user can add a question above the share.
		await box.evaluate((el) => {
			if (el instanceof HTMLTextAreaElement) el.setSelectionRange(0, 0);
		});
		await page.keyboard.type("what is this? ");
		await expect(box).toHaveValue(`what is this? ${SHARE}`);
	});

	test("a share into an empty app sends as the first message", async ({
		page
	}) => {
		await seedEmpty(page);
		// Cold-start share outcome: the app opens on a chat whose first
		// user message carries the shared text.
		const box = page.locator(".prompt .ta-input");
		await box.click();
		await box.fill(SHARE);
		await page.locator(".send-btn").click();
		const sent = page
			.locator("article.user")
			.filter({ hasText: "example.com/menu" });
		await expect(sent).toBeVisible({ timeout: 15000 });
	});
});

test.describe("touch", () => {
	/**
	 * Android touch batch: one-line region pills, the chats drawer, the
	 * touch selection menu with Speak, three-finger chat steps,
	 * two-finger bottom jump, three-finger message delete plus hold
	 * wipe, sidebar mutual exclusion, and the theme pin. Same
	 * UA-gated branches as android.e2e.ts, S24-class viewport.
	 */
	/** Touch-summon a highlight: a tap plus a programmatic range, the
	same dance the dock tests below share (trusted taps only reach
	button handlers; the selection itself is drawn by hand). */
	async function summonTouchSelection(page: Page): Promise<void> {
		const box = await page.locator("article .rendered").first().boundingBox();
		if (!box) throw new Error("no message box");
		await page.evaluate(
			({ x, y }: { x: number; y: number }) => {
				const touch = (id: number) =>
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
						touches: [touch(1)]
					})
				);
				const rendered = document.querySelector("article .rendered");
				const sel = window.getSelection();
				sel?.removeAllRanges();
				const range = document.createRange();
				if (rendered) range.selectNodeContents(rendered);
				sel?.addRange(range);
				window.dispatchEvent(
					new TouchEvent("touchend", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [],
						changedTouches: [touch(1)]
					})
				);
			},
			{ x: box.x + box.width / 2, y: box.y + box.height / 2 }
		);
	}

	async function seedTwoChats(page: Page): Promise<void> {
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
					{
						id: "chat-a",
						createdAt: 1,
						replyLang: null,
						messages: [msg("m1", "alpha-aaa")]
					},
					{
						id: "chat-b",
						createdAt: 2,
						replyLang: null,
						messages: [msg("m2", "beta-bbb")]
					}
				])
			);
		});
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
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

	/** Touch has no hover, so each chat row prints a short message
	count after the timestamp (the tooltip's full split lives on
	the hover tip, never in the row where it truncated). */
	test("chat rows print the message count on a phone", async ({ page }) => {
		await seedChat(page, [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello back" }
		]);
		await page.goto("/");
		const row = page.locator("aside ul li .side-chat").first();
		await expect(row).toBeVisible({ timeout: 15_000 });
		await expect(row).toContainText("· 2 msgs");
	});

	test("region menus share one row on a phone", async ({ page }) => {
		await seedEmpty(page);
		const wrap = await page
			.locator(".lang-menus")
			.evaluate((el) => getComputedStyle(el).flexWrap);
		expect(wrap).toBe("nowrap");
		const buttons = page.locator(".lang-menus .lang-menu > button");
		expect(await buttons.count()).toBe(4);
		const boxes = [];
		for (let i = 0; i < 4; i++) boxes.push(await buttons.nth(i).boundingBox());
		const ys = new Set(boxes.map((b) => Math.round(b?.y ?? -1)));
		expect(ys.size).toBe(1);
		const right = Math.max(...boxes.map((b) => (b?.x ?? 0) + (b?.width ?? 0)));
		expect(right).toBeLessThanOrEqual(412);
	});

	test("chats list is a left drawer covering ~3/4 width on a phone", async ({
		page
	}) => {
		await seedEmpty(page);
		const aside = page.locator("aside:has(button.new)");
		// Docked left, full height, square corners — not a bottom sheet.
		const pos = await aside.evaluate((el) => {
			const s = getComputedStyle(el);
			return {
				left: s.left,
				top: s.top,
				bottom: s.bottom,
				radius: s.borderTopLeftRadius,
				width: parseFloat(s.width)
			};
		});
		expect(pos.left).toBe("0px");
		expect(pos.top).toBe("0px");
		expect(pos.bottom).toBe("0px");
		expect(pos.radius).toBe("0px");
		// ~3/4 of the 412px viewport (min(78vw, 20rem) across root sizes).
		expect(pos.width).toBeGreaterThanOrEqual(280);
		expect(pos.width).toBeLessThanOrEqual(340);
	});

	/** Synthetic two-finger double-tap (bottom jump on Android). */
	async function doubleTapTwoFinger(page: Page): Promise<void> {
		for (let tap = 0; tap < 2; tap++) {
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
						touches: [touch(1, 200, 500), touch(2, 240, 500)]
					})
				);
				window.dispatchEvent(
					new TouchEvent("touchend", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [],
						changedTouches: [touch(1, 200, 500), touch(2, 240, 500)]
					})
				);
			});
			if (tap === 0) await page.waitForTimeout(120);
		}
	}

	/** Synthetic two-finger swipe: left opens settings, right summons the list. */
	async function swipeTwoFinger(
		page: Page,
		x0: number,
		x1: number
	): Promise<void> {
		await page.evaluate(
			({ x0, x1 }: { x0: number; x1: number }) => {
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
						touches: [touch(1, x0, 500), touch(2, x0 + 40, 500)]
					})
				);
				window.dispatchEvent(
					new TouchEvent("touchmove", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [touch(1, x1, 500), touch(2, x1 + 40, 500)]
					})
				);
				window.dispatchEvent(
					new TouchEvent("touchend", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [],
						changedTouches: [touch(1, x1, 500), touch(2, x1 + 40, 500)]
					})
				);
			},
			{ x0, x1 }
		);
	}

	test("swipes summon and fold on a phone", async ({ page }) => {
		await seedEmpty(page);
		const aside = page.locator("aside:has(button.new)");
		const panel = page.locator(".settings-panel");
		// A one-finger swipe from the right edge opens settings
		// (anything off a message or the prompt does)...
		await swipeX(page, 408, 268);
		await expect(panel).not.toHaveClass(/closed/);
		// ...a rightward stroke closes settings instead of summoning chats.
		await swipeX(page, 4, 144);
		await expect(panel).toHaveClass(/closed/);
		// ...settings opens from a two-finger swipe left instead; a
		// rightward stroke closes settings instead of summoning chats.
		await swipeTwoFinger(page, 300, 150);
		await expect(panel).not.toHaveClass(/closed/);
		// The composer stays mounted under open drawers (no park
		// slide): visible behind both the panel and the list below.
		await expect(page.locator(".prompt")).toBeVisible();
		await swipeX(page, 4, 144);
		await expect(panel).toHaveClass(/closed/);
		await expect(aside).toHaveClass(/collapsed/);
		// A rightward stroke with everything shut summons the list...
		await swipeX(page, 4, 144);
		await expect(aside).not.toHaveClass(/collapsed/);
		// ...and the composer stays up behind it too.
		await expect(page.locator(".prompt")).toBeVisible();
		// ...and never toggles it shut; a leftward stroke folds it
		// without opening settings.
		await swipeX(page, 4, 144);
		await expect(aside).not.toHaveClass(/collapsed/);
		await swipeX(page, 268, 128);
		await expect(aside).toHaveClass(/collapsed/);
		await expect(panel).toHaveClass(/closed/);
		// Two-finger double-tap jumps instead of summoning (and
		// never deletes): the list stays shut, the chat remains.
		const chats = await page.locator("aside button.side-chat").count();
		await doubleTapTwoFinger(page);
		await expect(aside).toHaveClass(/collapsed/);
		expect(await page.locator("aside button.side-chat").count()).toBe(chats);
		// Settings still opens from a two-finger swipe left after that.
		await swipeTwoFinger(page, 300, 150);
		await expect(panel).not.toHaveClass(/closed/);
	});

	test("two-finger swipe left opens settings on a phone", async ({ page }) => {
		await seedEmpty(page);
		const panel = page.locator(".settings-panel");
		await swipeTwoFinger(page, 300, 150);
		await expect(panel).not.toHaveClass(/closed/);
	});

	test("two-finger swipe right summons the chats list", async ({ page }) => {
		await seedEmpty(page);
		const aside = page.locator("aside:has(button.new)");
		const panel = page.locator(".settings-panel");
		await expect(aside).toHaveClass(/collapsed/);
		// Two fingers freed from chat steps now summon like the
		// one-finger rightward stroke does.
		await swipeTwoFinger(page, 150, 310);
		await expect(aside).not.toHaveClass(/collapsed/);
		// ...and close an open settings panel instead of stacking.
		await swipeTwoFinger(page, 300, 150);
		await expect(panel).not.toHaveClass(/closed/);
		await swipeTwoFinger(page, 150, 310);
		await expect(panel).toHaveClass(/closed/);
	});

	test("three-finger swipe steps to the newer chat", async ({ page }) => {
		await seedTwoChats(page);
		const before = await page.locator("article .rendered").first().innerText();
		// Chat steps moved to three fingers (right steps newer); the
		// lead finger's lift carries the travel, so no move event needed.
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
					touches: [touch(1, 150, 500), touch(2, 190, 500), touch(3, 230, 500)]
				})
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [
						touch(1, 310, 500),
						touch(2, 350, 500),
						touch(3, 390, 500)
					]
				})
			);
		});
		// The step lands through a view transition: poll instead of a
		// one-shot read, or the assertion races the re-render and sees
		// the old chat. A broken step still fails the poll honestly.
		await expect
			.poll(async () => page.locator("article .rendered").first().innerText(), {
				timeout: 10_000
			})
			.not.toBe(before);
	});

	test("two-finger hold opens the chat switcher", async ({ page }) => {
		await seedTwoChats(page);
		const veil = page.locator(".chat-switcher");
		await expect(veil).toHaveCount(0);
		const before = await page.locator("article .rendered").first().innerText();
		// Both fingers rest on the chat: the 500ms hold fires while
		// down, and the release after it must not swipe or delete.
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
					touches: [touch(1, 200, 500), touch(2, 240, 500)]
				})
			);
		});
		await page.waitForTimeout(700);
		await page.evaluate(() => {
			const touch = (id: number, x: number, y: number) =>
				new Touch({
					identifier: id,
					target: document.body,
					clientX: x,
					clientY: y
				});
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(1, 200, 500), touch(2, 240, 500)]
				})
			);
		});
		await expect(veil).toBeVisible();
		// The release paired nothing: same chat still showing.
		expect(await page.locator("article .rendered").first().innerText()).toBe(
			before
		);
		// Newer arrow cycles without closing; Escape closes.
		await veil.locator('button[aria-label="Newer chat"]').click();
		await expect
			.poll(async () => page.locator("article .rendered").first().innerText(), {
				timeout: 10_000
			})
			.not.toBe(before);
		await expect(veil).toBeVisible();
		// Swipes anywhere on the veil cycle too, looping past either
		// end: three leftward swipes over two chats must visit the far
		// chat and come back (a stick or mint never returns).
		const veilSwipe = (x0: number, x1: number) =>
			veil.evaluate(
				(el, [a, b]) => {
					const touch = (x: number) =>
						new Touch({ identifier: 11, target: el, clientX: x, clientY: 400 });
					el.dispatchEvent(
						new TouchEvent("touchstart", {
							bubbles: true,
							cancelable: true,
							composed: true,
							touches: [touch(a)]
						})
					);
					el.dispatchEvent(
						new TouchEvent("touchend", {
							bubbles: true,
							cancelable: true,
							composed: true,
							touches: [],
							changedTouches: [touch(b)]
						})
					);
				},
				[x0, x1] as [number, number]
			);
		const pos = () => veil.locator(".switcher-pos").innerText();
		const startPos = await pos();
		await veilSwipe(300, 140);
		await expect.poll(pos, { timeout: 10_000 }).not.toBe(startPos);
		await veilSwipe(300, 140);
		await expect.poll(pos, { timeout: 10_000 }).toBe(startPos);
		await expect(veil).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(veil).toHaveCount(0);
	});

	test("two-finger swipe left opens settings from a highlight", async ({
		page
	}) => {
		await seedTwoChats(page);
		const panel = page.locator(".settings-panel");
		await expect(panel).toHaveClass(/closed/);
		// A live highlight used to self-veto message-start swipes (the
		// swipe picks text on the way down): settings still opens.
		await page
			.locator("article.assistant .rendered")
			.first()
			.evaluate((el) => {
				const selection = window.getSelection();
				if (selection) {
					const range = document.createRange();
					range.selectNodeContents(el);
					selection.removeAllRanges();
					selection.addRange(range);
				}
				const touch = (id: number, x: number, y: number) =>
					new Touch({ identifier: id, target: el, clientX: x, clientY: y });
				el.dispatchEvent(
					new TouchEvent("touchstart", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [touch(1, 300, 500), touch(2, 340, 500)]
					})
				);
				el.dispatchEvent(
					new TouchEvent("touchend", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [],
						changedTouches: [touch(1, 150, 500), touch(2, 190, 500)]
					})
				);
			});
		await expect(panel).not.toHaveClass(/closed/);
	});

	test("sidebar delete rumbles the triple thump", async ({ page }) => {
		await seedTwoChats(page);
		await swipeTwoFinger(page, 150, 310);
		const aside = page.locator("aside:has(button.side-chat)");
		await expect(aside).not.toHaveClass(/collapsed/);
		// Spy the vibrator, then drop the first row: deletes thump
		// triple (done), distinct from the ticks of opens and folds.
		await page.evaluate(() => {
			const w = window as unknown as { __vib: unknown[] };
			w.__vib = [];
			const nav = navigator as unknown as {
				vibrate: (pattern: unknown) => boolean;
			};
			nav.vibrate = (pattern: unknown) => {
				w.__vib.push(pattern);
				return true;
			};
		});
		await aside
			.locator("li .del")
			.first()
			.evaluate((el) => {
				// Wiring test, not a pointer test: the row × sits under the
				// pill in headless hover (real thumbs tap it in flow).
				(el as HTMLElement).click();
			});
		await expect
			.poll(
				async () =>
					page.evaluate(() =>
						JSON.stringify((window as unknown as { __vib: unknown[] }).__vib)
					),
				{ timeout: 5000 }
			)
			.toBe(JSON.stringify([[35, 60, 110]]));
	});

	test("two-finger swipe left opens settings from the composer", async ({
		page
	}) => {
		await seedEmpty(page);
		const panel = page.locator(".settings-panel");
		await expect(panel).toHaveClass(/closed/);
		// Loose tracking: the stroke starts on the send button
		// itself (the old clean-only gate dropped exactly these).
		await page.locator(".prompt .send-btn").evaluate((el) => {
			const touch = (id: number, x: number, y: number) =>
				new Touch({ identifier: id, target: el, clientX: x, clientY: y });
			el.dispatchEvent(
				new TouchEvent("touchstart", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [touch(1, 300, 500), touch(2, 340, 500)]
				})
			);
			el.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(1, 150, 500), touch(2, 190, 500)]
				})
			);
		});
		await expect(panel).not.toHaveClass(/closed/);
	});

	test("double two-finger tap jumps to the thread bottom, never deletes", async ({
		page
	}) => {
		// Long thread so the jump has somewhere to go; the pair lands
		// on the last message, whose end sits below the fold.
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
			const lines = Array.from(
				{ length: 80 },
				(_, n) => `line ${n} of a long assistant reply`
			).join("\n");
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{
						id: "e2e-chat",
						createdAt: 1,
						replyLang: null,
						messages: [
							{
								id: "m1",
								role: "assistant",
								content: lines,
								usage: null,
								error: null
							}
						]
					}
				])
			);
		});
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		await page.evaluate(() =>
			document.querySelector(".messages")?.scrollTo({ top: 0 })
		);
		const box = await page.locator("article .rendered").last().boundingBox();
		if (!box) throw new Error("no message box");
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		for (let tap = 0; tap < 2; tap++) {
			await page.evaluate(
				({ x, y }: { x: number; y: number }) => {
					const touch = (id: number) =>
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
							touches: [touch(1, x, y), touch(2, x + 40, y)]
						})
					);
					window.dispatchEvent(
						new TouchEvent("touchend", {
							bubbles: true,
							cancelable: true,
							composed: true,
							touches: [],
							changedTouches: [touch(1, x, y), touch(2, x + 40, y)]
						})
					);
				},
				{ x, y }
			);
			if (tap === 0) await page.waitForTimeout(120);
		}
		// Smooth scroll lands the thread bottom; nothing deleted.
		await expect
			.poll(
				async () =>
					page.evaluate(
						() => document.querySelector(".messages")?.scrollTop ?? 0
					),
				{ timeout: 5000 }
			)
			.toBeGreaterThan(100);
		expect(await page.locator("aside button.side-chat").count()).toBe(1);
	});

	test("three-finger tap deletes the tapped message", async ({ page }) => {
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
							msg("m1", "user", "first"),
							msg("m2", "assistant", "second")
						]
					}
				])
			);
		});
		await page.goto("/");
		await expect(page.locator("article")).toHaveCount(2);
		const box = await page.locator("article .rendered").first().boundingBox();
		if (!box) throw new Error("no message box");
		await page.evaluate(
			({ x, y }: { x: number; y: number }) => {
				const touch = (id: number) =>
					new Touch({
						identifier: id,
						target: document.body,
						clientX: x,
						clientY: y
					});
				const fingers = [touch(1), touch(2), touch(3)];
				window.dispatchEvent(
					new TouchEvent("touchstart", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: fingers
					})
				);
				window.dispatchEvent(
					new TouchEvent("touchend", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [],
						changedTouches: fingers
					})
				);
			},
			{ x: box.x + box.width / 2, y: box.y + box.height / 2 }
		);
		await expect(page.locator(".toast")).toHaveText("Message deleted");
		await expect(page.locator("article")).toHaveCount(1);
	});

	test("three-finger hold wipes every chat", async ({ page }) => {
		await seedTwoChats(page);
		expect(await page.locator("aside button.side-chat").count()).toBe(2);
		await page.evaluate(() => {
			const touch = (id: number) =>
				new Touch({
					identifier: id,
					target: document.body,
					clientX: 200,
					clientY: 500
				});
			window.dispatchEvent(
				new TouchEvent("touchstart", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [touch(1), touch(2), touch(3)]
				})
			);
		});
		// The hold fires past tap range (600ms) while fingers rest.
		await page.waitForTimeout(750);
		await page.evaluate(() => {
			const touch = (id: number) =>
				new Touch({
					identifier: id,
					target: document.body,
					clientX: 200,
					clientY: 500
				});
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(1), touch(2), touch(3)]
				})
			);
		});
		await expect(page.locator("aside button.side-chat")).toHaveCount(1);
		await expect(page.locator("article")).toHaveCount(0);
		await expect(page.locator(".toast")).toHaveText("All chats deleted");
	});

	test("touch selection floats Copy/Annotate/Speak, Inspect stays docked", async ({
		page
	}) => {
		await seedTwoChats(page);
		const box = await page.locator("article .rendered").first().boundingBox();
		if (!box) throw new Error("no message box");
		await page.evaluate(
			({ x, y }: { x: number; y: number }) => {
				const touch = (id: number) =>
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
						touches: [touch(1)]
					})
				);
				const rendered = document.querySelector("article .rendered");
				const sel = window.getSelection();
				sel?.removeAllRanges();
				const range = document.createRange();
				if (rendered) range.selectNodeContents(rendered);
				sel?.addRange(range);
				window.dispatchEvent(
					new TouchEvent("touchend", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [],
						changedTouches: [touch(1)]
					})
				);
			},
			{ x: box.x + box.width / 2, y: box.y + box.height / 2 }
		);
		// The native callout is suppressed: our menu floats near the
		// text with Copy, Annotate, and Speak in the desktop style.
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		await expect(menu.locator("button")).toHaveText([
			"Copy",
			"Annotate",
			"Speak"
		]);
		// Non-Han text docks nothing: Inspect is Han-only.
		await expect(page.locator(".ann-dock")).toHaveCount(0);
	});

	test("a tap on Speak reads the highlight and keeps the menu", async ({
		page
	}) => {
		await page.addInitScript(() => {
			(window as unknown as { __spoken: string[] }).__spoken = [];
			const synth = window.speechSynthesis;
			if (synth) {
				synth.speak = ((utterance: SpeechSynthesisUtterance) => {
					(window as unknown as { __spoken: string[] }).__spoken.push(
						utterance.text
					);
				}) as typeof synth.speak;
			}
		});
		await seedTwoChats(page);
		await summonTouchSelection(page);
		const menu = page.locator(".sel-menu");
		await expect(menu.locator("button")).toHaveText([
			"Copy",
			"Annotate",
			"Speak"
		]);
		const btn = menu.locator('button:has-text("Speak")');
		const btnBox = await btn.boundingBox();
		if (!btnBox) throw new Error("no speak box");
		await page.touchscreen.tap(
			btnBox.x + btnBox.width / 2,
			btnBox.y + btnBox.height / 2
		);
		await expect
			.poll(
				() =>
					page.evaluate(
						() => (window as unknown as { __spoken: string[] }).__spoken ?? []
					),
				{
					timeout: 10_000
				}
			)
			.toContain("alpha-aaa");
		// The menu stays put: Annotate is one tap away after listening.
		await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	});

	test("a Han highlight floats Speak and docks Inspect", async ({ page }) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{
						id: "chat-han",
						createdAt: 1,
						replyLang: null,
						messages: [
							{
								id: "m1",
								role: "assistant",
								content: "語",
								usage: null,
								error: null
							}
						]
					}
				])
			);
		});
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		await summonTouchSelection(page);
		// Copy/Annotate/Speak float in the menu; the single Han
		// character docks Inspect alone in the composer.
		const menu = page.locator(".sel-menu");
		await expect(menu.locator("button")).toHaveText([
			"Copy",
			"Annotate",
			"Speak"
		]);
		await expect(page.locator(".ann-dock")).toHaveText(["Inspect"]);
	});

	test("a long chat scrolls inside the list, never squeezing the prompt", async ({
		page
	}) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
			const messages = [];
			for (let i = 0; i < 20; i++) {
				messages.push({
					id: `u${i}`,
					role: "user",
					content: `question ${i}`,
					usage: null,
					error: null
				});
				messages.push({
					id: `a${i}`,
					role: "assistant",
					content: `answer ${i}`,
					usage: null,
					error: null
				});
			}
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{ id: "chat-a", createdAt: 1, replyLang: null, messages }
				])
			);
		});
		await page.goto("/");
		await page.locator("article").first().waitFor();
		const metrics = await page.evaluate(() => {
			const list = document.querySelector(".messages") as HTMLElement;
			const prompt = document.querySelector(".prompt") as HTMLElement;
			list.scrollTop = list.scrollHeight;
			const promptBox = prompt.getBoundingClientRect();
			return {
				scrollHeight: list.scrollHeight,
				clientHeight: list.clientHeight,
				promptHeight: promptBox.height
			};
		});
		expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
		// Healthy multi-row composer, never squeezed flat: the floor
		// tolerates headless font-metric drift (86px observed vs 90).
		expect(metrics.promptHeight).toBeGreaterThanOrEqual(80);
	});

	test("page never scrolls sideways on a phone", async ({ page }) => {
		await seedTwoChats(page);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	test("hide-messages mode reveals one message per tap", async ({ page }) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify({ hideMessages: true })
			);
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
						id: "chat-a",
						createdAt: 1,
						replyLang: null,
						messages: [msg("m1", "assistant", "hello-hidden")]
					}
				])
			);
		});
		await page.goto("/");
		// Collapsed rows reserve no space, so the hidden article is
		// zero-height — wait for attachment, not visibility.
		await page.locator("article").first().waitFor({ state: "attached" });
		const body = page.locator("article .rendered").first();
		await expect(body).toBeHidden();
		await page.evaluate(() => {
			document
				.querySelector("article")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await expect(body).toBeVisible();
		await expect(body).toBeHidden({ timeout: 5000 });
	});

	test("settings sheet matches the chats drawer and offers touch toggles", async ({
		page
	}) => {
		await seedEmpty(page);
		await swipeTwoFinger(page, 300, 150);
		const panel = page.locator(".settings-panel");
		await expect(panel).not.toHaveClass(/closed/);
		const panelWidth = (await panel.boundingBox())?.width ?? 0;
		// The two drawers match instead of one spanning the screen:
		// shut settings, summon the list, compare.
		await swipeX(page, 4, 144);
		await expect(panel).toHaveClass(/closed/);
		await swipeX(page, 4, 144);
		const aside = page.locator("aside:has(button.new)");
		await expect(aside).not.toHaveClass(/collapsed/);
		const listWidth = (await aside.boundingBox())?.width ?? 0;
		expect(Math.abs(panelWidth - listWidth)).toBeLessThanOrEqual(1);
		await expect(panel.locator('legend:has-text("Voice engine")')).toHaveCount(
			0
		);
		// Phones never auto-read selections: no toggle, no behavior.
		await expect(
			panel.locator('label:has-text("Read selections aloud on release")')
		).toHaveCount(0);
		await expect(panel.locator('h2:has-text("Touch gestures")')).toBeVisible();
	});

	test("theme pin holds dark under a light OS", async ({ page }) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify({ theme: "dark" })
			);
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [] }
				])
			);
		});
		await page.goto("/");
		await expect(page.locator(".lang-menus")).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.dataset.theme)
		).toBe("dark");
		const bg = await page
			.locator(".app")
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		// Newer Chromium reports color(srgb …) floats instead of rgb()
		// ints for the same paint: compare channels, not the string.
		const channels = bg
			.match(/[\d.]+/g)
			?.map(Number)
			.slice(0, 3)
			.map((v) => Math.round(bg.startsWith("color") ? v * 255 : v));
		expect(channels).toEqual([23, 23, 26]);
	});

	test.describe("dark phone", () => {
		test.use({
			viewport: { width: 360, height: 740 },
			colorScheme: "dark",
			hasTouch: true
		});

		/** The chat list keeps readable contrast in dark: phone WebViews
		that "help" by darkening light text blank the sheet otherwise. */
		test("chat list text keeps contrast in dark", async ({ page }) => {
			await seedTwoChats(page);
			const report = await page.evaluate(() => {
				const lum = (rgb: string): number => {
					const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
					const f = (v: number): number => {
						const s = v / 255;
						return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
					};
					return (
						0.2126 * f(m[0] ?? 0) +
						0.7152 * f(m[1] ?? 0) +
						0.0722 * f(m[2] ?? 0)
					);
				};
				const ratio = (fg: string, bg: string): number => {
					const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
					return (a + 0.05) / (b + 0.05);
				};
				const cs = (sel: string): { fg: string; bg: string } => {
					const el = document.querySelector(sel);
					if (!(el instanceof HTMLElement)) throw new Error(`${sel} missing`);
					const s = getComputedStyle(el);
					return { fg: s.color, bg: s.backgroundColor };
				};
				const aside = cs("aside");
				const chat = cs("aside ul button.side-chat");
				const del = cs("aside li .del");
				return {
					theme: document.documentElement.dataset.theme,
					scheme: getComputedStyle(document.documentElement).colorScheme,
					chat: ratio(chat.fg, aside.bg),
					del: ratio(del.fg, aside.bg)
				};
			});
			expect(report.theme).toBe("dark");
			// Root opt-out of algorithmic darkening, so the WebView paints
			// our dark theme as-is instead of darkening light text away.
			expect(report.scheme).toBe("dark");
			expect(report.chat).toBeGreaterThanOrEqual(4.5);
			expect(report.del).toBeGreaterThanOrEqual(4.5);
		});

		/** The two-column gestures grid overflows a 360px phone, clipping
		the teaching text — single column fits, in a reading typeface. */
		test("gestures list fits a 360px screen", async ({ page }) => {
			await seedTwoChats(page);
			await swipeTwoFinger(page, 300, 150);
			await page.locator(".settings-panel").waitFor();
			await page.locator('button:has-text("Show all gestures")').click();
			// Phones have no modal heading by design (the filter owns
			// the head row): wait for the gestures list itself.
			await page.locator(".keys").waitFor();
			const fit = await page.evaluate(() => {
				const keys = document.querySelector(".keys");
				const dd = document.querySelector(".keys dd");
				if (!(keys instanceof HTMLElement) || !(dd instanceof HTMLElement))
					throw new Error("keys missing");
				return {
					overflow: keys.scrollWidth - keys.clientWidth,
					columns: getComputedStyle(keys).gridTemplateColumns.split(" ").length,
					font: getComputedStyle(dd).fontFamily
				};
			});
			expect(fit.overflow).toBeLessThanOrEqual(0);
			expect(fit.columns).toBe(1);
			expect(fit.font).not.toMatch(/mono/i);
		});

		/** A tap on the docked Annotate opens the comment box: taps near a
		selection handle are swallowed as handle nudges (no click ever
		arrives), so the button runs off touchend instead of waiting for
		onclick. */
		test("a tap on Annotate files the note through the composer", async ({
			page
		}) => {
			await seedTwoChats(page);
			const box = await page.locator("article .rendered").first().boundingBox();
			if (!box) throw new Error("no message box");
			await page.evaluate(
				({ x, y }: { x: number; y: number }) => {
					const touch = (id: number) =>
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
							touches: [touch(1)]
						})
					);
					const rendered = document.querySelector("article .rendered");
					const sel = window.getSelection();
					sel?.removeAllRanges();
					const range = document.createRange();
					if (rendered) range.selectNodeContents(rendered);
					sel?.addRange(range);
					window.dispatchEvent(
						new TouchEvent("touchend", {
							bubbles: true,
							cancelable: true,
							composed: true,
							touches: [],
							changedTouches: [touch(1)]
						})
					);
				},
				{ x: box.x + box.width / 2, y: box.y + box.height / 2 }
			);
			const btn = page.locator('.sel-menu button:has-text("Annotate")');
			await expect(btn).toBeVisible();
			// A real tap on the button: on-device the handle eats the click,
			// so the annotation must open off the touch sequence itself.
			// (Synthetic TouchEvents don't reach Svelte's touch handlers —
			// only trusted taps exercise this path.)
			const btnBox = await btn.boundingBox();
			if (!btnBox) throw new Error("no annotate box");
			await page.touchscreen.tap(
				btnBox.x + btnBox.width / 2,
				btnBox.y + btnBox.height / 2
			);
			// Phones file the annotation in the composer, never a floating
			// box: the tap consumes the menu and the composer asks for
			// the note instead.
			await expect(page.locator(".sel-menu")).toHaveCount(0);
			await expect(page.locator(".prompt textarea")).toHaveAttribute(
				"placeholder",
				"Add an annotation"
			);
			// Typing files through the send arrow: the pill counts it.
			await page.locator(".prompt textarea").click();
			await page.keyboard.type("nice point", { delay: 10 });
			await page.locator(".send-btn").click();
			await expect(page.locator(".toast")).toHaveText("Annotation saved");
			await expect(page.locator(".ann-pill")).toBeVisible();
		});

		/** The review pencil keeps the composer path on phones: the
		saved comment loads into the comment box instead of a floating
		card (the transplanted textbox can't summon the keyboard). The
		draft is seeded in storage — filing it by touch is covered by
		the Annotate test above. */
		test("review pencil loads the comment into the composer", async ({
			page
		}) => {
			await seedChat(page, [
				{ role: "assistant", content: "alpha beta gamma delta" }
			]);
			await page.addInitScript(() => {
				window.localStorage.setItem(
					"ccez-llm-annotations-v1",
					JSON.stringify({
						"e2e-chat": [
							{
								id: "ann-1",
								messageId: "e2e-m0",
								quote: "beta",
								comment: "first"
							}
						]
					})
				);
			});
			await page.goto("/");
			await expect(page.locator(".ann-pill")).toBeVisible();
			await page.locator(".prompt-tools .ann-pill").click();
			await expect(page.locator(".ann-wrap .review")).toHaveCSS("opacity", "1");
			await page.locator(".review-pencil").first().click();
			// No floating card on phones — the composer asks for the note.
			await expect(page.locator(".ann-pop")).toHaveCount(0);
			await expect(page.locator(".prompt textarea")).toHaveAttribute(
				"placeholder",
				"Edit annotation"
			);
			await expect(page.locator(".prompt textarea")).toHaveValue("first");
		});

		/** Tapping a badge edits its note through the composer: the tap
		must survive the tap-out rule (capture press opens before the
		bubble tap-out check), the composer starts empty, and the send
		arrow files the note instead of sending a chat. */
		test("tapping a badge rewrites its note through the composer", async ({
			page
		}) => {
			await seedChat(page, [
				{ role: "assistant", content: "alpha beta gamma delta" }
			]);
			await page.addInitScript(() => {
				window.localStorage.setItem(
					"ccez-llm-annotations-v1",
					JSON.stringify({
						"e2e-chat": [
							{
								id: "ann-1",
								messageId: "e2e-m0",
								quote: "beta",
								comment: "first"
							}
						]
					})
				);
			});
			await page.goto("/");
			const badge = page.locator("[data-ann-badge]").first();
			await expect(badge).toBeVisible({ timeout: 15_000 });
			const bbox = await badge.boundingBox();
			if (!bbox) throw new Error("badge has no box");
			await page.touchscreen.tap(
				bbox.x + bbox.width / 2,
				bbox.y + bbox.height / 2
			);
			const composer = page.locator(".prompt textarea");
			await expect(composer).toHaveAttribute("placeholder", "Edit annotation");
			await expect(composer).toHaveValue("");
			await composer.click();
			await page.keyboard.type("revised", { delay: 10 });
			const before = await page.evaluate(
				() =>
					(
						JSON.parse(
							window.localStorage.getItem("ccez-llm-chats-v1") ?? "[]"
						) as Array<{ messages: unknown[] }>
					)[0]?.messages.length ?? -1
			);
			await page.locator(".send-btn").click();
			await expect(page.locator(".toast")).toHaveText("Annotation edited");
			const after = await page.evaluate(() => ({
				annotations: window.localStorage.getItem("ccez-llm-annotations-v1"),
				messages:
					(
						JSON.parse(
							window.localStorage.getItem("ccez-llm-chats-v1") ?? "[]"
						) as Array<{ messages: unknown[] }>
					)[0]?.messages.length ?? -1
			}));
			expect(after.annotations).toContain('"comment":"revised"');
			expect(after.messages).toBe(before);
		});

		/** Entering a note edit washes its quote: creating washes the
		pending preview, review-pencil washes the saved quote — the
		comment box otherwise floats over an unmarked thread. */
		test("note edits wash their quote in the thread", async ({ page }) => {
			await seedChat(page, [
				{ role: "assistant", content: "alpha beta gamma delta" }
			]);
			await page.addInitScript(() => {
				window.localStorage.setItem(
					"ccez-llm-annotations-v1",
					JSON.stringify({
						"e2e-chat": [
							{
								id: "ann-1",
								messageId: "e2e-m0",
								quote: "beta",
								comment: "first"
							}
						]
					})
				);
			});
			await page.goto("/");
			const badge = page.locator("[data-ann-badge]").first();
			await expect(badge).toBeVisible({ timeout: 15_000 });
			const hasWash = () =>
				page.evaluate(() =>
					(
						CSS as unknown as { highlights: { has(x: string): boolean } }
					).highlights.has("ccez-ann")
				);
			const bbox = await badge.boundingBox();
			if (!bbox) throw new Error("badge has no box");
			await page.touchscreen.tap(
				bbox.x + bbox.width / 2,
				bbox.y + bbox.height / 2
			);
			await expect.poll(hasWash, { timeout: 10_000 }).toBe(true);
		});

		/** The selection menu survives scrolling a live highlight: the
		native callout is suppressed, so our menu must stay up across
		scrolls — only a collapsed selection dismisses it. */
		test("the selection menu survives scrolling a live highlight", async ({
			page
		}) => {
			const filler = Array.from(
				{ length: 30 },
				(_, i) => `filler paragraph ${i} pads the thread.`
			).join("\n\n");
			await seedChat(page, [
				{
					role: "assistant",
					content: `${filler}\n\nhello world from Kyoto harbor\n\n${filler}`
				}
			]);
			await page.goto("/");
			const quote = page
				.locator("article.assistant .rendered p", { hasText: "Kyoto harbor" })
				.first();
			await expect(quote).toBeVisible({ timeout: 15_000 });
			await quote.evaluate((el) => el.scrollIntoView({ block: "center" }));
			await page.waitForTimeout(600);
			const qbox = await quote.boundingBox();
			if (!qbox) throw new Error("quote has no box");
			const y = qbox.y + qbox.height / 2;
			await page.mouse.move(qbox.x + 30, y);
			await page.mouse.down();
			await page.mouse.move(qbox.x + 200, y, { steps: 8 });
			await page.mouse.up();
			const item = page.locator('.sel-menu button:has-text("Annotate")');
			await expect(item).toBeVisible();
			await page.evaluate(() => {
				document.querySelector(".messages")?.scrollBy({ top: 400 });
			});
			await page.waitForTimeout(400);
			expect(
				await page.evaluate(() => window.getSelection()?.toString() ?? "")
			).not.toBe("");
			await expect(item).toBeVisible();
		});

		/** Below the full-bleed text size, short assistant messages
		shrink-wrap like own bubbles instead of running the column. */
		test("assistant messages shrink-wrap below full-bleed", async ({
			page
		}) => {
			await seedChat(page, [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello back" }
			]);
			await page.goto("/");
			const article = page.locator("article.assistant").first();
			await expect(article).toBeVisible({ timeout: 15_000 });
			const [col, box] = await Promise.all([
				page.locator(".messages").boundingBox(),
				article.boundingBox()
			]);
			if (!col || !box) throw new Error("thread has no boxes");
			expect(box.width).toBeLessThan(col.width - 10);
		});

		/** At the full-bleed text size the thread drops its rem gutter
		and short assistant messages run ~99% wide, so huge type keeps
		context instead of squeezing into the phone column. */
		test("assistant messages go full-bleed at the full-bleed size", async ({
			page
		}) => {
			await seedChat(page, [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello back" }
			]);
			await page.addInitScript(() => {
				window.localStorage.setItem(
					"ccez-llm-settings-v1",
					JSON.stringify({
						hoverAssistantActions: true,
						hoverUserActions: true,
						promptIdleSec: 0,
						fontScale: 3.3
					})
				);
			});
			await page.goto("/");
			await expect(page.locator(".app")).toHaveAttribute(
				"data-fullbleed",
				"true"
			);
			const article = page.locator("article.assistant").first();
			await expect(article).toBeVisible({ timeout: 15_000 });
			const [col, box] = await Promise.all([
				page.locator(".messages").boundingBox(),
				article.boundingBox()
			]);
			if (!col || !box) throw new Error("thread has no boxes");
			expect(box.width).toBeGreaterThan(col.width - 8);
			// Own messages keep their alignment: the article spans the
			// column while the bubble stays shrink-wrapped and docked
			// hard right — no left-anchored full-width own column, and
			// the hairline gutter leaves no room on its right.
			const userBox = await page.locator("article.user").first().boundingBox();
			const userBubble = await page
				.locator("article.user .bubble")
				.first()
				.boundingBox();
			if (!userBox || !userBubble) throw new Error("own message has no box");
			expect(userBox.width).toBeGreaterThan(col.width - 8);
			expect(userBubble.width).toBeLessThan(userBox.width - 10);
			expect(
				userBox.x + userBox.width - (userBubble.x + userBubble.width)
			).toBeLessThan(3);
		});

		/** Double-tapping a message taller than the screen scrolls its
		action row into view: phones have no hover to reveal it. Rows
		already visible never move. */
		test("double-tapping a tall message reveals its action row", async ({
			page
		}) => {
			const long = Array.from(
				{ length: 60 },
				(_, i) => `line ${i} of a very tall message`
			).join("\n");
			await page.addInitScript((content: string) => {
				window.localStorage.setItem("ccez-mock-provider", "1");
				window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
				window.localStorage.setItem(
					"ccez-llm-chats-v1",
					JSON.stringify([
						{
							id: "e2e-chat",
							createdAt: 1,
							replyLang: null,
							messages: [
								{
									id: "e2e-m0",
									role: "assistant",
									content,
									usage: null,
									error: null
								}
							]
						}
					])
				);
			}, long);
			await page.goto("/");
			const article = page.locator("article.assistant").first();
			await expect(article).toBeVisible({ timeout: 60_000 });
			const actions = article.locator(".actions");
			// Park at the top so the action row starts below the fold.
			await article.evaluate((el) => el.scrollIntoView({ block: "start" }));
			await page.waitForTimeout(800);
			const below = await actions.boundingBox();
			expect(below?.y ?? 0).toBeGreaterThan(915);
			await article.locator(".rendered").first().dblclick();
			await expect
				.poll(async () => (await actions.boundingBox())?.y ?? 9999, {
					timeout: 10_000
				})
				.toBeLessThan(915);
		});
	});

	/** Sending in a new chat leaves a one-line composer: the reply's layout
	churn (and the keyboard's viewport churn on phones) must never strand
	the emptied editor at zero height until the next keystroke heals it. */
	test("composer holds one line after the reply lands", async ({ page }) => {
		await seedEmpty(page);
		const box = page.locator(".prompt .ta-input");
		await box.click();
		await page.keyboard.type("hello world");
		// Phones never send from the keyboard: the send button submits.
		await page.locator(".send-btn").click();
		await expect(
			page.locator('article .rendered:has-text("Mock reply to:")')
		).toBeVisible({ timeout: 15000 });
		const heights = await page.evaluate(() => {
			const el = document.querySelector(".prompt .ta-input");
			return el instanceof HTMLElement ? el.getBoundingClientRect().height : -1;
		});
		// One small empty line (~26px on the 1.5rem floor): the
		// stranded state measured ~0 here with no placeholder at all.
		expect(heights).toBeGreaterThan(16);
		expect(await box.getAttribute("placeholder")).toBeTruthy();
		// A keyboard transition settles through the same re-measure path
		// without disturbing the healthy composer.
		await page.evaluate(() =>
			window.visualViewport?.dispatchEvent(new Event("resize"))
		);
		await page.waitForTimeout(500);
		const after = await page.evaluate(() => {
			const el = document.querySelector(".prompt .ta-input");
			return el instanceof HTMLElement ? el.getBoundingClientRect().height : -1;
		});
		expect(after).toBeGreaterThan(16);
	});

	/** Buttons hide by default on phones: tap reveals one row, bodies stay
	visible throughout (only the text-hiding opt-in hides those), and the
	row drops on its own after ~3s. */
	test("message buttons hide until tapped", async ({ page }) => {
		await seedTwoChats(page);
		const row = page.locator("article.assistant .actions").first();
		const body = page.locator("article.assistant .rendered").first();
		await expect(row).toHaveCSS("opacity", "0");
		await expect(body).toBeVisible();
		// Tapping the message (not a control) opens its row...
		await body.click();
		await expect(row).toHaveCSS("opacity", "1");
		// ...and it closes itself after ~3s.
		await expect(row).toHaveCSS("opacity", "0", { timeout: 5000 });
	});

	/** A press inside an open row owns it: holding a button past the 3s
	mark must not watch the row vanish mid-press. Release happens off the
	button so no action fires; the cleared timer stays cleared. */
	test("holding a row button outlives the auto-dismiss", async ({ page }) => {
		await seedTwoChats(page);
		const row = page.locator("article.assistant .actions").first();
		const body = page.locator("article.assistant .rendered").first();
		await expect(body).toBeVisible();
		await body.click();
		await expect(row).toHaveCSS("opacity", "1");
		const btn = row.locator("button").first();
		const box = await btn.boundingBox();
		if (!box) throw new Error("row button lost its box");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.waitForTimeout(3500);
		await expect(row).toHaveCSS("opacity", "1");
		await page.mouse.move(4, 300);
		await page.mouse.up();
		await expect(row).toHaveCSS("opacity", "1");
	});

	/** The buttons checkbox ships checked: hiding rows is the default,
	unchecking is the opt-out. */
	test("buttons checkbox is checked by default", async ({ page }) => {
		await seedEmpty(page);
		await swipeTwoFinger(page, 300, 150);
		await page.locator(".settings-panel").waitFor();
		const box = page.locator(
			'label.check:has-text("Hide message buttons until tapped") input'
		);
		await expect(box).toBeChecked();
	});

	test("haptics toggle is off (enabled) by default and persists", async ({
		page
	}) => {
		await seedEmpty(page);
		await swipeTwoFinger(page, 300, 150);
		await page.locator(".settings-panel").waitFor();
		const box = page.locator(
			'label.check:has-text("Disable haptic feedback") input'
		);
		await expect(box).not.toBeChecked();
		// Disabled persists through the next settings flush: dismiss
		// settings, then summon the list (its toggle persists the whole
		// object).
		await box.click();
		await expect(box).toBeChecked();
		await swipeX(page, 4, 144);
		await swipeX(page, 4, 144);
		await expect(page.locator("aside:has(button.new)")).not.toHaveClass(
			/collapsed/
		);
		// The flush is async: the stored flag (not a reload — the seed
		// script resets settings on load) proves the disabled state sticks.
		await expect
			.poll(
				async () =>
					page.evaluate(
						() => window.localStorage.getItem("ccez-llm-settings-v1") ?? ""
					),
				{ timeout: 5000 }
			)
			.toContain('"hapticsDisabled":true');
	});

	test("settings button in the chats list opens settings", async ({ page }) => {
		await seedEmpty(page);
		const aside = page.locator("aside:has(button.new)");
		const panel = page.locator(".settings-panel");
		await swipeX(page, 4, 144);
		await expect(aside).not.toHaveClass(/collapsed/);
		await page.locator("aside .side-settings").click();
		await expect(panel).not.toHaveClass(/closed/);
		// The list folds away behind the opening panel.
		await expect(aside).toHaveClass(/collapsed/);
	});
});

test.describe("always-visible prompt", () => {
	test.use({ hasTouch: true, isMobile: true });

	const LONG = "Line of chat text for height. ".repeat(120);

	async function seed(
		page: Page,
		settings: Record<string, unknown>,
		bodies: string[]
	): Promise<void> {
		await page.addInitScript(
			({ s, texts }: { s: Record<string, unknown>; texts: string[] }) => {
				window.localStorage.setItem("ccez-mock-provider", "1");
				window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify(s));
				window.localStorage.setItem(
					"ccez-llm-chats-v1",
					JSON.stringify(
						texts.map((content, n) => ({
							id: `chat-${n}`,
							createdAt: n,
							replyLang: null,
							messages:
								content === ""
									? []
									: [
											{
												id: `m${n}`,
												role: "assistant",
												content,
												usage: null,
												error: null
											}
										]
						}))
					)
				);
			},
			{ s: settings, texts: bodies }
		);
	}

	const composer = (page: Page) => page.locator(".prompt .ta-input");

	/** Synthetic single-finger stroke: the window touch handlers read real TouchEvents. */
	async function flick(
		page: Page,
		targetSel: string,
		x0: number,
		y0: number,
		x1: number,
		y1: number
	): Promise<void> {
		await page.evaluate(
			({ targetSel, x0, y0, x1, y1 }) => {
				const target = document.querySelector(targetSel);
				if (!target) throw new Error(`no flick target: ${targetSel}`);
				const start = new Touch({
					identifier: 7,
					target,
					clientX: x0,
					clientY: y0
				});
				target.dispatchEvent(
					new TouchEvent("touchstart", {
						touches: [start],
						bubbles: true,
						cancelable: true
					})
				);
				const end = new Touch({
					identifier: 7,
					target,
					clientX: x1,
					clientY: y1
				});
				target.dispatchEvent(
					new TouchEvent("touchend", {
						touches: [],
						changedTouches: [end],
						bubbles: true,
						cancelable: true
					})
				);
			},
			{ targetSel, x0, y0, x1, y1 }
		);
	}

	/** Synthetic two-finger pinch: the window touch handlers read real TouchEvents. */
	async function pinch(
		page: Page,
		targetSel: string,
		spread0: number,
		spread1: number
	): Promise<void> {
		await page.evaluate(
			({ targetSel, spread0, spread1 }) => {
				const target = document.querySelector(targetSel);
				if (!target) throw new Error(`no pinch target: ${targetSel}`);
				const cx = 200;
				const cy = 400;
				const finger = (id: number, dx: number) =>
					new Touch({ identifier: id, target, clientX: cx + dx, clientY: cy });
				const a0 = finger(1, -spread0 / 2);
				const b0 = finger(2, spread0 / 2);
				target.dispatchEvent(
					new TouchEvent("touchstart", {
						touches: [a0, b0],
						bubbles: true,
						cancelable: true
					})
				);
				const a1 = finger(1, -spread1 / 2);
				const b1 = finger(2, spread1 / 2);
				target.dispatchEvent(
					new TouchEvent("touchmove", {
						touches: [a1, b1],
						bubbles: true,
						cancelable: true
					})
				);
				target.dispatchEvent(
					new TouchEvent("touchend", {
						touches: [],
						changedTouches: [a1, b1],
						bubbles: true,
						cancelable: true
					})
				);
			},
			{ targetSel, spread0, spread1 }
		);
	}

	/** Pinch apart in the messages grows the text; together shrinks it. */
	test("pinch in messages scales the text size", async ({ page }) => {
		await seed(page, { fontScale: 1 }, [LONG]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		const px = () =>
			page.evaluate(() =>
				parseFloat(
					getComputedStyle(document.querySelector("article .rendered")!)
						.fontSize
				)
			);
		const before = await px();
		await pinch(page, "article.assistant .rendered", 200, 320);
		// Two 48px spread steps: 100% -> 120%, live per step.
		await expect.poll(px, { timeout: 5000 }).toBeGreaterThan(before);
		const grown = await px();
		await pinch(page, "article.assistant .rendered", 320, 200);
		await expect.poll(px, { timeout: 5000 }).toBeLessThan(grown);
	});

	/** Empty-state pills stay tappable at big fonts on small screens. */
	test("language pills clear the floating prompt", async ({ page }) => {
		await seed(page, { fontScale: 1.8 }, [""]);
		await page.goto("/");
		await page.setViewportSize({ width: 360, height: 640 });
		await expect(page.locator(".lang-menus").first()).toBeVisible();
		await page.locator(".lang-menu > button").nth(1).tap();
		await expect(page.locator(".lang-list").first()).toBeVisible();
		await page.locator(".lang-list button").first().tap();
		await expect(page.locator(".lang-list")).toHaveCount(0);
	});

	/** The prompt is a permanent fixture on phones: never idle-hidden. */
	test("prompt stays visible, swipes leave it alone", async ({ page }) => {
		await seed(page, {}, [LONG]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		await expect(page.locator(".prompt.prompt-idle")).toHaveCount(0);
		await flick(page, "article.assistant .rendered", 200, 500, 200, 420);
		await expect(page.locator(".prompt.prompt-idle")).toHaveCount(0);
		await expect(composer(page)).not.toBeFocused();
		await flick(page, "article.assistant .rendered", 200, 420, 200, 500);
		await expect(page.locator(".prompt.prompt-idle")).toHaveCount(0);
		await expect(composer(page)).not.toBeFocused();
	});

	/** A tap keeps native behavior: visible prompt, no focus steal. */
	test("tap does not focus the prompt", async ({ page }) => {
		await seed(page, {}, [LONG]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		await flick(page, "article.assistant .rendered", 200, 500, 200, 502);
		await expect(page.locator(".prompt.prompt-idle")).toHaveCount(0);
		await expect(composer(page)).not.toBeFocused();
	});

	/** Composer stacks the field over the button row, send at its end. */
	test("composer stacks text over buttons", async ({ page }) => {
		await seed(page, {}, [LONG]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		// Buttons live on the focused second line: tap in first.
		await composer(page).click();
		await expect(page.locator(".prompt .prompt-tools")).toBeVisible();
		const boxes = (await page.evaluate(() => {
			const rect = (sel: string) => {
				const r = document.querySelector(sel)?.getBoundingClientRect();
				return r ? { y: r.y, h: r.height } : null;
			};
			return {
				ed: rect(".prompt .ta-input"),
				tools: rect(".prompt .prompt-tools"),
				send: rect(".prompt .send-btn")
			};
		})) as {
			ed: { y: number; h: number } | null;
			tools: { y: number; h: number } | null;
			send: { y: number; h: number } | null;
		};
		expect(boxes.ed && boxes.tools && boxes.send).toBeTruthy();
		if (!boxes.ed || !boxes.tools || !boxes.send) return;
		expect(boxes.tools.y).toBeGreaterThan(boxes.ed.y + boxes.ed.h - 2);
		expect(
			Math.abs(boxes.send.y + boxes.send.h - (boxes.tools.y + boxes.tools.h))
		).toBeLessThanOrEqual(4);
	});

	/** Two bars at rest and on focus: only typed text grows the field. */
	test("composer rests at one line and stays short on focus", async ({
		page
	}) => {
		await seed(page, {}, [LONG]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		const box = composer(page);
		const tools = page.locator(".prompt .prompt-tools");
		const send = page.locator(".prompt .send-btn");
		const height = () =>
			box.evaluate((el) =>
				el instanceof HTMLElement ? el.getBoundingClientRect().height : -1
			);
		// At rest: one small line with the button bar already up.
		const rest = await height();
		expect(rest).toBeGreaterThan(16);
		expect(rest).toBeLessThan(44);
		await expect(tools).toBeVisible();
		await expect(send).toBeVisible();
		// Focused: still one line (an empty tap never inflates).
		await box.click();
		await expect.poll(height, { timeout: 5000 }).toBeLessThan(rest + 10);
		// Typed text grows the field toward its cap (wraps, never sends).
		await box.pressSequentially("word ".repeat(60));
		await expect.poll(height, { timeout: 5000 }).toBeGreaterThan(rest + 10);
	});

	/** Phones scroll by thumb: no scrollbar chrome, scrolling intact. */
	test("no scrollbar chrome on a phone", async ({ page }) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
			const messages = [];
			for (let i = 0; i < 20; i++) {
				messages.push({
					id: `u${i}`,
					role: "user",
					content: `question ${i}`,
					usage: null,
					error: null
				});
				messages.push({
					id: `a${i}`,
					role: "assistant",
					content: `answer ${i}`,
					usage: null,
					error: null
				});
			}
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{ id: "chat-a", createdAt: 1, replyLang: null, messages }
				])
			);
		});
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		for (const sel of ["main", "aside ul", ".prompt .ta-input", ".messages"]) {
			const width = await page
				.locator(sel)
				.first()
				.evaluate((el) => getComputedStyle(el).scrollbarWidth);
			expect(width).toBe("none");
		}
		// The list still overflows with room to travel: the paint
		// hides, the gesture stays. (No landing readback: the list
		// scrolls smooth, so a set scrollTop animates instead.)
		const travel = await page.evaluate(() => {
			const list = document.querySelector(".messages") as HTMLElement;
			return {
				overflowing: list.scrollHeight > list.clientHeight + 1,
				range: list.scrollHeight - list.clientHeight
			};
		});
		expect(travel.overflowing).toBe(true);
		expect(travel.range).toBeGreaterThan(1);
	});

	/** Double-tap on empty space opens the sidebar (swipe right is the other opener). */
	test("double-tap empty space opens the quick switcher", async ({ page }) => {
		await seed(page, {}, [LONG]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		const aside = page.locator("aside").first();
		const veil = page.locator(".chat-switcher");
		await expect(aside).toHaveClass(/collapsed/);
		// One tap alone changes nothing: the pair is the gesture.
		await flick(page, "main", 200, 120, 200, 121);
		await expect(aside).toHaveClass(/collapsed/);
		await expect(veil).toHaveCount(0);
		await page.waitForTimeout(120);
		await flick(page, "main", 200, 120, 200, 121);
		// The switcher opens; the list stays shut.
		await expect(veil).toBeVisible();
		await expect(aside).toHaveClass(/collapsed/);
	});

	test("tapping empty space focuses the composer in a new chat", async ({
		page
	}) => {
		await seedEmpty(page);
		await page.goto("/");
		await expect(page.locator(".prompt")).toBeVisible();
		// Dead space below the hero: past the 380ms double-tap window
		// the single tap lands the caret (a pair would open the list).
		await flick(page, "main", 200, 600, 200, 601);
		await expect(composer(page)).toBeFocused({ timeout: 5000 });
	});

	/** A leftward stroke starting on a message folds it, never summons. */
	test("message swipe folds, never summons the sidebar", async ({ page }) => {
		await seed(page, {}, [LONG]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		const aside = page.locator("aside").first();
		const article = page.locator("article.assistant").first();
		await expect(aside).toHaveClass(/collapsed/);
		await expect(article).not.toHaveClass(/folded-msg/);
		// Leftward: folds the message, sidebar stays shut.
		await flick(page, "article.assistant .rendered", 220, 500, 30, 505);
		await expect(article).toHaveClass(/folded-msg/);
		await expect(aside).toHaveClass(/collapsed/);
	});

	/** Sideways pans inside code and latex blocks belong to the inner
	scroller: they fold neither the block nor the message around it. */
	test("code and latex pans never fold the message", async ({ page }) => {
		const code = "```python\nx = '" + "y".repeat(220) + "'\n```";
		const math =
			"$$\nE_{n} = " + "a".repeat(60) + " + " + "b".repeat(60) + "\n$$";
		await seed(page, {}, [`${code}\n\n${math}`]);
		await page.goto("/");
		const article = page.locator("article.assistant").first();
		await expect(article).toBeVisible({ timeout: 15_000 });
		const pre = article.locator(".ccez-code pre");
		await expect(pre).toBeVisible({ timeout: 20_000 });
		const pan = async (sel: string): Promise<void> => {
			const box = await page.locator(sel).first().boundingBox();
			if (!box) throw new Error(`no pan target: ${sel}`);
			await flick(
				page,
				sel,
				box.x + box.width - 30,
				box.y + box.height / 2,
				box.x + 30,
				box.y + box.height / 2
			);
		};
		await pan("article.assistant .rendered .ccez-code pre");
		await expect(article).not.toHaveClass(/folded-msg/);
		await expect(article.locator(".ccez-code")).not.toHaveAttribute(
			"data-folded",
			"1"
		);
		const block = article.locator(".ccez-math");
		await expect(block).toBeVisible({ timeout: 60_000 });
		await pan("article.assistant .rendered .ccez-math");
		await expect(article).not.toHaveClass(/folded-msg/);
		await expect(block).not.toHaveAttribute("data-folded", "1");
	});

	/** Own rows read audio before copy on phones (DOM stays copy-first
	for keyboard and readers): assert the visual left-to-right order. */
	test("own message buttons order audio before copy on a phone", async ({
		page
	}) => {
		await seedChat(page, [{ role: "user", content: "hi" }]);
		await page.goto("/");
		const row = page.locator("article.user .actions").first();
		await expect(row).toBeVisible({ timeout: 15_000 });
		const order = await row.locator("button").evaluateAll((btns) =>
			btns
				.map((b) => ({
					label: b.getAttribute("aria-label") ?? "",
					x: b.getBoundingClientRect().x
				}))
				.sort((a, b) => a.x - b.x)
				.map((b) =>
					b.label.includes("Copy")
						? "copy"
						: b.label.includes("Branch")
							? "branch"
							: b.label.includes("Delete")
								? "delete"
								: b.label.includes("Edit")
									? "edit"
									: b.label.includes("Rerun")
										? "rerun"
										: "audio"
				)
		);
		expect(order).toEqual([
			"audio",
			"copy",
			"branch",
			"delete",
			"edit",
			"rerun"
		]);
	});

	/** Composer tools share one even rhythm on phones: attach, audio,
	jump, and the annotations pill with the same gaps between each
	pair (the jump icon used to crowd attach with negative margins). */
	test("composer tools space evenly on a phone", async ({ page }) => {
		await seedChat(page, [
			{ role: "user", content: "one" },
			{ role: "assistant", content: "two" },
			{ role: "user", content: "three" },
			{ role: "assistant", content: "four" },
			{ role: "user", content: "five" },
			{ role: "assistant", content: "six" },
			{ role: "user", content: "seven" },
			{ role: "assistant", content: "eight" }
		]);
		await page.addInitScript(() => {
			window.localStorage.setItem(
				"ccez-llm-annotations-v1",
				JSON.stringify({
					"e2e-chat": [
						{ id: "ann-1", messageId: "e2e-m0", quote: "two", comment: "" }
					]
				})
			);
		});
		await page.goto("/");
		const tools = page.locator(".prompt-tools");
		await expect(tools).toBeVisible({ timeout: 15_000 });
		// Jump sits right of audio in DOM order, matching the row.
		const order = await tools.evaluate((row) =>
			[...row.children]
				.filter((el) => (el as HTMLElement).offsetParent !== null)
				.map((el) => el.className)
		);
		const voiceAt = order.findIndex((c) => String(c).includes("voice-float"));
		const jumpAt = order.findIndex((c) => String(c).includes("wp-jump"));
		expect(voiceAt).toBeGreaterThanOrEqual(0);
		expect(jumpAt).toBe(voiceAt + 1);
		// Pairwise gaps match within rounding.
		const gaps = await tools.evaluate((row) => {
			const boxes = [...row.children]
				.filter((el) => (el as HTMLElement).offsetParent !== null)
				.map((el) => el.getBoundingClientRect())
				.sort((a, b) => a.x - b.x);
			return boxes
				.slice(1)
				.map((b, i) => b.x - (boxes[i]!.x + boxes[i]!.width));
		});
		expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1.5);
	});
});

test.describe("message chrome", () => {
	function seedScript(s: Record<string, unknown>): void {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify(s));
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
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						msg("m1", "first message here"),
						msg("m2", "second message here")
					]
				}
			])
		);
	}

	async function seedChrome(
		page: Page,
		settings: Record<string, unknown>
	): Promise<void> {
		await page.addInitScript(seedScript, settings);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible({
			timeout: 60_000
		});
	}

	// Init scripts re-run on every navigation (reload included), so a
	// later leg must re-register the full settings — patching storage
	// alone gets overwritten by the original seed.
	async function reseed(
		page: Page,
		settings: Record<string, unknown>
	): Promise<void> {
		await page.addInitScript(seedScript, settings);
		await page.reload();
		await expect(page.locator("article .rendered").first()).toBeVisible({
			timeout: 60_000
		});
	}

	/** Huge type with button scaling off keeps tight gaps; the opt-in
	restores airy ones. Same engine, same thread — only the toggle flips. */
	test("button scaling toggle owns the message gaps", async ({ page }) => {
		await seedChrome(page, { fontScale: 4 });
		const listGap = (): Promise<number> =>
			page.evaluate(() => {
				const articles = [
					...document.querySelectorAll("main .messages article")
				];
				if (articles.length < 2) throw new Error("need two articles");
				const first = articles[0]!.getBoundingClientRect();
				const second = articles[1]!.getBoundingClientRect();
				return second.top - first.bottom;
			});
		const off = await listGap();
		await reseed(page, { fontScale: 4, scaleActionsWithFont: true });
		const on = await listGap();
		expect(off).toBeLessThan(20);
		expect(on).toBeGreaterThan(off * 2);
	});

	/** No fold chevron on phones: swipe folds, body tap unfolds. */
	test("fold button stays off the mobile row", async ({ page }) => {
		await seedChrome(page, {
			hideButtons: false,
			hoverAssistantActions: false,
			hoverUserActions: false
		});
		const row = page.locator("article.assistant .actions").first();
		await expect(row.locator("button").first()).toBeVisible();
		await expect(
			row.locator('button[aria-label="Fold this message"]')
		).toHaveCount(0);
	});

	/** Short own messages dock hard right: the last row button (Rerun)
	shares the text's right edge instead of hanging past it. */
	test("short own message shares its right edge with the row", async ({
		page
	}) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{
						id: "e2e-chat",
						createdAt: 1,
						replyLang: null,
						messages: [
							{
								id: "m1",
								role: "user",
								content: "Test",
								usage: null,
								error: null
							}
						]
					}
				])
			);
		});
		await page.goto("/");
		await expect(page.locator("article.user .bubble").first()).toBeVisible({
			timeout: 60_000
		});
		const edges = await page.evaluate(() => {
			const text = document.querySelector("article.user .bubble .rendered");
			const rerun = document.querySelector(
				'article.user .actions button[data-tip="Rerun"]'
			);
			if (!text || !rerun) throw new Error("missing text or rerun");
			return {
				textRight: text.getBoundingClientRect().right,
				rerunRight: rerun.getBoundingClientRect().right
			};
		});
		expect(Math.abs(edges.textRight - edges.rerunRight)).toBeLessThanOrEqual(2);
	});

	/** Phone language pills hang under the hero, never docked over
	the composer (desktop keeps the dock). */
	test("empty-state language buttons sit under the hero", async ({ page }) => {
		await seedEmpty(page);
		await page.goto("/");
		const hero = page.locator(".hero");
		const menus = page.locator(".empty-state .lang-menus");
		await expect(hero).toBeVisible({ timeout: 60_000 });
		await expect(menus).toBeVisible();
		const heroBox = await hero.boundingBox();
		const menusBox = await menus.boundingBox();
		expect(heroBox).toBeTruthy();
		expect(menusBox).toBeTruthy();
		expect(menusBox!.y).toBeGreaterThanOrEqual(heroBox!.y + heroBox!.height);
	});

	/** The open phone sheet escapes the thread scroller: every option
	fits on screen and stays reachable (the scroller used to clip
	Europe's list to five languages, cut by a rectangle). */
	test("open language sheet shows every option above the composer", async ({
		page
	}) => {
		await seedEmpty(page);
		await page.goto("/");
		await page.locator(".lang-menu > button").first().tap();
		const list = page.locator(".lang-list");
		await expect(list).toBeVisible();
		const vh = await page.evaluate(() => window.innerHeight);
		const box = await list.boundingBox();
		expect(box).toBeTruthy();
		expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
		const items = list.locator("button");
		// The reported symptom was five visible languages: the sheet
		// must hold more than that, and the last option must be
		// reachable and on screen.
		expect(await items.count()).toBeGreaterThan(5);
		await items.last().scrollIntoViewIfNeeded();
		await expect(items.last()).toBeVisible();
		const lastBox = await items.last().boundingBox();
		expect(lastBox).toBeTruthy();
		expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(vh);
	});

	/** The empty-chat phone composer never grows on focus (the
	height growth raced the keyboard glide and moved the thread
	twice): full width and the same small height at rest, focused,
	and with text. */
	test("empty phone composer stays full-width, never grows", async ({
		page
	}) => {
		await seedEmpty(page);
		await page.goto("/");
		await expect(page.locator(".prompt")).toBeVisible();
		// Let the editor mount settle before measuring.
		await page.waitForTimeout(500);
		const geom = (): Promise<{
			mainW: number;
			rem: number;
			w: number;
			h: number;
		}> =>
			page.evaluate(() => {
				const rem = parseFloat(
					getComputedStyle(document.documentElement).fontSize
				);
				const mainW = document
					.querySelector("main")!
					.getBoundingClientRect().width;
				const r = document.querySelector(".prompt")!.getBoundingClientRect();
				return { mainW, rem, w: r.width, h: r.height };
			});
		const full = (g: { mainW: number; rem: number }): number =>
			g.mainW - 2 * 1.2 * g.rem;
		// At rest while textless the card already fills the column.
		const rest = await geom();
		expect(Math.abs(rest.w - full(rest))).toBeLessThanOrEqual(4);
		// No focus-dependent field clamp: the old rest-only 1.5rem cap
		// clipped scaled text and released it on focus, growing the
		// card under the placeholder on every tap.
		const fieldMax = (): Promise<string> =>
			page.evaluate(() => {
				const el = document.querySelector(".prompt .ta-input");
				return el instanceof HTMLElement
					? getComputedStyle(el).maxHeight
					: "missing";
			});
		const restClamp = await fieldMax();
		await page.locator(".prompt .ta-input").click();
		await page.waitForTimeout(400);
		expect(await fieldMax()).toBe(restClamp);
		// Focused: same width, same height — nothing moves.
		const focused = await geom();
		expect(Math.abs(focused.w - full(focused))).toBeLessThanOrEqual(4);
		expect(Math.abs(focused.h - rest.h)).toBeLessThanOrEqual(2);
		// With text and unfocused: still the same geometry.
		await page.locator(".prompt .ta-input").pressSequentially("hello");
		await page.locator(".hero").click();
		const typed = await geom();
		expect(Math.abs(typed.w - focused.w)).toBeLessThanOrEqual(2);
		expect(Math.abs(typed.h - focused.h)).toBeLessThanOrEqual(2);
	});

	/** Tapping the phone composer never moves a settled thread: the
	WebView pans on textbox focus, and the focusin guard re-pins
	behind it when the field was already on screen. Force-click skips
	Playwright's own scroll-into-view so the tap is all app. */
	test("composer tap preserves a scrolled thread", async ({ page }) => {
		const body = "Line of chat text for height. ".repeat(120);
		await seedChat(page, [
			{ role: "user", content: `q ${body}` },
			{ role: "assistant", content: `a ${body}` },
			{ role: "user", content: `q2 ${body}` },
			{ role: "assistant", content: `a2 ${body}` }
		]);
		await page.goto("/");
		await expect(page.locator(".prompt")).toBeVisible();
		await page.waitForFunction(
			() => {
				const box = document.querySelector(".messages") as HTMLElement | null;
				return box !== null && box.scrollHeight > box.clientHeight + 800;
			},
			undefined,
			{ timeout: 15_000 }
		);
		const top = await page.evaluate(() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			if (!box) return -1;
			// Instant: the column eases programmatic jumps (smooth), so a
			// bare assignment would still be animating at the read below
			// (same guard the key-glide path uses).
			box.style.scrollBehavior = "auto";
			box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight - 600);
			return box.scrollTop;
		});
		expect(top).toBeGreaterThan(100);
		await page.locator(".prompt .ta-input").click({ force: true });
		await expect(page.locator(".prompt .ta-input")).toBeFocused();
		await page.waitForTimeout(400);
		const after = await page.evaluate(
			() =>
				(document.querySelector(".messages") as HTMLElement | null)
					?.scrollTop ?? -1
		);
		expect(after).toBe(top);
	});

	/** Huge phone type goes full-bleed; normal type keeps the floor. */
	test("phone chat width blooms at 330 percent", async ({ page }) => {
		await seedChrome(page, { fontScale: 3.3 });
		const chatVar = (): Promise<string> =>
			page.evaluate(() =>
				getComputedStyle(document.querySelector(".app") as Element)
					.getPropertyValue("--chat-width")
					.trim()
			);
		expect(await chatVar()).toBe("999");
		await reseed(page, { fontScale: 1 });
		expect(await chatVar()).toBe("46");
	});
});

test.describe("toasts", () => {
	/** Long errors fit the phone column at text size: the nowrap
	desktop pill stretched full-width on Android. Forced through the
	message copy path with no clipboard (same trigger as
	error-toast.e2e.ts, under the Android UA). */
	test("error toast fits the phone column and reads at text size", async ({
		page
	}) => {
		await seedChat(page, [{ role: "assistant", content: "copy me" }]);
		await page.addInitScript(() => {
			Object.defineProperty(window.navigator, "clipboard", {
				value: null,
				configurable: true
			});
		});
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible({
			timeout: 60_000
		});
		const row = page.locator("article.assistant").first();
		await row.click();
		await expect(row).toHaveAttribute("data-actions-open", "true");
		await row.locator('button[aria-label="Copy as plain text"]').click();
		const toast = page.locator(".toast.error");
		await expect(toast).toContainText("Couldn't copy to the clipboard.", {
			timeout: 10_000
		});
		const style = await toast.evaluate((el) => {
			const s = getComputedStyle(el);
			return {
				size: s.fontSize,
				white: s.whiteSpace,
				maxWidth: s.maxWidth,
				maxHeight: s.maxHeight,
				overflow: s.overflowY,
				width: el.getBoundingClientRect().width
			};
		});
		expect(style.size).toBe("15.2px");
		expect(style.white).toBe("normal");
		expect(style.maxWidth).not.toBe("none");
		expect(style.maxHeight).not.toBe("none");
		expect(style.overflow).toBe("auto");
		expect(style.width).toBeLessThanOrEqual(412);
	});
});
