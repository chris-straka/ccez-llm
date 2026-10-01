import { describe, it, expect } from "vitest";
import {
	addAnnotation,
	duplicateAnnotationId,
	aidMarkVisible,
	deleteAnnotation,
	buildMarksFor,
	buildStoryMarks,
	buildNewsMarks,
	aidedTextForMsg,
	seedAnnotationsFromRefs,
	annotationsAfterEdit,
	annotationCopyText,
	filePendingAnnotation,
	promptAnnWashIdFor,
	promptInclusions,
	clearPromptPinned,
	canPinAnnotation,
	canHoldDeleteBadge,
	setPromptPinned,
	attachAnnotationAnswer,
	unansweredAnnotations,
	badgeAnswerClass,
	badgeFace,
	quoteDirection,
	annEditCommitToast
} from "./annotations";
// The block fns are bake setup for the pinning/seeding tests below.
import { splitAnnotationBlock, withAnnotations } from "./annotation-block";
import type { ChatMsgId } from "./chat";
import type { Annotation, AnnotationId } from "./annotations";

describe("annotations", () => {
	it("adds and deletes", () => {
		let list = addAnnotation(
			[],
			"m1" as ChatMsgId,
			"  langue  ",
			"What does this mean?"
		);
		expect(list).toHaveLength(1);
		expect(list[0]?.quote).toBe("langue");
		expect(list[0]?.messageId).toBe("m1");

		// Blank quotes are ignored.
		list = addAnnotation(list, "m1" as ChatMsgId, "   ");
		expect(list).toHaveLength(1);

		list = deleteAnnotation(list, list[0]!.id);
		expect(list).toEqual([]);
	});

	it("clear-all removes only prompt-pinned annotations", () => {
		const filed = addAnnotation(
			addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?"),
			"m1" as ChatMsgId,
			"alphabet",
			"letters?"
		);
		const pinned = setPromptPinned(filed, filed[0]!.id, true);
		const cleared = clearPromptPinned(pinned);
		expect(cleared.map((a) => a.quote)).toEqual(["alphabet"]);
		expect(clearPromptPinned(filed)).toHaveLength(2);
	});

	it("holds every filed badge to delete, blue or orange", () => {
		expect(canHoldDeleteBadge(undefined)).toBe(false);
		expect(canHoldDeleteBadge({ id: "blue" })).toBe(true);
	});

	it("offers pinning only for answered annotations, pins them", () => {
		expect(canPinAnnotation({})).toBe(false);
		expect(canPinAnnotation({ answer: "because reasons" })).toBe(true);
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		// Creating never includes: the prompt goes out bare.
		expect(promptInclusions(list)).toHaveLength(0);
		expect(withAnnotations("explain", promptInclusions(list))).toBe(
			"explain"
		);
		const pinned = setPromptPinned(list, list[0]!.id, true);
		expect(pinned[0]?.pinnedToPrompt).toBe(true);
		expect(list[0]?.pinnedToPrompt).toBeUndefined();
		expect(promptInclusions(pinned)).toHaveLength(1);
		// Unpinning drops the flag (the annotation itself stays).
		const unpinned = setPromptPinned(pinned, list[0]!.id, false);
		expect(unpinned[0]).not.toHaveProperty("pinnedToPrompt");
		expect(promptInclusions(unpinned)).toHaveLength(0);
		// Unknown id: nothing changes.
		expect(setPromptPinned(list, "missing" as AnnotationId, true)).toBe(
			list
		);
	});

	it("restarts refire exactly the answerless drafts", () => {
		const list = addAnnotation(
			addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?"),
			"m1" as ChatMsgId,
			"alphabet",
			"letters?"
		);
		const asked = attachAnnotationAnswer(list, list[0]!.id, "because reasons");
		const waiting = unansweredAnnotations(asked);
		expect(waiting.map((a) => a.quote)).toEqual(["alphabet"]);
		expect(unansweredAnnotations([])).toEqual([]);
	});

	it("lands instant replies only on the asked id, never on blanks", () => {
		const list = addAnnotation(
			addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?"),
			"m1" as ChatMsgId,
			"alphabet",
			"letters?"
		);
		const asked = attachAnnotationAnswer(list, list[0]!.id, "because reasons");
		expect(asked[0]?.answer).toBe("because reasons");
		// Other annotations stay blue.
		expect(asked[1]?.answer).toBeUndefined();
		expect(list[0]?.answer).toBeUndefined();
		// Blank replies attach nothing (same ref back).
		expect(attachAnnotationAnswer(list, list[0]!.id, "   ")).toBe(list);
		expect(attachAnnotationAnswer(list, "missing" as AnnotationId, "x")).toBe(
			list
		);
	});

});

