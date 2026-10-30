import { test, expect, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/** ⌘1…⌘0 in the app pick a priority language; the active one's key
 * clears it again. Shell-only chords, so a stub shell stands in. */
async function stubShell(page: Page): Promise<void> {
	await page.addInitScript(() => {
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			invoke: async (cmd: string): Promise<unknown> => {
				if (cmd === "keychain_get") return null;
				if (cmd === "keychain_set" || cmd === "keychain_delete") return null;
				if (cmd === "plugin:event|listen") return 1;
				throw new Error(`mock-shell: unhandled ${cmd}`);
			},
			transformCallback: (): number => 0,
			unregisterCallback: (): void => {}
		};
	});
}

test("⌘1 picks French on the empty chat and ⌘1 again clears it", async ({
	page
}) => {
	await seedChat(page, []);
	await stubShell(page);
	await page.goto("/");
	const news = page.getByRole("tab", { name: "News" });
	await expect(page.getByRole("tab", { name: "Music" })).toBeVisible({
		timeout: 60_000
	});
	await expect(news).toHaveCount(0);
	await page.keyboard.press("Meta+Digit1");
	await expect(news).toBeVisible();
	await page.keyboard.press("Meta+Digit1");
	await expect(news).toHaveCount(0);
});

test("⌘1 clears French from inside the composer and the Listen search too", async ({
	page
}) => {
	await seedChat(page, []);
	await stubShell(page);
	await page.goto("/");
	const news = page.getByRole("tab", { name: "News" });
	await expect(page.getByRole("tab", { name: "Music" })).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("Meta+Digit1");
	await expect(news).toBeVisible();
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.press("Meta+Digit1");
	await expect(news, "from the composer").toHaveCount(0);
	await page.keyboard.press("Meta+Digit1");
	await page.getByRole("tab", { name: "Listen" }).click();
	await page.locator(".listen-panel input[type=search]").click();
	await page.keyboard.press("Meta+Digit1");
	await expect(news, "from the Listen search").toHaveCount(0);
});
