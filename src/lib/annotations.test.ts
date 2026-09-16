import { describe, it, expect } from "vitest";
import {
	addAnnotation,
	duplicateAnnotationId,
	editAnnotationComment,
	deleteAnnotation,
	clearAnnotations,
	annotationNumber,
	formatAnnotations,
	withAnnotations,
	rewriteAnnotationComment,
	findQuotedMessage,
	splitAnnotationBlock,
	locateQuote,
	occurrenceAtPosition,
	snapOffsetsToWordEdges,
	placeAnnPopX,
	selMenuPlacement,
	lineStartOffset,
	clampDragAnchorToFocusLine,
	reviewEditKey,
	REFS_ONLY_BODY,
	isRefsOnly,
	redactedCopyText
} from "./annotations";
import type { ChatMsgId } from "./chat";
import type { AnnotationId } from "./annotations";

describe("annotations", () => {
	it("adds, edits, deletes, and clears", () => {
		let list = addAnnotation([], "m1" as ChatMsgId, "  langue  ", "What does this mean?");
		expect(list).toHaveLength(1);
		expect(list[0]?.quote).toBe("langue");
		expect(list[0]?.messageId).toBe("m1");

		// Blank quotes are ignored.
		list = addAnnotation(list, "m1" as ChatMsgId, "   ");
		expect(list).toHaveLength(1);

		list = editAnnotationComment(list, list[0]!.id, "edited");
		expect(list[0]?.comment).toBe("edited");

		list = deleteAnnotation(list, list[0]!.id);
		expect(list).toEqual([]);

		list = addAnnotation(addAnnotation([], "m1" as ChatMsgId, "a"), "m2" as ChatMsgId, "b");
		expect(clearAnnotations()).toEqual([]);
		expect(annotationNumber(list, list[1]!.id)).toBe(2);
		expect(annotationNumber(list, "missing" as AnnotationId)).toBe(0);
	});

	it("formats numbered quote/comment pairs for the prompt", () => {
		const list = addAnnotation(
			addAnnotation([], "m1" as ChatMsgId, "langue", "What does this mean?"),
			"m1" as ChatMsgId,
			"alphabet"
		);
		expect(formatAnnotations(list)).toBe(
			'1. "langue" — What does this mean?\n2. "alphabet" — ?'
		);
	});

	it("wraps annotations into the outgoing prompt", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		expect(withAnnotations("explain", list)).toBe(
			'explain\n\nAnnotated selections:\n1. "langue" — meaning?'
		);
		expect(withAnnotations("", list)).toBe('Annotated selections:\n1. "langue" — meaning?');
		expect(withAnnotations("explain", [])).toBe("explain");
	});

	it("round-trips baked blocks back into text plus refs", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		const withTwo: typeof list = [
			...list,
			{
				id: "a2" as AnnotationId,
				messageId: "m1" as ChatMsgId,
				quote: "alphabet",
				comment: ""
			}
		];
		const split = splitAnnotationBlock(withAnnotations("explain", withTwo));
		expect(split?.text).toBe("explain");
		expect(split?.refs).toEqual([
			{ n: 1, quote: "langue", comment: "meaning?" },
			{ n: 2, quote: "alphabet", comment: "?" }
		]);
	});

	it("leaves normal messages and lookalikes untouched", () => {
		expect(splitAnnotationBlock("just a prompt")).toBeNull();
		expect(splitAnnotationBlock("explain\n\nAnnotated selections:\n")).toBeNull();
		expect(splitAnnotationBlock("I typed\n\nAnnotated selections:\nnot a list")).toBeNull();
	});

	it("parses an annotations-only message to empty text plus refs", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "風に舞う", "What does this mean?");
		const split = splitAnnotationBlock(withAnnotations("", list));
		expect(split?.text).toBe("");
		expect(split?.refs).toEqual([{ n: 1, quote: "風に舞う", comment: "What does this mean?" }]);
	});
});

