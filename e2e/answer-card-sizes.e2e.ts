import { expect, test } from "./fixtures";
import { seedChat } from "./helpers";

/** Every kind of answer card at small, big, and giant text: the card's
type never outgrows the message it explains, its buttons stay
buttons, and pills stay pills. Each card is photographed in
.screenshots/answer-cards/. */
const SENTENCE =
	"Laissez-moi vous faire écouter cet extrait, car nous savons tous que la maison est loin du domicile de Washington.";

const cards: Record<string, { sentence?: string; [key: string]: unknown }> = {
	gloss: { quote: "extrait", answer: "excerpt, clip" },
	note: {
		quote: "extrait",
		answer: "excerpt, clip\nfrom extraire, to pull out; a noun here."
	},
	prose: {
		quote: "car nous savons tous",
		answer:
			"because we all know — car joins a reason to what came before, a little more formal than parce que, and never starts the sentence."
	},
	word: {
		quote: "extrait",
		answer: "excerpt, clip",
		card: {
			meaning: "excerpt, clip",
			lang: "fr",
			parts: [
				{ text: "extr", label: "pull out", kind: "core" },
				{ text: "ait", label: "past participle", kind: "derive" }
			],
			facts: [
				{ text: "noun", kind: "role" },
				{ text: "masculine singular, shown by 'cet'", kind: "agree" }
			],
			base: "extraire: to extract",
			here: "the clip the speaker is about to play",
			watch: "Not the verb form: il extrait means he extracts."
		}
	},
	japanese: {
		sentence: "その本はよく読まれていた。",
		quote: "読まれていた",
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
	thread: {
		quote: "extrait",
		answer: "excerpt, clip",
		thread: [
			{
				q: "Could it also mean extract, like vanilla?",
				a: "Yes: extrait de vanille."
			}
		]
	}
};

for (const [kind, ann] of Object.entries(cards)) {
	for (const scale of [1, 2, 3.7]) {
		test(`${kind} card at ${scale}x`, async ({ page }) => {
			const { sentence = SENTENCE, ...stored } = ann;
			await page.setViewportSize({ width: 1000, height: 630 });
			await seedChat(page, [{ role: "assistant", content: sentence }], null, {
				fontScale: scale,
				theme: "dark"
			});
			await page.addInitScript((a: Record<string, unknown>) => {
				localStorage.setItem(
					"ccez-llm-annotations-v1",
					JSON.stringify({
						"e2e-chat": [
							{ id: "ann-1", messageId: "e2e-m0", comment: "", ...a }
						]
					})
				);
			}, stored);
			await page.goto("/");
			const badge = page.locator("button.ccez-ann-badge.ans-ready");
			await expect(badge).toBeVisible({ timeout: 60_000 });
			await badge.focus();
			await page.keyboard.press("Enter");
			const card = page.locator(".ann-answer.placed");
			await expect(card).toBeVisible();
			const sizes = await page.evaluate(() => {
				const px = (el: Element | null) =>
					el ? parseFloat(getComputedStyle(el).fontSize) : 0;
				const card = document.querySelector(".ann-answer")!;
				const biggest = Math.max(
					...[...card.querySelectorAll(".ann-answer-body *")].map(px)
				);
				const button = card.querySelector(".ann-answer-actions button");
				const pills = [...card.querySelectorAll(".wc-fact")].map((p) => {
					const r = p.getBoundingClientRect();
					return r.height / px(p);
				});
				const body = card.querySelector(".ann-answer-body")!;
				return {
					text: px(document.querySelector(".rendered")),
					base: px(card),
					biggest,
					clipped: body.scrollHeight > body.clientHeight + 1,
					button: px(button),
					pillLines: Math.max(0, ...pills)
				};
			});
			// The card's type never outgrows the message's, and only the
			// word's own pieces stand a little above it.
			expect.soft(sizes.base).toBeLessThanOrEqual(sizes.text + 0.5);
			expect.soft(sizes.biggest).toBeLessThanOrEqual(sizes.base * 1.2 + 0.5);
			// Short cards show whole through 2x in a short window; past
			// that neither side holds them and the body scrolls.
			if (kind !== "word" && scale <= 2) expect.soft(sizes.clipped).toBe(false);
			// Save and Reply are controls: they grow at half the text's pace.
			expect
				.soft(sizes.button)
				.toBeLessThanOrEqual(Math.max(16, sizes.text * 0.5) + 0.5);
			// A fact pill that wraps loses its stadium ends (one line is ~1.5em).
			expect.soft(sizes.pillLines).toBeLessThan(4);
			await page.screenshot({
				path: `.screenshots/answer-cards/${kind}-${scale}x.png`,
				animations: "disabled"
			});
		});
	}
}
