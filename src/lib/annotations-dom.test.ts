// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
	quoteFragmentText,
	quoteTextNodes,
	equationBodyOf,
	equationBodyRange,
	trimParagraphTerminator,
	loadDraftAnnotations,
	saveDraftAnnotations,
	snapSelectionToWordEdges,
	quoteRange,
	wrapRangeInMark,
	wrapRangeExcludingBadges,
	unwrapMark,
	type Annotation
} from "./annotations";

function fragment(html: string): DocumentFragment {
	const template = document.createElement("template");
	template.innerHTML = html;
	return template.content;
}

describe("quoteFragmentText", () => {
	it("drops reading overlays and keeps the base text", () => {
		const text = quoteFragmentText(
			fragment(
				'<p>今日<span class="frb">漢<span class="frt">かん</span></span><span class="frb">字<span class="frt">じ</span></span>を読む</p>'
			)
		);
		expect(text).toBe("今日漢字を読む");
	});

	it("drops annotation badge numbers", () => {
		const text = quoteFragmentText(
			fragment('<p>Kyoto<button data-ann-badge="a1">1</button> in two sentences</p>')
		);
		expect(text).toBe("Kyoto in two sentences");
	});

	it("skips math chrome buttons when collecting quotable text", () => {
		// The `$` toggle text is UI, never quotable: leaving it in
		// the haystack mis-anchors badges beside equations (and the
		// chrome reorder stays offset-neutral).
		const nodes = quoteTextNodes(
			fragment(
				'<p>slope <span class="ccez-math-inline"><span class="ccez-math-body">m</span>' +
					'<button type="button" class="ccez-math-tex">$</button>' +
					'<button type="button" class="ccez-math-copy">x</button></span> here</p>'
			)
		);
		expect(nodes.map((node) => node.textContent).join("")).toBe("slope m here");
	});

	it("trims plain selections untouched", () => {
		expect(quoteFragmentText(fragment("<p>  hello world  </p>"))).toBe("hello world");
	});

	it("drops math chrome heads, keeping the equation body", () => {
		const text = quoteFragmentText(
			fragment(
				'<div class="ccez-math" data-math-index="0"><div class="ccez-math-head"><span class="ccez-math-lang">math</span></div><div class="ccez-math-body"><span class="katex">E</span></div></div>'
			)
		);
		expect(text).toBe("E");
	});

	it("drops code chrome heads, keeping the code body", () => {
		const text = quoteFragmentText(
			fragment(
				'<div class="ccez-code" data-code-index="0"><button class="ccez-code-head"><span class="ccez-code-lang">python</span></button><pre><code>x = 1</code></pre></div>'
			)
		);
		expect(text).toBe("x = 1");
	});

	it("drops math chrome buttons, keeping the equation body", () => {
		// A spanning drag includes the `$` toggle and copy button in
		// its range even where user-select keeps them out of the
		// paint: neither may bake into the quote.
		const text = quoteFragmentText(
			fragment(
				'<div class="ccez-math" data-math-index="0"><button type="button" class="ccez-math-tex">$</button>' +
					'<button type="button" class="ccez-math-copy">copy</button>' +
					'<div class="ccez-math-body"><span class="katex">E</span></div></div>'
			)
		);
		expect(text).toBe("E");
	});

	it("drops folded labels and folded-away bodies", () => {
		// Folded labels are chrome and folded bodies are hidden: a
		// drag spanning a folded block quotes neither.
		const math = quoteFragmentText(
			fragment(
				'<div class="ccez-math" data-math-index="0" data-folded="1">' +
					'<span class="ccez-math-foldedlabel">latex · 1 LOC</span>' +
					'<div class="ccez-math-body"><span class="katex">E</span></div>' +
					"<pre class=\"ccez-math-raw\">E_n</pre></div>"
			)
		);
		expect(math).toBe("");
		const code = quoteFragmentText(
			fragment(
				'<div class="ccez-code" data-folded="1"><span class="ccez-code-foldedlabel">python · 2 LOC</span>' +
					"<pre><code>x = 1</code></pre></div>"
			)
		);
		expect(code).toBe("");
	});
});

