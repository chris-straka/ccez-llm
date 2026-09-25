import { devices, expect, test } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

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

/** Neither the submit, the stream, nor the completion yanks a
mid-thread reader: stuck-to-bottom follows, anything else stays. */
test("send and completion never yank a mid-thread reader", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "user", content: "first" },
		{ role: "assistant", content: LONG },
		{ role: "user", content: "second" },
		{ role: "assistant", content: LONG }
	]);
	await page.goto("/");
	await page.locator(".ta-input").waitFor({ timeout: 60_000 });
	// Park at the top: stuck is false, so nothing below may scroll.
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
	await sendLong(page);
	// The submit itself must not move: read before the reply lands.
	await page.waitForTimeout(400);
	const atSend = await page.evaluate(
		() => (document.querySelector(".messages") as HTMLElement)?.scrollTop ?? -1
	);
	expect(atSend).toBeLessThanOrEqual(100);
	// The stream and its completion must not move either.
	await expect(
		page.locator("article.assistant .rendered").last()
	).toContainText("Mock reply to:", {
		timeout: 60_000
	});
	await page.waitForTimeout(1000);
	const rest = await page.evaluate(() => {
		const box = (document.querySelector(".messages") as HTMLElement) ?? null;
		if (!box) throw new Error("no scroll box");
		return {
			top: box.scrollTop,
			gap: box.scrollHeight - box.scrollTop - box.clientHeight
		};
	});
	expect(rest.top).toBeLessThanOrEqual(100);
	expect(rest.gap).toBeGreaterThan(500);
});

/** Selecting mid-stream unpins the follow: the stick flag reads
true while the reply streams into a stuck view, and summoning
the selection menu flips it false so the follow stops yanking
under the highlight. Scrolling back to the bottom re-pins.
Pinned on the flag (see the data-stick mirror): scroll geometry
can't catch a one-line wrap through the one-token effect lag and
the completion slop. */
test("selecting text mid-stream unpins the follow", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "first" },
		{ role: "assistant", content: LONG },
		{ role: "user", content: "second" },
		{ role: "assistant", content: LONG }
	]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-word-ms", "800");
	});
	await page.goto("/");
	await page.locator(".ta-input").waitFor({ timeout: 60_000 });
	const box = page.locator(".messages");
	// Read to the end first: only a stuck submit pins the follow
	// (an unstuck submit never scrolls, so there would be nothing
	// to unpin and the test would pass on any tree).
	await page.evaluate(() => {
		const el = document.querySelector(".messages") as HTMLElement;
		el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
	});
	await expect(box).toHaveAttribute("data-stick", "true");
	await sendLong(page);
	// Still pinned while the reply streams...
	const last = page.locator("article.assistant .rendered").last();
	await expect(last).toContainText("Mock reply", { timeout: 60_000 });
	await expect(box).toHaveAttribute("data-stick", "true");
	// ...until a selection unpins it. The just-sent user turn is
	// visible at the bottom, mid-viewport, so the drag scrolls
	// nothing (a scroll would re-pin geometrically either way).
	await dragQuote(page, 4, "lorem");
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	await expect(box).toHaveAttribute("data-stick", "false");
});
