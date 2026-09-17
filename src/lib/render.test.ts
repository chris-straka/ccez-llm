// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	attachTagHtml,
	extractThoughts,
	stripSourcesIfUnasked,
	sourcesAsked,
	estimateTextTokens,
	renderMarkdown,
	renderMessage,
	applyPasteFolds,
	foldBracket,
	foldSegments,
	pasteFoldButton,
	htmlToText,
	highlightRendered,
} from "./render";
import type { AttachTagModel } from "./attachments";

describe("thoughts", () => {
	it("extracts closed think blocks, joining multiples", () => {
		const { thoughts, body } = extractThoughts("<think>hmm</think>Answer<think>more</think>");
		expect(thoughts).toBe("hmm\n\nmore");
		expect(body).toBe("Answer");
	});

	it("treats an unclosed tag as streaming thoughts", () => {
		const { thoughts, body } = extractThoughts("Answer so far<think>still thinking…");
		expect(thoughts).toBe("still thinking…");
		expect(body).toBe("Answer so far");
	});

	it("returns null thoughts for plain text", () => {
		expect(extractThoughts("just text")).toEqual({ thoughts: null, body: "just text" });
	});
});

describe("sources stripping", () => {
	const body = "Here is the answer.\n\n## Sources\n\n- example.com";
	it("drops a trailing Sources section unless asked", () => {
		expect(stripSourcesIfUnasked(body, false)).toBe("Here is the answer.");
		expect(stripSourcesIfUnasked(body, true)).toBe(body);
	});

	it("leaves mid-text mentions alone", () => {
		const text = "My sources are impeccable.\n\n## Next\n\nmore";
		expect(stripSourcesIfUnasked(text, false)).toBe(text);
	});

	it("detects when the user asked for sources", () => {
		expect(sourcesAsked(["tell me about cats"])).toBe(false);
		expect(sourcesAsked(["with sources please"])).toBe(true);
	});
});

describe("markdown rendering", () => {
	it("renders headless code blocks: copy icon button plus folded label, no fold bar", () => {
		const { html, codes } = renderMarkdown("```python\nprint(1)\n```");
		expect(codes).toEqual([{ lang: "python", code: "print(1)" }]);
		expect(html).not.toContain("ccez-code-head");
		expect(html).not.toContain("ccez-code-lang");
		expect(html).not.toContain("data-code-action");
		expect(html).not.toContain(">Fold<");
		expect(html).not.toContain(">Copy<");
		expect(html).toContain('data-code-index="0"');
		// Copy icon button: accessible name, per-block index, shared glyph.
		expect(html).toContain('class="ccez-code-copy"');
		expect(html).toContain('data-code-copy="0"');
		expect(html).toContain('aria-label="Copy code block"');
		expect(html).toContain("<svg");
		expect(html).toContain("action-glyph");
		// Folded label ships in the markup (stylesheet reveals it on fold).
		expect(html).toContain("ccez-code-foldedlabel");
		expect(html).toContain("python · 1 LOC");
	});

	it("runs only runnable fences: text and unknown labels get copy alone", () => {
		for (const fence of ["text", "", "haskell"]) {
			const { html } = renderMarkdown("```" + fence + "\nhello\n```");
			expect(html).toContain('class="ccez-code-copy"');
			expect(html).not.toContain("ccez-code-run");
		}
		for (const fence of ["python", "js", "bash"]) {
			const { html } = renderMarkdown("```" + fence + "\nhello\n```");
			expect(html).toContain('class="ccez-code-run"');
		}
	});

	it("labels multi-line blocks with their line count", () => {
		const { html } = renderMarkdown("```js\na\nb\nc\n```");
		expect(html).toContain("js · 3 LOC");
	});

	it("renders body-only display math: no fold bar, body kept for fold/copy", () => {
		const { html } = renderMarkdown("Here:\n\n$$x^2$$\n\ndone");
		expect(html).not.toContain("ccez-math-head");
		expect(html).toContain('data-math-index="0"');
		expect(html).toContain("ccez-math-body");
		expect(html).toContain("katex");
	});

	it("strips scripts and dangerous attributes", () => {
		const { html } = renderMarkdown(
			'hello <script>alert(1)</script><img src="x" onerror="alert(2)">'
		);
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onerror");
		expect(html).toContain("hello");
	});

	it("strips thoughts: body only, never displayed", () => {
		const { html, codes } = renderMessage("<think>hmm</think>```js\nx()\n```", false);
		expect(html).not.toContain("ccez-thoughts");
		expect(html).not.toContain("hmm");
		expect(html).toContain("ccez-code");
		expect(codes).toHaveLength(1);
	});

	it("keeps code indices unique across the body", () => {
		const { html, codes } = renderMessage("```py\na\n```\n\n```js\nb\n```", false);
		expect(codes.map((c) => c.lang)).toEqual(["py", "js"]);
		expect(html).toContain('data-code-index="0"');
		expect(html).toContain('data-code-index="1"');
	});

	it("marks only ruby-capable paragraphs for aid room", () => {
		const { html } = renderMarkdown("hello\n\n漢字を読む");
		expect(html).toContain('<p dir="auto">hello</p>');
		expect(html).toContain('<p dir="auto" class="cjk">');
	});

	it("keeps blank-line breaks between CJK paragraphs", () => {
		const { html } = renderMarkdown("秋が近づく。\n\n空が高くなる。\n\n紅葉が色づく。");
		expect(html.match(/<p dir="auto" class="cjk">/g)).toHaveLength(3);
	});

	it("marks CJK list items like the aid path does", () => {
		const { html } = renderMarkdown("3. 漢字を読む\n4. 空が高くなる");
		expect(html).toContain('<li dir="auto" class="cjk">');
		expect(html).not.toMatch(/<li dir="auto">[^<]*[一-鿿]/);
		const plain = renderMarkdown("3. read this\n4. then that");
		expect(plain.html).toContain('<li dir="auto">read this</li>');
		expect(plain.html).not.toContain("cjk");
	});

	it("keeps task checkboxes working with the item mark", () => {
		const { html } = renderMarkdown("- [ ] 漢字を読む\n- [x] done");
		expect(html).toContain('type="checkbox"');
		expect(html).toContain('<li dir="auto" class="cjk">');
	});

	it("directs every text block by its own content", () => {
		const { html } = renderMarkdown("# Title\n\n- item\n\n> quote\n\nplain");
		for (const tag of ["h1", "li", "blockquote", "p"]) {
			expect(html).toContain(`<${tag} dir="auto"`);
		}
		expect(html).not.toContain("<pre dir=");
	});

	it("converts rendered html back to plain text", () => {
		const { html } = renderMarkdown("# Title\n\nsome **bold** text");
		const text = htmlToText(html);
		expect(text).toContain("Title");
		expect(text).toContain("bold");
		expect(text).not.toContain("**");
		expect(text).not.toContain("<h1>");
	});
});

