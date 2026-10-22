import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Cards are opt-in per annotation: hovering a badge offers a save
 * icon beside it, and the answer card carries the same icon on its
 * corner (the phone's way in). Only saved quotes make the deck.
 */
async function seed(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "a1",
						messageId: "e2e-m1",
						quote: "fondement",
						comment: "",
						answer: "basis, grounds"
					}
				]
			})
		);
	});
	await seedChat(
		page,
		[
			{ role: "user", content: "hello" },
			{
				role: "assistant",
				content: "Il peut la critiquer sans fondement et c'est mal vu."
			}
		],
		null,
		{ flashcardsEnabled: true }
	);
	await page.goto("/");
	await page.locator("[data-ann-badge]").first().waitFor({ timeout: 60_000 });
}

const savedKeys = (page: Page) =>
	page.evaluate(() =>
		Object.keys(
			JSON.parse(
				window.localStorage.getItem("ccez-llm-flashcards-v1") ?? "{}"
			) as Record<string, unknown>
		)
	);

test("hovering a badge offers save as a card; a second click takes it back", async ({
	page
}) => {
	await seed(page);
	await page.locator("[data-ann-badge]").first().hover();
	const save = page.getByRole("button", { name: "Save as a card" });
	await expect(save).toBeVisible();
	await save.hover();
	await save.click();
	const remove = page.getByRole("button", { name: "Remove from cards" });
	await expect(remove).toBeVisible();
	expect(await savedKeys(page)).toEqual(["fondement"]);
	await remove.click();
	await expect(save).toBeVisible();
	expect(await savedKeys(page)).toEqual([]);
	// Leaving both lets it go.
	await page.mouse.move(5, 5);
	await expect(save).toHaveCount(0);
});

test("the answer card saves its quote as a card from its corner", async ({
	page
}) => {
	await seed(page);
	await page.locator("[data-ann-badge]").first().click();
	const card = page.locator(".ann-answer");
	await expect(card).toContainText("basis");
	await card.getByRole("button", { name: "Save as a card" }).click();
	await expect(
		card.getByRole("button", { name: "Remove from cards" })
	).toBeVisible();
	expect(await savedKeys(page)).toEqual(["fondement"]);
});
