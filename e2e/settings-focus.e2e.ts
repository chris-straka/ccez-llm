import { expect, test, type Page } from "@playwright/test";

const LONG = "Line of chat text for height. ".repeat(200);

async function seed(page: Page, settings: Record<string, unknown>, texts: string[]): Promise<void> {
	await page.addInitScript(
		({ s, bodies }: { s: Record<string, unknown>; bodies: string[] }) => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify(s));
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify(
					bodies.map((content, n) => ({
						id: `chat-${n}`,
						createdAt: n,
						replyLang: null,
						messages: [{ id: `m${n}`, role: "assistant", content, usage: null, error: null }]
					}))
				)
			);
			(window as unknown as { __vtCalls: number }).__vtCalls = 0;
			const doc = document as Document & {
				startViewTransition?: (opts: { update: () => void }) => { finished: Promise<void> };
			};
			const orig = doc.startViewTransition;
			if (typeof orig === "function") {
				doc.startViewTransition = (opts) => {
					(window as unknown as { __vtCalls: number }).__vtCalls += 1;
					return orig.call(document, opts);
				};
			}
		},
		{ s: settings, bodies: texts }
	);
}

const vtCalls = (page: Page): Promise<number> =>
	page.evaluate(() => (window as unknown as { __vtCalls: number }).__vtCalls ?? -1);
const composer = (page: Page) => page.locator(".prompt .ta-input");
const settingsPanel = (page: Page) => page.locator(".settings-panel");

/** Dead message-area point: inside the text run, clear of the action
row below it and the settings drawer to its right. */
async function clickBackToChat(page: Page): Promise<void> {
	await page.locator("article .rendered").first().click({ position: { x: 50, y: 200 } });
}

/** Dismissing settings by clicking back lands the caret in the shown prompt. */
test("click-back from settings focuses the visible prompt", async ({ page }) => {
	await seed(page, { promptIdleSec: 0, sidebarCollapsed: true }, [LONG]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.keyboard.press("Meta+,");
	await expect(settingsPanel(page)).not.toHaveClass(/closed/);
	await clickBackToChat(page);
	await expect(settingsPanel(page)).toHaveClass(/closed/);
	await expect(composer(page)).toBeFocused();
});

/** A hidden prompt stays keys-only: click-back closes settings, summons nothing. */
test("click-back never summons a hidden prompt", async ({ page }) => {
	await seed(page, { sidebarCollapsed: true }, [LONG]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await expect(page.locator(".prompt.prompt-idle")).toHaveCount(1);
	await page.keyboard.press("Meta+,");
	await expect(settingsPanel(page)).not.toHaveClass(/closed/);
	await clickBackToChat(page);
	await expect(settingsPanel(page)).toHaveClass(/closed/);
	await expect(page.locator(".prompt.prompt-idle")).toHaveCount(1);
	await expect(composer(page)).not.toBeFocused();
});

/** Enter on the already-active sidebar row runs no view transition. */
test("enter on the active chat skips the crossfade", async ({ page }) => {
	await seed(page, {}, ["Alpha active-chat message", "Bravo second-chat message"]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toContainText("Alpha");
	// The list boots closed: opening lands focus on the current row.
	await page.keyboard.press("Control+b");
	await expect
		.poll(
			() =>
				page.evaluate(
					() => !!(document.activeElement as HTMLElement | null)?.closest("aside ul li button.side-chat")
				),
			{ timeout: 10_000 }
		)
		.toBe(true);
	// Preview-as-you-go steps to the second chat (one transition).
	await page.keyboard.press("j");
	await expect(page.locator("article .rendered").first()).toContainText("Bravo");
	expect(await vtCalls(page)).toBe(1);
	// Focus already sits on the live row: Enter re-enters it with no crossfade.
	await page.keyboard.press("Enter");
	expect(await vtCalls(page)).toBe(1);
	await expect(composer(page)).toBeFocused();
});
