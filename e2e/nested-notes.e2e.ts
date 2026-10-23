import { expect, test } from "./fixtures";
import { seedChat } from "./helpers";

/** A note on a sentence and one on a word inside it: both badges
show apart, each underline reads on its own. */
test("a word note inside a sentence note keeps its own badge", async ({
	page
}) => {
	await page.setViewportSize({ width: 1000, height: 630 });
	await page.addInitScript(() => {
		localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "s1",
						messageId: "e2e-m0",
						quote: "la maison qu'elle a seulement, remarquez.",
						comment: "",
						answer: "the house she only has, mind you."
					},
					{
						id: "w1",
						messageId: "e2e-m0",
						quote: "remarquez",
						comment: "",
						answer: "mind you"
					}
				]
			})
		);
	});
	await seedChat(
		page,
		[
			{
				role: "assistant",
				content:
					"Il y a quelque chose dans sa maison de Washington, la maison qu'elle a seulement, remarquez."
			}
		],
		null,
		{ fontScale: 3.7, theme: "dark" }
	);
	await page.goto("/");
	const badges = page.locator("button.ccez-ann-badge");
	await expect(badges).toHaveCount(2, { timeout: 60_000 });
	await badges.first().scrollIntoViewIfNeeded();
	const boxes = await badges.evaluateAll((els) =>
		els
			.map((e) => e.getBoundingClientRect())
			.map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom }))
	);
	await page.screenshot({ path: ".screenshots/nested-notes.png" });
	const [a, b] = boxes;
	const overlap = a!.l < b!.r && b!.l < a!.r && a!.t < b!.b && b!.t < a!.b;
	expect(overlap).toBe(false);
});
