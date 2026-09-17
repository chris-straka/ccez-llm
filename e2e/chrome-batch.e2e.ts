import { expect, test, type Page } from "@playwright/test";
import { seedChat, type SeedMessage } from "./helpers";

/**
 * Chrome batch: slider reset scoping, idle-prompt restore allowlist,
 * middle-click toggle, emptied-composer caret (work/batch-chrome).
 */

const LONG = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);

async function openSettings(page: Page) {
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
}

/** Seed a long thread with a 2s idle timeout (overflows the viewport). */
async function seedIdleChat(page: Page, messages: SeedMessage[]) {
	await page.addInitScript((seed: { messages: SeedMessage[] }) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({
				hoverAssistantActions: true,
				hoverUserActions: true,
				promptIdleSec: 2
			})
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: seed.messages.map((m, i) => ({
						id: `e2e-m${i}`,
						role: m.role,
						content: m.content,
						usage: null,
						error: null
					}))
				}
			])
		);
	}, { messages });
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
}

function idleTurns(): SeedMessage[] {
	return [0, 1, 2, 3, 4, 5].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${LONG}` },
		{ role: "assistant" as const, content: `answer ${n} ${LONG}` }
	]);
}

/** Click the label-text row (top-left), clear of slider, readout, and reset button. */
async function clickLabelText(page: Page, sliderLabel: string) {
	// NOTE: the inner `has` selector must be relative — an absolute
	// `.settings-panel …` inner selector never matches inside a label.
	const label = page
		.locator(".settings-panel label")
		.filter({ has: page.locator(`input[aria-label="${sliderLabel}"]`) });
	const box = await label.boundingBox();
	expect(box).toBeTruthy();
	await page.mouse.click(box!.x + 20, box!.y + 10);
}

/** Only the parens button resets: label/row clicks keep the value, on all three rows. */
test("slider label text never resets any row", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
	await openSettings(page);

	const text = page.locator('.settings-panel input[aria-label="Text size percent"]');
	await text.fill("250");
	await expect(text).toHaveValue("250");
	await clickLabelText(page, "Text size percent");
	await expect(text).toHaveValue("250");
	await page.locator(".settings-panel button", { hasText: "(100%)" }).click();
	await expect(text).toHaveValue("100");

	const width = page.locator('.settings-panel input[aria-label="Chat width in rem"]');
	await width.fill("60");
	await expect(width).toHaveValue("60");
	await clickLabelText(page, "Chat width in rem");
	await expect(width).toHaveValue("60");
	await page.locator(".settings-panel button", { hasText: "(36)" }).click();
	await expect(width).toHaveValue("36");

	const idle = page.locator(
		'.settings-panel input[aria-label="Idle seconds before the prompt hides (bottom is always, top is never)"]'
	);
	await idle.fill("10");
	await expect(idle).toHaveValue("10");
	await clickLabelText(page, "Idle seconds before the prompt hides (bottom is always, top is never)");
	await expect(idle).toHaveValue("10");
	await page.locator(".settings-panel button", { hasText: "(6s)" }).click();
	await expect(idle).toHaveValue("6");
});

/** Idle prompt restores on i, Enter, and Space — and on nothing else key- or pointer-wise. */
test("idle prompt restores only on i, Enter, Space, or real click", async ({ page }) => {
	await seedIdleChat(page, idleTurns());
	const prompt = page.locator(".prompt");
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });

	// Mouse travel alone never restores.
	await page.mouse.move(400, 300);
	await page.mouse.move(420, 320);
	await expect(prompt).toHaveClass(/prompt-idle/);

	// An unrelated key never restores either — and never types blind
	// into the hidden box.
	await page.keyboard.press("j");
	await page.waitForTimeout(800);
	await expect(prompt).toHaveClass(/prompt-idle/);
	await expect(prompt).toHaveAttribute("data-empty", "true");

	// i restores and focuses the composer without typing the key.
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest?.(".prompt")))
		.toBe(true);
	await expect(prompt).toHaveAttribute("data-empty", "true");

	// Enter restores after the next hide.
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });
	await page.keyboard.press("Enter");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });

	// Space restores after the next hide.
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });
	await page.keyboard.press("Space");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
});

/** Selection drags keep the prompt hidden; plain clicks never summon; keys do; math never summons keys. */
test("idle prompt ignores drags, clicks, and math, answers keys", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedIdleChat(page, [
		{ role: "user", content: "show me the levels" },
		{ role: "assistant", content: `First point:\n\n$$E_n = -\\frac{13.6}{n^2}$$\n\nSecond point ${LONG}` },
		...idleTurns()
	]);
	const prompt = page.locator(".prompt");
	await expect(page.locator(".ccez-math").first()).toBeVisible({ timeout: 60_000 });
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });

	// A highlight drag across message text: still hidden afterwards.
	const rendered = page.locator("article.assistant .rendered").first();
	const box = await rendered.boundingBox();
	expect(box).toBeTruthy();
	await page.mouse.move(box!.x + 10, box!.y + 10);
	await page.mouse.down();
	await page.mouse.move(box!.x + 120, box!.y + 12, { steps: 6 });
	await page.mouse.up();
	await page.waitForTimeout(800);
	await expect(prompt).toHaveClass(/prompt-idle/);

	// A plain click on message text never summons; the i key restores
	// and focuses the composer.
	await page.locator("article.assistant .rendered").first().click();
	await page.waitForTimeout(600);
	await expect(prompt).toHaveClass(/prompt-idle/);
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest?.(".prompt")))
		.toBe(true);

	// Math taps copy but never summon the keyboard back.
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });
	await page.locator(".ccez-math-body").first().click();
	await page.waitForTimeout(800);
	await expect(prompt).toHaveClass(/prompt-idle/);
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest?.(".prompt")))
		.toBe(false);
});

/** Idle hide uncovers the tail: the prompt leaves the flow and stuck readers pin to the bottom. */
test("idle hide floats and moves nothing", async ({ page }) => {
	await seedIdleChat(page, idleTurns());
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
	const geometry = () =>
		page.evaluate(() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			const prompt = document.querySelector(".prompt") as HTMLElement | null;
			return {
				boxH: box?.clientHeight ?? 0,
				position: prompt ? getComputedStyle(prompt).position : "?",
				promptTop: prompt?.offsetTop ?? -1
			};
		});
	// Park at the bottom like a stuck reader, then go idle hands-off.
	await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		if (box) box.scrollTop = box.scrollHeight;
	});
	const before = await geometry();
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/, { timeout: 15_000 });
	await page.waitForTimeout(700);
	const after = await geometry();
	// Floating card in both states: hiding changes no geometry.
	expect(after.position).toBe("absolute");
	expect(after).toEqual(before);
});

/** Middle-click toggles the shortcuts modal: open when closed, close when open. */
test("middle-click toggles the shortcuts modal", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
	const box = await page.locator(".messages").boundingBox();
	expect(box).toBeTruthy();
	const x = box!.x + box!.width / 2;
	const y = box!.y + box!.height / 2;

	await expect(page.locator("#shortcuts-heading")).toHaveCount(0);
	await page.mouse.click(x, y, { button: "middle" });
	await expect(page.locator("#shortcuts-heading")).toBeVisible();
	await page.mouse.click(x, y, { button: "middle" });
	await expect(page.locator("#shortcuts-heading")).toHaveCount(0);
});

/** Paste-then-delete-all flags the composer empty and keeps focus
with a live caret (the native blink is the only focus signal). */
test("clearing the composer keeps focus with a live caret", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").first().click();

	// A long paste becomes a pill plus a positional tag (same dispatch
	// as the intake spec).
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	await page.evaluate((text) => {
		const target = document.querySelector(".ta-input");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	await expect(page.locator(".attachments .paste-body")).toBeVisible();
	await expect(page.locator(".prompt .ta-input")).toHaveValue(/\[Pasted 540 chars\]/);

	// Caret shows while the draft has content.
	const caretColor = (): Promise<string> =>
		page.evaluate(
			() => getComputedStyle(document.querySelector(".prompt .ta-input") as HTMLElement).caretColor
		);
	await expect.poll(caretColor).not.toBe("rgba(0, 0, 0, 0)");

	// Delete everything: the box flags empty and keeps focus (parked,
	// not blurred away) with its blink — the cursor is the only focus
	// signal. (execCommand: select natively — the delete-all path
	// under test is identical.)
	await page.evaluate(() => document.execCommand("selectAll"));
	await page.keyboard.press("Backspace");
	await expect(page.locator(".prompt")).toHaveAttribute("data-empty", "true");
	await expect.poll(caretColor).not.toBe("rgba(0, 0, 0, 0)");
	const stillFocused = await page.evaluate(
		() => !!document.activeElement?.closest?.(".prompt")
	);
	expect(stillFocused).toBe(true);
});