describe("rewriteAnnotationComment", () => {
	const baked = 'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?\n2. "merci" — ?';

	it("swaps one ref's comment and keeps the rest", () => {
		expect(rewriteAnnotationComment(baked, 2, "thanks")).toBe(
			'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?\n2. "merci" — thanks'
		);
	});

	it("rebakes byte-for-byte when the comment is unchanged", () => {
		expect(rewriteAnnotationComment(baked, 1, "greeting?")).toBe(baked);
	});

	it("files an empty comment as the ? marker, like the bake", () => {
		expect(rewriteAnnotationComment(baked, 1, "  ")).toBe(
			'explain this\n\nAnnotated selections:\n1. "bonjour" — ?\n2. "merci" — ?'
		);
	});

	it("keeps the refs-only shape (no prompt text, no leading blank)", () => {
		const only = 'Annotated selections:\n1. "bonjour" — greeting?';
		expect(rewriteAnnotationComment(only, 1, "hi")).toBe('Annotated selections:\n1. "bonjour" — hi');
	});

	it("returns null for a missing number or no clean block", () => {
		expect(rewriteAnnotationComment(baked, 9, "x")).toBeNull();
		expect(rewriteAnnotationComment("just a prompt", 1, "x")).toBeNull();
	});
});

describe("duplicateAnnotationId", () => {
	it("finds the same span and ignores neighbors", () => {
		const msg = "m1" as ChatMsgId;
		const list = addAnnotation(addAnnotation([], msg, "Kyoto", "old capital"), msg, "Osaka");
		const kyoto = list[0];
		if (!kyoto) throw new Error("no annotation");
		// Same message, quote, and repeat: a twin.
		expect(duplicateAnnotationId(list, msg, "  Kyoto ", 0)).toBe(kyoto.id);
		// A different repeat of the same text is its own span.
		expect(duplicateAnnotationId(list, msg, "Kyoto", 2)).toBeNull();
		// Same quote in another message is unrelated.
		expect(duplicateAnnotationId(list, "m2" as ChatMsgId, "Kyoto", 0)).toBeNull();
		// Blank quotes never match.
		expect(duplicateAnnotationId(list, msg, "   ", 0)).toBeNull();
	});
});

describe("locateQuote", () => {
	it("finds single-node quotes with offsets", () => {
		expect(locateQuote(["hello world"], "world")).toEqual({
			startNode: 0,
			startOffset: 6,
			endNode: 0,
			endOffset: 11
		});
	});

	it("spans element boundaries (inline markup splits nodes)", () => {
		expect(locateQuote(["hello ", "world"], "hello world")).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 1,
			endOffset: 5
		});
	});

	it("ignores whitespace differences (multi-line selections)", () => {
		expect(locateQuote(["first half", "second half"], "first half\n\nsecond half")).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 1,
			endOffset: 11
		});
	});

	it("folds typographic punctuation (rendered curly quotes)", () => {
		expect(locateQuote(["say “hi” now"], 'say "hi" now')).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 0,
			endOffset: 12
		});
	});

	it("returns null for empty quotes and cross-message text", () => {
		expect(locateQuote(["hello"], "")).toBeNull();
		expect(locateQuote(["hello"], "bye")).toBeNull();
		expect(locateQuote(["first message"], "first message second message")).toBeNull();
	});

	it("picks the requested repeat of a repeated quote", () => {
		expect(locateQuote(["ccc"], "c", 0)).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 0,
			endOffset: 1
		});
		expect(locateQuote(["ccc"], "c", 2)).toEqual({
			startNode: 0,
			startOffset: 2,
			endNode: 0,
			endOffset: 3
		});
		// Multi-char repeats across nodes: the second "bc".
		expect(locateQuote(["ab", "cbc"], "bc", 1)).toEqual({
			startNode: 1,
			startOffset: 1,
			endNode: 1,
			endOffset: 3
		});
	});

	it("falls back to the first match past the end", () => {
		expect(locateQuote(["ccc"], "c", 9)).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 0,
			endOffset: 1
		});
	});
});

