import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

/**
 * Repeat ink: an annotated quote takes a solid underline in its ink
 * and the same text further down the chat a dotted one (Custom
 * Highlights, no DOM moves); text above the annotation stays plain.
 */

const MESSAGES = [
	{ role: "assistant" as const, content: "Ein Haus am See ist teuer." },
	{
		role: "assistant" as const,
		content:
			"Das Haus ist alt, aber das Haus ist schön.\n\n露軍の攻撃が続く。露の首都は遠い。"
	},
	{ role: "user" as const, content: "Wie alt ist das Haus am See?" },
	{
		role: "assistant" as const,
		content: "Das Haus ist hundert Jahre alt. Haushalt ist ein anderes Wort."
	}
];

async function seedNotes(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					// The second Haus in its message: the first stays plain.
					{
						id: "ann-haus",
						messageId: "e2e-m1",
						quote: "Haus",
						comment: "",
						at: 1,
						answer: "house"
					},
					{
						id: "ann-ro",
						messageId: "e2e-m1",
						quote: "露",
						comment: "",
						answer: "Russia"
					},
					{
						id: "ann-see",
						messageId: "e2e-m2",
						quote: "See",
						comment: "",
						answer: "lake"
					}
				]
			})
		);
	});
}

/** Inked text per highlight name (`ccez-rep-N` solid, `-again`
dotted), with the message each range sits in; empty names left out. */
async function inked(page: Page): Promise<Record<string, string[]>> {
	return page.evaluate(() => {
		const out: Record<string, string[]> = {};
		const rows = [...document.querySelectorAll("article")];
		const reg = (
			CSS as unknown as {
				highlights: Map<string, Iterable<Range>>;
			}
		).highlights;
		for (const [name, hl] of reg) {
			if (!name.startsWith("ccez-rep-")) continue;
			const texts = [...hl].map((r) => {
				const row = r.startContainer.parentElement?.closest("article");
				return `e2e-m${row ? rows.indexOf(row) : "?"}:${r.toString()}`;
			});
			if (texts.length > 0) out[name] = texts;
		}
		return out;
	});
}

test("annotated quotes underline their repeats below, never above", async ({
	page
}) => {
	await seedChat(page, MESSAGES);
	await seedNotes(page);
	await page.goto("/");
	await expect(page.locator('[data-ann-badge="ann-see"]')).toBeAttached({
		timeout: 30_000
	});
	await expect
		.poll(() => inked(page))
		.toEqual({
			// Haus: the annotated (second) one solid, then later
			// messages dotted; Haushalt is another word.
			"ccez-rep-0": ["e2e-m1:Haus"],
			"ccez-rep-0-again": ["e2e-m2:Haus", "e2e-m3:Haus"],
			// 露 inks inside 露軍 too: spaceless scripts have no words.
			"ccez-rep-1": ["e2e-m1:露"],
			"ccez-rep-1-again": ["e2e-m1:露"],
			// See: the user's question onward, never the first message.
			"ccez-rep-2": ["e2e-m2:See"]
		});
	const shot = (name: string): Promise<Buffer> =>
		page.locator("main").screenshot({ path: `.screenshots/${name}.png` });
	await shot("repeat-ink-light");
	await page.evaluate(() => {
		document.documentElement.dataset.theme = "dark";
	});
	await shot("repeat-ink-dark");
});

test("filing an annotation inks its repeats at once", async ({ page }) => {
	await seedChat(page, MESSAGES);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 30_000
	});
	await dragQuote(page, 2, "See");
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	await expect
		.poll(async () => (await inked(page))["ccez-rep-0"])
		.toEqual(["e2e-m2:See"]);
});

test("a reading tint keeps its underline while its panel is up", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "攻撃は終わる。攻撃開始する。" }
	]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{ id: "ann-k", messageId: "e2e-m0", quote: "攻撃", comment: "" }
				]
			})
		);
	});
	await page.goto("/");
	await expect(page.locator('[data-ann-badge="ann-k"]')).toBeAttached({
		timeout: 30_000
	});
	const both = {
		"ccez-rep-0": ["e2e-m0:攻撃"],
		"ccez-rep-0-again": ["e2e-m0:攻撃"]
	};
	await expect.poll(() => inked(page)).toEqual(both);
	// Highlight the repeat 攻撃開始する: two back-to-back words share
	// one furigana panel (the kana makes it Japanese), so their kanji
	// take tints.
	const at = await page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const walker = document.createTreeWalker(
			p ?? document.body,
			NodeFilter.SHOW_TEXT
		);
		const nodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode;
			// The badge anchor splits the text; its digit is chrome.
			if (
				node instanceof Text &&
				!node.parentElement?.closest("[data-ann-badge]")
			)
				nodes.push(node);
		}
		const tail = nodes.find((n) => n.data.includes("攻撃開始する"));
		if (!tail) return null;
		const at = tail.data.indexOf("攻撃開始する");
		window.getSelection()?.setBaseAndExtent(tail, at, tail, at + 6);
		const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
		return rect
			? { x: rect.left + rect.width * 0.15, y: rect.top + rect.height / 2 }
			: null;
	});
	if (!at) throw new Error("no highlight");
	await page.mouse.click(at.x, at.y, { button: "right" });
	const body = page.locator("article.assistant .rendered");
	await expect(body.locator(".frbt0")).not.toHaveCount(0, { timeout: 120_000 });
	// Underlines leave the text colour alone, so the tinted 攻撃
	// keeps its dotted line (re-inked over the tint's new nodes).
	await expect
		.poll(async () =>
			(await inked(page))["ccez-rep-0-again"]?.join("").replace("e2e-m0:", "")
		)
		.toMatch(/^(e2e-m0:)?攻(e2e-m0:)?撃$/);
	await page
		.locator("main")
		.screenshot({ path: ".screenshots/repeat-ink-tint.png" });
	await page.keyboard.press("Escape");
	await expect(body.locator('[class*="frbt"]')).toHaveCount(0);
	await expect.poll(() => inked(page)).toEqual(both);
});

test("a DOM-mark wash leaves the ink where it was", async ({ page }) => {
	// RTL quotes wash through DOM marks: the fade-out swaps the
	// quote's text nodes after the stamp, and the ink follows them.
	await seedChat(page, [
		{ role: "assistant", content: "البيت كبير. أحب البيت القديم." }
	]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{ id: "ann-b", messageId: "e2e-m0", quote: "البيت", comment: "" }
				]
			})
		);
	});
	await page.goto("/");
	const badge = page.locator('[data-ann-badge="ann-b"]');
	await expect(badge).toBeAttached({ timeout: 30_000 });
	const both = {
		"ccez-rep-0": ["e2e-m0:البيت"],
		"ccez-rep-0-again": ["e2e-m0:البيت"]
	};
	await expect.poll(() => inked(page)).toEqual(both);
	await badge.dispatchEvent("mouseover");
	await expect(page.locator("mark.ccez-ann")).not.toHaveCount(0);
	await badge.dispatchEvent("mouseout");
	await expect(page.locator("mark.ccez-ann")).toHaveCount(0);
	// Past the 180ms fade: the leaving marks unwrapped.
	await page.waitForTimeout(300);
	expect(await inked(page)).toEqual(both);
});