describe("duplicateAnnotationId", () => {
	it("finds the same span and ignores neighbors", () => {
		const msg = "m1" as ChatMsgId;
		const list = addAnnotation(
			addAnnotation([], msg, "Kyoto", "old capital"),
			msg,
			"Osaka"
		);
		const kyoto = list[0];
		if (!kyoto) throw new Error("no annotation");
		// Same message, quote, and repeat: a twin.
		expect(duplicateAnnotationId(list, { messageId: msg }, "  Kyoto ", 0)).toBe(kyoto.id);
		// A different repeat of the same text is its own span.
		expect(duplicateAnnotationId(list, { messageId: msg }, "Kyoto", 2)).toBeNull();
		// Same quote in another message is unrelated.
		expect(
			duplicateAnnotationId(list, { messageId: "m2" as ChatMsgId }, "Kyoto", 0)
		).toBeNull();
		// Blank quotes never match.
		expect(duplicateAnnotationId(list, { messageId: msg }, "   ", 0)).toBeNull();
	});

	it("treats aid scope as part of span identity", () => {
		const msg = "m1" as ChatMsgId;
		const scoped: Annotation[] = [
			{
				id: "a1" as AnnotationId,
				messageId: msg,
				quote: "Kyoto",
				comment: "",
				aidScope: "tashkeel"
			}
		];
		// Same span in the bare text is not a twin of the vocalized one.
		expect(duplicateAnnotationId(scoped, { messageId: msg }, "Kyoto", 0)).toBeNull();
		expect(duplicateAnnotationId(scoped, { messageId: msg }, "Kyoto", 0, "tashkeel")).toBe(
			"a1"
		);
		// Unscoped lists match unscoped lookups, as before.
		const plain = addAnnotation([], msg, "Kyoto");
		expect(duplicateAnnotationId(plain, { messageId: msg }, "Kyoto", 0)).toBe(
			plain[0]?.id ?? null
		);
		expect(
			duplicateAnnotationId(plain, { messageId: msg }, "Kyoto", 0, "tashkeel")
		).toBeNull();
	});
});

describe("aidMarkVisible", () => {
	it("shows tashkeel-scoped quotes only while the aid is on", () => {
		expect(aidMarkVisible("tashkeel", true)).toBe(true);
		expect(aidMarkVisible("tashkeel", false)).toBe(false);
	});
	it("always shows unscoped quotes", () => {
		expect(aidMarkVisible(undefined, true)).toBe(true);
		expect(aidMarkVisible(undefined, false)).toBe(true);
	});
});

describe("quoteDirection", () => {
	it("reads the first strong character, not the paragraph", () => {
		expect(quoteDirection("اليوم")).toBe("rtl");
		expect(quoteDirection("hello")).toBe("ltr");
		expect(quoteDirection("«اليوم»")).toBe("rtl");
		expect(quoteDirection("…hello")).toBe("ltr");
		expect(quoteDirection("abc عربي")).toBe("ltr");
		expect(quoteDirection("عربي abc")).toBe("rtl");
		expect(quoteDirection("123?!")).toBeNull();
		expect(quoteDirection("")).toBeNull();
	});
});