describe("sent-message tags", () => {
	const img: AttachTagModel = {
		id: "img-1",
		kind: "image",
		name: "shot.png",
		tokens: 85,
		open: false,
		dataUrl: "data:image/png;base64,AAA",
		text: null
	};
	const file: AttachTagModel = {
		id: "file-1",
		kind: "text",
		name: "notes.md",
		tokens: 12,
		open: false,
		dataUrl: null,
		text: "# hello"
	};

	it("rebuilds literals as fold buttons paired by kind order", () => {
		const { html } = renderMarkdown("[Pasted image] what do you see here?", [img]);
		expect(html).toContain('class="paste-fold sent-fold"');
		expect(html).toContain('data-sent-toggle="img-1"');
		expect(html).toContain("[Pasted image]");
		expect(html).not.toContain("sent-card");
		expect(html).toContain("what do you see here?");
	});

	it("floats open tags as pill popups with icon buttons", () => {
		const { html } = renderMarkdown("[Pasted image] what do you see here?", [{ ...img, open: true }]);
		expect(html).toContain('class="sent-open"');
		// The tag stays mounted below its popup.
		expect(html).toContain('class="paste-fold sent-fold"');
		expect(html).toContain('src="data:image/png;base64,AAA"');
		expect(html).toContain("shot.png");
		expect(html).toContain("~85");
		expect(html).toContain('data-sent-action="copy"');
		expect(html).toContain('data-sent-action="ocr"');
		expect(html).toContain('aria-label="Copy attachment"');
		expect(html).toContain('aria-label="Close preview"');
		expect(html).not.toContain("Remove");
		expect(html).not.toContain("Collapse attachment");
	});

	it("floats file excerpts with copy but no OCR", () => {
		const { html } = renderMarkdown("[Pasted Attachment] notes", [{ ...file, open: true }]);
		expect(html).toContain('class="sent-excerpt"');
		expect(html).toContain("# hello");
		expect(html).toContain("notes.md");
		expect(html).toContain('data-sent-action="copy"');
		expect(html).not.toContain('data-sent-action="ocr"');
	});

	it("falls back to plain text past the end of the models", () => {
		const { html } = renderMarkdown("[Pasted image] one [Pasted image] two", [img]);
		expect(html).toContain('data-sent-toggle="img-1"');
		expect(html).toContain("[Pasted image] two");
	});

	it("leaves literals inside code alone", () => {
		const { html } = renderMarkdown("`[Pasted image]`", [img]);
		expect(html).not.toContain("sent-tag");
	});

	it("builds the tag fold directly", () => {
		expect(attachTagHtml(null, "i")).toBe("[Pasted image]");
		expect(attachTagHtml(null, "f")).toBe("[Pasted Attachment]");
		expect(attachTagHtml(img, "i")).toContain('data-sent-toggle="img-1"');
		expect(attachTagHtml({ ...img, open: true }, "i")).toContain('class="sent-img"');
	});
});

