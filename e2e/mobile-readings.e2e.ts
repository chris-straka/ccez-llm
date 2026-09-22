import { expect, test } from "@playwright/test";
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
