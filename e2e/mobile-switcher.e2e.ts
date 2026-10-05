import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Phone quick switcher: double-tap or hold on dead space opens it,
 * it stays open past its own compat click, the card rides near the
 * top, and cycling inside it cuts instantly (no crossfade flashing
 * bright above the dimming veil).
 */
test.use({
	hasTouch: true,
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

async function seedTwo(page: Page): Promise<void> {
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
					id: "e2e-first",
					createdAt: 1,
					replyLang: null,
					messages: [msg("m1", "assistant", "first chat")]
				},
				{
					id: "e2e-second",
					createdAt: 2,
					replyLang: null,
					messages: [msg("m2", "assistant", "second chat")]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
}

/** Dead-space point below the short thread (not on text or chrome). */
async function deadSpace(page: Page): Promise<{ x: number; y: number }> {
	const y = await page.evaluate(() => {
		const arts = [...document.querySelectorAll("article")];
		const bottom = Math.max(
			...arts.map((a) => a.getBoundingClientRect().bottom)
		);
		const prompt = document.querySelector(".prompt")?.getBoundingClientRect();
		return Math.min(bottom + 120, (prompt?.top ?? 915) - 120);
	});
	return { x: 206, y: Math.max(200, y) };
}

test("double-tap on dead space opens the switcher and it stays open", async ({
	page
}) => {
	await seedTwo(page);
	const at = await deadSpace(page);
	await page.touchscreen.tap(at.x, at.y);
	await page.waitForTimeout(120);
	await page.touchscreen.tap(at.x, at.y);
	const veil = page.locator(".modal-veil.chat-switcher");
	await expect(veil).toBeVisible({ timeout: 5_000 });
	// Past the opening tap's own compat click: still open.
	await page.waitForTimeout(900);
	await expect(veil).toBeVisible();
	// A later tap-away on the veil closes it.
	const box = await veil.boundingBox();
	if (!box) throw new Error("veil has no box");
	await page.mouse.click(box.x + 20, box.y + box.height - 20);
	await expect(veil).toHaveCount(0);
});

test("switcher card rides near the top of the screen", async ({ page }) => {
	await seedTwo(page);
	const at = await deadSpace(page);
	await page.touchscreen.tap(at.x, at.y);
	await page.waitForTimeout(120);
	await page.touchscreen.tap(at.x, at.y);
	const card = page.locator(".switcher-card");
	await expect(card).toBeVisible({ timeout: 5_000 });
	const top = (await card.boundingBox())?.y ?? 9999;
	expect(top).toBeLessThan(915 * 0.4);
});

test("hold on dead space summons the switcher", async ({ page }) => {
	await seedTwo(page);
	const at = await deadSpace(page);
	await page.evaluate(({ x, y }) => {
		const el = document.elementFromPoint(x, y);
		if (!el) return;
		const touch = (clientX: number, clientY: number) =>
			new Touch({ identifier: 11, target: el, clientX, clientY });
		el.dispatchEvent(
			new TouchEvent("touchstart", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [touch(x, y)]
			})
		);
		window.setTimeout(() => {
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(x, y)]
				})
			);
		}, 650);
	}, at);
	const veil = page.locator(".modal-veil.chat-switcher");
	await expect(veil).toBeVisible({ timeout: 5_000 });
	await page.waitForTimeout(900);
	await expect(veil).toBeVisible();
});

