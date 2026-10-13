import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";

const excerpt = Array.from(
	{ length: 30 },
	(_, i) =>
		`Line ${i + 1}: Au lendemain de la fusillade, les investigations se poursuivent.`
).join("\n");

async function pasteExcerpt(page: Page): Promise<void> {
	await seedChat(
		page,
		Array.from({ length: 30 }, (_, i) => ({
			role: "assistant" as const,
			content: `History paragraph ${i + 1}. `.repeat(10)
		}))
	);
	await page.goto("/");
	const field = page.locator(".prompt .ta-input");
	await expect(field).toBeVisible();
	await field.focus();
	await field.evaluate((el, text) => {
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", {
			bubbles: true,
			cancelable: true
		});
		Object.defineProperty(event, "clipboardData", { value: transfer });
		el.dispatchEvent(event);
	}, excerpt);
	await expect(
		page.getByRole("textbox", { name: "Pasted text preview" })
	).toHaveValue(excerpt);
}

test("paste preview scrolls to the end without moving the chat or footer", async ({
	page
}) => {
	await pasteExcerpt(page);
	const preview = page.getByRole("textbox", { name: "Pasted text preview" });
	const footer = page.locator(".attachments .tok");
	const footerBefore = await footer.boundingBox();
	await page.locator(".messages").evaluate((el) => {
		(el as HTMLElement).style.scrollBehavior = "auto";
		el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
	});
	const chatTop = await page
		.locator(".messages")
		.evaluate((el) => el.scrollTop);
	await preview.hover();
	await page.mouse.wheel(0, 400);
	await expect
		.poll(() => preview.evaluate((el) => el.scrollTop))
		.toBeGreaterThan(0);
	await page.mouse.wheel(0, 10000);
	await expect
		.poll(() =>
			preview.evaluate((el) =>
				Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop)
			)
		)
		.toBeLessThanOrEqual(2);
	await page.mouse.wheel(0, 500);
	await expect
		.poll(() => page.locator(".messages").evaluate((el) => el.scrollTop))
		.toBe(chatTop);
	expect((await footer.boundingBox())?.y).toBeCloseTo(footerBefore!.y, 0);
	await expect(page.locator(".prompt .ta-input")).toHaveValue(
		`[Pasted ${excerpt.length} chars] `
	);
	await page
		.locator(".attachments li.card")
		.screenshot({ path: ".screenshots/paste-preview-scroll.png" });
});

test("paste preview scrolls with the keyboard and cannot edit the attachment", async ({
	page
}) => {
	await pasteExcerpt(page);
	const preview = page.getByRole("textbox", { name: "Pasted text preview" });
	await preview.focus();
	await page.keyboard.press("ControlOrMeta+End");
	await expect
		.poll(() => preview.evaluate((el) => el.scrollTop))
		.toBeGreaterThan(0);
	await page.keyboard.type("accidental typing");
	await expect(preview).toHaveValue(excerpt);
	await page
		.locator('.attachments button[aria-label="Remove attachment"]')
		.click();
	await expect(preview).toHaveCount(0);
	await expect(page.locator(".prompt .ta-input")).toHaveValue("");
});
