import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Hovered-message keyboard shortcuts (see messageKeyAction): C copies
 * with nothing selected, Shift+C branches from here, Shift+R reads
 * aloud — plus the Messages toggle that hides every action row, and
 * the Gap size slider that rides the row gap.
 */
test.beforeEach(async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.addInitScript(() => {
		(window as unknown as { __spoken: string[] }).__spoken = [];
		const synth = window.speechSynthesis;
		if (synth) {
			synth.speak = ((utterance: SpeechSynthesisUtterance) => {
				(window as unknown as { __spoken: string[] }).__spoken.push(
					utterance.text
				);
			}) as typeof synth.speak;
		}
	});
});

async function openThread(
	page: Page,
	settings?: Record<string, unknown>
): Promise<void> {
	await seedChat(page, [
		{ role: "user", content: "what is up" },
		{ role: "assistant", content: "alpha beta gamma delta" },
		{ role: "user", content: "and then?" },
		{ role: "assistant", content: "omega psi chi" }
	]);
	if (settings) {
		await page.addInitScript((extra: Record<string, unknown>) => {
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify(extra)
			);
		}, settings);
	}
	await page.goto("/");
	await expect(page.locator("article.assistant .rendered").first()).toBeVisible(
		{
			timeout: 60_000
		}
	);
}

/** Hover a message as keyboard-shortcut hands do (the composer owns
autofocus, so blur it: the keypress must read as body keys). */
async function hoverArticle(page: Page, role: string, nth = 0) {
	const article = page.locator(`article.${role}`).nth(nth);
	await article.hover();
	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur?.()
	);
	return article;
}

async function clipboardText(page: Page): Promise<string> {
	return page.evaluate(() => navigator.clipboard.readText());
}

test("hovering with nothing selected and pressing c copies the message", async ({
	page
}) => {
	await openThread(page);
	await hoverArticle(page, "assistant");
	await page.keyboard.press("c");
	// The write rides a promise: poll for it instead of racing it.
	await expect
		.poll(() => clipboardText(page), { timeout: 10_000 })
		.toContain("alpha beta gamma delta");
});

test("a live selection keeps its keys: c copies nothing", async ({ page }) => {
	await openThread(page);
	await page.evaluate(() => navigator.clipboard.writeText("sentinel"));
	const article = await hoverArticle(page, "assistant");
	await article.locator(".rendered").first().selectText();
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected.length).toBeGreaterThan(0);
	await page.keyboard.press("c");
	// A regressed copy lands fast: wait it out, then prove nothing moved.
	await page.waitForTimeout(500);
	expect(await clipboardText(page)).toBe("sentinel");
});

test("Shift+C branches from the hovered message", async ({ page }) => {
	await openThread(page);
	await hoverArticle(page, "user");
	await page.keyboard.press("Shift+C");
	// The fork lands beside the seeded chat and takes over the view
	// (its first message only: one user turn, no reply yet).
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						JSON.parse(window.localStorage.getItem("ccez-llm-chats-v1") ?? "[]")
							.length
				),
			{ timeout: 10_000 }
		)
		.toBe(2);
	await expect(page.locator("article")).toHaveCount(1);
	await expect(page.locator("article").first()).toContainText("what is up");
});

test("Shift+R reads the hovered message aloud", async ({ page }) => {
	await openThread(page);
	await hoverArticle(page, "assistant");
	await page.keyboard.press("Shift+R");
	// Native has no bridge in the browser: the engine falls back to
	// web voices, so the stubbed speak still records the utterance.
	await expect
		.poll(
			() =>
				page.evaluate(
					() => (window as unknown as { __spoken: string[] }).__spoken ?? []
				),
			{ timeout: 15_000 }
		)
		.toContain("alpha beta gamma delta");
});

test("hiding message buttons removes every row; c still copies", async ({
	page
}) => {
	await openThread(page, { showMessageButtons: false });
	await expect(page.locator("article .actions")).toHaveCount(0);
	await hoverArticle(page, "assistant", 1);
	await page.keyboard.press("c");
	await expect
		.poll(() => clipboardText(page), { timeout: 10_000 })
		.toContain("omega psi chi");
});

async function threadGaps(
	page: Page
): Promise<{ root: number; gap: number; pair: number }> {
	return page.evaluate(() => {
		const list = document.querySelector(".messages");
		const secondOwn = document.querySelectorAll("article.user")[1];
		if (!list || !secondOwn) throw new Error("missing thread");
		return {
			root: parseFloat(getComputedStyle(document.documentElement).fontSize),
			gap: parseFloat(getComputedStyle(list).gap),
			pair: parseFloat(getComputedStyle(secondOwn).marginTop)
		};
	});
}

test("gap size rides the row gap; pair separation stays a hair above", async ({
	page
}) => {
	await openThread(page);
	// Out of the box the thread sits tighter than the legacy 0.6rem.
	const def = await threadGaps(page);
	expect(def.gap).toBeCloseTo(def.root * 0.35, 1);
	expect(def.pair).toBeCloseTo(def.root * 0.45, 1);
	// Drive the real slider (a reload would re-run the seed script
	// and clobber the setting before first paint proves anything).
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/, { timeout: 10_000 });
	await panel.getByRole("slider", { name: "Gap size in rem" }).fill("1");
	const wide = await threadGaps(page);
	expect(wide.gap).toBeCloseTo(wide.root * 1, 1);
	expect(wide.pair).toBeCloseTo(wide.root * 1.1, 1);
});

test("settings offers the buttons checkbox and the gap slider", async ({
	page
}) => {
	await openThread(page);
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/, { timeout: 10_000 });
	await expect(
		panel.getByRole("checkbox", { name: "Show message buttons" })
	).toBeChecked();
	const slider = panel.getByRole("slider", { name: "Gap size in rem" });
	await expect(slider).toBeVisible();
	expect(await slider.inputValue()).toBe("0.35");
});

test("shortcuts modal lists the message keys", async ({ page }) => {
	await openThread(page);
	await page.keyboard.press("Control+Shift+Slash");
	await expect(
		page.locator(".modal", { hasText: "Keyboard shortcuts" })
	).toBeVisible({
		timeout: 10_000
	});
	for (const name of ["Copy message", "Branch from here", "Speak message"]) {
		await expect(
			page.locator(".modal .keys div > dt", { hasText: name })
		).toBeVisible();
	}
});
