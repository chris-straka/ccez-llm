import { test, expect, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Hover+T trim: the prefix above the hovered assistant message hides
 * behind a slim marker (Undo restores it) and folds into the rolling
 * summary through the mock provider — asserted via persisted storage,
 * since the summary itself never renders.
 */
const PAD = "padding ".repeat(150);

function seedMessages(): Array<{ role: "user" | "assistant"; content: string }> {
	const tags = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT"];
	return tags.map((tag, i) => ({
		role: i % 2 === 0 ? "user" : "assistant",
		content: `${tag} ${PAD}`
	}));
}

/** Hover a row, then blur the autofocused composer so the hotkey lands. */
async function hoverArticle(page: Page, id: string): Promise<void> {
	await page.locator(`#${id}`).hover();
	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur?.()
	);
}

test("trims above the hovered reply, folds the summary, undo restores", async ({
	page
}) => {
	await seedChat(page, seedMessages());
	await page.goto("/");
	await expect(page.locator("#msg-5")).toBeVisible({ timeout: 60_000 });
	await hoverArticle(page, "msg-3");
	await page.keyboard.press("t");
	const marker = page.locator(".trim-marker");
	await expect(marker).toContainText("3 messages trimmed", {
		timeout: 10_000
	});
	await expect(page.locator("#msg-0")).toHaveCount(0);
	await expect(page.locator("#msg-3")).toBeVisible();
	// The mock provider folded the prefix: watermarks persisted.
	await page.waitForFunction(
		() => {
			const chats = JSON.parse(
				localStorage.getItem("ccez-llm-chats-v1") ?? "[]"
			) as Array<{ summary?: string; summaryThrough?: string; trimmedThrough?: string }>;
			const chat = chats[0];
			return (
				typeof chat?.summary === "string" &&
				chat.summary.length > 0 &&
				chat.summaryThrough === "e2e-m2" &&
				chat.trimmedThrough === "e2e-m3"
			);
		},
		{ timeout: 10_000 }
	);
	await marker.getByRole("button", { name: "Undo" }).click();
	await expect(marker).toHaveCount(0);
	await expect(page.locator("#msg-0")).toBeVisible();
});

test("trim refuses user messages", async ({ page }) => {
	await seedChat(page, seedMessages());
	await page.goto("/");
	await expect(page.locator("#msg-5")).toBeVisible({ timeout: 60_000 });
	await hoverArticle(page, "msg-2");
	await page.keyboard.press("t");
	await expect(page.locator(".toast")).toHaveText(
		"Hover an assistant message to trim above it."
	);
	await expect(page.locator(".trim-marker")).toHaveCount(0);
	await expect(page.locator("#msg-0")).toBeVisible();
});

test("trim refuses the head of the chat", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: `HEAD ${PAD}` },
		{ role: "user", content: `TAIL ${PAD}` }
	]);
	await page.goto("/");
	await expect(page.locator("#msg-1")).toBeVisible({ timeout: 60_000 });
	await hoverArticle(page, "msg-0");
	await page.keyboard.press("t");
	await expect(page.locator(".toast")).toHaveText("Nothing above to trim.");
	await expect(page.locator(".trim-marker")).toHaveCount(0);
});

// NOTE: no find-bar test — the bar only opens in the shell
// (find-toggle is shell-only, and no shell e2e project exists),
// so trim+find is an on-device check. The currentFindHits filter
// is a no-op untrimmed (floor 0 keeps every hit).
test("scroll selection stops at the trim point", async ({ page }) => {
	await seedChat(page, seedMessages());
	await page.goto("/");
	await expect(page.locator("#msg-5")).toBeVisible({ timeout: 60_000 });
	await hoverArticle(page, "msg-3");
	await page.keyboard.press("t");
	await expect(page.locator(".trim-marker")).toContainText("3 messages trimmed", {
		timeout: 10_000
	});
	await page.keyboard.press("Control+g");
	await expect(page.locator(".app[data-focus-mode='scroll']")).toHaveCount(1, {
		timeout: 5_000
	});
	// gg goes to the first visible message, k holds there, j walks on.
	await page.keyboard.press("g");
	await page.keyboard.press("g");
	await expect(page.locator("#msg-3.selected")).toBeVisible({ timeout: 5_000 });
	await page.keyboard.press("k");
	await expect(page.locator("#msg-3.selected")).toBeVisible({ timeout: 5_000 });
	await page.keyboard.press("j");
	await expect(page.locator("#msg-4.selected")).toBeVisible({ timeout: 5_000 });
});

test("a persisted trim restores its marker on boot", async ({ page }) => {
	await seedChat(page, seedMessages());
	await page.addInitScript(() => {
		const chats = JSON.parse(
			localStorage.getItem("ccez-llm-chats-v1") ?? "[]"
		) as Array<Record<string, unknown>>;
		if (chats[0]) {
			chats[0].trimmedThrough = "e2e-m3";
			chats[0].summary = "boot summary";
			chats[0].summaryThrough = "e2e-m2";
		}
		localStorage.setItem("ccez-llm-chats-v1", JSON.stringify(chats));
	});
	await page.goto("/");
	const marker = page.locator(".trim-marker");
	await expect(marker).toContainText("3 messages trimmed", {
		timeout: 60_000
	});
	await expect(page.locator("#msg-0")).toHaveCount(0);
	await expect(page.locator("#msg-3")).toBeVisible();
});
