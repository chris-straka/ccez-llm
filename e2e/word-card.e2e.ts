import { expect, test } from "./fixtures";
import { dragQuote, seedChat } from "./helpers";

/** A bare one-word note asks for a word card: the literal meaning
leads in bold, the word splits into labeled pieces, and the card
survives a reload. */
test("a one-word note files and renders a word card", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" }
	]);
	await page.addInitScript(() => {
		localStorage.setItem(
			"ccez-mock-reply",
			JSON.stringify({
				meaning: "the bank of a river",
				parts: [
					{ text: "river", label: "river", kind: "core" },
					{ text: "bank", label: "edge of land", kind: "core" }
				],
				facts: [{ text: "noun", kind: "agree" }],
				construction: {
					name: "compound",
					words: "the riverbank",
					gloss: "the river-bank"
				},
				phrase: {
					words: "the riverbank at dawn",
					meaning: "the shore at sunrise"
				},
				watch: "Not the bank that keeps money."
			})
		);
	});
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({
		timeout: 60_000
	});
	await dragQuote(page, 0, "riverbank");
	await page.keyboard.press("a");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(ready).toBeVisible({ timeout: 10_000 });
	const open = async (): Promise<void> => {
		await ready.focus();
		await page.keyboard.press("Enter");
		await expect(page.locator(".ann-answer.placed")).toBeVisible();
	};
	await open();
	const card = page.locator(".ann-answer");
	await expect(card.locator(".ann-answer-head")).toHaveText(
		"the bank of a river"
	);
	await expect(card.locator(".wc-piece")).toHaveText(["river", "bank"]);
	// "river" labeled river only repeats its piece: no label.
	await expect(card.locator(".wc-label")).toHaveText(["edge of land"]);
	await expect(card.locator(".wc-fact")).toHaveText(["noun"]);
	await expect(card).toContainText("Watch: Not the bank that keeps money.");
	// The form it belongs to sits by the split; the phrase closes the card.
	await expect(card.locator(".wc-form > span")).toHaveText([
		"compound",
		"the riverbank",
		"the river-bank"
	]);
	await expect(card.locator(".wc-phrase")).toHaveText(
		/the riverbank at dawn\s*→\s*means\s*the shore at sunrise/
	);
	await page.keyboard.press("Escape");
	await page.reload();
	await expect(ready).toBeVisible({ timeout: 60_000 });
	await open();
	await expect(page.locator(".ann-answer .wc-piece")).toHaveText([
		"river",
		"bank"
	]);
});

/** A gender fact that names this word's base (le lycéen for
lycéens) draws as a letter under the stem, not a pill. */
test("a plural noun shows its gender under the stem", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "Ce qui va changer pour les lycéens." }
	]);
	await page.addInitScript(() => {
		localStorage.setItem(
			"ccez-mock-reply",
			JSON.stringify({
				meaning: "students at a lycée",
				parts: [
					{ text: "lycéen", label: "lycéen", kind: "core" },
					{ text: "s", label: "plural", kind: "agree" }
				],
				facts: [{ text: "le lycéen", kind: "agree" }]
			})
		);
	});
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({
		timeout: 60_000
	});
	await dragQuote(page, 0, "lycéens");
	await page.keyboard.press("a");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(ready).toBeVisible({ timeout: 10_000 });
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer.placed");
	await expect(card).toBeVisible();
	await expect(card.locator(".k-core .wc-gender")).toHaveText("m.");
	await expect(card.locator(".wc-fact")).toHaveCount(0);
	await expect(card.locator(".wc-ghost")).toHaveCount(0);
});

