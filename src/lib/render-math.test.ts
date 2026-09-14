// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	extractMath,
	mathHtml,
	mathTexPreview,
	foldedCodeLabel,
	mathCopyText,
	foldPreviewText,
	stripLatexFenceDupes
} from "./render-math";
import { renderMarkdown, renderMessage } from "./render";

describe("latex math", () => {
	it("renders display math with copy, $ toggle, folded label, and raw source", () => {
		const { html, maths } = renderMarkdown("Here:\n\n$$x^2 + y^2$$\n\ndone");
		expect(maths).toEqual([{ kind: "display", tex: "x^2 + y^2", raw: "$$x^2 + y^2$$" }]);
		expect(html).toContain('data-math-index="0"');
		expect(html).toContain("ccez-math-body");
		expect(html).toContain("ccez-math-copy");
		expect(html).toContain("ccez-math-tex");
		expect(html).toContain("ccez-math-foldedlabel");
		expect(html).toContain("latex · 1 LOC");
		expect(html).toContain("ccez-math-raw");
		expect(html).toContain("katex");
	});

	it("drops a latex fence duplicating its neighboring display block", () => {
		const src = "```latex\n$$x^2$$\n```\n\n$$x^2$$";
		expect(stripLatexFenceDupes(src)).toBe("$$x^2$$");
		// Reversed order collapses the same way.
		expect(stripLatexFenceDupes("$$x^2$$\n\n```latex\n$$x^2$$\n```")).toBe("$$x^2$$");
		// Different equations stay twice.
		const other = "```latex\n$$x^2$$\n```\n\n$$y^2$$";
		expect(stripLatexFenceDupes(other)).toBe(other);
		// Fence delimiters aside, whitespace aside.
		expect(stripLatexFenceDupes("```latex\nx^2\n```\n\n$$x^2$$")).toBe("$$x^2$$");
	});

	it("renders a lone latex fence as display math, once", () => {
		const { html, maths, codes } = renderMarkdown("Work:\n\n```latex\n$$\\frac{a}{b}$$\n```\ndone");
		expect(codes).toHaveLength(0);
		expect(html).not.toContain("ccez-code");
		expect(maths).toHaveLength(1);
		expect(maths[0]?.kind).toBe("display");
		expect(maths[0]?.tex).toBe("\\frac{a}{b}");
		expect(html).toContain("ccez-math-copy");
		expect(html).toContain("katex");
	});

	it("shows a fenced-plus-display pair exactly once", () => {
		const { html } = renderMessage(
			"Quad:\n\n```latex\n$$x = 1$$\n```\n\n$$x = 1$$",
			false
		);
		expect(html.match(/data-math-index="0"/g)).toHaveLength(1);
		expect(html).not.toContain("ccez-code");
	});

	it("renders inline math bare, with no chrome at all", () => {
		const { html, maths } = renderMarkdown("slope \\(m = \\frac{a}{b}\\) here");
		expect(maths).toHaveLength(1);
		expect(maths[0]?.kind).toBe("inline");
		expect(html).toContain("ccez-math-inline");
		expect(html).not.toContain("ccez-math-head");
		expect(html).not.toContain("data-math-action");
		expect(html).toContain("katex");
	});

	it("keeps the inline wrapper free of block elements (divs would be ejected from the paragraph)", () => {
		const html = mathHtml({ kind: "inline", tex: "m", raw: "\\(m\\)" }, 0);
		const inner = html.slice(html.indexOf(">") + 1, html.lastIndexOf("<"));
		expect(inner).not.toContain("<div");
		expect(html).not.toContain("ccez-math-head");
	});

	it("truncates long TeX previews to one line", () => {
		expect(mathTexPreview("a + b", 48)).toBe("a + b");
		expect(mathTexPreview("x\n^2", 48)).toBe("x ^2");
		const long = mathTexPreview("a".repeat(60), 48);
		expect(long).toHaveLength(49);
		expect(long.endsWith("…")).toBe(true);
	});

	it("prefers the override for folded previews", () => {
		expect(foldPreviewText("anything", "\"quoted\"")).toBe("\"quoted\"");
	});

	it("previews plain text as the first line, as before", () => {
		expect(foldPreviewText("hello world", null)).toBe("hello world");
		expect(foldPreviewText(`${"a".repeat(200)}\nsecond`, null)).toBe("a".repeat(140));
	});

	it("folds display math into parenthesized latex", () => {
		expect(foldPreviewText("$$E = mc^2$$", null)).toBe("\\(E = mc^2\\)");
		expect(foldPreviewText("\\[a + b\\]", null)).toBe("\\(a + b\\)");
		expect(foldPreviewText("$$\nx^2\n$$", null)).toBe("\\(x^2\\)");
	});

	it("folds inline math up to its closing delimiter", () => {
		expect(foldPreviewText("$x^2$ and more", null)).toBe("\\(x^2\\)");
	});

	it("truncates long folded equations with an ellipsis", () => {
		const preview = foldPreviewText(`$$${"a".repeat(200)}$$`, null);
		expect(preview.startsWith("\\(")).toBe(true);
		expect(preview.endsWith("…\\)")).toBe(true);
	});

	it("keeps invalid math as plain text, never fatal", () => {
		const { html, maths } = renderMarkdown("$$\\notacommand{$$");
		expect(maths).toHaveLength(1);
		expect(html).not.toContain("katex");
		expect(html).toContain("notacommand");
		expect(() => mathHtml({ kind: "display", tex: "   ", raw: "$$   $$" }, 0)).not.toThrow();
		expect(mathHtml({ kind: "display", tex: "   ", raw: "$$   $$" }, 0)).toContain("$$");
	});

	it("leaves unclosed delimiters literal (streaming-safe)", () => {
		const { html, maths } = renderMarkdown("halfway $$x^2 and \\(y");
		expect(maths).toEqual([]);
		expect(html).not.toContain("ccez-math");
		expect(html).toContain("x^2");
	});

	it("never renders math inside fenced code or inline code spans", () => {
		const { html, codes, maths } = renderMarkdown(
			"```tex\n$$x^2$$\n```\n\n`\\(y\\)` and `$$z$$`"
		);
		expect(maths).toEqual([]);
		expect(codes).toHaveLength(1);
		expect(html).not.toContain("ccez-math");
		expect(html).toContain("ccez-code");
	});

	it("never renders thoughts math: body indices only", () => {
		const { html, maths } = renderMessage("<think>$$a$$</think>See \\(b\\) and $$c$$", false);
		expect(maths.map((m) => m.tex)).toEqual(["b", "c"]);
		expect(html).toContain('data-math-index="0"');
		expect(html).toContain('data-math-index="1"');
		expect(html).not.toContain('data-math-index="2"');
	});

	it("renders single-dollar inline math bare like paren inline math", () => {
		const { html, maths } = renderMarkdown("slope $m = \\frac{a}{b}$ here");
		expect(maths).toEqual([{ kind: "inline", tex: "m = \\frac{a}{b}", raw: "$m = \\frac{a}{b}$" }]);
		expect(html).toContain("ccez-math-inline");
		expect(html).not.toContain("ccez-math-head");
		expect(html).not.toContain("data-math-action");
		expect(html).toContain("katex");
	});

	it("leaves prices, mid-word joins, and padded dollars literal", () => {
		const { html, maths } = renderMarkdown("costs $5 and $10, plus a$b and $ x$ done");
		expect(maths).toEqual([]);
		expect(html).not.toContain("ccez-math");
		expect(html).toContain("$5");
	});

	it("leaves unclosed single dollars literal and skips escaped closers", () => {
		const { html, maths } = renderMarkdown("halfway $x^2 and done");
		expect(maths).toEqual([]);
		expect(html).not.toContain("ccez-math");
		const escaped = renderMarkdown("price \\$5 and $y$ ok");
		expect(escaped.maths.map((m) => m.tex)).toEqual(["y"]);
	});

	it("never renders single-dollar math inside fenced code or code spans", () => {
		const { html, maths } = renderMarkdown("```\n$x^2$\n```\n\n`$y$` done");
		expect(maths).toEqual([]);
		expect(html).not.toContain("ccez-math");
	});

	it("extracts display math across lines and skips escaped openers", () => {
		const { stripped, maths } = extractMath("a\n$$\nx\n$$\n\\\\(not math\\\\) and \\(real\\)");
		expect(maths.map((m) => m.kind)).toEqual(["display", "inline"]);
		expect(maths[0]?.tex).toBe("\nx\n");
		expect(maths[1]?.tex).toBe("real");
		expect(stripped).toContain("\\\\(not math\\\\)");
	});
});
describe("foldedCodeLabel", () => {
	it("names the language and line count with a middle dot", () => {
		expect(foldedCodeLabel("python", 13)).toBe("python · 13 LOC");
		expect(foldedCodeLabel("text", 1)).toBe("text · 1 LOC");
		expect(foldedCodeLabel("js", 0)).toBe("js · 0 LOC");
	});
});
describe("mathCopyText", () => {
	it("wraps TeX in $$ delimiters, verbatim", () => {
		expect(mathCopyText("x^2 + y^2")).toBe("$$x^2 + y^2$$");
		expect(mathCopyText("\nx\n")).toBe("$$\nx\n$$");
		expect(mathCopyText("")).toBe("$$$$");
	});
});
