import { describe, expect, it } from "vitest";
import {
	correctionHtmlFor,
	correctionPromptOn,
	correctionTokens,
	diffCorrection,
	escapeCorrection,
	extractCorrection
} from "./correction";

describe("extractCorrection", () => {
	it("splits a closed block from the body", () => {
		const { correction, body } = extractCorrection(
			"Bien sûr !\n\n```correction\nJe vais au parc\n```\n\nÀ bientôt."
		);
		expect(correction).toBe("Je vais au parc");
		expect(body).toBe("Bien sûr !\n\n\n\nÀ bientôt.");
		expect(body).not.toContain("correction");
	});

	it("matches the fence case-insensitively with spare spaces", () => {
		const { correction, body } = extractCorrection(
			"ok\n```Correction  \nTu as raison\n```"
		);
		expect(correction).toBe("Tu as raison");
		expect(body).toBe("ok");
	});

	it("hides an unclosed fence to the end mid-stream", () => {
		const { correction, body } = extractCorrection(
			"Voici :\n\n```correction\nJe vais au"
		);
		expect(correction).toBe("Je vais au");
		expect(body).toBe("Voici :");
	});

	it("joins multiple blocks and leaves other fences alone", () => {
		const { correction, body } = extractCorrection(
			"```js\nconst x = 1;\n```\n\n```correction\nUn\n```\n\n```correction\nDeux\n```"
		);
		expect(correction).toBe("Un\n\nDeux");
		expect(body).toContain("```js");
		expect(body).not.toContain("```correction");
	});

	it("returns null with the markdown untouched when no fence", () => {
		const { correction, body } = extractCorrection("Just a reply.");
		expect(correction).toBeNull();
		expect(body).toBe("Just a reply.");
	});
});

describe("correctionPromptOn", () => {
	it("needs both the toggle and a reply language", () => {
		expect(correctionPromptOn(true, "fr")).toBe(true);
		expect(correctionPromptOn(true, null)).toBe(false);
		expect(correctionPromptOn(false, "fr")).toBe(false);
		expect(correctionPromptOn(undefined, "fr")).toBe(false);
		expect(correctionPromptOn(undefined, null)).toBe(false);
	});
});

describe("correctionTokens", () => {
	it("keeps Latin words whole with their trailing spaces", () => {
		expect(correctionTokens("Je vais  au parc.")).toEqual([
			"Je ",
			"vais  ",
			"au ",
			"parc."
		]);
	});

	it("keeps leading spaces in their own run", () => {
		expect(correctionTokens("  bonjour")).toEqual(["  ", "bonjour"]);
	});

	it("splits CJK into single characters", () => {
		expect(correctionTokens("私は公園に行く")).toEqual([
			"私",
			"は",
			"公",
			"園",
			"に",
			"行",
			"く"
		]);
	});

	it("mixes scripts without gluing", () => {
		expect(correctionTokens("go 公園へ!")).toEqual([
			"go ",
			"公",
			"園",
			"へ",
			"!"
		]);
	});
});

describe("diffCorrection", () => {
	it("marks a swapped word as del plus ins", () => {
		expect(diffCorrection("Je vais au le parc", "Je vais au parc")).toEqual([
			{ type: "same", text: "Je vais au " },
			{ type: "del", text: "le " },
			{ type: "same", text: "parc" }
		]);
	});

	it("marks a pure insertion", () => {
		expect(diffCorrection("Je vais parc", "Je vais au parc")).toEqual([
			{ type: "same", text: "Je vais " },
			{ type: "ins", text: "au " },
			{ type: "same", text: "parc" }
		]);
	});

	it("keeps substitutions readable, never glued", () => {
		const ops = diffCorrection("Je vais au le parc", "Je vais au grand parc");
		expect(ops).toEqual([
			{ type: "same", text: "Je vais au " },
			{ type: "del", text: "le " },
			{ type: "ins", text: "grand " },
			{ type: "same", text: "parc" }
		]);
		expect(ops.map((op) => op.text).join("")).toBe("Je vais au le grand parc");
	});

	it("diffs CJK at the character level", () => {
		expect(diffCorrection("私は公園に行く", "私は公園へ行く")).toEqual([
			{ type: "same", text: "私は公園" },
			{ type: "del", text: "に" },
			{ type: "ins", text: "へ" },
			{ type: "same", text: "行く" }
		]);
	});

	it("returns one same run for identical texts", () => {
		expect(diffCorrection("Bonjour", "Bonjour")).toEqual([
			{ type: "same", text: "Bonjour" }
		]);
	});
});

describe("escapeCorrection", () => {
	it("escapes HTML metacharacters", () => {
		expect(escapeCorrection('<b>"a" & \'b\'</b>')).toBe(
			"&lt;b&gt;&quot;a&quot; &amp; 'b'&lt;/b&gt;"
		);
	});
});

describe("correctionHtmlFor", () => {
	const block = (text: string): string =>
		`Bien sûr !\n\n\`\`\`correction\n${text}\n\`\`\``;

	it("renders del struck and ins underlined", () => {
		expect(correctionHtmlFor("Je vais au le parc", block("Je vais au parc"))).toBe(
			'Je vais au <span class="corr-del">le </span>parc'
		);
	});

	it("returns null without a following assistant message", () => {
		expect(correctionHtmlFor("Je vais", null)).toBeNull();
	});

	it("returns null when the reply holds no block", () => {
		expect(correctionHtmlFor("Je vais", "Just a reply.")).toBeNull();
	});

	it("returns null when the correction matches the user text", () => {
		expect(correctionHtmlFor("Je vais au parc", block("Je vais au parc"))).toBeNull();
	});

	it("returns null for refs-only user content", () => {
		expect(
			correctionHtmlFor(
				'Annotated selections:\n1. "bonjour" — ?',
				block("Bonjour")
			)
		).toBeNull();
	});

	it("diffs against the display text, not the baked block", () => {
		const html = correctionHtmlFor(
			'Je vais au le parc\n\nAnnotated selections:\n1. "bonjour" — ?',
			block("Je vais au parc")
		);
		expect(html).toBe('Je vais au <span class="corr-del">le </span>parc');
	});

	it("escapes model HTML in the diff", () => {
		const html = correctionHtmlFor("Hello", block("Hello <b>world</b>"));
		expect(html).toContain("&lt;b&gt;");
		expect(html).not.toContain("<b>");
	});
});
