import { test, expect, type Page } from "@playwright/test";
import { requireShell, toggleSidebar } from "./helpers";

/**
 * Search-mobile bucket: the Ctrl+P / Cmd+P command palette (Worker
 * index, IndexedDB snapshot, in-memory fallback), the sidebar search
 * box behind the left-to-right swipe, and the touch paste-images
 * button. Written, not run, per the bucket brief (shared dev-server
 * port) — run with `bun run test:e2e e2e/search.e2e.ts`.
 */

async function seedThreeChats(page: Page): Promise<void> {
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
					id: "chat-ramen",
					createdAt: 1,
					replyLang: null,
					messages: [msg("m1", "ramen recipe with miso broth")]
				},
				{
					id: "chat-sushi",
					createdAt: 2,
					replyLang: null,
					messages: [msg("m2", "sushi rice vinegar ratio")]
				},
				{
					id: "chat-cjk",
					createdAt: 3,
					replyLang: null,
					messages: [msg("m3", "今天的中文菜单")]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
}

test.describe("search palette", () => {
	test("Ctrl+P opens the palette and finds a message", async ({ page }) => {
		await seedThreeChats(page);
		await requireShell(page);
		await page.keyboard.press("Control+p");
		await expect(
			page.getByRole("dialog", { name: "Search chats" })
		).toBeVisible();
		await page.getByLabel("Search chats and annotations").fill("ramen");
		await expect(page.locator(".search-hit").first()).toContainText("ramen", {
			timeout: 8000
		});
	});

	test("CJK query matches without whitespace boundaries", async ({ page }) => {
		await seedThreeChats(page);
		await requireShell(page);
		await page.keyboard.press("Control+p");
		await page.getByLabel("Search chats and annotations").fill("中文");
		await expect(page.locator(".search-hit").first()).toContainText("中文", {
			timeout: 8000
		});
	});

	test("Enter jumps to the hit chat and Esc closes", async ({ page }) => {
		await seedThreeChats(page);
		await requireShell(page);
		await page.keyboard.press("Control+p");
		const box = page.getByLabel("Search chats and annotations");
		await box.fill("sushi");
		await expect(page.locator(".search-hit").first()).toContainText("sushi", {
			timeout: 8000
		});
		await box.press("Enter");
		await expect(page.locator("article .rendered").first()).toContainText(
			"sushi"
		);
		await page.keyboard.press("Control+p");
		await expect(
			page.getByRole("dialog", { name: "Search chats" })
		).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("dialog", { name: "Search chats" })
		).toBeHidden();
	});
});

test.describe("palette focus order", () => {
	async function seedMiso(page: Page): Promise<void> {
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
						messages: [
							msg("a1", "miso ramen broth"),
							msg("a2", "miso tare seasoning")
						]
					},
					{
						id: "chat-b",
						createdAt: 2,
						replyLang: null,
						messages: [msg("b1", "miso soup breakfast")]
					}
				])
			);
		});
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
	}

	test("ESC moves input focus to the list, second ESC closes", async ({
		page
	}) => {
		await seedMiso(page);
		await requireShell(page);
		await page.keyboard.press("Control+p");
		const box = page.getByLabel("Search chats and annotations");
		await box.fill("miso");
		await expect(page.locator(".search-hit")).toHaveCount(3, { timeout: 8000 });
		// First ESC: palette stays, DOM focus lands on the highlight.
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("dialog", { name: "Search chats" })
		).toBeVisible();
		const focused = await page.evaluate(() => ({
			tag: document.activeElement?.tagName,
			cls: (document.activeElement as HTMLElement | null)?.className
		}));
		expect(focused.tag).toBe("BUTTON");
		expect(String(focused.cls)).toContain("search-hit");
		// Second ESC: closes.
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("dialog", { name: "Search chats" })
		).toBeHidden();
	});

	test("j/k walk results with DOM focus following the highlight", async ({
		page
	}) => {
		await seedMiso(page);
		await requireShell(page);
		await page.keyboard.press("Control+p");
		await page.getByLabel("Search chats and annotations").fill("miso");
		await expect(page.locator(".search-hit")).toHaveCount(3, { timeout: 8000 });
		await page.keyboard.press("Escape");
		const first = await page.evaluate(
			() => document.activeElement?.textContent
		);
		await page.keyboard.press("j");
		const second = await page.evaluate(() => ({
			text: document.activeElement?.textContent,
			selected: (document.activeElement as HTMLElement | null)?.getAttribute(
				"aria-selected"
			)
		}));
		expect(second.text).not.toBe(first);
		expect(second.selected).toBe("true");
		await page.keyboard.press("k");
		const back = await page.evaluate(() => document.activeElement?.textContent);
		expect(back).toBe(first);
	});

	test("Enter jumps without selecting the message", async ({ page }) => {
		await seedMiso(page);
		await requireShell(page);
		await page.keyboard.press("Control+p");
		const box = page.getByLabel("Search chats and annotations");
		await box.fill("ramen");
		await expect(page.locator(".search-hit").first()).toContainText("ramen", {
			timeout: 8000
		});
		await box.press("Enter");
		// The jump lands silently: the article takes DOM focus but
		// carries no .selected cursor (no scroll-mode parking).
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.tagName), {
				timeout: 8000
			})
			.toBe("ARTICLE");
		const selected = await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.classList.contains(
				"selected"
			)
		);
		expect(selected).toBe(false);
		await expect(page.locator("article.selected")).toHaveCount(0);
		// j glides instead of walking: still no cursor afterwards.
		await page.keyboard.press("j");
		await page.waitForTimeout(500);
		await expect(page.locator("article.selected")).toHaveCount(0);
	});
});

