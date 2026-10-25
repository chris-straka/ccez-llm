import { expect, test, type Page } from "./fixtures";
import { dragQuote, seedChat } from "./helpers";

/**
 * Pressing a badge opens its answer and marks nothing else: no stray
 * selection, no new note, no ink on another line. At big text the
 * badge rides up over the line above, where a press once also caught
 * that line.
 */
const TEXT =
	"Mais si l'allégation est que son père, qui est décédé, s'est livré à une activité qu'ils estiment illégale en ce qui concerne le remplissage de documents relatifs à sa citoyenneté.";

for (const scale of [1, 3.7]) {
	test(`a badge press at ${scale}x opens its card and nothing else`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 1000, height: 630 });
		await page.addInitScript(() => {
			localStorage.setItem(
				"ccez-llm-annotations-v1",
				JSON.stringify({
					"e2e-chat": [
						{
							id: "a1",
							messageId: "e2e-m0",
							quote: "décédé",
							comment: "",
							answer: "passed away",
							card: {
								meaning: "passed away",
								lang: "fr",
								parts: [
									{ text: "décéd", label: "die", kind: "core" },
									{ text: "é", label: "past participle", kind: "tense" }
								],
								facts: []
							}
						},
						{
							id: "a2",
							messageId: "e2e-m0",
							quote: "estiment",
							comment: "",
							answer: "they consider"
						}
					]
				})
			);
		});
		await seedChat(page, [{ role: "assistant", content: TEXT }], null, {
			fontScale: scale,
			theme: "dark"
		});
		await page.goto("/");
		const badge = page.locator('button.ccez-ann-badge[data-ann-badge="a1"]');
		await expect(badge).toBeVisible({ timeout: 60_000 });
		await badge.scrollIntoViewIfNeeded();
		const box = (await badge.boundingBox())!;
		// The pointer comes in from the text and presses the badge's
		// lower half, as a hand does.
		await page.mouse.move(box.x - 40, box.y + box.height + 10);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7, {
			steps: 5
		});
		await page.mouse.down();
		await page.mouse.up();
		await expect(page.locator(".ann-answer.placed")).toBeVisible();
		await page.waitForTimeout(400);
		const state = await page.evaluate(() => {
			const inks: Record<string, string[]> = {};
			for (const [name, hl] of CSS.highlights)
				inks[name] = [...hl].map((r) => (r as Range).toString());
			return {
				selection: window.getSelection()?.toString() ?? "",
				notes: (
					JSON.parse(
						localStorage.getItem("ccez-llm-annotations-v1") ?? "{}"
					) as Record<string, { quote: string }[]>
				)["e2e-chat"]?.map((a) => a.quote),
				inks
			};
		});
		expect(state.selection).toBe("");
		expect(state.notes).toEqual(["décédé", "estiment"]);
		// Both notes wear their badge.
		await expect(page.locator("button.ccez-ann-badge")).toHaveCount(2);
		const marked = Object.entries(state.inks)
			.filter(([name]) => name.startsWith("ccez-"))
			.flatMap(([, texts]) => texts);
		expect(new Set(marked)).toEqual(new Set(["décédé", "estiment"]));
		await page.screenshot({ path: `.screenshots/badge-open-${scale}x.png` });
	});
}

/** A drill chat whose one revealed clip is TEXT, with `notes` on it. */
async function seedDrill(
	page: Page,
	notes: { id: string; quote: string; answer: string }[]
): Promise<void> {
	await page.setViewportSize({ width: 1000, height: 630 });
	await page.addInitScript(
		(seed: { text: string; notes: typeof notes }) => {
			const clips = Array.from({ length: 7 }, (_, i) => ({
				i,
				start: i * 5,
				end: i * 5 + 4,
				text: i === 6 ? seed.text : `Phrase numéro ${i}.`
			}));
			localStorage.setItem("ccez-mock-provider", "1");
			localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify({ fontScale: 3.7, theme: "dark" })
			);
			localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{
						id: "e2e-chat",
						createdAt: 1,
						replyLang: "fr",
						listen: {
							videoId: "abcdefghijk",
							lang: "fr",
							title: "A video",
							channel: "Channel",
							channelUrl: "https://www.youtube.com/@channel",
							thumbnail: "",
							audio: "dub",
							clips,
							aligned: true
						},
						messages: [
							{
								id: "e2e-m0",
								role: "assistant",
								content: seed.text,
								usage: null,
								error: null,
								clip: { i: 6, peeked: true }
							}
						]
					}
				])
			);
			localStorage.setItem(
				"ccez-llm-annotations-v1",
				JSON.stringify({
					"e2e-chat": seed.notes.map((n) => ({
						...n,
						messageId: "e2e-m0",
						comment: "",
						at: 0
					}))
				})
			);
		},
		{ text: TEXT, notes }
	);
	await page.goto("/");
	await expect(page.locator("button.ccez-ann-badge").first()).toBeVisible({
		timeout: 60_000
	});
}

