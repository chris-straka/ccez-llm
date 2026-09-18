import { expect, test, type Page } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

/**
 * Streaming integrity on the mock provider: the reply lands exactly
 * once with its full text, and the visible text only ever grows (no
 * truncation flicker, no duplicated chunks).
 */

test("stream renders exactly one reply with the full text", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("integrity check");
	await page.keyboard.press("Enter");
	const body = page.locator("article.assistant .rendered");
	await expect(body).toContainText("Mock reply to: integrity check", { timeout: 15_000 });
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(body).toHaveText("Mock reply to: integrity check");
});

test("visible stream text grows monotonically, never flickers", async ({ page }) => {
	await seedChat(page, []);
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-word-ms", "60");
	});
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("monotonic stream sampling probe");
	await page.keyboard.press("Enter");
	const body = page.locator("article.assistant .rendered");
	await expect(body).toBeVisible({ timeout: 15_000 });
	const samples: string[] = [];
	for (let i = 0; i < 8; i++) {
		samples.push(((await body.textContent()) ?? "").trim());
		await page.waitForTimeout(150);
	}
	await expect(body).toContainText("Mock reply to: monotonic stream sampling probe", {
		timeout: 15_000
	});
	const final = (((await body.textContent()) ?? "").trim());
	// Every mid-stream sample is a prefix of the final text: tokens only
	// append (map + accumulator), the DOM never rewinds or restates.
	for (const sample of samples) {
		expect(final.startsWith(sample)).toBe(true);
	}
	expect(final).toBe("Mock reply to: monotonic stream sampling probe");
	await expect(page.locator("article.assistant")).toHaveCount(1);
});

/** A reply that finishes after a chat switch leaves the new chat
alone: its draft annotations survive (the origin's resets must not
run there) and its scroll never yanks to the bottom. The slow mock
cadence makes the mid-stream switch deterministic. */
test("mid-stream switch keeps the new chat's drafts and scroll", async ({ page }) => {
	const long = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6);
	const bodies = Array.from({ length: 30 }, (_, i) => `filler message number ${i}: ${long}`);
	await page.addInitScript(
		({ filler }: { filler: string[] }) => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem("ccez-mock-word-ms", "1000");
			window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ promptIdleSec: 0 }));
			const msg = (id: string, content: string) => ({ id, role: "assistant", content, usage: null, error: null });
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{ id: "chat-1", createdAt: 1, replyLang: null, messages: [msg("m1", "origin chat opener")] },
					{ id: "chat-2", createdAt: 2, replyLang: null, messages: filler.map((content, n) => msg(`f${n}`, content)) }
				])
			);
		},
		{ filler: bodies }
	);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toContainText("origin chat opener", { timeout: 60_000 });

	// Draft (filed, unsent) annotation in chat 1, then send slow.
	await annotateDraft(page, "origin chat opener", "origin note");
	await page.locator(".ta-input").click();
	await page.keyboard.type("go slow");
	await page.keyboard.press("Enter");

	// Switch to chat 2 mid-stream and draft an annotation there too,
	// then pin its scroll at the top: the annotate flow itself scrolls
	// message 5 into view, so the pin must come after it — anything
	// that moves scroll past this point is the completion under test.
	await switchChat(page, 1);
	await expect(page.locator("article .rendered").first()).toContainText("filler message number 0");
	await annotateDraft(page, "filler message number 5", "keep me");
	await page.evaluate(() => {
		document.querySelector("main .messages")?.scrollTo({ top: 0 });
	});

	// Chat 1's reply lands while chat 2 is open (read off storage —
	// the suite's proof the finish happened mid-test, not after).
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const chats = JSON.parse(window.localStorage.getItem("ccez-llm-chats-v1") ?? "[]") as {
						id: string;
						messages: unknown[];
					}[];
					return chats.find((c) => c.id === "chat-1")?.messages.length ?? 0;
				}),
			{ timeout: 30_000 }
		)
		.toBe(3);
	// Chat 2's draft survived the foreign completion (the old code
	// cleared it) and its scroll never yanked.
	await expect(page.locator(".prompt-tools .ann-wrap")).toHaveCount(1);
	const scroller = () =>
		page.evaluate(() => {
			const el = document.querySelector("main .messages") as HTMLElement | null;
			if (!el) throw new Error("no scroller");
			return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight };
		});
	const { top, max } = await scroller();
	expect(max).toBeGreaterThan(500);
	expect(top).toBeLessThan(100);
	// And the reply really did land back home.
	await switchChat(page, 0);
	await expect(page.locator("article.assistant .rendered").nth(1)).toContainText("Mock reply to: go slow");
});

