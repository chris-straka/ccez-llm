import { devices, expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Stick-to-bottom: submit pins the view to the newest content and the
 * stream carries it down as the reply grows — unless a held finger
 * freezes everything in place. Uses the mock provider's echo (a long
 * sent message grows a taller-than-viewport reply, so the submit-time
 * scroll alone can never reach the final bottom).
 */
test.setTimeout(90_000);

const LONG = "lorem ipsum dolor sit amet ".repeat(60);

async function sendLong(page) {
	await page.locator(".ta-input").click();
	await page.keyboard.type(LONG.slice(0, 400), { delay: 0 });
	// Phone composer: Enter is a carriage return there (enterSubmits
	// is false), so the send button alone sends.
	await page.locator(".send-btn").click();
}

async function streamDone(page) {
	await expect(page.locator("article.assistant .rendered")).toContainText(
		"Mock reply to:",
		{
			timeout: 60_000
		}
	);
	await page.waitForFunction(
		() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			if (!box) return false;
			return box.scrollHeight - box.scrollTop - box.clientHeight <= 64;
		},
		{ timeout: 15_000 }
	);
}

test("submit follows the stream to the bottom", async ({ browser }) => {
	const ctx = await browser.newContext({ ...devices["iPhone 15"] });
	const page = await ctx.newPage();
	try {
		await seedChat(page, []);
		await page.goto("/");
		await page.locator(".ta-input").waitFor({ timeout: 60_000 });
		await sendLong(page);
		await streamDone(page);
	} finally {
		await ctx.close();
	}
});

test("a held finger freezes submit scroll and stream follow", async ({
	browser
}) => {
	const ctx = await browser.newContext({ ...devices["iPhone 15"] });
	const page = await ctx.newPage();
	try {
		await seedChat(page, [
			{ role: "user", content: "first" },
			{ role: "assistant", content: LONG },
			{ role: "user", content: "second" },
			{ role: "assistant", content: LONG }
		]);
		await page.goto("/");
		await page.locator(".ta-input").waitFor({ timeout: 60_000 });
		// Park at the top, then hold a finger down for the whole send.
		await page.evaluate(() => {
			document
				.querySelector(".messages")
				?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
		});
		await page.waitForFunction(() => {
			return (
				(document.querySelector(".messages") as HTMLElement)?.scrollTop === 0
			);
		});
		await page.evaluate(() => {
			document
				.querySelector(".messages")
				?.dispatchEvent(
					new TouchEvent("touchstart", { bubbles: true, cancelable: true })
				);
		});
		await sendLong(page);
		await expect(
			page.locator("article.assistant .rendered").last()
		).toContainText("Mock reply to:", {
			timeout: 60_000
		});
		await page.waitForTimeout(1000);
		const held = await page.evaluate(() => {
			const box = (document.querySelector(".messages") as HTMLElement) ?? null;
			if (!box) throw new Error("no scroll box");
			return {
				top: box.scrollTop,
				gap: box.scrollHeight - box.scrollTop - box.clientHeight
			};
		});
		// Never left the top, far from the new bottom.
		expect(held.top).toBeLessThanOrEqual(4);
		expect(held.gap).toBeGreaterThan(500);
		// Lifting the finger causes no catch-up yank either.
		await page.evaluate(() => {
			document
				.querySelector(".messages")
				?.dispatchEvent(
					new TouchEvent("touchend", { bubbles: true, cancelable: true })
				);
		});
		await page.waitForTimeout(1000);
		const after = await page.evaluate(
			() =>
				(document.querySelector(".messages") as HTMLElement)?.scrollTop ?? -1
		);
		expect(after).toBeLessThanOrEqual(4);
	} finally {
		await ctx.close();
	}
});