/** Readings sit above the pieces where the script hides the sound,
and right-to-left languages split right to left. */
test("word cards carry readings and run right to left", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "その本はよく読まれていた。" },
		{ role: "assistant", content: "ذهبت إلى المكتبة." }
	]);
	await page.addInitScript(() => {
		localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "ann-ja",
						messageId: "e2e-m0",
						quote: "読まれていた",
						comment: "",
						answer: "was read",
						card: {
							meaning: "was read",
							lang: "ja",
							parts: [
								{ text: "読ま", reading: "よま", label: "読む", kind: "core" },
								{ text: "れ", label: "passive", kind: "voice" },
								{ text: "てい", label: "ongoing", kind: "tense" },
								{ text: "た", label: "past", kind: "tense" }
							],
							facts: []
						}
					},
					{
						id: "ann-ar",
						messageId: "e2e-m1",
						quote: "المكتبة",
						comment: "",
						answer: "the library",
						card: {
							meaning: "the library",
							lang: "ar",
							parts: [
								{ text: "ال", reading: "al", label: "the", kind: "agree" },
								{
									text: "مكتب",
									reading: "maktab",
									label: "k-t-b",
									kind: "core"
								},
								{ text: "ة", reading: "a", label: "feminine", kind: "agree" }
							],
							facts: []
						}
					}
				]
			})
		);
	});
	await page.goto("/");
	const badges = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(badges).toHaveCount(2, { timeout: 60_000 });
	await badges.nth(0).focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer.placed");
	await expect(card).toBeVisible();
	await expect(card.locator(".wc-read")).toHaveText(["よま", "", "", ""]);
	await expect(card.locator(".wc-word")).toHaveAttribute("dir", "ltr");
	await page.keyboard.press("Escape");
	await expect(page.locator(".ann-answer")).toHaveCount(0);
	await badges.nth(1).focus();
	await page.keyboard.press("Enter");
	await expect(card).toBeVisible();
	await expect(card.locator(".wc-word")).toHaveAttribute("dir", "rtl");
	// Right to left: the article sits rightmost.
	const xs = await card
		.locator(".wc-piece")
		.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
	expect(xs[0]).toBeGreaterThan(xs[2]!);
});

/** A compound's pieces carry their own meanings, and a word in Han
characters lists each character's parts with the radical marked. */
test("word cards show piece meanings and character parts", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "die Nachrichtenagentur Reuters" },
		{ role: "assistant", content: "詳しく説明します。" }
	]);
	await page.addInitScript(() => {
		localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "ann-de",
						messageId: "e2e-m0",
						quote: "Nachrichtenagentur",
						comment: "",
						answer: "news agency",
						card: {
							meaning: "news agency",
							lang: "de",
							parts: [
								{
									text: "Nachrichten",
									label: "Nachricht",
									meaning: "news",
									kind: "core"
								},
								{
									text: "agentur",
									label: "Agentur",
									meaning: "agency",
									kind: "core"
								}
							],
							facts: [{ text: "die Nachrichtenagentur", kind: "agree" }]
						}
					},
					{
						id: "ann-ja",
						messageId: "e2e-m1",
						quote: "説明",
						comment: "",
						answer: "explanation",
						card: {
							meaning: "explanation",
							lang: "ja",
							parts: [
								{ text: "説明", reading: "せつめい", label: "", kind: "core" }
							],
							facts: []
						}
					}
				]
			})
		);
	});
	await page.goto("/");
	const badges = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(badges).toHaveCount(2, { timeout: 60_000 });
	const card = page.locator(".ann-answer.placed");
	await badges.nth(0).focus();
	await page.keyboard.press("Enter");
	await expect(card).toBeVisible();
	await expect(card.locator(".wc-meaning")).toHaveText(["news", "agency"]);
	await expect(card.locator(".wc-han")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(card).toHaveCount(0);
	await badges.nth(1).focus();
	await page.keyboard.press("Enter");
	await expect(card).toBeVisible();
	await expect(card.locator(".wc-han-char")).toHaveText(["説", "明"]);
	await expect(card.locator(".wc-han-part.radical .wc-han-glyph")).toHaveText([
		"言",
		"日"
	]);
});

/** Long labels wrap under their own piece instead of widening it,
so a three-piece word stays on one row at phone width. */
test("a word's pieces stay on one row at phone width", async ({ page }) => {
	await page.setViewportSize({ width: 412, height: 915 });
	await seedChat(page, [
		{
			role: "assistant",
			content: "autour des interventions très médiatisées de deux anciens présidents"
		}
	]);
	await page.addInitScript(() => {
		localStorage.setItem(
			"ccez-mock-reply",
			JSON.stringify({
				meaning: "publicized",
				parts: [
					{ text: "médiatis", label: "médiatiser", kind: "core" },
					{ text: "é", label: "past participle", kind: "tense" },
					{ text: "es", label: "feminine plural", kind: "agree" }
				]
			})
		);
	});
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({
		timeout: 60_000
	});
	await dragQuote(page, 0, "médiatisées");
	await page.keyboard.press("a");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(ready).toBeVisible({ timeout: 10_000 });
	await ready.focus();
	await page.keyboard.press("Enter");
	const pieces = page.locator(".ann-answer.placed .wc-piece");
	await expect(pieces).toHaveText(["médiatis", "é", "es"]);
	const tops = await pieces.evaluateAll((els) =>
		els.map((e) => Math.round(e.getBoundingClientRect().top))
	);
	expect(new Set(tops).size).toBe(1);
});