test.describe("find in chat", () => {
	test("Ctrl+F finds text in the current chat, Enter cycles hits", async ({
		page
	}) => {
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
						messages: [
							msg("a1", "miso ramen broth"),
							msg("a2", "sushi rice"),
							msg("a3", "miso soup breakfast")
						]
					}
				])
			);
		});
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		await requireShell(page);
		await page.keyboard.press("Control+f");
		const bar = page.locator(".find-bar");
		await expect(bar).toBeVisible();
		const box = bar.getByLabel("Find in chat");
		await box.fill("miso");
		await expect(bar.locator(".find-count")).toHaveText("1/2", {
			timeout: 8000
		});
		await expect(page.locator("article#msg-0.selected")).toBeVisible();
		// Enter cycles to the second hit, then wraps.
		await box.press("Enter");
		await expect(bar.locator(".find-count")).toHaveText("2/2");
		await expect(page.locator("article#msg-2.selected")).toBeVisible();
		await box.press("Enter");
		await expect(bar.locator(".find-count")).toHaveText("1/2");
		await expect(page.locator("article#msg-0.selected")).toBeVisible();
		// Escape closes the bar.
		await page.keyboard.press("Escape");
		await expect(bar).toBeHidden();
	});

	test("repeat Ctrl+F closes the bar it opened", async ({ page }) => {
		await seedThreeChats(page);
		await requireShell(page);
		await page.keyboard.press("Control+f");
		const bar = page.locator(".find-bar");
		await expect(bar).toBeVisible();
		await page.keyboard.press("Control+f");
		await expect(bar).toBeHidden();
	});

	/** One hit is "done": Enter, Esc, and repeat Cmd+F close the bar
	and drop the landed cursor. Several hits keep the old close
	(cursor stays for walking). */
	test("a lone find hit closes and deselects on Enter, Esc, repeat", async ({
		page
	}) => {
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
						messages: [
							msg("a1", "miso ramen broth"),
							msg("a2", "sushi rice"),
							msg("a3", "miso soup breakfast")
						]
					}
				])
			);
		});
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		await requireShell(page);
		const bar = page.locator(".find-bar");
		const box = bar.getByLabel("Find in chat");
		const loneHit = async () => {
			await page.keyboard.press("Control+f");
			await expect(bar).toBeVisible();
			await box.fill("sushi");
			await expect(bar.locator(".find-count")).toHaveText("1/1", {
				timeout: 8000
			});
			await expect(page.locator("article#msg-1.selected")).toBeVisible();
		};
		// Enter with one hit: bar closes, cursor dropped.
		await loneHit();
		await box.press("Enter");
		await expect(bar).toBeHidden();
		await expect(page.locator("article.selected")).toHaveCount(0);
		// Esc with one hit: same "done".
		await loneHit();
		await page.keyboard.press("Escape");
		await expect(bar).toBeHidden();
		await expect(page.locator("article.selected")).toHaveCount(0);
		// Repeat Cmd+F with one hit: same "done".
		await loneHit();
		await page.keyboard.press("Control+f");
		await expect(bar).toBeHidden();
		await expect(page.locator("article.selected")).toHaveCount(0);
		// Several hits still cycle on Enter, and closing drops the
		// cursor too: composer focus already flips mode to edit, so a
		// stale cursor would only strand the next scroll entry.
		await page.keyboard.press("Control+f");
		await expect(bar).toBeVisible();
		await box.fill("miso");
		await expect(bar.locator(".find-count")).toHaveText("1/2", {
			timeout: 8000
		});
		await expect(page.locator("article#msg-0.selected")).toBeVisible();
		await box.press("Enter");
		await expect(bar.locator(".find-count")).toHaveText("2/2");
		await expect(page.locator("article#msg-2.selected")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(bar).toBeHidden();
		await expect(page.locator("article.selected")).toHaveCount(0);
	});

	test("find bar floats in the upper half, never dead center", async ({
		page
	}) => {
		await seedThreeChats(page);
		await requireShell(page);
		await page.keyboard.press("Control+f");
		const bar = page.locator(".find-bar");
		await expect(bar).toBeVisible();
		const geom = await bar.evaluate((el) => {
			const r = el.getBoundingClientRect();
			return { midY: r.top + r.height / 2, viewport: window.innerHeight };
		});
		expect(geom.midY).toBeLessThan(geom.viewport / 2);
	});

	test("Shift+F never summons find, it types", async ({ page }) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			// Never idle-hide: the always-on default parks the composer
			// on load and the click below needs it mounted.
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify({ promptIdleSec: 0 })
			);
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{
						id: "chat-a",
						createdAt: 1,
						replyLang: null,
						messages: [
							{
								id: "a1",
								role: "assistant",
								content: "miso ramen",
								usage: null,
								error: null
							}
						]
					}
				])
			);
		});
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible({
			timeout: 60_000
		});
		await page.locator(".ta-input").click();
		await page.keyboard.press("Shift+f");
		await expect(page.locator(".find-bar")).toHaveCount(0);
		const draft = await page.evaluate(
			() =>
				(
					document.querySelector(
						".prompt .ta-input"
					) as HTMLTextAreaElement | null
				)?.value ?? ""
		);
		expect(draft.toLowerCase()).toContain("f");
	});
});