describe("equationBodyOf", () => {
	function mathDoc(): HTMLElement {
		const root = document.createElement("div");
		root.innerHTML =
			'<div class="ccez-math" data-math-index="0"><div class="ccez-math-head">head</div><div class="ccez-math-body"><span class="katex">E_n</span></div></div>' +
			'<p>plain <span class="ccez-math-inline" data-math-index="1"><span class="ccez-math-body">x</span></span> tail</p>';
		document.body.append(root);
		return root;
	}

	it("returns the display body for nodes inside display math", () => {
		const root = mathDoc();
		const glyph = root.querySelector(".ccez-math-body .katex")!;
		const body = equationBodyOf(glyph);
		expect(body?.classList.contains("ccez-math-body")).toBe(true);
		root.remove();
	});

	it("returns the inline body for nodes inside inline math", () => {
		const root = mathDoc();
		const glyph = root.querySelector(".ccez-math-inline .ccez-math-body")!;
		expect(equationBodyOf(glyph)?.classList.contains("ccez-math-body")).toBe(true);
		root.remove();
	});

	it("falls back to the wrapper when it holds no body", () => {
		const wrap = document.createElement("span");
		wrap.setAttribute("data-math-index", "7");
		wrap.textContent = "bare";
		document.body.append(wrap);
		expect(equationBodyOf(wrap.firstChild)).toBe(wrap);
		wrap.remove();
	});

	it("returns null outside math", () => {
		const root = mathDoc();
		expect(equationBodyOf(root.querySelector("p"))).toBeNull();
		expect(equationBodyOf(null)).toBeNull();
		root.remove();
	});

	it("returns null inside the raw source view", () => {
		// Dragging raw TeX must keep the live highlight: expanding
		// onto the hidden rendered body deletes the selection and
		// strands the menu.
		const root = document.createElement("div");
		root.innerHTML =
			'<div class="ccez-math" data-math-index="0"><div class="ccez-math-body"><span class="katex">E</span></div>' +
			'<pre class="ccez-math-raw">E_n</pre></div>';
		document.body.append(root);
		const raw = root.querySelector(".ccez-math-raw")!;
		expect(equationBodyOf(raw.firstChild)).toBeNull();
		root.remove();
	});

	it("returns null on a folded label", () => {
		// A folded label pick is already whole: expanding it onto the
		// folded-away body (display:none) moves the paint where nothing
		// can show, and the stranded menu dies on selectionchange.
		const root = document.createElement("div");
		root.innerHTML =
			'<div class="ccez-math" data-math-index="0" data-folded="1"><span class="ccez-math-foldedlabel">latex · 1 LOC</span>' +
			'<div class="ccez-math-body"><span class="katex">E</span></div></div>';
		document.body.append(root);
		const label = root.querySelector(".ccez-math-foldedlabel")!;
		expect(equationBodyOf(label.firstChild)).toBeNull();
		root.firstElementChild?.removeAttribute("data-folded");
		expect(equationBodyOf(label.firstChild)?.classList.contains("ccez-math-body")).toBe(true);
		root.remove();
	});
});

describe("equationBodyRange", () => {
	it("trims blank edge text so one-line equations stop at their line", () => {
		const root = document.createElement("div");
		root.innerHTML =
			'<div class="ccez-math-body">\n<span class="katex">E_n</span>\n</div>';
		document.body.append(root);
		const body = root.querySelector(".ccez-math-body")!;
		const range = equationBodyRange(body);
		expect(range?.toString()).toBe("E_n");
		root.remove();
	});

	it("keeps the whole body when nothing is blank", () => {
		const root = document.createElement("div");
		root.innerHTML = '<div class="ccez-math-body"><span class="katex">E_n</span></div>';
		document.body.append(root);
		const body = root.querySelector(".ccez-math-body")!;
		expect(equationBodyRange(body)?.toString()).toBe("E_n");
		root.remove();
	});
});

