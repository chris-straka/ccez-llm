import { expect, test } from "./fixtures";
import { seedChat } from "./helpers";

/** Settings → Chat → Old msgs (owner, 2026-11-11): a chat keeps its
newest five messages, and the notes on deleted ones go with them. */
test("a long chat keeps its last five messages and drops their notes", async ({
	page
}) => {
	const messages = Array.from({ length: 8 }, (_, i) => ({
		role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
		content: `numéro ${i}`
	}));
	await seedChat(page, messages, null, { keepRecentOnly: true });
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "ann-old",
						messageId: "e2e-m1",
						quote: "numéro",
						comment: "?",
						at: 0
					},
					{
						id: "ann-new",
						messageId: "e2e-m7",
						quote: "numéro",
						comment: "?",
						at: 0
					}
				]
			})
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered")).toHaveCount(5);
	await expect(page.locator("article .rendered").first()).toContainText(
		"numéro 3"
	);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const notes = JSON.parse(
					localStorage.getItem("ccez-llm-annotations-v1") ?? "{}"
				) as Record<string, Array<{ id: string }>>;
				return (notes["e2e-chat"] ?? []).map((n) => n.id);
			})
		)
		.toEqual(["ann-new"]);
});

test("with the switch off, nothing is deleted", async ({ page }) => {
	const messages = Array.from({ length: 8 }, (_, i) => ({
		role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
		content: `numéro ${i}`
	}));
	await seedChat(page, messages, null, { keepRecentOnly: false });
	await page.goto("/");
	await expect(page.locator("article .rendered")).toHaveCount(8);
});
