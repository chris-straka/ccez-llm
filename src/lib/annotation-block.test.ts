import { describe, it, expect } from "vitest";
import {
	addAnnotation,
	setPromptPinned,
	promptInclusions,
	attachAnnotationAnswer
} from "./annotations";
import {
	clearBakedAnnotations,
	formatAnnotations,
	withAnnotations,
	rewriteAnnotationComment,
	splitAnnotationBlock,
	commitRefsEdit,
	planClearSentRefs,
	annRefsFor,
	REFS_ONLY_BODY,
	redactedCopyText
} from "./annotation-block";
import type { ChatMsgId } from "./chat";
import type { AnnotationId } from "./annotations";

describe("rewriteAnnotationComment", () => {
	const baked =
		'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?\n2. "merci" — ?';

	it("swaps one ref's comment and keeps the rest", () => {
		expect(rewriteAnnotationComment(baked, 2, "thanks")).toBe(
			'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?\n2. "merci" — thanks'
		);
	});

	it("rebakes byte-for-byte when the comment is unchanged", () => {
		expect(rewriteAnnotationComment(baked, 1, "greeting?")).toBe(baked);
	});

	it("keeps the edited ref's answer line", () => {
		const answered = withAnnotations("", [
			{ quote: "bonjour", comment: "greeting?", answer: "hello" }
		]);
		const out = rewriteAnnotationComment(answered, 1, "formal?");
		expect(splitAnnotationBlock(out ?? "")?.refs).toEqual([
			{ n: 1, quote: "bonjour", comment: "formal?", answer: "hello" }
		]);
	});

	it("collapses a multi-line comment so the block still parses", () => {
		const out = withAnnotations("", [
			{ quote: "bonjour", comment: "line one\nline two", answer: "hi" },
			{ quote: "merci", comment: "", answer: "thanks" }
		]);
		expect(splitAnnotationBlock(out)?.refs).toEqual([
			{ n: 1, quote: "bonjour", comment: "line one line two", answer: "hi" },
			{ n: 2, quote: "merci", comment: "?", answer: "thanks" }
		]);
	});

	it("files an empty comment as the ? marker, like the bake", () => {
		expect(rewriteAnnotationComment(baked, 1, "  ")).toBe(
			'explain this\n\nAnnotated selections:\n1. "bonjour" — ?\n2. "merci" — ?'
		);
	});

	it("keeps the refs-only shape (no prompt text, no leading blank)", () => {
		const only = 'Annotated selections:\n1. "bonjour" — greeting?';
		expect(rewriteAnnotationComment(only, 1, "hi")).toBe(
			'Annotated selections:\n1. "bonjour" — hi'
		);
	});

	it("returns null for a missing number or no clean block", () => {
		expect(rewriteAnnotationComment(baked, 9, "x")).toBeNull();
		expect(rewriteAnnotationComment("just a prompt", 1, "x")).toBeNull();
	});
});
describe("refs-only display", () => {
	it("renders an annotations-only message as an em-dash", () => {
		expect(REFS_ONLY_BODY).toBe("—");
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		expect(annRefsFor(withAnnotations("", list))?.text).toBe("");
		expect(annRefsFor(withAnnotations("explain", list))?.text).toBe("explain");
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
describe("commitRefsEdit", () => {
	const baked =
		'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?\n2. "merci" — ?';

	it("rewrites with one comment swapped", () => {
		expect(commitRefsEdit(baked, 2, "thanks")).toEqual({
			kind: "rewrote",
			content:
				'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?\n2. "merci" — thanks'
		});
	});

	it("reports untouched drafts and gone blocks", () => {
		expect(commitRefsEdit(baked, 1, "greeting?")).toEqual({
			kind: "untouched"
		});
		expect(commitRefsEdit("just a prompt", 1, "x")).toEqual({ kind: "gone" });
		expect(commitRefsEdit(baked, 9, "x")).toEqual({ kind: "gone" });
		expect(commitRefsEdit(null, 1, "x")).toEqual({ kind: "gone" });
	});
});
describe("planClearSentRefs", () => {
	it("skips non-user messages silently", () => {
		expect(planClearSentRefs("assistant", "anything")).toEqual({
			kind: "skip"
		});
	});

	it("reports gone blocks, deletes refs-only, rewrites the rest", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		expect(planClearSentRefs("user", "just a prompt")).toEqual({
			kind: "gone"
		});
		expect(planClearSentRefs("user", withAnnotations("", list))).toEqual({
			kind: "delete"
		});
		expect(planClearSentRefs("user", withAnnotations("explain", list))).toEqual(
			{
				kind: "rewrote",
				bare: "explain"
			}
		);
	});
});
describe("annotation block", () => {
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
		expect(withAnnotations("", list)).toBe(
			'Annotated selections:\n1. "langue" — meaning?'
		);
		expect(withAnnotations("explain", [])).toBe("explain");
	});

	it("bakes only pinned annotations; deleting is the only removal", () => {
		const filed = addAnnotation(
			addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?"),
			"m1" as ChatMsgId,
			"alphabet",
			"letters?"
		);
		// Nothing pinned: the prompt goes out bare (no omit state —
		// creating never includes).
		expect(withAnnotations("explain", promptInclusions(filed))).toBe("explain");
		const list = setPromptPinned(
			setPromptPinned(filed, filed[0]!.id, true),
			filed[1]!.id,
			true
		);
		expect(withAnnotations("explain", promptInclusions(list))).toBe(
			'explain\n\nAnnotated selections:\n1. "langue" — meaning?\n2. "alphabet" — letters?'
		);
		// Unpinning one resequences numbering from the kept order.
		const oneOut = setPromptPinned(list, list[0]!.id, false);
		expect(promptInclusions(oneOut)).toHaveLength(1);
		expect(withAnnotations("explain", promptInclusions(oneOut))).toBe(
			'explain\n\nAnnotated selections:\n1. "alphabet" — letters?'
		);
		// None pinned: bare again.
		const noneOut = setPromptPinned(oneOut, oneOut[1]!.id, false);
		expect(withAnnotations("explain", promptInclusions(noneOut))).toBe(
			"explain"
		);
	});

	it("bakes pinned answers as quote, question, and reply", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		const answered = attachAnnotationAnswer(
			list,
			list[0]!.id,
			"because reasons\nsecond line"
		);
		const pinned = setPromptPinned(answered, list[0]!.id, true);
		expect(withAnnotations("explain", promptInclusions(pinned))).toBe(
			'explain\n\nAnnotated selections:\n1. "langue" — meaning?\n   Answer: because reasons second line'
		);
		const split = splitAnnotationBlock(
			withAnnotations("explain", promptInclusions(pinned))
		);
		expect(split?.refs).toEqual([
			{
				n: 1,
				quote: "langue",
				comment: "meaning?",
				answer: "because reasons second line"
			}
		]);
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
		expect(
			splitAnnotationBlock("explain\n\nAnnotated selections:\n")
		).toBeNull();
		expect(
			splitAnnotationBlock("I typed\n\nAnnotated selections:\nnot a list")
		).toBeNull();
	});

	it("clears baked blocks back to the bare prompt", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		expect(clearBakedAnnotations(withAnnotations("explain", list))).toBe(
			"explain"
		);
		expect(clearBakedAnnotations(withAnnotations("", list))).toBe("");
		expect(clearBakedAnnotations("just a prompt")).toBeNull();
		expect(
			clearBakedAnnotations("I typed\n\nAnnotated selections:\nnot a list")
		).toBeNull();
	});

	it("parses an annotations-only message to empty text plus refs", () => {
		const list = addAnnotation(
			[],
			"m1" as ChatMsgId,
			"風に舞う",
			"What does this mean?"
		);
		const split = splitAnnotationBlock(withAnnotations("", list));
		expect(split?.text).toBe("");
		expect(split?.refs).toEqual([
			{ n: 1, quote: "風に舞う", comment: "What does this mean?" }
		]);
	});
});
