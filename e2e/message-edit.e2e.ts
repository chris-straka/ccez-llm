import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/** The baked-refs count clears the edit frame at huge type: the
badge floats above the message, and its float offset tracks the text
size like the count itself (a fixed rem parks the grown number on the
frame's top edge). */
test("the refs badge clears the edit frame at huge type", async ({
	page
}) => {
	await seedChat(
		page,
		[
			{
				role: "user",
				content:
					"ما هي الأفكار؟\n\nAnnotated selections:\n1. \"الأفكار\" — ما معناها؟"
			},
			{ role: "assistant", content: "رد" }
		],
		null,
		{ fontScale: 3.7 }
	);
	await page.goto("/");
	await startEdit(page, 0);
	const pill = page.locator("article.user .ann-refs-pill");
	await expect(pill).toBeVisible();
	const clear = await page.evaluate(() => {
		const badge = document.querySelector("article.user .ann-refs-pill");
		const box = document.querySelector("article.user .msg-edit");
		if (!(badge instanceof HTMLElement) || !(box instanceof HTMLElement))
			return null;
		const badgeRect = badge.getBoundingClientRect();
		const boxRect = box.getBoundingClientRect();
		return { pillBottom: badgeRect.bottom, boxTop: boxRect.top };
	});
	if (!clear) throw new Error("edit badge geometry missing");
	expect(clear.pillBottom).toBeLessThanOrEqual(clear.boxTop);
});

/** Open the in-place editor on the nth own message. */
async function startEdit(page: Page, index = 0): Promise<void> {
	const article = page.locator("article.user").nth(index);
	await expect(article).toBeVisible();
	await article.hover();
	await article.locator('.actions button[aria-label="Edit this message"]').click();
	await expect(page.locator(".msg-edit")).toHaveCount(1);
}

test("hovering another message's buttons keeps the edit open", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "user", content: "first message here" },
		{ role: "assistant", content: "a reply" },
		{ role: "user", content: "second message here" }
	]);
	await page.goto("/");
	await startEdit(page, 0);
	// Draft a change, then wander to the other message's buttons: the
	// hover blur must not kill the edit (the draft stays mounted for a
	// click back in).
	const inline = page.locator(".msg-edit .ta-input");
	await inline.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" plus more");
	const other = page.locator("article.user").nth(1);
	await other.hover();
	await other.locator(".actions button").first().hover();
	await expect(page.locator(".msg-edit")).toHaveCount(1);
	await expect(inline).toHaveValue(/first message here plus more/);
});

test("clicking dead message space cancels the edit", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "leave me alone" },
		{ role: "assistant", content: "a reply" }
	]);
	await page.goto("/");
	await startEdit(page, 0);
	// Click-away (not hover-away) reverts to the untouched message.
	await page.locator("article.assistant .rendered").click();
	await expect(page.locator(".msg-edit")).toHaveCount(0);
	await expect(page.locator("article.user .rendered")).toContainText(
		"leave me alone"
	);
});

test("checkmark commits the edit and confirms with a toast", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "user", content: "helo world" },
		{ role: "assistant", content: "hi" }
	]);
	await page.goto("/");
	await startEdit(page, 0);
	const inline = page.locator(".msg-edit .ta-input");
	await inline.click();
	await page.keyboard.press("Control+a");
	await page.keyboard.type("hello world");
	await page.locator("[data-commit-edit]").click();
	await expect(page.locator("article.user .rendered")).toContainText(
		"hello world"
	);
	await expect(page.locator(".toast:not(.error)")).toHaveText(
		"Message edited"
	);
});

test("the editor reads at the message size", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "size me" },
		{ role: "assistant", content: "a reply" }
	]);
	await page.goto("/");
	await startEdit(page, 0);
	const editorSize = await page
		.locator(".msg-edit .ta-input")
		.evaluate((el) => getComputedStyle(el).fontSize);
	// The editing article unmounts its own .rendered, so the reply
	// stands in: both read at the shared message size.
	const messageSize = await page
		.locator("article.assistant .rendered")
		.evaluate((el) => getComputedStyle(el).fontSize);
	expect(editorSize).toBe(messageSize);
});

test("buttons hold still while another row is hovered mid-edit", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "user", content: "first message here" },
		{ role: "assistant", content: "a reply" },
		{ role: "user", content: "second message here" }
	]);
	await page.goto("/");
	await startEdit(page, 0);
	const row = page.locator("article.user").nth(0).locator(".actions button");
	const before = await row.evaluateAll((els) =>
		els.map((el) => {
			const r = el.getBoundingClientRect();
			return [r.x, r.y, r.width, r.height];
		})
	);
	const other = page.locator("article.user").nth(1);
	await other.hover();
	await other.locator(".actions button").first().hover();
	const after = await row.evaluateAll((els) =>
		els.map((el) => {
			const r = el.getBoundingClientRect();
			return [r.x, r.y, r.width, r.height];
		})
	);
	expect(after).toEqual(before);
});
