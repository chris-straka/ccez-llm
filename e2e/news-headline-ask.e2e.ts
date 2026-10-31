import { test, expect } from "./fixtures";
import { seedChat } from "./helpers";
import { seedMockShell } from "./mock-shell";

/**
 * Asking about one headline word without reading the article: hover
 * a word on a news card and press A. The word files against the
 * story (badge on the card) and the story never opens. Runs in
 * WebKit too: the Mac shell's caret lookup is the one that matters.
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".empty-state h1")).toBeVisible({
		timeout: 60_000
	});
	await seedMockShell(page);
	await page.reload();
	await expect(page.locator(".empty-state h1")).toBeVisible({
		timeout: 60_000
	});
	await page.locator('.lang-menu button:has-text("Europe")').click();
	await page
		.locator(".lang-list")
		.getByRole("menuitem", { name: "French" })
		.click();
	await page.locator('.study-modes button[aria-label="News"]').click();
});

test("hovering a headline word and pressing A asks about it in the grid", async ({
	page
}) => {
	const panel = page.locator(".news-panel");
	const cards = panel.locator("button.news-card");
	await expect(cards).toHaveCount(3);
	// Cards fly in: measure once they have landed.
	await expect
		.poll(() =>
			panel.evaluate(
				(el) =>
					el
						.getAnimations({ subtree: true })
						.filter((a) => a.playState === "running").length
			)
		)
		.toBe(0);
	// Mid-word caret rect of "sparrows" so the pointer sits on a
	// glyph, not a gap.
	const pt = await cards.nth(0).evaluate((card) => {
		const title = card.querySelector(".news-card-title");
		const node = title?.firstChild;
		if (!node) return null;
		const i = (node.textContent ?? "").indexOf("sparrows");
		const r = document.createRange();
		r.setStart(node, i + 2);
		r.setEnd(node, i + 3);
		const rect = r.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	});
	if (!pt) throw new Error("headline has no text");
	await page.mouse.move(pt.x, pt.y);
	await page.keyboard.press("a");
	// The word files on its own card; the story never opens.
	const badge = cards.nth(0).locator("button.ccez-ann-badge");
	await expect(badge).toHaveCount(1, { timeout: 10_000 });
	await expect(panel.locator(".news-stage")).toHaveCount(0);
	await expect(cards).toHaveCount(3);
	// Filed against the story, not a message, on the hovered word.
	// The mock shell turns the mock provider off, so the answer
	// itself never lands here.
	await expect
		.poll(() =>
			page.evaluate(() => {
				const raw = localStorage.getItem("ccez-llm-annotations-v1") ?? "";
				return raw.includes('"quote":"sparrows"') && raw.includes('"story"');
			})
		)
		.toBe(true);
	await cards.nth(0).screenshot({
		path: test.info().outputPath("headline-badge.png")
	});
	// A press on the badge never opens the story either.
	await badge.click();
	await expect(panel.locator(".news-stage")).toHaveCount(0);
});