test.describe("web pass-through", () => {
	// Shell-only chords stay dead in the browser (e1026be): the page
	// never swallows print or browser find.
	test("Ctrl+P never opens the palette in the browser", async ({ page }) => {
		await seedThreeChats(page);
		await page.keyboard.press("Control+p");
		await expect(
			page.getByRole("dialog", { name: "Search chats" })
		).toHaveCount(0);
	});

	test("Ctrl+F never opens the find bar in the browser", async ({
		page
	}) => {
		await seedThreeChats(page);
		await page.keyboard.press("Control+f");
		await expect(page.locator(".find-bar")).toHaveCount(0);
	});
});

test.describe("sidebar search", () => {
	test("typing in the sidebar box filters the chat list", async ({ page }) => {
		await seedThreeChats(page);
		await toggleSidebar(page);
		const box = page.getByLabel("Search chats");
		await expect(box).toBeVisible();
		await box.fill("sushi");
		await expect(page.locator("aside ul li")).toHaveCount(1);
		await page.getByLabel("Clear chat search").click();
		await expect(page.locator("aside ul li")).toHaveCount(3);
	});
});

test.describe("touch paths", () => {
	test.use({
		userAgent:
			"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
		viewport: { width: 412, height: 915 }
	});

	test("left-to-right swipe summons the chats sidebar", async ({ page }) => {
		await seedThreeChats(page);
		// Swipe right summons (double-tap open is covered in
		// android.e2e.ts; this pins the swipe half here).
		const sidebar = page.locator("aside:not(.settings-panel)");
		await expect(sidebar).toHaveClass(/collapsed/);
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
					changedTouches: [touch(200, 604)]
				})
			);
		});
		await expect(sidebar).not.toHaveClass(/collapsed/);
	});

	test("paste-images button appears with clipboard.read and reports an empty clipboard", async ({
		page
	}) => {
		await page.addInitScript(() => {
			const nav = window.navigator as Navigator & {
				clipboard?: { read?: () => Promise<never[]> };
			};
			if (!nav.clipboard) return;
			try {
				Object.defineProperty(nav.clipboard, "read", {
					value: async () => [],
					configurable: true
				});
			} catch {
				// Clipboard is not patchable here; the button stays hidden.
			}
		});
		await seedThreeChats(page);
		const paste = page.getByLabel("Paste images from the clipboard");
		if ((await paste.count()) === 0)
			test.skip(true, "clipboard.read unavailable in this shell");
		await paste.click();
		await expect(page.locator(".error").first()).toContainText(
			"No images on the clipboard."
		);
	});
});

test.describe("sidebar search focus", () => {
	test("clicking the box keeps focus", async ({ page }) => {
		await seedThreeChats(page);
		await toggleSidebar(page);
		const box = page.getByLabel("Search chats");
		await expect(box).toBeVisible();
		await page.evaluate(() => {
			(window as unknown as { focusLog: string[] }).focusLog = [];
			document.addEventListener("focusin", (e) => {
				const t = e.target as HTMLElement | null;
				(window as unknown as { focusLog: string[] }).focusLog.push(
					t
						? `${t.tagName}.${(t.className?.toString?.() ?? "").slice(0, 30)}`
						: "null"
				);
			});
		});
		await box.click();
		await expect(box).toBeFocused();
		// Typing filters the list; hovering rows previews chats.
		await box.pressSequentially("s", { delay: 50 });
		await page.locator("aside ul li").first().hover();
		await page.waitForTimeout(1500);
		const log = await page.evaluate(
			() => (window as unknown as { focusLog: string[] }).focusLog
		);
		console.log(`focus trail: ${JSON.stringify(log)}`);
		await expect(box).toBeFocused();
	});
});
