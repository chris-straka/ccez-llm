import { devices, expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

const MESSAGES = [
	{ role: "user", content: "Give me three random paragraphs." },
	{ role: "assistant", content: "Nox alta erat et stellae." }
] as Array<{ role: "user" | "assistant"; content: string }>;

async function seedPlain(page) {
	await seedChat(page, MESSAGES);
	// After seedChat: its init script overwrites this key, so ours
	// must register later to win.
	await page.addInitScript(() => {
		localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ ownBubble: false }));
	});
}

/** A two-line own message docks hard right with a shared left edge:
bubble, article, and longest line all end together. */
test("own two-line message aligns right", async ({ page }) => {
	await seedChat(page, [
		{
			role: "user",
			content:
				"Give me three random paragraphs in Japanese, please, and make them fairly long ones for reading practice tonight."
		}
	]);
	await page.goto("/");
	await expect(page.locator("article.user .rendered").first()).toBeVisible({ timeout: 60_000 });
	const info = await page.evaluate(() => {
		const article = document.querySelector("article.user") as HTMLElement;
		const bubble = article.querySelector(".bubble") as HTMLElement;
		const text = article.querySelector(".rendered p")?.firstChild as Text;
		const rows: Record<string, string> = {};
		for (let i = 0; i < (text.textContent ?? "").length; i++) {
			const range = document.createRange();
			range.setStart(text, i);
			range.setEnd(text, i + 1);
			const r = range.getBoundingClientRect();
			if (r.width === 0) continue;
			const key = Math.round(r.top);
			rows[key] = (rows[key] ?? "") + (text.textContent ?? "")[i];
		}
		return {
			articleRight: Math.round(article.getBoundingClientRect().right),
			bubbleRight: Math.round(bubble.getBoundingClientRect().right),
			rows: Object.values(rows)
		};
	});
	expect(info.rows).toHaveLength(2);
	expect(info.bubbleRight).toBe(info.articleRight);
});

/** Narrow phone: the own message docks hard right with the same inset
as the assistant's left edge — no dead space stranded on the right. */
test("own message docks right with symmetric insets on a phone", async ({ browser }) => {
	const ctx = await browser.newContext({ ...devices["iPhone 15"] });
	const page = await ctx.newPage();
	try {
		await seedChat(page, [
			{ role: "user", content: "Give me three random Chinese paragraphs." },
			{ role: "assistant", content: "OK." }
		]);
		await page.goto("/");
		await expect(page.locator("article.user .rendered").first()).toBeVisible({ timeout: 60_000 });
		const info = await page.evaluate(() => {
			const r = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
			const msgs = r(".messages");
			const user = r("article.user");
			const bubble = r("article.user .bubble");
			const asst = r("article.assistant");
			if (!msgs || !user || !bubble) throw new Error("missing boxes");
			return {
				leftInset: Math.round((asst?.left ?? msgs.left) - msgs.left),
				userRightGap: Math.round(msgs.right - user.right),
				bubbleGap: Math.round(user.right - bubble.right)
			};
		});
		expect(info.bubbleGap).toBe(0);
		expect(Math.abs(info.userRightGap - info.leftInset)).toBeLessThanOrEqual(2);
	} finally {
		await ctx.close();
	}
});

/** A wrapped own message keeps a left gutter on a phone: long text
wraps at 90% instead of going full-bleed, so the message still reads
as right-docked rather than a centered block. */
test("wrapped own message keeps its right dock on a phone", async ({ browser }) => {
	const ctx = await browser.newContext({ ...devices["iPhone 15"] });
	const page = await ctx.newPage();
	try {
		await seedChat(page, [
			{
				role: "user",
				content:
					"First line of a longer English message that must wrap onto several lines no matter what\nSecond line here\nThird short"
			}
		]);
		await page.goto("/");
		await expect(page.locator("article.user .rendered").first()).toBeVisible({ timeout: 60_000 });
		const info = await page.evaluate(() => {
			const r = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
			const user = r("article.user");
			const bubble = r("article.user .bubble");
			const msgs = r(".messages");
			if (!user || !bubble || !msgs) throw new Error("missing boxes");
			return {
				rightGap: Math.round(user.right - bubble.right),
				// Visible gutter is article-vs-column now: at the wider
				// cap the bubble can fill its shrink-wrapped article (the
				// action row no longer stretches it), while the article
				// itself keeps clear of the left edge.
				articleInset: Math.round(user.left - msgs.left)
			};
		});
		expect(info.rightGap).toBe(0);
		expect(info.articleInset).toBeGreaterThan(10);
	} finally {
		await ctx.close();
	}
});

/** Text-to-buttons gap for one article: pill/row top minus text bottom. */
async function textGap(page, articleSel: string): Promise<number | null> {
	return page.evaluate((sel: string) => {
		const article = document.querySelector(sel);
		const text = article?.querySelector(".rendered") as HTMLElement | null;
		const actions = article?.querySelector(".actions") as HTMLElement | null;
		if (!text || !actions) return null;
		return Math.round(actions.getBoundingClientRect().top - text.getBoundingClientRect().bottom);
	}, articleSel);
}

/** Background off: own messages sit as close to their buttons as the
assistant's — no leftover bubble padding in between. */
test("plain own messages match the assistant button gap", async ({ page }) => {
	await seedPlain(page);
	await page.goto("/");
	await expect(page.locator("article.user .rendered").first()).toBeVisible({ timeout: 60_000 });
	const user = await textGap(page, "article.user");
	const assistant = await textGap(page, "article.assistant");
	expect(user, "user gap measured").not.toBeNull();
	expect(assistant, "assistant gap measured").not.toBeNull();
	expect(Math.abs(user! - assistant!)).toBeLessThanOrEqual(2);
});

test("revealed phone pill hugs own text like replies", async ({ browser }) => {
	const ctx = await browser.newContext({ ...devices["iPhone 15"] });
	const page = await ctx.newPage();
	try {
		await seedPlain(page);
		await page.goto("/");
		await expect(page.locator("article.user .rendered").first()).toBeVisible({ timeout: 60_000 });
		for (const sel of ["article.user", "article.assistant"]) {
			await page.locator(sel).click();
			await expect(page.locator(`${sel}[data-actions-open="true"] .actions`)).toBeVisible();
		}
		const user = await textGap(page, "article.user");
		const assistant = await textGap(page, "article.assistant");
		expect(user, "user gap measured").not.toBeNull();
		expect(assistant, "assistant gap measured").not.toBeNull();
		expect(Math.abs(user! - assistant!)).toBeLessThanOrEqual(2);
	} finally {
		await ctx.close();
	}
});