test("cycling inside the switcher cuts without a transition", async ({
	page
}) => {
	await seedTwo(page);
	// Record snapshot scopes: cycling under the open switcher must
	// never snapshot (the crossfade paints above the dimming veil).
	await page.evaluate(() => {
		(window as unknown as { __vt: string[] }).__vt = [];
		const proto = Document.prototype as unknown as {
			startViewTransition?: (opts: { update: () => void }) => {
				finished: Promise<unknown>;
			};
		};
		const real = proto.startViewTransition;
		if (typeof real === "function") {
			proto.startViewTransition = function (
				this: Document,
				opts: { update: () => void }
			): { finished: Promise<unknown> } {
				(window as unknown as { __vt: string[] }).__vt.push("snapshot");
				return real.call(this, opts);
			};
		}
	});
	const at = await deadSpace(page);
	await page.touchscreen.tap(at.x, at.y);
	await page.waitForTimeout(120);
	await page.touchscreen.tap(at.x, at.y);
	await expect(page.locator(".modal-veil.chat-switcher")).toBeVisible({
		timeout: 5_000
	});
	const pos = page.locator(".switcher-pos");
	await expect(pos).toContainText("1 / 2");
	// Swipe left across the veil cycles to the next chat.
	await page.evaluate(() => {
		const veil = document.querySelector(".modal-veil.chat-switcher")!;
		const r = veil.getBoundingClientRect();
		const y = r.y + r.height / 2;
		const touch = (clientX: number) =>
			new Touch({ identifier: 13, target: veil, clientX, clientY: y });
		veil.dispatchEvent(
			new TouchEvent("touchstart", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [touch(300)]
			})
		);
		window.dispatchEvent(
			new TouchEvent("touchend", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [],
				changedTouches: [touch(120)]
			})
		);
	});
	await expect(pos).toContainText("2 / 2", { timeout: 5_000 });
	const calls = await page.evaluate(
		() => (window as unknown as { __vt: string[] }).__vt
	);
	expect(calls).toEqual([]);
});

async function openSwitcher(page: Page): Promise<void> {
	const at = await deadSpace(page);
	await page.touchscreen.tap(at.x, at.y);
	await page.waitForTimeout(120);
	await page.touchscreen.tap(at.x, at.y);
	await expect(page.locator(".modal-veil.chat-switcher")).toBeVisible({
		timeout: 5_000
	});
	await page.waitForTimeout(900);
}

test("switcher + mints a chat and dismisses", async ({ page }) => {
	await seedTwo(page);
	await openSwitcher(page);
	const card = page.locator(".switcher-card");
	await expect(card.locator(".switcher-pos")).toContainText("1 / 2");
	await page
		.locator(".switcher-actions")
		.getByRole("button", { name: "New chat" })
		.click();
	await expect(page.locator(".modal-veil.chat-switcher")).toHaveCount(0);
	const total = await page.evaluate(
		() =>
			JSON.parse(window.localStorage.getItem("ccez-llm-chats-v1") ?? "[]")
				.length
	);
	expect(total).toBe(3);
});

test("switcher trash drops the shown chat and stays open", async ({ page }) => {
	await seedTwo(page);
	await openSwitcher(page);
	const card = page.locator(".switcher-card");
	await expect(card.locator(".switcher-pos")).toContainText("1 / 2");
	await page
		.locator(".switcher-actions")
		.getByRole("button", { name: "Delete chat" })
		.click();
	await expect(card.locator(".switcher-pos")).toContainText("1 / 1");
	await expect(page.locator(".modal-veil.chat-switcher")).toBeVisible();
	const total = await page.evaluate(
		() =>
			JSON.parse(window.localStorage.getItem("ccez-llm-chats-v1") ?? "[]")
				.length
	);
	expect(total).toBe(1);
});

test("switcher actions float centered below the card", async ({ page }) => {
	await seedTwo(page);
	await openSwitcher(page);
	const layout = await page.evaluate(() => {
		const card = document
			.querySelector(".switcher-card")!
			.getBoundingClientRect();
		const acts = document
			.querySelector(".switcher-actions")!
			.getBoundingClientRect();
		const btn = document
			.querySelector(".switcher-act")!
			.getBoundingClientRect();
		return {
			cardBottom: card.bottom,
			cardCx: card.left + card.width / 2,
			actsTop: acts.top,
			actsCx: acts.left + acts.width / 2,
			insideCard:
				document.querySelector(".switcher-card .switcher-actions") !== null,
			btnWidth: btn.width
		};
	});
	// Outside the card panel, below it, centered on it.
	expect(layout.insideCard).toBe(false);
	expect(layout.actsTop).toBeGreaterThanOrEqual(layout.cardBottom);
	expect(Math.abs(layout.actsCx - layout.cardCx)).toBeLessThan(4);
	// Thumb-sized (44px) round buttons, not full-size bar buttons.
	expect(layout.btnWidth).toBeGreaterThanOrEqual(44);
	expect(layout.btnWidth).toBeLessThanOrEqual(48);
});

