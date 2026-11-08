import { expect, test } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Mobile readings + welcome text: the dock Speak button shows CJK
 * readings in the panel at the top (no popup space on phones), and
 * the hero is chrome — never selectable.
 */
test.use({
	hasTouch: true,
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

test.beforeEach(async ({ page }) => {
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
	await seedChat(page, [{ role: "assistant", content: "你好世界" }]);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
});

/** Summon the phone dock off a programmatic highlight: touchstart
snapshots the empty selection, the pick lands mid-touch, and the
lift summons the menu the way a handle drag would. */
async function summonDock(page: Page): Promise<void> {
	const selected = await page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const r = p?.getBoundingClientRect();
		if (!p || !r) return "";
		const x = r.x + 20;
		const y = r.y + r.height / 2;
		const touch = (clientX: number, clientY: number) =>
			new Touch({ identifier: 7, target: document.body, clientX, clientY });
		window.dispatchEvent(
			new TouchEvent("touchstart", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [touch(x, y)]
			})
		);
		const text = p.firstChild;
		const selection = window.getSelection();
		selection?.setBaseAndExtent(text, 0, text, 2);
		const picked = selection?.toString() ?? "";
		window.dispatchEvent(
			new TouchEvent("touchend", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [],
				changedTouches: [touch(x, y)]
			})
		);
		return picked;
	});
	expect(selected).toBe("你好");
	await expect(page.locator(".ann-dock-wrap")).toBeVisible({ timeout: 10_000 });
}

test("dock Speak shows pinyin at the top and still speaks", async ({
	page
}) => {
	await summonDock(page);
	await page.locator('button[aria-label="Speak selection"]').click();
	// Readings ride the unified panel now (the phone top-toast is
	// gone): readings only, near the highlight.
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	// Readings only: the characters are right there in the highlight.
	await expect(panel).toContainText("nǐ");
	await expect(panel).not.toContainText("你好");
	// Pinned under the camera hole, not down by the composer.
	const top = (await panel.boundingBox())?.y ?? 9999;
	expect(top).toBeLessThan(200);
	// Speech always runs too: the toast is a silent extra.
	const spoken = await page.evaluate(
		() => (window as unknown as { __spoken: string[] }).__spoken ?? []
	);
	expect(spoken.some((s) => s.includes("你好"))).toBe(true);
});

test("pinyin for a phrase at the left edge stays on screen as the page scrolls", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "做白宫新闻发言人。他在网上写道。" }
	]);
	await page.reload();
	const p = page.locator("article.assistant .rendered p").first();
	await expect(p).toContainText("做白宫新闻发言人", { timeout: 60_000 });
	const box = await p.boundingBox();
	await page.evaluate(
		({ x, y }) => {
			const touch = (clientX: number, clientY: number) =>
				new Touch({ identifier: 8, target: document.body, clientX, clientY });
			window.dispatchEvent(
				new TouchEvent("touchstart", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [touch(x, y)]
				})
			);
			const text = document.querySelector(
				"article.assistant .rendered p"
			)?.firstChild;
			if (text) window.getSelection()?.setBaseAndExtent(text, 0, text, 6);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(x, y)]
				})
			);
		},
		{ x: box!.x + 20, y: box!.y + 10 }
	);
	await expect(page.locator(".ann-dock-wrap")).toBeVisible({ timeout: 10_000 });
	await page.locator('button[aria-label="Speak selection"]').click();
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toContainText("zuò", { timeout: 10_000 });
	// Scrolling re-places the panel over its highlight: it must keep
	// the clamp the first placement had, not slide half off the edge.
	for (let i = 0; i < 3; i++) {
		await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
		await page.waitForTimeout(100);
		const left = (await panel.boundingBox())?.x ?? -1;
		expect(left).toBeGreaterThanOrEqual(0);
	}
});

test("a Chinese pick cut mid-word quotes and tints the whole words", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "做白宫新闻发言人。" }]);
	await page.reload();
	const p = page.locator("article.assistant .rendered p").first();
	await expect(p).toContainText("做白宫新闻发言人", { timeout: 60_000 });
	const box = await p.boundingBox();
	await page.evaluate(
		({ x, y }) => {
			const touch = (clientX: number, clientY: number) =>
				new Touch({ identifier: 9, target: document.body, clientX, clientY });
			window.dispatchEvent(
				new TouchEvent("touchstart", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [touch(x, y)]
				})
			);
			const text = document.querySelector(
				"article.assistant .rendered p"
			)?.firstChild;
			// 宫新: the end of 白宫 and the start of 新闻.
			if (text) window.getSelection()?.setBaseAndExtent(text, 2, text, 4);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(x, y)]
				})
			);
		},
		{ x: box!.x + 20, y: box!.y + 10 }
	);
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible({ timeout: 10_000 });
	// The selection stays as drawn; the rest of each word is tinted.
	const seen = await page.evaluate(() => {
		const tint = (
			CSS as unknown as {
				highlights: Map<string, Iterable<Range>>;
			}
		).highlights.get("ccez-sel-snap");
		return {
			selected: window.getSelection()?.toString() ?? "",
			tint: tint ? [...tint].map((r) => r.toString()) : []
		};
	});
	expect(seen).toEqual({ selected: "宫新", tint: ["白", "闻"] });
	await page.screenshot({
		path: test.info().outputPath("han-snap.png")
	});
	await menu.locator('button:has-text("Annotate")').tap();
	// Phones take the note in the composer; the send arrow files it.
	const composer = page.locator(".prompt textarea");
	await composer.click();
	await page.keyboard.type("?", { delay: 10 });
	await page.locator(".send-btn").click();
	await expect
		.poll(() =>
			page.evaluate(() => {
				const saved = JSON.parse(
					localStorage.getItem("ccez-llm-annotations-v1") ?? "{}"
				) as Record<string, Array<{ quote: string }>>;
				return saved["e2e-chat"]?.map((a) => a.quote) ?? [];
			})
		)
		.toEqual(["白宫新闻"]);
});

test("welcome hero text is not selectable", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	const hero = page.locator(".hero");
	await expect(hero).toBeVisible({ timeout: 60_000 });
	// Gesture-level opt-out (user-select gates real drag picks, which
	// is the complaint — programmatic ranges ignore it by design).
	await expect(hero).toHaveCSS("user-select", "none");
	await expect(hero).toHaveCSS("cursor", "default");
});
