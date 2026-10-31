import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Right-click in an answer card reads the word under the cursor, in
 * the word's own voice: the card's pieces and any word the annotated
 * message holds read in the message's language, the explanation
 * around them in its own.
 */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const w = window as unknown as { __spoken: [string, string][] };
		w.__spoken = [];
		// Headless Linux browsers report no voices: one per language.
		const voices = [
			{ name: "Samantha", lang: "en-US" },
			{ name: "Thomas", lang: "fr-FR" }
		].map((v) => ({
			...v,
			voiceURI: v.name,
			localService: true,
			default: v.lang === "en-US"
		}));
		Object.defineProperty(window.speechSynthesis, "getVoices", {
			value: () => voices,
			configurable: true
		});
		window.speechSynthesis.speak = ((u: SpeechSynthesisUtterance) => {
			w.__spoken.push([u.text, u.lang]);
			setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 50);
		}) as typeof window.speechSynthesis.speak;
		localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "a1",
						messageId: "e2e-m0",
						quote: "tâche",
						comment: "",
						answer: "task, job",
						card: {
							meaning: "task, job",
							lang: "fr",
							parts: [{ text: "tâche", label: "task", kind: "core" }],
							facts: [],
							watch: "Do not confuse tâche with tache, which means stain."
						}
					}
				]
			})
		);
	});
	await seedChat(page, [
		{
			role: "assistant",
			content:
				"La tâche était difficile, il n'en demeure pas moins qu'elle l'a finie."
		}
	]);
	await page.goto("/");
	const badge = page.locator('button.ccez-ann-badge[data-ann-badge="a1"]');
	await expect(badge).toBeVisible({ timeout: 60_000 });
	await badge.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator(".ann-answer")).toBeVisible({ timeout: 10_000 });
	// Opening a badge reads its quote: let that land, then start
	// the log clean so only the right-click's speech counts.
	await expect.poll(() => lastSpoken(page)).toEqual(["tâche", "fr-FR"]);
	await page.evaluate(() => {
		(window as unknown as { __spoken: [string, string][] }).__spoken = [];
	});
});

/** Right-clicks the middle of `word`'s first occurrence inside `scope`. */
async function rightClickWord(
	page: Page,
	scope: string,
	word: string
): Promise<void> {
	const point = await page.evaluate(
		({ scope, word }) => {
			const root = document.querySelector(scope);
			if (!root) throw new Error(`no ${scope}`);
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				const at = (n.textContent ?? "").search(
					new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, "u")
				);
				if (at < 0) continue;
				const start = (n.textContent ?? "").indexOf(word, at);
				const range = document.createRange();
				range.setStart(n, start);
				range.setEnd(n, start + word.length);
				const r = range.getBoundingClientRect();
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
			}
			throw new Error(`no ${word} in ${scope}`);
		},
		{ scope, word }
	);
	await page.mouse.click(point.x, point.y, { button: "right" });
}

async function lastSpoken(page: Page): Promise<[string, string] | undefined> {
	return page.evaluate(() =>
		(window as unknown as { __spoken: [string, string][] }).__spoken.at(-1)
	);
}

test("a message word inside the English note reads in French", async ({
	page
}) => {
	await rightClickWord(page, ".ann-answer-body .wc-line", "tâche");
	await expect.poll(() => lastSpoken(page)).toEqual(["tâche", "fr-FR"]);
	// The card stays open: the press read, it didn't click off.
	await expect(page.locator(".ann-answer")).toBeVisible();
});

test("the note's own words read in its language", async ({ page }) => {
	await rightClickWord(page, ".ann-answer-body .wc-line", "stain");
	await expect.poll(() => lastSpoken(page)).toEqual(["stain", "en-US"]);
});

test("a card piece reads in the card's language", async ({ page }) => {
	await rightClickWord(page, ".ann-answer-body .wc-piece", "tâche");
	await expect.poll(() => lastSpoken(page)).toEqual(["tâche", "fr-FR"]);
});