describe("trimParagraphTerminator", () => {
	function pick(html: string): { range: Range; root: HTMLElement } {
		const root = document.createElement("div");
		root.innerHTML = html;
		document.body.append(root);
		const range = document.createRange();
		range.selectNodeContents(root);
		return { range, root };
	}
	it("drops a trailing newline run from a paragraph pick", () => {
		const { range, root } = pick("<pre>$$a^2$$</pre>\n");
		expect(trimParagraphTerminator(range)).toBe(true);
		expect(range.toString()).toBe("$$a^2$$");
		root.remove();
	});
	it("leaves deliberate picks untouched", () => {
		const { range, root } = pick("<p>plain line</p>");
		expect(trimParagraphTerminator(range)).toBe(false);
		expect(range.toString()).toBe("plain line");
		root.remove();
	});
	it("skips empty paragraphs and chrome parking past the pick", () => {
		// Triple-clicking a heading parks its focus at the next
		// block's start — on the `$` chrome — with the pipeline's
		// empty paragraphs and newline glue between: the walk must
		// pull back to the heading, not land in the glue (which
		// repaints the line beneath).
		const root = document.createElement("div");
		root.innerHTML =
			"<h2>1. Pythagorean Theorem</h2>\n<p></p>" +
			'<div class="ccez-math" data-math-index="0"><button type="button" class="ccez-math-tex">$</button>' +
			'<div class="ccez-math-body"><span>E</span></div></div>';
		document.body.append(root);
		const text = root.querySelector("h2")!.firstChild!;
		const button = root.querySelector("button")!;
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(button, 0);
		expect(trimParagraphTerminator(range)).toBe(true);
		expect(range.toString()).toBe("1. Pythagorean Theorem");
		root.remove();
	});

	it("pulls an end parked at the next block back to content", () => {
		// Triple-click lands its focus at the following paragraph's
		// start (jsdom never synthesizes that block break, so the
		// inter-block newline stands in for it here; the live shape
		// is pinned by the triple-click e2e instead).
		const root = document.createElement("div");
		root.innerHTML = "<pre>$$a^2$$</pre>\n<p>tail</p>";
		document.body.append(root);
		const preText = root.querySelector("pre")!.firstChild!;
		const tail = root.querySelector("p")!;
		const range = document.createRange();
		range.setStart(preText, 0);
		range.setEnd(tail, 0);
		expect(range.toString()).toBe("$$a^2$$\n");
		expect(trimParagraphTerminator(range)).toBe(true);
		expect(range.toString()).toBe("$$a^2$$");
		root.remove();
	});
	it("never collapses a newline-only pick", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>\n</p>";
		document.body.append(root);
		const text = root.querySelector("p")!.firstChild!;
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(text, 1);
		expect(trimParagraphTerminator(range)).toBe(false);
		expect(range.toString()).toBe("\n");
		root.remove();
	});
});

describe("snapSelectionToWordEdges", () => {
	function selectIn(node: Text, start: number, end: number): Selection {
		const sel = window.getSelection();
		if (!sel) throw new Error("no selection");
		sel.setBaseAndExtent(node, start, node, end);
		return sel;
	}

	it("expands a mid-word drag to whole words, preserving direction", () => {
		document.body.innerHTML = "<p>hello world</p>";
		const node = document.querySelector("p")?.firstChild;
		if (!(node instanceof Text)) throw new Error("no text");
		const sel = selectIn(node, 2, 9);
		expect(snapSelectionToWordEdges(sel)).toBe(true);
		expect(sel.toString()).toBe("hello world");
		// Backwards drags keep their direction (anchor stays last).
		sel.setBaseAndExtent(node, 9, node, 2);
		expect(snapSelectionToWordEdges(sel)).toBe(true);
		expect(sel.toString()).toBe("hello world");
		expect(sel.anchorOffset).toBe(11);
		expect(sel.focusOffset).toBe(0);
	});

	it("reports false (and moves nothing) on clean edges and carets", () => {
		document.body.innerHTML = "<p>hello world</p>";
		const node = document.querySelector("p")?.firstChild;
		if (!(node instanceof Text)) throw new Error("no text");
		const sel = selectIn(node, 0, 5);
		expect(snapSelectionToWordEdges(sel)).toBe(false);
		expect(sel.toString()).toBe("hello");
		sel.collapse(node, 3);
		expect(snapSelectionToWordEdges(sel)).toBe(false);
	});

	it("snaps both ends of a multi-node selection", () => {
		document.body.innerHTML = "<p>alpha <b>beta gamma</b></p>";
		const first = document.querySelector("p")?.firstChild;
		const bold = document.querySelector("b")?.firstChild;
		if (!(first instanceof Text) || !(bold instanceof Text)) throw new Error("no text");
		const sel = window.getSelection();
		if (!sel) throw new Error("no selection");
		// "pha beta gam": start cut inside "alpha", end cut inside "gamma".
		sel.setBaseAndExtent(first, 2, bold, 8);
		expect(snapSelectionToWordEdges(sel)).toBe(true);
		expect(sel.toString()).toBe("alpha beta gamma");
	});
});