describe("story-anchored annotations", () => {
	const story = { link: "https://x/y", title: "T", outlet: "O", lang: "fr" };
	const storyNote = (id: string, quote: string): Annotation => ({
		id: id as AnnotationId,
		story,
		quote,
		comment: ""
	});
	it("finds dupes per story link, apart from messages", () => {
		const list: Annotation[] = [
			storyNote("s1", "q"),
			storyNote("s2", "qq"),
			{
				id: "m1a" as AnnotationId,
				messageId: "m1" as ChatMsgId,
				quote: "q",
				comment: ""
			}
		];
		expect(duplicateAnnotationId(list, { story }, "q")).toBe("s1");
		expect(duplicateAnnotationId(list, { story }, "missing")).toBeNull();
	});
	it("excludes story notes from message marks", () => {
		const list: Annotation[] = [storyNote("s1", "q")];
		expect(
			buildMarksFor(list, "m1" as ChatMsgId, false, null)
		).toEqual([]);
	});
	it("builds numbered headline badges per story, waiting or ready", () => {
		const other = { ...story, link: "https://x/z" };
		const list: Annotation[] = [
			storyNote("s1", "q"),
			{ ...storyNote("s2", "qq"), answer: "because" },
			{ id: "s3" as AnnotationId, story: other, quote: "other", comment: "" }
		];
		const marks = buildStoryMarks(list, "https://x/y", null);
		expect(marks).toHaveLength(2);
		expect(marks[0]).toMatchObject({ number: 1, quote: "q", answer: "waiting" });
		expect(marks[1]).toMatchObject({ number: 2, quote: "qq", answer: "ready" });
		expect(marks[0]).not.toHaveProperty("aidScope");
		// Another story's pill never leaks in; pending previews next.
		const pending: Annotation = {
			id: "p" as AnnotationId,
			story: other,
			quote: "draft",
			comment: ""
		};
		expect(buildStoryMarks(list, "https://x/y", pending)).toHaveLength(2);
		const ours = buildStoryMarks(list, "https://x/z", pending);
		expect(ours).toHaveLength(2);
		expect(ours[1]).toMatchObject({ number: 2, quote: "draft", preview: true });
	});
	it("groups headline marks by story link", () => {
		const other = { ...story, link: "https://x/z" };
		const list: Annotation[] = [
			storyNote("s1", "q"),
			{ id: "s3" as AnnotationId, story: other, quote: "other", comment: "" }
		];
		const grouped = buildNewsMarks(list, null);
		expect(Object.keys(grouped).sort()).toEqual(["https://x/y", "https://x/z"]);
		expect(grouped["https://x/y"]).toHaveLength(1);
		expect(grouped["https://x/z"]).toHaveLength(1);
		expect(buildNewsMarks([], null)).toEqual({});
	});
});

describe("buildMarksFor", () => {
	const m1 = "m1" as ChatMsgId;
	const m2 = "m2" as ChatMsgId;
	const list = addAnnotation(
		addAnnotation([], m1, "first"),
		m2,
		"second"
	);

	it("builds numbered badges for one message only", () => {
		const marks = buildMarksFor(list, m1, false, null);
		expect(marks).toHaveLength(1);
		expect(marks[0]).toMatchObject({ number: 1, quote: "first", at: 0 });
		expect(marks[0]!.preview).toBeUndefined();
	});

	it("keeps pin and arm states off the mark (page-side only)", () => {
		const pinned = setPromptPinned(list, list[0]!.id, true);
		const marks = buildMarksFor(pinned, m1, false, null);
		expect(marks[0]).not.toHaveProperty("pinned");
		expect(marks[0]).not.toHaveProperty("armed");
		const loose = buildMarksFor(list, m1, false, null);
		expect(loose[0]).not.toHaveProperty("pinned");
		expect(loose[0]).not.toHaveProperty("armed");
	});

	it("faces every badge as its number, always", () => {
		// Numbers never swap (no plus/minus): pinning happens by
		// double-click and leaves the face alone.
		expect(badgeFace({ number: 3 })).toEqual({
			text: "3",
			title: "Open annotation"
		});
		expect(badgeFace({ number: 12 })).toEqual({
			text: "12",
			title: "Open annotation"
		});
	});

	it("hides aid-scoped quotes while the aid is off", () => {
		const scoped: Annotation = {
			...list[0]!,
			aidScope: "tashkeel"
		};
		expect(buildMarksFor([scoped], m1, false, null)).toHaveLength(0);
		expect(buildMarksFor([scoped], m1, true, null)).toHaveLength(1);
	});

	it("appends a pending preview with the next number, no badge", () => {
		const pending: Annotation = {
			id: "pending" as AnnotationId,
			messageId: m1,
			quote: "draft",
			comment: ""
		};
		const marks = buildMarksFor(list, m1, false, pending);
		expect(marks).toHaveLength(2);
		expect(marks[1]).toMatchObject({
			// Next per-message number (m1 holds one), never the
			// chat-global count.
			number: 2,
			quote: "draft",
			preview: true
		});
		// Another message's pill never leaks in.
		expect(buildMarksFor(list, m2, false, pending)).toHaveLength(1);
	});

	it("marks filed-but-unasked waiting (steady blue) and answered ready", () => {
		const answered: Annotation = { ...list[0]!, answer: "because" };
		const ready = buildMarksFor([answered], m1, false, null);
		expect(ready[0]).toMatchObject({ answer: "ready" });
		// No separate request exists: every filed annotation without
		// an answer waits, never neutral.
		const waiting = buildMarksFor(list, m1, false, null);
		expect(waiting[0]).toMatchObject({ answer: "waiting" });
	});

	it("paints waiting blue and ready orange, neutral unclassed", () => {
		expect(badgeAnswerClass("waiting")).toBe(" ans-waiting");
		expect(badgeAnswerClass("ready")).toBe(" ans-ready");
		expect(badgeAnswerClass(undefined)).toBe("");
	});
});