/** Open the chat list if it closed itself, then pick a row. */
async function switchChat(page: Page, nth: number): Promise<void> {
	await page.locator(".ta-input").click();
	const aside = page.locator("aside").first();
	if (await aside.evaluate((el) => el.classList.contains("collapsed"))) {
		await page.keyboard.press("Meta+b");
	}
	const row = page.locator("aside ul li button.side-chat").nth(nth);
	await expect(row).toBeVisible();
	await row.click();
}

/** File one draft annotation (unsent) on the first quote match. */
async function annotateDraft(page: Page, quote: string, note: string): Promise<void> {
	await page.locator(`article .rendered:has-text("${quote}")`).first().dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.type(note);
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-wrap")).toHaveCount(1);
}

/** Annotating the just-sent message mid-stream survives the reply: the
post-send reset drops the baked pills only, never notes filed while
the reply was still arriving. The slow mock cadence makes the
mid-stream annotate deterministic. */
test("mid-stream annotation on the sent message survives the reply", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-mock-word-ms", "800");
	});
	await seedChat(page, [{ role: "user", content: "The quick brown fox jumps over the lazy dog." }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.locator(".ta-input").click();
	await page.keyboard.type("tell me about foxes");
	await page.keyboard.press("Enter");
	// The stream crawls (800ms a word): drag-select the just-sent
	// message and file an annotation before the reply lands.
	await expect(page.locator("article.assistant .rendered")).toBeVisible({ timeout: 15_000 });
	await dragQuote(page, 0, "quick brown fox");
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.type("mid-stream note");
	await page.keyboard.press("Enter");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	// The reply lands after the note was filed: the note survives it.
	await expect(page.locator("article.assistant .rendered")).toContainText("Mock reply to: tell me about foxes", {
		timeout: 30_000
	});
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	await expect(page.locator(".prompt-tools .ann-wrap")).toHaveCount(1);
});

/** The sending chip localizes to the chat reply language, counts the
wait up in seconds, and wears its accent tint (all inside one slow
mock stream). */
test("thinking chip localizes, counts up, and tints", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-mock-word-ms", "800");
	});
	await seedChat(page, [{ role: "user", content: "The quick brown fox jumps over the lazy dog." }], "ja");
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.locator(".ta-input").click();
	await page.keyboard.type("tell me about foxes");
	await page.keyboard.press("Enter");
	const sending = page.locator(".sending");
	await expect(sending).toContainText("考え中", { timeout: 15_000 });
	await expect(sending.locator(".sending-elapsed")).toContainText(/· \d+s/, { timeout: 12_000 });
	const elapsed = sending.locator(".sending-elapsed");
	await expect(elapsed).toBeHidden();
	await sending.locator(".sending-chip").hover();
	await expect(elapsed).toBeVisible();
	// No backplate: the chip is plain status text and the color lives
	// on the dots — three distinct hues in a blue-teal-green run.
	const dotColors = await page.evaluate(() => {
		const dots = [...document.querySelectorAll(".sending .tdots span")];
		return dots.map((d) => (d instanceof HTMLElement ? getComputedStyle(d).color : ""));
	});
	expect(dotColors).toHaveLength(3);
	expect(new Set(dotColors).size).toBe(3);
	await expect(page.locator("article.assistant .rendered")).toContainText("Mock reply to: tell me about foxes", {
		timeout: 30_000
	});
	await expect(sending).toHaveCount(0);
});
