// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	applyMarks,
	annotationCountLabel,
	edgeOffsetForAnchor,
	gapOffsetForAnchor,
	locateQuote,
	lockSelectionToMessage,
	saveSelection,
	restoreSelection,
	WASH_FADE_MS,
	type AnnotationMark,
	type AnnotationId
} from "./annotations";
import {
	ANN_HIGHLIGHT_D1,
	ANN_HIGHLIGHT_NAME,
	paintAnnotationWash
} from "./annHighlights";

function rootWith(text: string): HTMLDivElement {
	const root = document.createElement("div");
	root.textContent = text;
	return root;
}

/** Base text only: badges and readings are overlay, never content. */
function baseText(root: Element): string {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const parts: string[] = [];
	while (walker.nextNode()) {
		const node = walker.currentNode;
		const parent = node.parentNode;
		if (parent instanceof Element && parent.closest("[data-ann-badge], rt, rp, .frt")) {
			continue;
		}
		parts.push(node.textContent ?? "");
	}
	return parts.join("");
}

describe("applyMarks badges", () => {
	it("fades only newly stamped badges", () => {
		const marks: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: "hello world" }];
		const root = rootWith("say hello world today");
		applyMarks(root, marks, false, null);
		const first = root.querySelector("[data-ann-badge]");
		expect(first?.classList.contains("fresh")).toBe(true);

		// Re-stamping the same marks (every render does this) keeps the
		// badge but must not replay the mount fade.
		applyMarks(root, marks, false, null);
		const badges = root.querySelectorAll("[data-ann-badge]");
		expect(badges).toHaveLength(1);
		expect(badges[0]?.classList.contains("fresh")).toBe(false);
	});

	it("marks a second quote fresh while the first stays settled", () => {
		const root = rootWith("alpha and beta");
		applyMarks(root, [{ id: "a1" as AnnotationId, number: 1, quote: "alpha" }], false, null);
		applyMarks(
			root,
			[
				{ id: "a1" as AnnotationId, number: 1, quote: "alpha" },
				{ id: "a2" as AnnotationId, number: 2, quote: "beta" }
			],
			false,
			null
		);
		const byId = (id: string) => root.querySelector(`[data-ann-badge="${id}"]`);
		expect(byId("a1")?.classList.contains("fresh")).toBe(false);
		expect(byId("a2")?.classList.contains("fresh")).toBe(true);
	});
});

