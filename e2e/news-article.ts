import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * A French news session as the owner reads it (dark theme, RTL
 * story): the opener's headline carries two notes, the summary below
 * two more, so inks cycle violet, cyan, lime, violet.
 */

export const HEADLINE =
	'"Je n’ai jamais rien vu de pareil" : les débuts laborieux de Katie Zacharia, nouvelle voix du trumpisme à la Maison Blanche';

const OPENER =
	`📰 "${HEADLINE}" (RTL)\n` +
	"Summarize the pasted article in French at CEFR B2 (Upper intermediate), " +
	"about 200 words. [Pasted 11088 chars] ";

export const BODY = [
	"La nouvelle porte-parole de Donald Trump à la Maison-Blanche, Katie Zacharia, a connu des débuts difficiles, selon un article de RTL publié le 14 octobre 2026.",
	"Âgée de 42 ans, mère de quatre enfants et ancienne commentatrice de Fox News et Newsmax, proche du mouvement MAGA, elle a succédé le 9 octobre à Karoline Leavitt. Elle a donné sa première conférence de presse le 13 octobre devant la presse et le monde entier.",
	"D'un ton lent et hésitant, elle a présenté le bilan et les succès du président, puis n'a répondu qu'à trois questions, posées uniquement par des médias conservateurs.",
	"La scène a provoqué de vives réactions. Sur CNN, l'ancienne porte-parole de Joe Biden, Karine Jean-Pierre, s'est dite surprise : « Je n'ai jamais rien vu de pareil ». Elle a rappelé que ce poste demande des heures de préparation chaque jour."
].join("\n\n");

export const NOTES = [
	{
		id: "ann-pareil",
		messageId: "e2e-m0",
		quote: "de pareil",
		comment: "",
		answer: "Like it."
	},
	{
		id: "ann-laborieux",
		messageId: "e2e-m0",
		quote: "les débuts laborieux de Katie Zacharia",
		comment: "",
		answer: "Katie Zacharia's difficult beginnings."
	},
	{
		id: "ann-debuts",
		messageId: "e2e-m1",
		quote: "a connu des débuts difficiles",
		comment: "",
		answer: "Had a difficult start."
	},
	{
		id: "ann-proche",
		messageId: "e2e-m1",
		quote: "proche du mouvement MAGA",
		comment: "",
		answer: "Close to the MAGA movement."
	}
];

/** Seed the session (notes optional) and wait for the summary. */
export async function seedArticle(
	page: Page,
	notes: readonly (typeof NOTES)[number][] = NOTES,
	settings: Record<string, unknown> = {}
): Promise<void> {
	await seedChat(
		page,
		[
			{ role: "user", content: OPENER },
			{ role: "assistant", content: BODY }
		],
		"fr",
		{ theme: "dark", ownInk: "purple", ...settings }
	);
	await page.addInitScript((list) => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({ "e2e-chat": list })
		);
	}, notes);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
	const last = notes.at(-1);
	if (last)
		await expect(page.locator(`[data-ann-badge="${last.id}"]`)).toBeAttached({
			timeout: 30_000
		});
}