describe("draft annotation persistence", () => {
	const ann = (over: Partial<Annotation> = {}): Annotation => ({
		id: "a1" as Annotation["id"],
		messageId: "m1" as Annotation["messageId"],
		quote: "散歩",
		comment: "walk",
		at: 0,
		...over
	});

	beforeEach(() => {
		window.localStorage.clear();
	});

	it("round-trips drafts per chat", () => {
		expect(loadDraftAnnotations("c1")).toEqual([]);
		saveDraftAnnotations("c1", [ann()], ["c1"]);
		expect(loadDraftAnnotations("c1")).toEqual([ann()]);
		expect(loadDraftAnnotations("c2")).toEqual([]);
	});

	it("clearing a chat drops its entry, orphans prune on save", () => {
		saveDraftAnnotations("c1", [ann()], ["c1", "c2"]);
		saveDraftAnnotations("c2", [ann({ id: "a2" as Annotation["id"] })], ["c1", "c2"]);
		saveDraftAnnotations("c1", [], ["c1", "c2"]);
		expect(loadDraftAnnotations("c1")).toEqual([]);
		expect(loadDraftAnnotations("c2")).toHaveLength(1);
		// c2's chat deleted: next save prunes its drafts.
		saveDraftAnnotations("c1", [ann()], ["c1"]);
		expect(loadDraftAnnotations("c2")).toEqual([]);
	});

	it("deleting a background chat keeps the active chat's drafts", () => {
		saveDraftAnnotations("c1", [ann()], ["c1", "c2"]);
		saveDraftAnnotations("c2", [ann({ id: "a2" as Annotation["id"] })], ["c1", "c2"]);
		// Drop c2 in the background: re-file c1's in-memory drafts with
		// c2 excluded from known ids (the dropChat background branch).
		saveDraftAnnotations("c1", [ann()], ["c1"]);
		expect(loadDraftAnnotations("c1")).toEqual([ann()]);
		expect(loadDraftAnnotations("c2")).toEqual([]);
	});

	it("drops corrupt entries and survives corrupt storage", () => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({ c1: [ann(), null, "x", { id: 5 }, { ...ann(), at: "0" }] })
		);
		const loaded = loadDraftAnnotations("c1");
		expect(loaded).toHaveLength(2);
		expect(loaded[1]?.at).toBe(0);
		window.localStorage.setItem("ccez-llm-annotations-v1", "not json{");
		expect(loadDraftAnnotations("c1")).toEqual([]);
	});

	it("reads drafts saved under the pre-rename key", () => {
		window.localStorage.setItem("ccez-studio-annotations-v1", JSON.stringify({ c1: [ann()] }));
		expect(loadDraftAnnotations("c1")).toEqual([ann()]);
	});
});

describe("quoteRange", () => {
	it("returns a range spanning the quote text", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>Kyoto in <em>spring</em> is lovely</p>";
		document.body.appendChild(root);
		const range = quoteRange(root, "spring is");
		expect(range?.toString()).toBe("spring is");
		root.remove();
	});

	it("returns null when the quote is absent", () => {
		const root = document.createElement("div");
		root.textContent = "nothing here";
		document.body.appendChild(root);
		expect(quoteRange(root, "osaka")).toBeNull();
		root.remove();
	});

	it("skips badge numbers like badge stamping does", () => {
		const root = document.createElement("div");
		root.innerHTML = '<p>Kyoto<button data-ann-badge="a1">1</button> in spring</p>';
		document.body.appendChild(root);
		// Without the skip the "1" fuses the haystack ("Kyoto1 in…")
		// and nothing matches: endpoints on either side prove it.
		const range = quoteRange(root, "Kyoto in spring");
		expect(range?.startContainer.textContent).toBe("Kyoto");
		expect(range?.endContainer.textContent).toBe(" in spring");
		root.remove();
	});

	it("locates a quote split by a stamped badge anchor", () => {
		const root = document.createElement("div");
		// A mid-quote anchor leaves the last node short while the
		// first runs long: end offsets must stay in their own node,
		// or setEnd overshoots and the range throws to null (the
		// sent-jump flash never painted).
		root.innerHTML =
			'<p>Paragraph 0. wo<span class="ccez-ann-anchor">r<button data-ann-badge="a1">1</button></span>d here.</p>';
		document.body.appendChild(root);
		const range = quoteRange(root, "word");
		expect(range?.startContainer.textContent).toBe("Paragraph 0. wo");
		expect(range?.endContainer.textContent).toBe("d here.");
		root.remove();
	});
});

