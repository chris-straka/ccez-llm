import { expect, test, type Page } from "./fixtures";
import { pinMacPlatform, seedChat } from "./helpers";

/* Desktop composer: text on top at the card's full width, one bottom
row with the tools on the left and send on the right, and the pasted
text card inside the box (never floating over the thread). */

const typed =
	"I don't understand the part at y compris. I read it as because the entire world listens, but the sentence keeps going after that and I lose the thread of who is listening to what.";

const pasted = Array.from(
	{ length: 6 },
	(_, i) =>
		`Ligne ${i + 1} : le monde entier écoute, y compris ceux qui ne parlent pas.`
).join("\n");

async function open(page: Page, width: number): Promise<void> {
	await page.setViewportSize({ width, height: 800 });
	await pinMacPlatform(page);
	await seedChat(page, [
		{ role: "user", content: "Que veut dire « y compris » ici ?" },
		{
			role: "assistant",
			content:
				"« Y compris » veut dire *including*. La phrase dit que le monde entier écoute, y compris les gens qui d'habitude n'écoutent pas."
		}
	]);
	await page.addInitScript(() => {
		const raw = window.localStorage.getItem("ccez-llm-settings-v1");
		const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ ...prev, theme: "dark" })
		);
	});
	await page.goto("/");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
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
	}, pasted);
	await expect(
		page.getByRole("textbox", { name: "Pasted text preview" })
	).toHaveValue(pasted);
	await page.keyboard.type(typed);
}

for (const [name, width] of [
	["desktop", 1280],
	["narrow", 560]
] as const) {
	test(`${name}: text spans the card, tools and send share the bottom row, paste card sits inside`, async ({
		page
	}) => {
		await open(page, width);
		await page.screenshot({
			path: `.screenshots/composer-bottom-row-${name}.png`
		});
		const card = (await page.locator(".prompt").boundingBox())!;
		const field = (await page.locator(".prompt .ta-input").boundingBox())!;
		const tools = (await page.locator(".prompt-tools").boundingBox())!;
		const send = (await page.locator(".prompt .send-btn").boundingBox())!;
		const tray = (await page.locator(".attachments li.card").boundingBox())!;
		// The text box keeps no side reservation: its content runs to
		// within the card's own padding on both sides.
		const pad = await page
			.locator(".prompt .ta-input")
			.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
		expect(pad).toBeLessThanOrEqual(2);
		expect(field.width).toBeGreaterThan(card.width - 40);
		// Tools and send sit below the text, on one row.
		expect(tools.y).toBeGreaterThanOrEqual(field.y + field.height - 1);
		expect(send.y).toBeGreaterThanOrEqual(field.y + field.height - 1);
		expect(
			Math.abs(tools.y + tools.height / 2 - (send.y + send.height / 2))
		).toBeLessThan(6);
		// Tools on the left, send on the right.
		expect(tools.x - card.x).toBeLessThan(24);
		expect(card.x + card.width - (send.x + send.width)).toBeLessThan(24);
		// The paste card lives inside the box, above the text.
		expect(tray.y).toBeGreaterThanOrEqual(card.y);
		expect(tray.y + tray.height).toBeLessThanOrEqual(field.y + 1);
		expect(tray.x).toBeGreaterThanOrEqual(card.x);
	});
}