describe("occurrenceAtPosition", () => {
	it("finds the repeat holding a node offset", () => {
		expect(occurrenceAtPosition(["ccc"], "c", 0, 0)).toBe(0);
		expect(occurrenceAtPosition(["ccc"], "c", 0, 1)).toBe(1);
		expect(occurrenceAtPosition(["ccc"], "c", 0, 2)).toBe(2);
		expect(occurrenceAtPosition(["ccc"], "c", 0, 3)).toBe(0);
	});

	it("maps multi-node positions through whitespace", () => {
		// "a b c", selecting "b c" from raw offset 2.
		expect(occurrenceAtPosition(["a b ", "c"], "b c", 0, 2)).toBe(0);
		// Second "bc" in "abcbc", range starting at raw offset 3.
		expect(occurrenceAtPosition(["abcbc"], "bc", 0, 3)).toBe(1);
	});

	it("returns 0 for empty quotes, misses, and unknown nodes", () => {
		expect(occurrenceAtPosition(["abc"], "", 0, 1)).toBe(0);
		expect(occurrenceAtPosition(["abc"], "z", 0, 1)).toBe(0);
		expect(occurrenceAtPosition(["abc"], "b", 4, 0)).toBe(0);
	});
});

describe("snapOffsetsToWordEdges", () => {
	it("expands mid-word cuts out to the word's edges", () => {
		// "hell|o wo|rld": start cut inside "hello", end cut inside "world".
		expect(snapOffsetsToWordEdges("hello world", 2, 9)).toEqual({ start: 0, end: 11 });
	});

	it("leaves boundaries already on word edges alone", () => {
		expect(snapOffsetsToWordEdges("hello world", 0, 5)).toEqual({ start: 0, end: 5 });
		expect(snapOffsetsToWordEdges("hello world", 6, 11)).toEqual({ start: 6, end: 11 });
		// Leading space is not a word char: no snap into the neighbor.
		expect(snapOffsetsToWordEdges("hello world", 5, 6)).toEqual({ start: 5, end: 6 });
	});

	it("leaves spaceless scripts untouched", () => {
		expect(snapOffsetsToWordEdges("テストを確認", 2, 4)).toEqual({ start: 2, end: 4 });
	});

	it("snaps spaced non-Latin words too", () => {
		expect(snapOffsetsToWordEdges("مرحبا بالعالم", 2, 8)).toEqual({ start: 0, end: 13 });
	});

	it("clamps out-of-range input and normalizes reversed ranges", () => {
		expect(snapOffsetsToWordEdges("hello", -4, 99)).toEqual({ start: 0, end: 5 });
		expect(snapOffsetsToWordEdges("hello world", 8, 2)).toEqual({ start: 0, end: 11 });
	});

	it("treats digits and underscores as word characters", () => {
		expect(snapOffsetsToWordEdges("foo_bar2 baz", 2, 10)).toEqual({ start: 0, end: 12 });
	});
});

describe("placeAnnPopX", () => {
	const viewportWidth = 1280;
	const popWidth = 384;

	it("centers the box over a highlight narrower than the box", () => {
		// Highlight [500, 600): center 550, box 384 wide -> x = 358.
		expect(
			placeAnnPopX({ cursorX: 600, highlightLeft: 500, highlightWidth: 100, popWidth, viewportWidth })
		).toBe(358);
	});

	it("keeps the cursor placement for wide highlights", () => {
		expect(
			placeAnnPopX({ cursorX: 600, highlightLeft: 100, highlightWidth: 900, popWidth, viewportWidth })
		).toBe(600);
	});

	it("clamps centered and cursor placements on screen", () => {
		expect(
			placeAnnPopX({ cursorX: 10, highlightLeft: 0, highlightWidth: 40, popWidth, viewportWidth })
		).toBe(8);
		expect(
			placeAnnPopX({ cursorX: 2000, highlightLeft: 100, highlightWidth: 900, popWidth, viewportWidth })
		).toBe(viewportWidth - popWidth - 8);
	});
});