describe("applyMarks wash fade", () => {
	const one: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: "hello world" }];

	it("fades a newly arrived wash in once, not on re-stamp", () => {
		const root = rootWith("say hello world today");
		applyMarks(root, one, false, "a1");
		expect(root.querySelector("mark.ccez-ann")?.classList.contains("fresh")).toBe(true);

		// Re-stamping a steady wash (every render does this) keeps the
		// marks but must not replay the mount fade.
		applyMarks(root, one, false, "a1");
		const marks = root.querySelectorAll("mark.ccez-ann");
		expect(marks).toHaveLength(1);
		expect(marks[0]?.classList.contains("fresh")).toBe(false);
	});

	it("fades the wash out on clear, then unwraps", () => {
		vi.useFakeTimers();
		try {
			const root = rootWith("say hello world today");
			applyMarks(root, one, false, "a1");
			expect(root.querySelector("mark.ccez-ann")).not.toBeNull();

			applyMarks(root, one, false, null);
			// Still mounted (fading), text intact underneath (badges are
			// overlay: baseText, not raw textContent, is the assertion).
			const leaving = root.querySelector("mark.ccez-ann");
			expect(leaving?.classList.contains("leaving")).toBe(true);
			expect(baseText(root)).toContain("hello world");

			vi.advanceTimersByTime(WASH_FADE_MS);
			expect(root.querySelector("mark.ccez-ann")).toBeNull();
			expect(baseText(root)).toContain("hello world");
		} finally {
			vi.useRealTimers();
		}
	});

	it("a superseding wash unwraps a fading mark immediately", () => {
		vi.useFakeTimers();
		try {
			const root = rootWith("alpha and beta");
			const two: AnnotationMark[] = [
				{ id: "a1" as AnnotationId, number: 1, quote: "alpha" },
				{ id: "a2" as AnnotationId, number: 2, quote: "beta" }
			];
			applyMarks(root, two, false, "a1");
			applyMarks(root, two, false, null);
			expect(root.querySelector("mark.ccez-ann")?.classList.contains("leaving")).toBe(true);

			applyMarks(root, two, false, "a2");
			const marks = root.querySelectorAll("mark.ccez-ann");
			expect(marks).toHaveLength(1);
			expect(marks[0]?.classList.contains("leaving")).toBe(false);

			// The stale fade-out timer no-ops on the detached node.
			vi.advanceTimersByTime(WASH_FADE_MS * 3);
			expect(root.querySelectorAll("mark.ccez-ann")).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("applyMarks badges over reading overlays", () => {
	function readingBody(): HTMLDivElement {
		const root = document.createElement("div");
		root.innerHTML = '<p><span class="frb">漢字<span class="frt">かんじ</span></span>を読む</p>';
		return root;
	}

	const one: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: "漢字を読む" }];

	it("floats the badge on an anchor instead of inline text", () => {
		const root = readingBody();
		applyMarks(root, one, false, null);
		const badge = root.querySelector("[data-ann-badge]");
		expect(badge?.textContent).toBe("1");
		// The badge never lands inside a reading base; it rides a
		// positioned anchor at the quote's middle.
		expect(badge?.closest(".frb")).toBeNull();
		const anchor = badge?.parentElement;
		expect(anchor?.classList.contains("ccez-ann-anchor")).toBe(true);
		// Spaceless quote: the anchor parks after the quote holding
		// no letters (the badge's own label is UI, never wash text).
		const letterKids = [...(anchor?.childNodes ?? [])].filter((n) => n instanceof Text);
		expect(letterKids).toEqual([]);
		// Stamping moved nothing: base text and readings intact.
		expect(baseText(root)).toBe("漢字を読む");
		expect(root.querySelector(".frt")?.textContent).toBe("かんじ");
	});

	it("washes a preview without stamping its badge", () => {
		const root = rootWith("say hello world today");
		const preview: AnnotationMark[] = [
			{ id: "a1" as AnnotationId, number: 1, quote: "hello world", preview: true }
		];
		// Open (wash id matches): the quote highlights, no badge yet.
		applyMarks(root, preview, false, "a1");
		expect(root.querySelector("mark.ccez-ann")).not.toBeNull();
		expect(root.querySelector("[data-ann-badge]")).toBeNull();
		// Not open: the wash fades out, still no badge.
		applyMarks(root, preview, false, null);
		expect(root.querySelector("mark.ccez-ann.leaving")).not.toBeNull();
		expect(root.querySelector("[data-ann-badge]")).toBeNull();
		expect(root.textContent).toBe("say hello world today");
	});

	it("never matches a reading as message text", () => {
		const root = readingBody();
		applyMarks(root, [{ id: "a1" as AnnotationId, number: 1, quote: "かんじ" }], false, null);
		expect(root.querySelector("[data-ann-badge]")).toBeNull();
		expect(root.querySelector(".frt")?.textContent).toBe("かんじ");
	});

	it("re-stamping unwraps anchors without accumulating", () => {
		const root = readingBody();
		applyMarks(root, one, false, null);
		applyMarks(root, one, false, null);
		expect(root.querySelectorAll("[data-ann-badge]")).toHaveLength(1);
		expect(root.querySelectorAll(".ccez-ann-anchor")).toHaveLength(1);
		expect(baseText(root)).toBe("漢字を読む");
	});

	it("anchors inside the wash region over readings", () => {
		const root = readingBody();
		applyMarks(root, one, false, "a1");
		const badge = root.querySelector("[data-ann-badge]");
		// Same quote-edge anchor as the unwashed state (hovering the
		// wash on and off never moves the badge); nested in the wash
		// marks. Spaceless quote: the anchor parks after the quote,
		// still inside the wash marks.
		const washAnchor = root.querySelector(".ccez-ann-anchor");
		expect(badge?.parentElement).toBe(washAnchor);
		expect(badge?.closest("mark.ccez-ann")).not.toBeNull();
		expect(baseText(root)).toBe("漢字を読む");
		expect(root.querySelector(".frt")?.textContent).toBe("かんじ");
	});

	it("parks a spaced quote in a word gap, wrapping no letters", () => {
		const root = rootWith("say hello world today");
		applyMarks(root, [{ id: "a1" as AnnotationId, number: 1, quote: "hello world" }], false, null);
		const badge = root.querySelector("[data-ann-badge]");
		const anchor = root.querySelector(".ccez-ann-anchor");
		expect(badge?.parentElement).toBe(anchor);
		// No letters live in the box (the badge's own label is UI,
		// never wash text): nothing to paint short.
		const letterKids = [...(anchor?.childNodes ?? [])].filter((n) => n instanceof Text);
		expect(letterKids).toEqual([]);
		expect(baseText(root)).toBe("say hello world today");
	});

	it("mirrors the badge for RTL quotes, nowhere else", () => {
		const rtl = document.createElement("div");
		rtl.innerHTML = '<p dir="rtl">قال اليوم مودعا</p>';
		applyMarks(rtl, [{ id: "a1" as AnnotationId, number: 1, quote: "اليوم" }], false, null);
		expect(rtl.querySelector("[data-ann-badge]")?.classList.contains("rtl")).toBe(true);
		const ltr = rootWith("say hello world today");
		applyMarks(ltr, [{ id: "a1" as AnnotationId, number: 1, quote: "world" }], false, null);
		expect(ltr.querySelector("[data-ann-badge]")?.classList.contains("rtl")).toBe(false);
	});

	it("parks a lone word in its neighboring gap", () => {
		const root = rootWith("say hello world today");
		applyMarks(root, [{ id: "a1" as AnnotationId, number: 1, quote: "world" }], false, null);
		const anchor = root.querySelector(".ccez-ann-anchor");
		const letterKids = [...(anchor?.childNodes ?? [])].filter((n) => n instanceof Text);
		expect(letterKids).toEqual([]);
		// After the word (ties prefer later): the fence edges sit on
		// the word's own boundaries.
		expect(anchor?.previousSibling?.textContent).toContain("world");
		expect(baseText(root)).toBe("say hello world today");
	});
});

describe("gapOffsetForAnchor", () => {
	it("picks the word gap nearest the middle", () => {
		expect(gapOffsetForAnchor("hello world")).toBe(6);
		expect(gapOffsetForAnchor("hi to you")).toBe(5);
	});

	it("parks a lone word after itself", () => {
		expect(gapOffsetForAnchor("world")).toBe(5);
		expect(gapOffsetForAnchor("hi")).toBe(2);
	});

	it("never borders a combining mark", () => {
		// a + combining acute + b, then a spaced word: the only
		// nearby clean gap is the space, not either side of the mark.
		expect(gapOffsetForAnchor("áb c")).toBe(3);
	});

	it("finds no gap in spaceless or empty text", () => {
		expect(gapOffsetForAnchor("漢字を読む")).toBeNull();
		expect(gapOffsetForAnchor("")).toBeNull();
	});
});

describe("edgeOffsetForAnchor", () => {
	it("parks a lone spaceless quote after itself", () => {
		expect(edgeOffsetForAnchor("読む午")).toBe(3);
		expect(edgeOffsetForAnchor("漢字を読む")).toBe(5);
	});

	it("prefers punctuation nearest the middle", () => {
		expect(edgeOffsetForAnchor("一年の中でも、この短い")).toBe(6);
	});

	it("never borders a combining mark", () => {
		expect(edgeOffsetForAnchor("áb")).toBe(3);
	});

	it("finds no edge in empty text", () => {
		expect(edgeOffsetForAnchor("")).toBeNull();
	});

	it("wraps no letters on a spaceless stamp", () => {
		const root = rootWith("に本を読む午後の時間は");
		applyMarks(root, [{ id: "a1" as AnnotationId, number: 1, quote: "読む午" }], false, null);
		const anchor = root.querySelector(".ccez-ann-anchor");
		const letterKids = [...(anchor?.childNodes ?? [])].filter((n) => n instanceof Text);
		expect(letterKids).toEqual([]);
		expect(baseText(root)).toBe("に本を読む午後の時間は");
	});
});

describe("lockSelectionToMessage", () => {
	function twoArticles(): HTMLElement {
		const root = document.createElement("div");
		root.innerHTML =
			'<article id="msg-0"><p>first message here</p></article>' +
			'<article id="msg-1"><p>second message here</p></article>';
		document.body.append(root);
		return root;
	}

	const articleOf = (node: Node | null): Element | null => {
		const el = node instanceof Element ? node : node?.parentElement;
		return el?.closest("article") ?? null;
	};

	it("trims a drag crossing into the next message", () => {
		const root = twoArticles();
		try {
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const first = root.querySelector("#msg-0 p")?.firstChild;
			const second = root.querySelector("#msg-1 p")?.firstChild;
			if (!first || !second) throw new Error("no text nodes");
			sel.setBaseAndExtent(first, 0, second, 6);
			expect(lockSelectionToMessage(sel, articleOf)).toBe(true);
			expect(sel.focusNode === first || first.contains(sel.focusNode)).toBe(true);
			expect(sel.toString()).toBe("first message here");
		} finally {
			root.remove();
			document.getSelection()?.removeAllRanges();
		}
	});

	it("trims a drag reaching up into the previous message", () => {
		const root = twoArticles();
		try {
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const first = root.querySelector("#msg-0 p")?.firstChild;
			const second = root.querySelector("#msg-1 p")?.firstChild;
			if (!first || !second) throw new Error("no text nodes");
			sel.setBaseAndExtent(second, 6, first, 0);
			expect(lockSelectionToMessage(sel, articleOf)).toBe(true);
			expect(sel.toString()).toBe("second");
		} finally {
			root.remove();
			document.getSelection()?.removeAllRanges();
		}
	});

	it("trims a focus that escapes below every message (prompt editor)", () => {
		const root = document.createElement("div");
		root.innerHTML =
			'<article id="msg-0"><div class="rendered"><p>first message here</p></div>' +
			'<div class="actions"><button>読み仮名</button></div></article>' +
			'<div id="composer" contenteditable="true"><p>prompt</p></div>';
		document.body.append(root);
		try {
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const first = root.querySelector("#msg-0 p")?.firstChild;
			const outside = root.querySelector("#composer p")?.firstChild;
			if (!first || !outside) throw new Error("no text nodes");
			// Double-click past a line's end stretches into the editor;
			// the trim must stop at the prose edge, never bake the aid
			// button's label into the selection.
			sel.setBaseAndExtent(first, 18, outside, 0);
			expect(lockSelectionToMessage(sel, articleOf)).toBe(true);
			expect(sel.focusNode === first || first.contains(sel.focusNode)).toBe(true);
			expect(sel.toString()).toBe("");
		} finally {
			root.remove();
			document.getSelection()?.removeAllRanges();
		}
	});

	it("trims a focus that escapes above every message", () => {
		const root = document.createElement("div");
		root.innerHTML =
			'<header>app header</header><article id="msg-0"><p>first message here</p></article>';
		document.body.append(root);
		try {
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const header = root.querySelector("header")?.firstChild;
			const first = root.querySelector("#msg-0 p")?.firstChild;
			if (!header || !first) throw new Error("no text nodes");
			sel.setBaseAndExtent(first, 5, header, 0);
			expect(lockSelectionToMessage(sel, articleOf)).toBe(true);
			expect(sel.toString()).toBe("first");
		} finally {
			root.remove();
			document.getSelection()?.removeAllRanges();
		}
	});

	it("leaves collapsed and single-message selections alone", () => {
		const root = twoArticles();
		try {
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const first = root.querySelector("#msg-0 p")?.firstChild;
			if (!first) throw new Error("no text nodes");
			sel.setBaseAndExtent(first, 0, first, 0);
			expect(lockSelectionToMessage(sel, articleOf)).toBe(false);
			sel.setBaseAndExtent(first, 0, first, 5);
			expect(lockSelectionToMessage(sel, articleOf)).toBe(false);
			expect(sel.toString()).toBe("first");
		} finally {
			root.remove();
			document.getSelection()?.removeAllRanges();
		}
	});
});

describe("applyMarks wash over paragraphs", () => {
	function twoParagraphs(): HTMLDivElement {
		const root = document.createElement("div");
		root.innerHTML = "<p>alpha here</p>\n<p>beta here</p>";
		document.body.append(root);
		return root;
	}

	it("never wraps the whitespace between block elements", () => {
		const root = twoParagraphs();
		try {
			const marks: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: "alpha here\n\nbeta here" }];
			applyMarks(root, marks, false, "a1");
			const wrapped = [...root.querySelectorAll("mark.ccez-ann")];
			// One wash per paragraph: the "\n" gap stays unwrapped so no
			// empty line box paints between the paragraphs.
			expect(wrapped).toHaveLength(2);
			for (const mark of wrapped) expect(mark.textContent).toMatch(/\S/);
			// baseText, not raw textContent: the badge number is overlay.
			expect(baseText(root)).toBe("alpha here\nbeta here");
		} finally {
			root.remove();
		}
	});

	it("restores a highlight after its nodes are replaced", () => {
		const root = twoParagraphs();
		try {
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const first = root.querySelector("p")?.firstChild;
			const last = root.querySelectorAll("p")[1]?.firstChild;
			if (!(first instanceof Text) || !(last instanceof Text)) throw new Error("no text nodes");
			// Right-to-left drag: direction must survive the round trip.
			sel.setBaseAndExtent(last, 4, first, 6);
			expect(sel.toString()).toBe("here\nbeta");
			const saved = saveSelection(root);
			if (!saved) throw new Error("no snapshot");
			expect(saved.backwards).toBe(true);
			// The wash-off unwrap swaps every text node for a fresh one
			// with the same text: endpoints detach in every engine.
			root.querySelectorAll("p").forEach((p) => {
				p.replaceChildren(document.createTextNode(p.textContent ?? ""));
			});
			restoreSelection(root, saved);
			expect(sel.toString()).toBe("here\nbeta");
			// Anchor stays where the drag started (the later node).
			const after = root.querySelectorAll("p")[1]?.firstChild;
			expect(sel.anchorNode).toBe(after);
			expect(sel.anchorOffset).toBe(4);
		} finally {
			root.remove();
			document.getSelection()?.removeAllRanges();
		}
	});

	it("reuses badge buttons across re-stamps", () => {
		const marks: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: "alpha" }];
		const root = rootWith("alpha and beta");
		applyMarks(root, marks, false, null);
		const first = root.querySelector("[data-ann-badge]");
		if (!(first instanceof HTMLButtonElement)) throw new Error("no badge");
		// A wash re-stamp (hover on) must keep the very same node: a
		// swapped node fires mouseout/mouseover under a still cursor
		// and stacked badges oscillate.
		applyMarks(root, marks, false, "a1");
		expect(root.querySelector("[data-ann-badge]")).toBe(first);
		applyMarks(root, marks, false, null);
		expect(root.querySelector("[data-ann-badge]")).toBe(first);
	});

	it("snapshots nothing for carets and outside selections", () => {
		const root = twoParagraphs();
		const outsider = document.createElement("div");
		outsider.textContent = "elsewhere";
		document.body.append(outsider);
		try {
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const first = root.querySelector("p")?.firstChild;
			if (!(first instanceof Text)) throw new Error("no text nodes");
			sel.setBaseAndExtent(first, 0, first, 0);
			expect(saveSelection(root)).toBeNull();
			const away = outsider.firstChild;
			if (!(away instanceof Text)) throw new Error("no outsider text");
			sel.setBaseAndExtent(away, 0, away, 4);
			expect(saveSelection(root)).toBeNull();
		} finally {
			root.remove();
			outsider.remove();
			document.getSelection()?.removeAllRanges();
		}
	});

	it("defers the fade-out unwrap while a highlight is live", () => {
		vi.useFakeTimers();
		const root = twoParagraphs();
		try {
			const marks: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: "alpha here" }];
			applyMarks(root, marks, false, "a1");
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const first = root.querySelector("p mark")?.firstChild;
			if (!(first instanceof Text)) throw new Error("no text nodes");
			sel.setBaseAndExtent(first, 0, first, 5);
			applyMarks(root, marks, false, null);
			// The fade timer must not pull the range's nodes out: the
			// transparent mark stays until a later stamp cleans it up.
			vi.advanceTimersByTime(WASH_FADE_MS);
			expect(root.querySelector("mark.ccez-ann.leaving")).not.toBeNull();
			expect(sel.toString()).toBe("alpha");
			// Highlight gone: the next stamp unwraps it synchronously.
			sel.removeAllRanges();
			applyMarks(root, marks, false, null);
			vi.advanceTimersByTime(WASH_FADE_MS);
			expect(root.querySelector("mark.ccez-ann")).toBeNull();
		} finally {
			root.remove();
			document.getSelection()?.removeAllRanges();
			vi.useRealTimers();
		}
	});
});