test("tapping the actions row dead space dismisses", async ({ page }) => {
	await seedTwo(page);
	await openSwitcher(page);
	// The row's center falls between the + and trash buttons: dead
	// space there must fall through to the veil and dismiss, not die
	// silently on the container. Forced: the veil intercepts the hit
	// by design (that IS the fix), so the rig must not hit-test.
	await page.locator(".switcher-actions").click({ force: true });
	await expect(page.locator(".modal-veil.chat-switcher")).toHaveCount(0);
});

test("composer refocuses and types after the first reply", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	const box = page.locator(".prompt .ta-input");
	await box.click();
	await page.keyboard.type("hello android");
	// Phones never send from the keyboard: the send button submits.
	await page.locator(".send-btn").click();
	await expect(page.locator("article.assistant .rendered").first()).toBeVisible(
		{ timeout: 30_000 }
	);
	await expect(page.locator(".sending")).toHaveCount(0, { timeout: 30_000 });
	await box.click();
	await expect(box).toBeFocused({ timeout: 5_000 });
	await page.keyboard.type("second");
	await expect(box).toHaveValue("second");
});

/** Phone full-text search lives behind the switcher's magnifier: hits
group under their chat, mark the matched word (accents folded), and a
pick with more matches in that chat opens the find bar to step them
without raising the keyboard. */
test("switcher search finds unaccented words and steps matches in the chat", async ({
	page
}) => {
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
					id: "e2e-de",
					createdAt: 1,
					replyLang: null,
					messages: [
						msg("d1", "user", "Was heißt über?"),
						msg("d2", "assistant", "Über means over."),
						msg("d3", "assistant", "Noch einmal: über.")
					]
				},
				{
					id: "e2e-other",
					createdAt: 2,
					replyLang: null,
					messages: [msg("o1", "assistant", "nothing to see")]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	const at = await deadSpace(page);
	await page.touchscreen.tap(at.x, at.y);
	await page.waitForTimeout(120);
	await page.touchscreen.tap(at.x, at.y);
	await expect(page.locator(".modal-veil.chat-switcher")).toBeVisible({
		timeout: 5_000
	});
	await page.waitForTimeout(700);
	await page.getByRole("button", { name: "Search chats" }).tap();
	await expect(page.locator(".modal-veil.chat-switcher")).toHaveCount(0);
	const field = page.getByLabel("Search chats and annotations");
	await expect(field).toBeFocused();
	await field.fill("uber");
	const hits = page.locator(".search-hit");
	await expect(hits).toHaveCount(3, { timeout: 8_000 });
	await expect(page.locator(".search-chat")).toHaveCount(1);
	await expect(page.locator(".search-chat")).toContainText("Was heißt über?");
	await expect(hits.first().locator("mark")).toHaveText(/über/i);
	await expect(hits.first().locator(".search-kind")).toHaveText(/you|ai/i);
	await page.screenshot({ path: ".screenshots/phone-search-results.png" });
	// Pick the closing message: the find bar opens on it, unfocused.
	await hits.filter({ hasText: "Noch einmal" }).tap();
	const bar = page.locator(".find-bar");
	await expect(bar).toBeVisible();
	await expect(bar.locator(".find-count")).toHaveText("3/3");
	await expect(bar.locator("input")).not.toBeFocused();
	// The landing flashes the matched word (Highlight registry).
	const flashSize = (): Promise<number> =>
		page.evaluate(() => {
			const reg = (
				window.CSS as unknown as {
					highlights?: { get(n: string): { size: number } | undefined };
				}
			).highlights;
			return reg?.get("ccez-ann-flash")?.size ?? 0;
		});
	await expect.poll(flashSize, { timeout: 5_000 }).toBeGreaterThan(0);
	await page.screenshot({ path: ".screenshots/phone-find-bar.png" });
	await expect.poll(flashSize, { timeout: 5_000 }).toBe(0);
	await bar.getByRole("button", { name: "Next match" }).tap();
	await expect(bar.locator(".find-count")).toHaveText("1/3");
	// Each step flashes again.
	await expect.poll(flashSize, { timeout: 5_000 }).toBeGreaterThan(0);
	await bar.getByRole("button", { name: "Close find" }).tap();
	await expect(bar).toHaveCount(0);
});

