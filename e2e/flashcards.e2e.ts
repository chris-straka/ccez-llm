import { expect, test, type Page } from "@playwright/test";
import { toggleSidebar } from "./helpers";

/**
 * Flashcards: answered annotations from other chats surface as a quiet
 * "N flashcards due" entry on an empty chat; the deck flips, grades,
 * deletes, and keeps English quotes out.
 */
async function seedDeck(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 0 })
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
					id: "de-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						msg("m0", "user", "Wo ist der Bahnhof?"),
						msg(
							"m1",
							"assistant",
							"Der Bahnhof ist ganz in der Nähe. Gehen Sie geradeaus. What is the point of this?"
						)
					]
				}
			])
		);
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"de-chat": [
					{
						id: "a1",
						messageId: "m1",
						quote: "ganz in der Nähe",
						comment: "",
						answer: "very close by"
					},
					{
						id: "a2",
						messageId: "m1",
						quote: "Gehen Sie geradeaus",
						comment: "",
						answer: "go straight ahead"
					},
					{
						id: "a3",
						messageId: "m1",
						quote: "What is the point of this?",
						comment: "",
						answer: "an English aside"
					}
				]
			})
		);
	});
}

test("flashcards flip, grade, delete, and skip English quotes", async ({
	page
}) => {
	await seedDeck(page);
	await page.goto("/");
	// The entry lives on empty chats only.
	await expect(
		page.getByRole("button", { name: /flashcards? due/ })
	).toHaveCount(0);
	await page.locator(".ta-input").click();
	await toggleSidebar(page);
	await page
		.locator('aside:not(.settings-panel) button[aria-label="New chat"]')
		.click();
	await expect(page.locator(".hero")).toBeVisible();
	await page.screenshot({ path: ".screenshots/flashcards-entry.png" });
	// Two German cards due; the English quote never becomes one.
	const entry = page.getByRole("button", { name: "2 flashcards due" });
	await expect(entry).toBeVisible();
	await entry.click();

	const dialog = page.getByRole("dialog", { name: "Flashcards" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText("2 cards left")).toBeVisible();
	await expect(dialog.locator(".front .quote")).toHaveText("ganz in der Nähe");
	await expect(dialog.locator(".front .context")).toHaveText(
		"Der Bahnhof ist ganz in der Nähe."
	);

	await dialog.screenshot({ path: ".screenshots/flashcards-front.png" });
	// Space flips; a grade only lands face-up.
	await page.keyboard.press("Space");
	await expect(dialog.locator(".flashcard")).toHaveClass(/flipped/);
	await expect(dialog.locator(".back .answer")).toHaveText("very close by");
	await page.waitForTimeout(500); // let the flip settle for the screenshot
	await dialog.screenshot({ path: ".screenshots/flashcards-back.png" });
	await page.keyboard.press("2");
	await expect(dialog.locator(".front .quote")).toHaveText(
		"Gehen Sie geradeaus"
	);

	// Delete drops the card without touching its annotation.
	await dialog.getByRole("button", { name: "Delete" }).click();
	await expect(dialog.getByText("All caught up")).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Export to Anki" })
	).toBeVisible();

	const schedule = await page.evaluate(() =>
		JSON.parse(window.localStorage.getItem("ccez-llm-flashcards-v1") ?? "{}")
	);
	expect(schedule["ganz in der nähe"]?.interval).toBe(1);
	expect(schedule["gehen sie geradeaus"]?.dismissed).toBe(true);
	const drafts = await page.evaluate(() =>
		JSON.parse(window.localStorage.getItem("ccez-llm-annotations-v1") ?? "{}")
	);
	expect(drafts["de-chat"]).toHaveLength(3);

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	// Nothing left due: the entry goes away.
	await expect(
		page.getByRole("button", { name: /flashcards? due/ })
	).toHaveCount(0);
});