describe("wrapRangeInMark / unwrapMark", () => {
	it("wraps a mid-node range, keeping the text", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>The quick brown fox</p>";
		document.body.appendChild(root);
		const range = quoteRange(root, "quick brown")!;
		const mark = wrapRangeInMark(range, "ccez-ann-flash");
		expect(mark?.tagName).toBe("MARK");
		expect(mark?.className).toBe("ccez-ann-flash");
		expect(mark?.textContent).toBe("quick brown");
		expect(root.textContent).toBe("The quick brown fox");
		unwrapMark(mark!);
		expect(root.querySelector("mark")).toBeNull();
		expect(root.textContent).toBe("The quick brown fox");
		root.remove();
	});

	it("wraps ranges spanning elements without throwing", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>Kyoto <strong>in spring</strong> and more</p>";
		document.body.appendChild(root);
		const range = quoteRange(root, "Kyoto in spring")!;
		const mark = wrapRangeInMark(range, "ccez-ann-flash");
		expect(mark?.textContent).toBe("Kyoto in spring");
		unwrapMark(mark!);
		expect(root.textContent).toBe("Kyoto in spring and more");
		root.remove();
	});

	it("refuses a range collapsed by a removal", () => {
		const root = document.createElement("div");
		root.textContent = "gone after rerender";
		document.body.appendChild(root);
		const range = document.createRange();
		range.selectNodeContents(root);
		root.remove();
		// The removal collapses the range to (parent, index): wrapping
		// that would plant an empty live mark, so it refuses and the
		// document stays clean for the next blink phase.
		expect(wrapRangeInMark(range, "ccez-ann-flash")).toBeNull();
		expect(document.querySelector("mark")).toBeNull();
	});

	it("unwrap tolerates an already-dropped mark", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>plain</p>";
		document.body.appendChild(root);
		const orphan = document.createElement("mark");
		orphan.textContent = "ghost";
		expect(() => unwrapMark(orphan)).not.toThrow();
		root.remove();
	});
});

describe("wrapRangeExcludingBadges", () => {
	it("carves out the badge anchor: the marker never moves", () => {
		const root = document.createElement("div");
		root.innerHTML =
			'<p>Paragraph 0. wo<span class="ccez-ann-anchor">r<button data-ann-badge="a1">1</button></span>d here.</p>';
		document.body.appendChild(root);
		const badge = root.querySelector('[data-ann-badge="a1"]')!;
		const anchor = badge.parentElement!;
		const range = quoteRange(root, "word")!;
		const marks = wrapRangeExcludingBadges(range, "ccez-ann-flash");
		// Text runs on both sides flash, the badge label never does
		// (marks paint back-to-front, so order is positional, not
		// document).
		expect(marks).toHaveLength(2);
		expect(new Set(marks.map((m) => m.textContent))).toEqual(new Set(["wor", "d"]));
		for (const mark of marks) {
			expect(mark.querySelector("[data-ann-badge]")).toBeNull();
		}
		// Same badge node, same anchor, anchor outside every mark.
		expect(root.querySelector('[data-ann-badge="a1"]')).toBe(badge);
		expect(badge.parentElement).toBe(anchor);
		expect(anchor.closest("mark")).toBeNull();
		for (const mark of marks) unwrapMark(mark);
		expect(root.querySelector("mark")).toBeNull();
		expect(root.querySelector('[data-ann-badge="a1"]')).toBe(badge);
		// textContent counts the badge's own "1" label: quote text
		// plus marker, exactly as mounted.
		expect(root.textContent).toBe("Paragraph 0. wor1d here.");
		root.remove();
	});

	it("wraps a badge-free range in one mark", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>The quick brown fox</p>";
		document.body.appendChild(root);
		const range = quoteRange(root, "quick brown")!;
		const marks = wrapRangeExcludingBadges(range, "ccez-ann-flash");
		expect(marks).toHaveLength(1);
		expect(marks[0]?.textContent).toBe("quick brown");
		unwrapMark(marks[0]!);
		expect(root.textContent).toBe("The quick brown fox");
		root.remove();
	});

	it("paints nothing for a collapsed range", () => {
		const root = document.createElement("div");
		root.textContent = "gone after rerender";
		document.body.appendChild(root);
		const range = document.createRange();
		range.selectNodeContents(root);
		root.remove();
		expect(wrapRangeExcludingBadges(range, "ccez-ann-flash")).toEqual([]);
	});
});