describe("annotationCountLabel", () => {
	it("shows the number, capped at 99+", () => {
		expect(annotationCountLabel(0)).toBe("0");
		expect(annotationCountLabel(1)).toBe("1");
		expect(annotationCountLabel(99)).toBe("99");
		expect(annotationCountLabel(100)).toBe("99+");
		expect(annotationCountLabel(1234)).toBe("99+");
	});
});

describe("tashkeel-anchored marks", () => {
	// Same words, bare vs vocalized: markers anchor to the base text
	// and must survive the aid toggle either way.
	const BASE = "مرحبا بك";
	const VOCALIZED = "مَرحَبًا بِكَ";

	it("locates a vocalized quote in bare base text", () => {
		expect(locateQuote([BASE], VOCALIZED)).not.toBeNull();
	});

	it("locates a bare quote in vocalized text", () => {
		expect(locateQuote([VOCALIZED], BASE)).not.toBeNull();
	});

	it("keeps the badge when tashkeel is removed (aid unpinned)", () => {
		const marks: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: VOCALIZED }];
		const root = rootWith(VOCALIZED);
		applyMarks(root, marks, false, null);
		expect(root.querySelector("[data-ann-badge]")).not.toBeNull();
		// Unpinning the aid swaps the body back to the bare base text;
		// the re-stamp must re-anchor instead of dropping the badge.
		root.textContent = BASE;
		applyMarks(root, marks, false, null);
		expect(root.querySelector("[data-ann-badge]")).not.toBeNull();
		expect(baseText(root)).toBe(BASE);
	});

	it("keeps the badge when tashkeel is applied (aid pinned)", () => {
		const marks: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: BASE }];
		const root = rootWith(BASE);
		applyMarks(root, marks, false, null);
		expect(root.querySelector("[data-ann-badge]")).not.toBeNull();
		root.textContent = VOCALIZED;
		applyMarks(root, marks, false, null);
		expect(root.querySelector("[data-ann-badge]")).not.toBeNull();
		expect(baseText(root)).toBe(VOCALIZED);
	});

	it("stamps a vocalized quote onto aid-rendered base paragraphs", () => {
		// The pinyin path renders plain paragraphs (markdown set aside);
		// an Arabic annotation must persist across that toggle too.
		const root = document.createElement("div");
		root.innerHTML = "<p dir=\"auto\">مرحبا بك</p>";
		applyMarks(root, [{ id: "a1" as AnnotationId, number: 1, quote: VOCALIZED }], false, null);
		expect(root.querySelector("[data-ann-badge]")).not.toBeNull();
		expect(baseText(root)).toBe(BASE);
	});
});

