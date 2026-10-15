import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Canadian Multilingual Standard (CSA) keyboard: [ is a dead
 * circumflex, so Ctrl+Shift+[ in the focused prompt arrives as
 * `key: "Dead"` on the BracketLeft code, IME-flagged in WebKit. The
 * chord still resizes the prompt, and the field never keeps a ^.
 */

async function deadChord(
	page: Page,
	opts: { code: string; composeFirst: boolean }
): Promise<void> {
	await page.locator(".ta-input").evaluate((el, o) => {
		const field = el as HTMLTextAreaElement;
		if (o.composeFirst) {
			// WebKit: the dead key composes before keydown runs.
			field.dispatchEvent(
				new CompositionEvent("compositionstart", { bubbles: true })
			);
			field.value += "^";
			field.dispatchEvent(new Event("input", { bubbles: true }));
		}
		const event = new KeyboardEvent("keydown", {
			key: "Dead",
			code: o.code,
			ctrlKey: true,
			shiftKey: true,
			isComposing: o.composeFirst,
			bubbles: true,
			cancelable: true
		});
		Object.defineProperty(event, "keyCode", { value: 229 });
		field.dispatchEvent(event);
	}, opts);
}

test("CSA dead-key Ctrl+Shift+[ / ] from the focused prompt runs the chord and types nothing", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "Bonjour." }]);
	await page.setViewportSize({ width: 1400, height: 900 });
	await page.goto("/");
	await expect(page.locator("article").first()).toBeVisible({
		timeout: 60_000
	});
	const field = page.locator(".ta-input");
	const aside = page.locator("aside:has(button.side-chat)");
	const panel = page.locator(".settings-panel");
	await expect(aside).toHaveClass(/collapsed/);
	await field.click();
	await page.keyboard.type("bonjour");

	// On the web the browser keeps width chords, so [ / ] toggle the
	// panels (the shell resizes the prompt: unit-tested chord).
	await deadChord(page, { code: "BracketLeft", composeFirst: true });
	await expect(aside).not.toHaveClass(/collapsed/);
	await expect(field).toHaveValue("bonjour");

	// Folding the list again, Chromium order (composition after keydown).
	await deadChord(page, { code: "BracketLeft", composeFirst: false });
	await expect(aside).toHaveClass(/collapsed/);
	await expect(field).toHaveValue("bonjour");
	await deadChord(page, { code: "BracketRight", composeFirst: false });
	await expect(panel).not.toHaveClass(/closed/);
	await expect(field).toHaveValue("bonjour");
});
