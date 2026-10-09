import { test, expect } from "./fixtures";
import { seedChat } from "./helpers";

const REPLY_WITH_BLOCK =
	"Bien sûr !\n\n```correction\nJe vais au grand parc\n```";

test("correction mode diffs under the user message and hides the block", async ({
	page
}) => {
	await seedChat(page, [], "fr");
	await page.addInitScript((reply: string) => {
		localStorage.setItem("ccez-mock-word-ms", "10");
		localStorage.setItem("ccez-mock-reply", reply);
	}, REPLY_WITH_BLOCK);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	// The toggle shows beside the reply-language pill, default off.
	const toggle = page.locator(".prompt-tools .correct-btn");
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await page.locator(".ta-input").click();
	await page.keyboard.type("Je vais au le parc");
	await page.keyboard.press("Enter");
	// The assistant body renders without the fenced block.
	const assistant = page.locator("article.assistant .rendered");
	await expect(assistant).toContainText("Bien sûr", { timeout: 15_000 });
	await expect(assistant).not.toContainText("```correction");
	await expect(assistant).not.toContainText("Je vais au grand parc");
	// The user's message carries the diff: "le" struck, "grand" added.
	const diff = page.locator("article.user .correction");
	await expect(diff).toHaveText("Je vais au le grand parc", {
		timeout: 15_000
	});
	await expect(diff.locator(".corr-del")).toHaveText("le ");
	await expect(diff.locator(".corr-ins")).toHaveText("grand ");
	// The corrected word annotates like any text: menu, box, filing.
	await diff.locator(".corr-ins").dblclick();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible({ timeout: 10_000 });
	await page.keyboard.type("why grand?");
	await page.keyboard.press("Enter");
	await expect(page.locator(".ann-pop")).toBeHidden({ timeout: 10_000 });
});

test("correction toggle hides without a reply language", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant .rendered")).toBeVisible({
		timeout: 60_000
	});
	await expect(page.locator(".prompt-tools .correct-btn")).toHaveCount(0);
});