describe("selMenuPlacement", () => {
	const viewportWidth = 1280;
	const viewportHeight = 800;
	const rect = { rectLeft: 500, rectTop: 300, rectBottom: 322 };

	it("docks desktop above the finishing cursor", () => {
		expect(
			selMenuPlacement({
				cursorX: 600,
				cursorY: 310,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: false,
				menuWidth: 120
			})
		).toEqual({ x: 584, y: 262 });
	});

	it("falls back to the highlight when the cursor is gone (scroll track)", () => {
		expect(
			selMenuPlacement({
				cursorX: undefined,
				cursorY: undefined,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: false,
				menuWidth: 120
			})
		).toEqual({ x: 484, y: 252 });
	});

	it("clamps to the viewport edges", () => {
		expect(
			selMenuPlacement({
				cursorX: 10,
				cursorY: 4,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: false,
				menuWidth: 120
			})
		).toEqual({ x: 8, y: 8 });
	});

	it("clamps the right edge by menu width, not a phantom box", () => {
		// Cursor near the right edge: the menu's right edge lands on
		// the viewport's, keeping the button under the cursor instead
		// of stranding it a phantom-box away to the left.
		expect(
			selMenuPlacement({
				cursorX: 1200,
				cursorY: 310,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: false,
				menuWidth: 120
			})
		).toEqual({ x: 1152, y: 262 });
	});

	it("docks Android below the handles, iOS above the bubble", () => {
		expect(
			selMenuPlacement({
				cursorX: 600,
				cursorY: 310,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: true,
				iosUI: false,
				menuWidth: 120
			})
		).toEqual({ x: 584, y: 352 });
		expect(
			selMenuPlacement({
				cursorX: 600,
				cursorY: 310,
				...rect,
				viewportWidth,
				viewportHeight,
				androidUI: false,
				iosUI: true,
				menuWidth: 220
			})
		).toEqual({ x: 584, y: 253 });
	});
});

describe("off-chat drag clamp", () => {
	it("finds the current line's start", () => {
		expect(lineStartOffset("a\nbc\ndef", 6)).toBe(5);
		expect(lineStartOffset("a\nbc\ndef", 5)).toBe(5);
		expect(lineStartOffset("single", 3)).toBe(0);
		expect(lineStartOffset("single", 0)).toBe(0);
	});

	it("pins anchors above the cursor line, passes the rest through", () => {
		// Focus on line 2 ("bc"), anchor up on line 1: pin to line 2's start.
		expect(clampDragAnchorToFocusLine("a\nbc\ndef", 0, 4)).toBe(2);
		// Anchor on the same line or below: untouched.
		expect(clampDragAnchorToFocusLine("a\nbc\ndef", 2, 4)).toBe(2);
		expect(clampDragAnchorToFocusLine("a\nbc\ndef", 6, 4)).toBe(6);
	});
});

describe("reviewEditKey", () => {
	it("maps Enter to save, Shift+Enter to nothing, Escape to cancel", () => {
		expect(reviewEditKey("Enter", false)).toBe("save");
		expect(reviewEditKey("Enter", true)).toBeNull();
		expect(reviewEditKey("Escape", false)).toBe("cancel");
		expect(reviewEditKey("a", false)).toBeNull();
	});
});

describe("refs-only display", () => {
	it("renders an annotations-only message as an em-dash", () => {
		expect(REFS_ONLY_BODY).toBe("—");
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		const content = withAnnotations("", list);
		expect(isRefsOnly(content)).toBe(true);
		expect(isRefsOnly(withAnnotations("explain", list))).toBe(false);
		expect(isRefsOnly("just a prompt")).toBe(false);
	});

	it("redacts the baked block from message copy", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		expect(redactedCopyText(withAnnotations("explain", list))).toBe("explain");
		expect(redactedCopyText("just a prompt")).toBe("just a prompt");
	});

	it("copies refs-only quotes instead of an empty string", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		expect(redactedCopyText(withAnnotations("", list))).toBe("langue");
	});
});

describe("findQuotedMessage", () => {
	const m1 = "m1" as ChatMsgId;
	const m2 = "m2" as ChatMsgId;
	const messages = [
		{ id: m1, content: "Kyoto in spring is lovely" },
		{ id: m2, content: 'explain this\n\nAnnotated selections:\n1. "spring" — ?' }
	];

	it("finds the quoted message, never the sender", () => {
		// The sender's baked block quotes it too — including it would
		// land every jump on the sender.
		expect(findQuotedMessage(messages, m2, "spring")).toBe(m1);
	});

	it("returns null when only the sender holds the quote", () => {
		expect(findQuotedMessage(messages, m1, "lovely")).toBeNull();
	});

	it("returns null when the quote is gone everywhere", () => {
		expect(findQuotedMessage(messages, m2, "osaka")).toBeNull();
	});

	it("matches badge-insensitively across whitespace", () => {
		expect(findQuotedMessage(messages, m2, "  Kyoto   in  spring ")).toBe(m1);
	});
});