/** Phones rename with a still long-press on a chat row. */
test("long-press on a chat row renames it", async ({ page }) => {
	await seedTwo(page);
	await page.keyboard.press("Meta+Shift+BracketLeft");
	const row = page.locator("aside ul li button.side-chat").first();
	await expect(row).toBeVisible({ timeout: 5_000 });
	const box = await row.boundingBox();
	if (!box) throw new Error("row has no box");
	const at = { x: box.x + 30, y: box.y + box.height / 2 };
	await row.dispatchEvent("touchstart", {
		touches: [{ identifier: 1, clientX: at.x, clientY: at.y }]
	});
	await page.waitForTimeout(700);
	await row.dispatchEvent("touchend", { touches: [], changedTouches: [] }).catch(() => {});
	const field = page.getByLabel("Chat name");
	await expect(field).toBeFocused();
	await field.fill("Renamed on phone");
	await page.keyboard.press("Enter");
	await expect(page.locator("aside ul li .side-title").first()).toHaveText(
		"Renamed on phone"
	);
});

/** At giant text the switcher and phone search grow with the type,
capped so nothing runs off a 412px screen. */
test("switcher and search grow with giant text", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ fontScale: 4 }));
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
				{ id: "g1", createdAt: 1, replyLang: null, messages: [msg("a", "user", "Was heißt über?"), msg("b", "assistant", "Über means over.")] },
				{ id: "g2", createdAt: 2, replyLang: null, messages: [msg("c", "user", "Hi")] }
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
	// Giant text leaves no dead space to double-tap: a two-finger
	// hold on the thread opens the switcher instead.
	await page.evaluate(() => {
		const main = document.querySelector("main .messages") ?? document.body;
		const r = main.getBoundingClientRect();
		const touch = (id: number, x: number) =>
			new Touch({ identifier: id, target: main, clientX: x, clientY: r.top + r.height / 2 });
		const fingers = [touch(1, r.left + 120), touch(2, r.left + 220)];
		window.dispatchEvent(
			new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: fingers, changedTouches: fingers })
		);
	});
	await expect(page.locator(".modal-veil.chat-switcher")).toBeVisible({ timeout: 3_000 });
	await page.evaluate(() => {
		window.dispatchEvent(
			new TouchEvent("touchend", { bubbles: true, cancelable: true, composed: true, touches: [], changedTouches: [] })
		);
	});
	const titleSize = await page
		.locator(".switcher-title")
		.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
	expect(titleSize).toBeGreaterThan(16 * 1.5);
	await page.screenshot({ path: ".screenshots/phone-switcher-giant.png" });
	await page.waitForTimeout(700);
	await page.getByRole("button", { name: "Search chats" }).tap();
	const fits = async (sel: string): Promise<string[]> =>
		page.evaluate((s) => {
			const vw = document.documentElement.clientWidth;
			return [...document.querySelectorAll<HTMLElement>(s)]
				.filter((el) => {
					const r = el.getBoundingClientRect();
					return r.width > 0 && (r.left < -1 || r.right > vw + 1);
				})
				.map((el) => el.className);
		}, sel);
	const field = page.getByLabel("Search chats and annotations");
	await field.fill("uber");
	await expect(page.locator(".search-hit").first()).toBeVisible({ timeout: 8_000 });
	const size = await page
		.locator(".search-hit")
		.first()
		.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
	expect(size).toBeGreaterThan(14 * 1.3);
	expect(await fits(".search-palette, .search-palette *")).toEqual([]);
	await page.screenshot({ path: ".screenshots/phone-search-giant.png" });
});