describe("grapheme-cluster-safe stamping", () => {
	const VOCALIZED = "مَرحَبًا بِكَ";

	/** Text nodes starting with a combining mark: a split cluster. */
	function strandedMarks(root: Element): string[] {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const bad: string[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode;
			const parent = node.parentNode;
			if (parent instanceof Element && parent.closest("[data-ann-badge], rt, rp, .frt")) continue;
			const text = node.textContent ?? "";
			if (/^[\p{Mn}\p{Me}]/u.test(text)) bad.push(text);
		}
		return bad;
	}

	it("never splits a base letter from its tashkeel (wash on)", () => {
		const root = rootWith(`قال ${VOCALIZED} اليوم`);
		applyMarks(root, [{ id: "a1" as AnnotationId, number: 1, quote: VOCALIZED }], false, "a1");
		expect(strandedMarks(root)).toEqual([]);
	});

	it("wraps a partial bare quote over vocalized text without splitting", () => {
		const root = rootWith(VOCALIZED);
		// Bare "مرحب" ends on a base letter carrying a mark in the
		// node: the wash must expand to the cluster end, not cut it.
		applyMarks(root, [{ id: "a1" as AnnotationId, number: 1, quote: "مرحب" }], false, "a1");
		expect(root.querySelector("mark.ccez-ann")).not.toBeNull();
		expect(strandedMarks(root)).toEqual([]);
	});

	it("rebuild preserves shaping: wash off restores the exact base text", () => {
		const original = `قال ${VOCALIZED} اليوم`;
		const root = rootWith(original);
		const marks: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: VOCALIZED }];
		applyMarks(root, marks, false, "a1");
		applyMarks(root, marks, false, null);
		expect(baseText(root)).toBe(original);
		expect(strandedMarks(root)).toEqual([]);
	});
});