describe("highlighting", () => {
	it("highlights known languages, leaves unknown ones plain", async () => {
		const rendered = renderMarkdown("```js\nconst x = 1;\n```\n\n```zzz\n???\n```");
		const html = await highlightRendered(rendered);
		// Shiki v4 emits light colors inline plus dark-mode CSS variables.
		expect(html).toContain("--shiki-dark");
		// The unknown-language block keeps its escaped plain text.
		expect(html).toContain("???");
	}, 30000);

	it("is a no-op without code blocks", async () => {
		const rendered = renderMarkdown("plain text");
		await expect(highlightRendered(rendered)).resolves.toBe(rendered.html);
	});
});


describe("token estimates", () => {
	it("estimates ~4 chars per token", () => {
		expect(estimateTextTokens("")).toBe(1);
		expect(estimateTextTokens("abcd")).toBe(1);
		expect(estimateTextTokens("abcde")).toBe(2);
	});
});



describe("applyPasteFolds", () => {
	it("passes content through with no folds", () => {
		expect(applyPasteFolds("hello", undefined)).toBe("hello");
		expect(applyPasteFolds("hello", [])).toBe("hello");
	});

	it("splices closed folds into marker buttons, frames open ones in brackets", () => {
		const out = applyPasteFolds("aa BBBB cc DDDD ee", [
			{ start: 3, end: 7, chars: 4 },
			{ start: 11, end: 15, chars: 4, open: true }
		]);
		expect(out).toContain('data-paste-fold="0"');
		expect(out).toContain("[Pasted 4 chars]");
		expect(out).toContain(
			'data-paste-fold="1" title="Collapse pasted content">[</button>DDDD' +
				'<button type="button" class="paste-fold paste-fold-bracket" data-paste-fold="1" title="Collapse pasted content">]</button>'
		);
		expect(out).not.toContain("BBBB");
		expect(out.startsWith("aa ")).toBe(true);
		expect(out.endsWith(" ee")).toBe(true);
	});

	it("ignores invalid and overlapping folds", () => {
		const out = applyPasteFolds("abcdef", [
			{ start: 1, end: 3, chars: 2 },
			{ start: 2, end: 5, chars: 3 },
			{ start: -2, end: 1, chars: 3 },
			{ start: 4, end: 99, chars: 95 }
		]);
		expect(out).toContain('data-paste-fold="0"');
		expect(out.match(/data-paste-fold/g)).toHaveLength(1);
	});
});

describe("foldSegments", () => {
	it("splits visible runs from closed-fold markers, opening folds apart", () => {
		expect(foldSegments("hello", undefined)).toEqual([{ kind: "text", text: "hello" }]);
		expect(
			foldSegments("aa BBBB cc DDDD ee", [
				{ start: 3, end: 7, chars: 4 },
				{ start: 11, end: 15, chars: 4, open: true }
			])
		).toEqual([
			{ kind: "text", text: "aa " },
			{ kind: "marker", index: 0, chars: 4 },
			{ kind: "text", text: " cc " },
			{ kind: "open", index: 1, chars: 4, text: "DDDD" },
			{ kind: "text", text: " ee" }
		]);
	});

	it("builds collapse brackets carrying the fold toggle", () => {
		expect(foldBracket(2, "data-paste-fold", "[")).toBe(
			'<button type="button" class="paste-fold paste-fold-bracket" data-paste-fold="2" title="Collapse pasted content">[</button>'
		);
	});

	it("emits the same markers applyPasteFolds splices", () => {
		expect(pasteFoldButton(2, 128)).toBe(
			'<button type="button" class="paste-fold" data-paste-fold="2">[Pasted 128 chars]</button>'
		);
	});
});
