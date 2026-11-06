// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { pageExcerpt, plainMarkdown, selectQuote } from "./browser";
import { renderMessage } from "./render";

describe("annotating a page's selection", () => {
	it("takes the sentence the selection is in", () => {
		const block =
			"Le marché ouvre le premier samedi de l'Avent. Il attire chaque année plus de trois millions de visiteurs. Les chalets ferment le 24 décembre.";
		expect(pageExcerpt("attire", block)).toBe(
			"Il attire chaque année plus de trois millions de visiteurs."
		);
		// Spread over two sentences: both.
		expect(pageExcerpt("Avent. Il attire", block)).toBe(
			"Le marché ouvre le premier samedi de l'Avent. Il attire chaque année plus de trois millions de visiteurs."
		);
		// Japanese full stops have no space after them.
		expect(
			pageExcerpt("雨", "今日は晴れです。明日は雨が降ります。週末は雪。")
		).toBe("明日は雨が降ります。");
		// Not in the block (it ran across paragraphs): the selection itself.
		expect(pageExcerpt("a b", "nothing here")).toBe("a b");
	});

	it("stays on the selection's line: a card's heading and links aren't the sentence", () => {
		const block =
			"More Images\nMarché de Noël\nUn marché de Noël est un marché en plein air qui se tient traditionnellement pendant l'Avent. On y trouve tout.\nContinued in Wikipedia (FR)";
		expect(pageExcerpt("traditionnellement", block)).toBe(
			"Un marché de Noël est un marché en plein air qui se tient traditionnellement pendant l'Avent."
		);
	});

	it("cuts a paragraph with no full stop to a readable length", () => {
		const block = `${"mot ".repeat(200)}cible ${"mot ".repeat(200)}`;
		const out = pageExcerpt("cible", block);
		expect(out.length).toBeLessThan(700);
		expect(out).toContain("cible");
		expect(out.startsWith("…")).toBe(true);
		expect(out.endsWith("…")).toBe(true);
	});

	it("shows a page's text in the chat exactly as written", () => {
		const texts = [
			"# 5 * 3 = 15_ok",
			"1. Premier point, puis 2) le second",
			"- un tiret + un plus",
			"Le menu coûte 5 $ et le vin 10 $ seulement.",
			"R&amp;D &lt;b&gt; et a < b > c",
			"`code` ~~barré~~ *étoile* [lien](https://x.fr) a | b",
			"> citation === ---",
			"Voir https://www.lemonde.fr/ ou écrire à a@b.fr !",
			"\\ une barre \\n inverse"
		];
		for (const text of texts) {
			const out = renderMessage(plainMarkdown(text), false);
			const el = document.createElement("div");
			el.innerHTML = out.html;
			expect(el.textContent?.trim()).toBe(text);
			expect(out.maths).toHaveLength(0);
		}
	});

	it("selects the quote again inside the chat's message, across its elements", () => {
		document.body.innerHTML =
			'<article id="msg-3"><div class="rendered"><p>Il <em>attire</em> chaque année</p><p>— <a href="#">Wikipédia</a></p></div></article>';
		const root = document.querySelector(".rendered")!;
		expect(selectQuote(root, "attire chaque")).toBe(true);
		expect(document.getSelection()?.toString()).toBe("attire chaque");
		expect(selectQuote(root, "absent")).toBe(false);
	});
});