describe("refresh sweep of orphaned fade grades (Highlight path)", () => {
	/** Minimal CSS.highlights stand-in: jsdom has no Highlight API. */
	class MockHighlight extends Array<Range> {
		constructor(...ranges: Range[]) {
			super(...ranges);
		}
	}

	let store: Map<string, unknown>;

	beforeEach(() => {
		store = new Map<string, unknown>();
		vi.stubGlobal("Highlight", MockHighlight);
		vi.stubGlobal("CSS", {
			highlights: {
				set(name: string, highlight: object): void {
					store.set(name, highlight);
				},
				delete(name: string): void {
					store.delete(name);
				},
				get(name: string): object | undefined {
					return store.get(name) as object | undefined;
				}
			}
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("a re-stamp clears a stranded dim grade beside the live wash", () => {
		const root = rootWith("say hello world today");
		const marks: AnnotationMark[] = [{ id: "w1" as AnnotationId, number: 1, quote: "hello world" }];
		applyMarks(root, marks, false, "w1");
		expect(store.get(ANN_HIGHLIGHT_NAME)).toBeDefined();
		// A preempted ramp's dim grade, stranded in the registry.
		const stray = document.createRange();
		stray.selectNodeContents(root);
		paintAnnotationWash([stray], ANN_HIGHLIGHT_D1);
		expect(store.get(ANN_HIGHLIGHT_D1)).toBeDefined();
		// Shift the text so the re-stamp relocates the wash.
		root.insertBefore(document.createTextNode("well, "), root.firstChild);
		applyMarks(root, marks, false, "w1");
		// Live wash repainted, orphan grade swept: no dim twin survives.
		expect(store.get(ANN_HIGHLIGHT_NAME)).toBeDefined();
		expect(store.get(ANN_HIGHLIGHT_D1)).toBeUndefined();
	});

	it("forces every fade step to display, not just the settle", () => {
		// Motion allowed so the arrival takes the graded ramp.
		vi.stubGlobal("matchMedia", () => ({ matches: false }));
		try {
			vi.useFakeTimers();
			const root = rootWith("say hello world today");
			let nudges = 0;
			const orig = root.style.setProperty.bind(root.style);
			root.style.setProperty = (prop, value, priority) => {
				if (prop === "opacity") nudges += 1;
				return orig(prop, value, priority);
			};
			const marks: AnnotationMark[] = [{ id: "s9" as AnnotationId, number: 1, quote: "hello world" }];
			applyMarks(root, marks, false, "s9");
			// First grade plus one nudge per walked step: un-nudged
			// steps surface late and partial in the shell (bands).
			vi.advanceTimersByTime(35);
			vi.advanceTimersByTime(35);
			vi.advanceTimersByTime(500);
			expect(nudges).toBeGreaterThanOrEqual(3);
			expect(store.get(ANN_HIGHLIGHT_NAME)).toBeDefined();
			expect(store.get(ANN_HIGHLIGHT_D1)).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});