describe("aidedTextForMsg", () => {
	const m1 = "m1" as ChatMsgId;

	it("reads the peeked message cache first", () => {
		expect(aidedTextForMsg(m1, m1, { m1: "vocal" }, new Set())).toBe(
			"vocal"
		);
		expect(aidedTextForMsg(m1, m1, {}, new Set([m1]))).toBeNull();
	});

	it("shows the model pin cache, surviving one unpin click", () => {
		expect(aidedTextForMsg(m1, null, { m1: "vocal" }, new Set([m1]))).toBe(
			"vocal"
		);
		expect(aidedTextForMsg(m1, null, {}, new Set([m1]))).toBeNull();
		expect(aidedTextForMsg(m1, null, { m1: "vocal" }, new Set())).toBeNull();
	});
});

describe("seedAnnotationsFromRefs", () => {
	it("seeds one pending annotation per baked ref", () => {
		const m1 = "m1" as ChatMsgId;
		const seeded = seedAnnotationsFromRefs(m1, [
			{ n: 1, quote: "a", comment: "x" },
			{ n: 2, quote: "b", comment: "" }
		]);
		expect(seeded).toHaveLength(2);
		expect(seeded[0]).toMatchObject({ messageId: m1, quote: "a", comment: "x" });
		expect(seeded[0]!.id).not.toBe(seeded[1]!.id);
		expect(seedAnnotationsFromRefs(m1, [])).toEqual([]);
	});

	it("rebakes an untouched block byte-for-byte (pins and answers kept)", () => {
		const content = withAnnotations("hallo", [
			{ quote: "Bahnhof", comment: "", answer: "train station" },
			{ quote: "Nähe", comment: "near?" }
		]);
		const split = splitAnnotationBlock(content)!;
		const seeds = seedAnnotationsFromRefs("m1" as ChatMsgId, split.refs);
		expect(seeds[0]?.comment).toBe("");
		expect(withAnnotations(split.text, promptInclusions(seeds))).toBe(content);
	});
});

describe("annotationsAfterEdit", () => {
	const ann = (id: string, pinned = false): Annotation => ({
		id: id as AnnotationId,
		messageId: "m" as ChatMsgId,
		quote: id,
		comment: "",
		...(pinned ? { pinnedToPrompt: true } : {})
	});

	it("restores the filed list and drops the seeds", () => {
		const filed = [ann("filed")];
		const live = [ann("seed", true)];
		expect(annotationsAfterEdit(filed, live, new Set(["seed"]), false)).toEqual(filed);
		expect(annotationsAfterEdit(filed, live, new Set(["seed"]), true)).toEqual(filed);
	});

	it("keeps notes filed mid-edit unless the save baked them", () => {
		const live = [ann("seed", true), ann("new"), ann("newPinned", true)];
		const ids = (list: Annotation[]) => list.map((a) => a.id);
		expect(ids(annotationsAfterEdit([], live, new Set(["seed"]), true))).toEqual(["new"]);
		expect(ids(annotationsAfterEdit(null, live, new Set(["seed"]), false))).toEqual([
			"new",
			"newPinned"
		]);
	});
});

describe("annotation copy text", () => {
	it("formats one annotation without numbers", () => {
		expect(annotationCopyText("Kyoto", "meaning?")).toBe('"Kyoto" — meaning?');
		expect(annotationCopyText("Kyoto", "  ")).toBe('"Kyoto"');
	});
});

describe("pending filing", () => {
	const m1 = "m1" as ChatMsgId;

	it("files the pending annotation with its draft", () => {
		const pending: Annotation = {
			id: "p" as AnnotationId,
			messageId: m1,
			quote: "q",
			comment: ""
		};
		expect(filePendingAnnotation([], pending, "note")).toEqual([
			{ ...pending, comment: "note" }
		]);
		expect(filePendingAnnotation([], null, "note")).toBeNull();
	});

	it("washes the pending preview or the saved quote", () => {
		expect(promptAnnWashIdFor(null, "p" as AnnotationId)).toBeNull();
		expect(promptAnnWashIdFor({ pending: true }, "p" as AnnotationId)).toBe(
			"p"
		);
		expect(promptAnnWashIdFor({ pending: true }, null)).toBeNull();
		expect(promptAnnWashIdFor({ id: "s" }, "p" as AnnotationId)).toBe("s");
	});
});

describe("annEditCommitToast", () => {
	it("names filings vs rewrites", () => {
		expect(annEditCommitToast(true)).toBe("Annotation sent");
		expect(annEditCommitToast(false)).toBe("Annotation edited");
	});
});

