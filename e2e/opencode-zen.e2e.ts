import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";
import { seedMockShell } from "./mock-shell";

/**
 * OpenCode Zen as a built-in provider. Its API sends no CORS headers:
 * the shells read its model list from Rust (`list_models`, mocked
 * here), only Android sends turns from Rust, and everywhere else says
 * so. The picker offers only the models Zen serves on
 * /chat/completions, free ones first and marked.
 */
async function openZen(page: Page): Promise<void> {
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("ControlOrMeta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	await panel
		.locator('[role="radiogroup"][aria-label="Active provider"] button', {
			hasText: "OpenCode Zen"
		})
		.click();
}

test("a plain browser offers Zen with its defaults but says Android owns it", async ({
	page
}) => {
	await seedChat(page, []);
	await page.goto("/");
	await openZen(page);
	const panel = page.locator(".settings-panel");
	// The folded custom-provider form has its own (hidden) Base URL.
	await expect(panel.locator('input[type="url"]:visible')).toHaveValue(
		"https://opencode.ai/zen/v1"
	);
	await expect(panel.locator('input[list="model-list"]')).toHaveValue("big-pickle");
	await expect(panel.getByText("Free model")).toBeVisible();
	await expect(panel.getByText("works in the Android app for now")).toBeVisible();
	await expect(panel.locator("#model-list option")).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Refresh" })).toBeDisabled();
});

test("the apps load Zen's chat models from Rust without a key, free first", async ({
	page
}) => {
	await seedMockShell(page);
	await seedChat(page, []);
	await page.goto("/");
	await openZen(page);
	const panel = page.locator(".settings-panel");
	const options = panel.locator("#model-list option");
	await expect(options).toHaveCount(4);
	expect(
		await options.evaluateAll((els) =>
			els.map((el) => [(el as HTMLOptionElement).value, el.getAttribute("label")])
		)
	).toEqual([
		["big-pickle", "Free"],
		["nemotron-3-ultra-free", "Free"],
		["deepseek-v4-pro", null],
		["glm-5.3", null]
	]);
	expect(
		await page.evaluate(
			() => (window as unknown as { __listModelsCalls: unknown[] }).__listModelsCalls
		)
	).toEqual([{ baseUrl: "https://opencode.ai/zen/v1", apiKey: "" }]);
	// Desktop shell: the list loads, but sends still run in the webview.
	await expect(panel.getByText("works in the Android app for now")).toBeVisible();
	await panel.locator('input[list="model-list"]').fill("glm-5.3");
	await expect(panel.getByText("Free model")).toHaveCount(0);
});

test.describe("Android shell", () => {
	test.use({
		userAgent:
			"Mozilla/5.0 (Linux; Android 16; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
		viewport: { width: 412, height: 915 }
	});

	test("sends from Rust there, so no app-only note", async ({ page }) => {
		await seedMockShell(page);
		await seedChat(page, []);
		await page.goto("/");
		await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
		// Phones open settings with a mid-screen swipe from right to left.
		await page.evaluate(() => {
			const touch = (x: number) =>
				new Touch({ identifier: 3, target: document.body, clientX: x, clientY: 500 });
			window.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(408)] })
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					touches: [],
					changedTouches: [touch(150)]
				})
			);
		});
		const panel = page.locator(".settings-panel");
		await expect(panel).not.toHaveClass(/closed/);
		await panel
			.locator('[role="radiogroup"][aria-label="Active provider"] button', {
				hasText: "OpenCode Zen"
			})
			.click();
		await expect(panel.locator("#model-list option")).toHaveCount(4);
		await expect(panel.getByText("Free model")).toBeVisible();
		await expect(panel.getByText("works in the Android app for now")).toHaveCount(0);
	});
});