/** The texts the underline inks cover, sorted. */
const inked = (page: Page) =>
	page.evaluate(() =>
		[...CSS.highlights]
			.filter(([name]) => name.startsWith("ccez-rep"))
			.flatMap(([, hl]) => [...hl].map((r) => (r as Range).toString()))
			.sort()
	);

/** The same pair of notes on a drill clip (a revealed clip of a video
the learner watches): each keeps its own badge and underline, before
and while a card is open. */
test("notes on a drill clip keep their own badges and underlines", async ({
	page
}) => {
	await seedDrill(page, [
		{ id: "a1", quote: "décédé", answer: "passed away" },
		{ id: "a2", quote: "estiment", answer: "they consider" }
	]);
	const badges = page.locator("button.ccez-ann-badge");
	await expect(badges).toHaveCount(2);
	expect(await inked(page)).toEqual(["décédé", "estiment"]);
	await page.locator('button.ccez-ann-badge[data-ann-badge="a1"]').click();
	await expect(page.locator(".ann-answer.placed")).toBeVisible();
	await page.waitForTimeout(400);
	expect(await inked(page)).toEqual(["décédé", "estiment"]);
	await page.screenshot({ path: ".screenshots/badge-open-drill.png" });
});

/** A second note still being answered: opening the first one's card
inks the new quote, never the clip's first line. */
test("a note in flight inks its own word while another card opens", async ({
	page
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("ccez-mock-chat-ms", "6000")
	);
	await seedDrill(page, [{ id: "a1", quote: "décédé", answer: "passed away" }]);
	// A short word: Linux fonts hyphenate longer ones across lines,
	// where a drag through the middle of the box misses the word.
	await dragQuote(page, 0, "son");
	await page.keyboard.press("a");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(2);
	await page.mouse.move(2, 2);
	await page.waitForTimeout(300);
	const before = await inked(page);
	await page.screenshot({ path: ".screenshots/badge-inflight-closed.png" });
	await page.locator('button.ccez-ann-badge[data-ann-badge="a1"]').click();
	await expect(page.locator(".ann-answer.placed")).toBeVisible();
	await page.waitForTimeout(400);
	await page.screenshot({ path: ".screenshots/badge-inflight-open.png" });
	expect(before).toEqual(["décédé", "son"]);
	expect(await inked(page)).toEqual(["décédé", "son"]);
});

/** Pressing the badge of a note still being answered marks nothing
new: no underline on the line it overlaps. */
test("pressing a loading badge inks nothing above it", async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem("ccez-mock-chat-ms", "8000")
	);
	await seedDrill(page, [{ id: "a1", quote: "décédé", answer: "passed away" }]);
	await dragQuote(page, 0, "son");
	await page.keyboard.press("a");
	const waiting = page.locator("button.ccez-ann-badge.ans-waiting");
	await expect(waiting).toHaveCount(1);
	await page.mouse.move(2, 2);
	await page.waitForTimeout(300);
	const box = (await waiting.boundingBox())!;
	// The badge rides up over the line above: press its upper half.
	await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3, {
		steps: 4
	});
	await page.mouse.down();
	await page.mouse.up();
	await page.waitForTimeout(500);
	await page.screenshot({ path: ".screenshots/badge-loading-press.png" });
	expect(await inked(page)).toEqual(["décédé", "son"]);
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
});

/** Sending the next message closes an open card: it belongs to the
passage, and the thread moves on to the new turn. */
test("sending a message closes an open word card", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "a1",
						messageId: "e2e-m0",
						quote: "décédé",
						comment: "",
						answer: "passed away",
						card: {
							meaning: "passed away",
							lang: "fr",
							parts: [
								{ text: "décéd", label: "die", kind: "core" },
								{ text: "é", label: "past participle", kind: "tense" }
							],
							facts: []
						}
					}
				]
			})
		);
	});
	await seedChat(page, [{ role: "assistant", content: TEXT }]);
	await page.goto("/");
	const badge = page.locator('button.ccez-ann-badge[data-ann-badge="a1"]');
	await expect(badge).toBeVisible({ timeout: 60_000 });
	// Its lower half: the top edge can sit under the window's drag strip.
	const box = (await badge.boundingBox())!;
	await badge.click({ position: { x: box.width / 2, y: box.height * 0.8 } });
	await expect(page.locator(".ann-answer")).toBeVisible();
	await page.keyboard.press("i");
	await page.keyboard.type("Merci !");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.user")).toContainText("Merci !");
	await expect(page.locator(".ann-answer")).toHaveCount(0);
});
