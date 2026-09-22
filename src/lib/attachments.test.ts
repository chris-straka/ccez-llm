import { describe, it, expect } from "vitest";
import {
	ATTACH_TAG_RE,
	appendImageMarkers,
	FILE_MARKER,
	IMAGE_MARKER,
	IMAGE_MAX_DIM,
	MAX_FILE_CHARS,
	PASTED_TAG_RE,
	countMarkers,
	countPastedTags,
	dropFileAttachmentsAtIndexes,
	dropNewestWhere,
	dropPastedAttachmentsAtIndexes,
	extractAttachmentTags,
	fileExcerpt,
	fileMarkerInsert,
	formatTokenCount,
	fitDimensions,
	imageMarkerInsert,
	imageTokens,
	isPastedTextAttachment,
	isTextFile,
	leftoverAttachments,
	makePastedTextAttachment,
	pastedMarkerInsert,
	pastedTextMarker,
	reconcileTagRemovals,
	syncTagRemovals,
	removeMarker,
	removeMarkerAt,
	removePastedAt,
	dropAttachmentsAtIndexes,
	attachmentImageBlobsAt,
	attachmentDataUrlsAt,
	removeTags,
	splicePastedText,
	splicePastedFolds,
	spliceSendText,
	sentTagModelsFor,
	stripAttachmentMarkers,
	stripPastedMarkers,
	tagPlaceholder,
	toggleTagKey,
	attachmentImageBlobs,
	blobToDataUrl,
	clipboardPngBlob,
	reconcileDropCount,
	type Attachment
} from "./attachments";
import { estimateTextTokens } from "./render";

describe("image token estimates", () => {
	it("charges a base cost plus per-tile cost", () => {
		expect(imageTokens(100, 100)).toBe(85 + 170);
		// 1024x512 → 2x1 tiles.
		expect(imageTokens(1024, 512)).toBe(85 + 170 * 2);
	});
});

describe("downscale dimensions", () => {
	it("leaves small images alone", () => {
		expect(fitDimensions(800, 600)).toEqual({ width: 800, height: 600 });
	});

	it("caps the long side at IMAGE_MAX_DIM, keeping aspect ratio", () => {
		const { width, height } = fitDimensions(4000, 2000);
		expect(Math.max(width, height)).toBe(IMAGE_MAX_DIM);
		expect(width / height).toBeCloseTo(2, 1);
	});
});

describe("text file detection", () => {
	const file = (name: string, type: string) => ({ name, type }) as File;
	it("accepts text mimes, code extensions, and rejects binaries", () => {
		expect(isTextFile(file("a.txt", "text/plain"))).toBe(true);
		expect(isTextFile(file("app.tsx", ""))).toBe(true);
		expect(isTextFile(file("data.json", "application/json"))).toBe(true);
		expect(isTextFile(file("photo.png", "image/png"))).toBe(false);
		expect(isTextFile(file("app.zip", "application/zip"))).toBe(false);
	});
});

describe("attachment markers", () => {
	it("strips both tag kinds on send, keeping prose and blank lines", () => {
		const text = `hello\n${IMAGE_MARKER}\nworld`;
		expect(stripAttachmentMarkers(text)).toBe("hello\nworld");
		expect(stripAttachmentMarkers("no markers")).toBe("no markers");
		// Tags typed beside prose strip; the user's words and blank
		// lines survive.
		expect(stripAttachmentMarkers(`${IMAGE_MARKER} describe this`)).toBe(
			"describe this"
		);
		expect(stripAttachmentMarkers(`look ${IMAGE_MARKER} here`)).toBe(
			"look here"
		);
		expect(stripAttachmentMarkers(`hello\n\n${IMAGE_MARKER} \nworld`)).toBe(
			"hello\n\nworld"
		);
		// Stacked tags on one line all go, mixed kinds alike.
		expect(stripAttachmentMarkers(`${IMAGE_MARKER} ${IMAGE_MARKER} `)).toBe("");
		expect(stripAttachmentMarkers(`${FILE_MARKER} read this`)).toBe(
			"read this"
		);
		expect(stripAttachmentMarkers(`see ${FILE_MARKER} now`)).toBe("see now");
		expect(stripAttachmentMarkers(`${IMAGE_MARKER} ${FILE_MARKER} `)).toBe("");
	});

	it("says [Pasted image] plus one space, caret staying on the line", () => {
		expect(IMAGE_MARKER).toBe("[Pasted image]");
		expect(imageMarkerInsert("")).toBe(`${IMAGE_MARKER} `);
		expect(imageMarkerInsert("draft\n")).toBe(`${IMAGE_MARKER} `);
		// Mid-draft: one separating space before the tag, still no
		// newline after it — the caret lands after the space, same line.
		expect(imageMarkerInsert("hello")).toBe(` ${IMAGE_MARKER} `);
		expect(imageMarkerInsert("hello\n")).toBe(`${IMAGE_MARKER} `);
		// Chained right after another tag: repeat pastes ride one line.
		expect(imageMarkerInsert(`${IMAGE_MARKER} `)).toBe(`${IMAGE_MARKER} `);
		expect(imageMarkerInsert(`${FILE_MARKER} hello`)).toBe(` ${IMAGE_MARKER} `);
		// Prose typed beside a tag ends spaced: the next tag stays on
		// the line instead of dropping below it.
		expect(imageMarkerInsert(`${IMAGE_MARKER} test `)).toBe(`${IMAGE_MARKER} `);
	});

	it("says [Pasted Attachment] under the same contract", () => {
		expect(FILE_MARKER).toBe("[Pasted Attachment]");
		expect(fileMarkerInsert("")).toBe(`${FILE_MARKER} `);
		expect(fileMarkerInsert("hello")).toBe(` ${FILE_MARKER} `);
		expect(fileMarkerInsert("hello\n")).toBe(`${FILE_MARKER} `);
		expect(fileMarkerInsert(`${IMAGE_MARKER} `)).toBe(`${FILE_MARKER} `);
		expect(fileMarkerInsert(`${IMAGE_MARKER} test `)).toBe(`${FILE_MARKER} `);
	});

	it("appends one image literal per image attachment for sent text", () => {
		expect(appendImageMarkers("look", 0)).toBe("look");
		expect(appendImageMarkers("", 0)).toBe("");
		expect(appendImageMarkers("", 1)).toBe(`${IMAGE_MARKER}`);
		expect(appendImageMarkers("look", 1)).toBe(`look ${IMAGE_MARKER}`);
		expect(appendImageMarkers("look", 2)).toBe(
			`look ${IMAGE_MARKER} ${IMAGE_MARKER}`
		);
	});

	it("rides the paste's line one space apart right after a collapsed paste", () => {
		// Same line, single-space separation, caret after the space.
		expect(imageMarkerInsert("pasted words", true)).toBe(` ${IMAGE_MARKER} `);
		expect(fileMarkerInsert("pasted words", true)).toBe(` ${FILE_MARKER} `);
		// Already spaced: no doubling.
		expect(imageMarkerInsert("pasted words ", true)).toBe(`${IMAGE_MARKER} `);
		// Elsewhere the usual prefix applies even with the flag set.
		expect(imageMarkerInsert("", true)).toBe(`${IMAGE_MARKER} `);
		expect(imageMarkerInsert("draft\n", true)).toBe(`${IMAGE_MARKER} `);
		// Without the flag spaceless prose still takes the tag on
		// its line, one space apart — never a line of its own.
		expect(imageMarkerInsert("pasted words", false)).toBe(` ${IMAGE_MARKER} `);
	});

	it("compacts token counts past four figures", () => {
		expect(formatTokenCount(0)).toBe("~0");
		expect(formatTokenCount(85)).toBe("~85");
		expect(formatTokenCount(999)).toBe("~999");
		expect(formatTokenCount(1105)).toBe("~1.1k");
		expect(formatTokenCount(12000)).toBe("~12k");
		expect(formatTokenCount(100000)).toBe("~100k");
		expect(formatTokenCount(2500000)).toBe("~2.5M");
	});

	it("removes one marker tag at a time, sparing beside-prose", () => {
		const text = `hello\n${IMAGE_MARKER}\n${IMAGE_MARKER}\nworld`;
		expect(removeMarker(text)).toBe(`hello\n${IMAGE_MARKER}\nworld`);
		expect(removeMarker("no markers")).toBe("no markers");
		// Pill → tag on a lived-in line: the tag goes, the words stay.
		expect(removeMarker(`${IMAGE_MARKER} describe this`)).toBe("describe this");
		expect(removeMarker(`look ${IMAGE_MARKER} here`)).toBe("look here");
		expect(removeMarker(`${IMAGE_MARKER} `)).toBe("");
		// File tags remove by kind, never touching image tags.
		expect(removeMarker(`${FILE_MARKER} read this`, FILE_MARKER)).toBe(
			"read this"
		);
		expect(removeMarker(`${IMAGE_MARKER} ${FILE_MARKER}`, FILE_MARKER)).toBe(
			`${IMAGE_MARKER}`
		);
		expect(removeMarker(`${IMAGE_MARKER} x`, FILE_MARKER)).toBe(
			`${IMAGE_MARKER} x`
		);
	});

	it("removes the index-th tag, so a pill drops its own", () => {
		const two = `${IMAGE_MARKER} one\n${IMAGE_MARKER} two`;
		// Index 0 is the legacy path exactly.
		expect(removeMarkerAt(two, IMAGE_MARKER, 0)).toBe(removeMarker(two));
		// Deleting one tag keeps the other's line (beside-prose
		// survives on the edited line, as in the legacy path).
		expect(removeMarkerAt(two, IMAGE_MARKER, 0)).toBe(
			`one\n${IMAGE_MARKER} two`
		);
		expect(removeMarkerAt(two, IMAGE_MARKER, 1)).toBe(
			`${IMAGE_MARKER} one\ntwo`
		);
		// Stacked on one line index by occurrence, not by line.
		const stacked = `${IMAGE_MARKER} ${IMAGE_MARKER} end`;
		expect(removeMarkerAt(stacked, IMAGE_MARKER, 1)).toBe(
			`${IMAGE_MARKER} end`
		);
		// Kinds index separately; out-of-range leaves text untouched.
		const mixed = `${IMAGE_MARKER} ${FILE_MARKER} ${IMAGE_MARKER}`;
		expect(removeMarkerAt(mixed, FILE_MARKER, 0)).toBe(
			`${IMAGE_MARKER} ${IMAGE_MARKER}`
		);
		expect(removeMarkerAt(two, IMAGE_MARKER, 2)).toBe(two);
		expect(removeMarkerAt(two, IMAGE_MARKER, -1)).toBe(two);
		expect(removeMarkerAt("no markers", IMAGE_MARKER, 0)).toBe("no markers");
	});

	it("counts marker tags per kind, even stacked on one line", () => {
		expect(countMarkers(`${IMAGE_MARKER} \nhello\n${IMAGE_MARKER}`)).toBe(2);
		expect(countMarkers(`${IMAGE_MARKER} ${IMAGE_MARKER} `)).toBe(2);
		expect(countMarkers(`look ${IMAGE_MARKER} here`)).toBe(1);
		expect(countMarkers("plain")).toBe(0);
		expect(countMarkers(`${FILE_MARKER} a ${FILE_MARKER}`, FILE_MARKER)).toBe(
			2
		);
		expect(countMarkers(`${IMAGE_MARKER} ${FILE_MARKER}`)).toBe(1);
		expect(countMarkers(`${IMAGE_MARKER} ${FILE_MARKER}`, FILE_MARKER)).toBe(1);
	});

	it("cuts tag ranges with offsets for fold mapping", () => {
		expect(removeTags("no markers")).toEqual({ text: "no markers", cuts: [] });
		expect(removeTags(`${IMAGE_MARKER} hi`)).toEqual({
			text: "hi",
			cuts: [{ start: 0, end: 15 }]
		});
		expect(removeTags(`see ${FILE_MARKER} now`).text).toBe("see now");
	});

	it("excerpts leading file text with an ellipsis past the cap", () => {
		expect(fileExcerpt("short")).toBe("short");
		expect(fileExcerpt("a".repeat(240))).toBe("a".repeat(240));
		expect(fileExcerpt(`a${"b".repeat(300)}`)).toBe(`a${"b".repeat(239)}…`);
		expect(fileExcerpt("line one\nline two")).toBe("line one\nline two");
	});
});

describe("attachment budgets", () => {
	it("text attachments cost ~4 chars per token, capped by MAX_FILE_CHARS", () => {
		expect(MAX_FILE_CHARS).toBe(100_000);
		expect(estimateTextTokens("a".repeat(400))).toBe(100);
	});
});
function testAttachment(
	partial: Partial<Attachment> & { kind: Attachment["kind"] }
): Attachment {
	return {
		id: partial.id ?? Math.random().toString(36),
		name: "file",
		mime: "text/plain",
		dataUrl: null,
		text: null,
		width: null,
		height: null,
		tokens: 1,
		...partial
	};
}

describe("extractAttachmentTags", () => {
	it("replaces literals with kind-indexed placeholders in order", () => {
		const doc = `${IMAGE_MARKER} what do you see here?\n${FILE_MARKER} notes`;
		const { stripped, tags } = extractAttachmentTags(doc);
		expect(tags).toEqual([
			{ kind: "image", index: 0 },
			{ kind: "text", index: 0 }
		]);
		expect(stripped).toBe(
			`${tagPlaceholder("image", 0)} what do you see here?\n${tagPlaceholder("text", 0)} notes`
		);
		// Placeholders round-trip through the matcher.
		const kinds: string[] = [];
		stripped.replace(ATTACH_TAG_RE, (_m, kind: string) => {
			kinds.push(kind);
			return "";
		});
		expect(kinds).toEqual(["i", "f"]);
	});

	it("indexes each kind separately", () => {
		const { tags } = extractAttachmentTags(
			`${IMAGE_MARKER} ${FILE_MARKER} ${IMAGE_MARKER}`
		);
		expect(tags).toEqual([
			{ kind: "image", index: 0 },
			{ kind: "text", index: 0 },
			{ kind: "image", index: 1 }
		]);
	});

	it("leaves fenced blocks and code spans alone", () => {
		const doc = [
			"```",
			`${IMAGE_MARKER} in a fence`,
			"```",
			`talk about \`${FILE_MARKER}\` inline`
		].join("\n");
		const { stripped, tags } = extractAttachmentTags(doc);
		expect(tags).toEqual([]);
		expect(stripped).toBe(doc);
	});
});

describe("leftoverAttachments", () => {
	const img = (id: string) => testAttachment({ id, kind: "image" });
	const file = (id: string) => testAttachment({ id, kind: "text" });

	it("consumes the first attachments of each kind per literal", () => {
		const atts = [img("a"), img("b"), file("c")];
		expect(
			leftoverAttachments(atts, `${IMAGE_MARKER} hi`).map((a) => a.id)
		).toEqual(["b", "c"]);
		expect(leftoverAttachments(atts, "plain text").map((a) => a.id)).toEqual([
			"a",
			"b",
			"c"
		]);
		expect(
			leftoverAttachments(
				atts,
				`${IMAGE_MARKER} ${IMAGE_MARKER} ${FILE_MARKER}`
			).map((a) => a.id)
		).toEqual([]);
	});

	it("ignores literals inside code", () => {
		const atts = [img("a")];
		expect(
			leftoverAttachments(atts, `\`${IMAGE_MARKER}\``).map((a) => a.id)
		).toEqual(["a"]);
	});
});

describe("attachmentImageBlobs", () => {
	const PNG =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
	const png = (id: string, dataUrl: string | null = PNG) =>
		testAttachment({ id, kind: "image", mime: "image/png", dataUrl });

	it("hands the newest image attachments as blobs", async () => {
		// The 5-byte entry is oldest: newest-two slicing skips it (an
		// oldest-first take would lead with it).
		const tiny = testAttachment({
			id: "a",
			kind: "image",
			mime: "image/png",
			dataUrl: "data:,hello"
		});
		const blobs = await attachmentImageBlobs([tiny, png("b"), png("c")], 2);
		const pngSize = (await (await fetch(PNG)).blob()).size;
		expect(blobs.map((b) => b.size)).toEqual([pngSize, pngSize]);
		expect(blobs.map((b) => b.type)).toEqual(["image/png", "image/png"]);
	});

	it("skips text attachments, dataless images, and dead counts", async () => {
		const atts = [
			testAttachment({ id: "t", kind: "text", text: "hi" }),
			png("nodata", null),
			png("a")
		];
		expect(await attachmentImageBlobs(atts, 5)).toHaveLength(1);
		expect(await attachmentImageBlobs(atts, 0)).toEqual([]);
		expect(await attachmentImageBlobs([], 2)).toEqual([]);
	});

	it("skips unreadable entries instead of failing", async () => {
		const atts = [
			png("bad", "http://127.0.0.1:1/unreachable.png"),
			png("good")
		];
		expect(await attachmentImageBlobs(atts, 2)).toHaveLength(1);
	});
});

describe("indexed attachment access", () => {
	const PNG =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
	const png = (id: string, dataUrl: string | null = PNG) =>
		testAttachment({ id, kind: "image", mime: "image/png", dataUrl });
	const pngSize = async (): Promise<number> =>
		(await (await fetch(PNG)).blob()).size;

	it("reads blobs for the indexed attachments, skipping dataless ones in place", async () => {
		const atts = [
			png("a"),
			testAttachment({ id: "t", kind: "text", text: "hi" }),
			png("nodata", null),
			png("c")
		];
		// Indexes ride image order (text attachments don't shift them).
		const blobs = await attachmentImageBlobsAt(atts, [0, 1, 2]);
		expect(blobs.map((b) => b.size)).toEqual([
			await pngSize(),
			await pngSize()
		]);
		expect(await attachmentImageBlobsAt(atts, [5, -1])).toEqual([]);
	});

	it("reads data URLs synchronously for same-event clipboard writes", () => {
		const atts = [
			png("a"),
			testAttachment({ id: "t", kind: "text", text: "hi" }),
			png("nodata", null)
		];
		expect(attachmentDataUrlsAt(atts, [0])).toEqual([PNG]);
		expect(attachmentDataUrlsAt(atts, [1])).toEqual([null]);
		expect(attachmentDataUrlsAt(atts, [9])).toEqual([null]);
	});

	it("drops one kind's attachments at document-order indexes", () => {
		const img = (id: string) => testAttachment({ id, kind: "image" });
		const file = (id: string) => testAttachment({ id, kind: "text" });
		const atts = [img("a"), file("f"), img("b"), img("c")];
		// Deleting the first tag drops the first image, files untouched.
		expect(
			dropAttachmentsAtIndexes(atts, "image", [0]).map((a) => a.id)
		).toEqual(["f", "b", "c"]);
		expect(
			dropAttachmentsAtIndexes(atts, "image", [1]).map((a) => a.id)
		).toEqual(["a", "f", "c"]);
		expect(
			dropAttachmentsAtIndexes(atts, "text", [0]).map((a) => a.id)
		).toEqual(["a", "b", "c"]);
		// Out-of-range and negative indexes drop nothing.
		expect(dropAttachmentsAtIndexes(atts, "image", [9, -1])).toHaveLength(4);
		expect(dropAttachmentsAtIndexes([], "image", [0])).toEqual([]);
	});
});

describe("reconcileDropCount", () => {
	it("drops the fall and heals orphans, never more", () => {
		// Synced fall: the difference goes.
		expect(reconcileDropCount(3, 1, 3)).toBe(2);
		// Rise or dead tags: nothing moves.
		expect(reconcileDropCount(1, 2, 1)).toBe(0);
		expect(reconcileDropCount(1, 3, 2)).toBe(0);
		// Orphan: attachments with no tags drop the excess.
		expect(reconcileDropCount(2, 0, 0)).toBe(2);
		expect(reconcileDropCount(2, 1, 1)).toBe(1);
		// Empty stays empty.
		expect(reconcileDropCount(0, 0, 0)).toBe(0);
	});
});

describe("clipboardPngBlob", () => {
	it("passes PNG through untouched", async () => {
		const blob = new Blob(["png-bytes"], { type: "image/png" });
		await expect(clipboardPngBlob(blob)).resolves.toBe(blob);
	});

	it("falls back to the original without a converter", async () => {
		// No createImageBitmap outside browsers: the JPEG survives for
		// engines that write it (Safari), instead of throwing.
		const blob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
		await expect(clipboardPngBlob(blob)).resolves.toBe(blob);
	});
});

describe("pasted-text tags", () => {
	it("labels the stored char count and counts tags", () => {
		expect(pastedTextMarker(512)).toBe("[Pasted 512 chars]");
		expect(countPastedTags("plain text")).toBe(0);
		expect(
			countPastedTags(`a ${pastedTextMarker(10)} b ${pastedTextMarker(20)}`)
		).toBe(2);
		// Fixed markers never read as pasted tags.
		expect(countPastedTags(`${IMAGE_MARKER} ${FILE_MARKER}`)).toBe(0);
		expect(countMarkers(pastedTextMarker(10))).toBe(0);
	});

	it("inserts with the same caret contract as image/file tags", () => {
		// Empty and newline-ended drafts take the tag as-is.
		expect(pastedMarkerInsert("", 10)).toBe("[Pasted 10 chars] ");
		expect(pastedMarkerInsert("notes\n", 10)).toBe("[Pasted 10 chars] ");
		// Chained after another tag's trailing space: same line.
		expect(pastedMarkerInsert(`${IMAGE_MARKER} `, 10)).toBe(
			"[Pasted 10 chars] "
		);
		// Spaceless mid-prose takes the tag on its line, one space
		// apart — never glues, never a line of its own.
		expect(pastedMarkerInsert("hello", 10)).toBe(" [Pasted 10 chars] ");
		// Prose already spaced stays on its line.
		expect(pastedMarkerInsert("hello ", 10)).toBe("[Pasted 10 chars] ");
	});
});

describe("makePastedTextAttachment", () => {
	it("builds a flagged text attachment with token cost", () => {
		const text = "pasted body";
		const att = makePastedTextAttachment(text);
		expect(att.kind).toBe("text");
		expect(att.text).toBe(text);
		expect(att.pastedText).toBe(true);
		expect(att.tokens).toBe(Math.max(1, Math.ceil(text.length / 4)));
		expect(isPastedTextAttachment(att)).toBe(true);
	});

	it("caps like file drops and leaves files unflagged", () => {
		const att = makePastedTextAttachment("a".repeat(MAX_FILE_CHARS + 10));
		expect(att.text?.length).toBe(MAX_FILE_CHARS);
		expect(pastedTextMarker(att.text?.length ?? 0)).toBe(
			`[Pasted ${MAX_FILE_CHARS} chars]`
		);
		expect(isPastedTextAttachment(testAttachment({ kind: "text" }))).toBe(
			false
		);
		expect(isPastedTextAttachment(testAttachment({ kind: "image" }))).toBe(
			false
		);
	});
});

describe("removePastedAt", () => {
	it("drops the indexed tag, never the first of its kind by accident", () => {
		const doc = `a ${pastedTextMarker(10)} b ${pastedTextMarker(20)}`;
		expect(removePastedAt(doc, 1)).toBe(`a ${pastedTextMarker(10)} b`);
		expect(removePastedAt(doc, 0)).toBe(`a b ${pastedTextMarker(20)}`);
	});

	it("keeps prose typed beside the tag and drops bare host lines", () => {
		expect(removePastedAt(`look ${pastedTextMarker(5)} here`, 0)).toBe(
			"look here"
		);
		expect(removePastedAt(`before\n${pastedTextMarker(5)} \nafter`, 0)).toBe(
			"before\nafter"
		);
	});

	it("leaves text untouched out of range", () => {
		expect(removePastedAt("plain", 0)).toBe("plain");
		expect(removePastedAt(pastedTextMarker(5), 3)).toBe(pastedTextMarker(5));
		expect(removePastedAt(pastedTextMarker(5), -1)).toBe(pastedTextMarker(5));
	});
});

describe("stripPastedMarkers", () => {
	it("drops every pasted tag without touching prose spacing", () => {
		expect(stripPastedMarkers(`a  b ${pastedTextMarker(3)} c`)).toBe("a  b c");
		expect(stripPastedMarkers(`keep\n${pastedTextMarker(3)}\nkeep`)).toBe(
			"keep\nkeep"
		);
		expect(stripPastedMarkers("plain")).toBe("plain");
		// Fixed markers stay for their own strip.
		expect(stripPastedMarkers(`${IMAGE_MARKER} hi`)).toBe(`${IMAGE_MARKER} hi`);
	});
});

describe("splicePastedText", () => {
	it("splices stored text at tag positions index-matched", () => {
		const doc = `intro ${pastedTextMarker(3)} middle ${pastedTextMarker(3)} end`;
		expect(splicePastedText(doc, ["AAA", "BBB"])).toBe(
			"intro AAA middle BBB end"
		);
	});

	it("leaves tags without text literal and end-appends texts without tags", () => {
		// Fewer texts than tags: the orphan tag stays (hand-typed or
		// resurrected by undo), exactly like an unmatched literal.
		expect(splicePastedText(`a ${pastedTextMarker(3)}`, [])).toBe(
			`a ${pastedTextMarker(3)}`
		);
		// More texts than tags: leftovers end-append like files.
		expect(splicePastedText("hi", ["AAA", "BBB"])).toBe("hi\n\nAAA\n\nBBB");
		expect(splicePastedText("", ["AAA"])).toBe("AAA");
		expect(splicePastedText("hi", [])).toBe("hi");
	});
});

describe("splicePastedFolds", () => {
	it("splices prose and folds it so the tag comes back on send", () => {
		const doc = `intro ${pastedTextMarker(3)} middle ${pastedTextMarker(3)} end`;
		const { text, folds } = splicePastedFolds(doc, ["AAA", "BBB"]);
		expect(text).toBe("intro AAA middle BBB end");
		expect(folds).toEqual([
			{ start: 6, end: 9, chars: 3 },
			{ start: 17, end: 20, chars: 3 }
		]);
		// Every fold slices exactly its prose back out.
		for (const fold of folds) {
			expect(text.slice(fold.start, fold.end)).toHaveLength(fold.chars);
		}
	});

	it("leaves textless tags literal with no fold and ignores tagless docs", () => {
		expect(splicePastedFolds(`a ${pastedTextMarker(3)}`, [])).toEqual({
			text: `a ${pastedTextMarker(3)}`,
			folds: []
		});
		expect(splicePastedFolds("plain", [])).toEqual({
			text: "plain",
			folds: []
		});
	});

	it("clamps folds into the trimmed send text", () => {
		// Trailing-space prose (the usual paste tail): the stored
		// text trims it, so the fold must end where storage ends or
		// the renderer drops it and the tag is lost.
		const { text, folds } = splicePastedFolds(`${pastedTextMarker(3)} `, [
			"AAA "
		]);
		expect(text).toBe("AAA");
		expect(folds).toEqual([{ start: 0, end: 3, chars: 3 }]);
	});
});

describe("pasted-aware index drops", () => {
	const pasted = (id: string) => ({
		...testAttachment({ id, kind: "text" }),
		pastedText: true
	});
	const file = (id: string) => testAttachment({ id, kind: "text" });

	it("pairs file tags with file drops and pasted tags with pasted drops", () => {
		const list = [file("f"), pasted("p"), file("g")];
		expect(dropFileAttachmentsAtIndexes(list, [0]).map((a) => a.id)).toEqual([
			"p",
			"g"
		]);
		expect(dropFileAttachmentsAtIndexes(list, [1]).map((a) => a.id)).toEqual([
			"f",
			"p"
		]);
		expect(dropPastedAttachmentsAtIndexes(list, [0]).map((a) => a.id)).toEqual([
			"f",
			"g"
		]);
		expect(dropPastedAttachmentsAtIndexes(list, [4]).map((a) => a.id)).toEqual([
			"f",
			"p",
			"g"
		]);
	});

	it("never mistakes fixed markers for pasted tags", () => {
		expect(`${IMAGE_MARKER} ${FILE_MARKER}`.match(PASTED_TAG_RE)).toBeNull();
	});
});

describe("dropNewestWhere", () => {
	const img = (id: string) => testAttachment({ id, kind: "image" });
	it("drops the newest n matches and keeps order", () => {
		const list = [img("a"), img("b"), img("c")];
		expect(
			dropNewestWhere(list, (a) => a.kind === "image", 2).map((a) => a.id)
		).toEqual(["a"]);
	});
	it("keeps everything when nothing matches or n is zero", () => {
		const list = [img("a")];
		expect(
			dropNewestWhere(list, (a) => a.kind === "text", 1).map((a) => a.id)
		).toEqual(["a"]);
		expect(
			dropNewestWhere(list, (a) => a.kind === "image", 0).map((a) => a.id)
		).toEqual(["a"]);
	});
});

describe("reconcileTagRemovals", () => {
	const img = (id: string) => testAttachment({ id, kind: "image" });
	const file = (id: string) => testAttachment({ id, kind: "text" });
	const pasted = (id: string) => ({
		...testAttachment({ id, kind: "text" }),
		pastedText: true
	});
	const ids = (list: Attachment[]) => list.map((a) => a.id);
	it("keeps everything when tags match attachments", () => {
		const list = [img("a"), file("b")];
		expect(
			ids(reconcileTagRemovals(list, 1, 1, 1, 1, undefined, 0, 0))
		).toEqual(["a", "b"]);
	});
	it("drops explicitly removed tags by index", () => {
		const list = [img("a"), img("b")];
		expect(
			ids(
				reconcileTagRemovals(list, 1, 0, 2, 0, { image: [0], file: [] }, 0, 0)
			)
		).toEqual(["b"]);
	});
	it("drops orphan attachments newest-first", () => {
		const list = [img("a"), img("b"), file("c")];
		expect(ids(reconcileTagRemovals(list, 1, 1, 1, 1, undefined, 0, 0))).toEqual(
			["a", "c"]
		);
	});
	it("drops orphan pastes newest-first", () => {
		const list = [pasted("a"), pasted("b")];
		expect(ids(reconcileTagRemovals(list, 0, 0, 0, 0, undefined, 1, 1))).toEqual(
			["a"]
		);
	});
});

describe("blobToDataUrl", () => {
	it("encodes typed blobs without FileReader", async () => {
		await expect(
			blobToDataUrl(new Blob(["hi"], { type: "image/png" }))
		).resolves.toBe("data:image/png;base64,aGk=");
	});

	it("falls back to octet-stream for typeless blobs, like FileReader", async () => {
		await expect(blobToDataUrl(new Blob(["hi"]))).resolves.toBe(
			"data:application/octet-stream;base64,aGk="
		);
	});
});

describe("spliceSendText", () => {
	const pasted = (id: string, text: string) => ({
		...testAttachment({ id, kind: "text" as const, text }),
		pastedText: true as const
	});

	it("splices pasted pills inline and keeps the rest", () => {
		const img = testAttachment({ id: "i", kind: "image" });
		const { stored, kept, pastedFolds } = spliceSendText(
			`hi ${pastedTextMarker(3)}`,
			[pasted("p", "AAA "), img]
		);
		expect(stored).toBe(`hi AAA ${IMAGE_MARKER}`);
		expect(kept.map((a) => a.id)).toEqual(["i"]);
		expect(pastedFolds).toEqual([{ start: 3, end: 6, chars: 3 }]);
	});

	it("stores prose with no pills untouched", () => {
		expect(spliceSendText("plain", [])).toEqual({
			stored: "plain",
			kept: [],
			pastedFolds: []
		});
	});
});

describe("sentTagModelsFor", () => {
	it("models leftovers with expanded flags", () => {
		const atts = [
			testAttachment({ id: "a", kind: "image" }),
			testAttachment({ id: "b", kind: "text", text: "hello" })
		];
		const models = sentTagModelsFor(atts, "no literals here", "m1", [
			"m1:b"
		]);
		expect(models.map((m) => [m.id, m.open])).toEqual([
			["a", false],
			["b", true]
		]);
		expect(models[1]).toMatchObject({ kind: "text", text: "hello" });
	});
});

describe("toggleTagKey", () => {
	it("toggles the tapped tag, closing same-message siblings", () => {
		expect(toggleTagKey([], "m1", "a")).toEqual(["m1:a"]);
		expect(toggleTagKey(["m1:a"], "m1", "a")).toEqual([]);
		expect(toggleTagKey(["m1:a"], "m1", "b")).toEqual(["m1:b"]);
		expect(toggleTagKey(["m1:a", "m2:x"], "m1", "b")).toEqual([
			"m2:x",
			"m1:b"
		]);
	});
});

describe("syncTagRemovals", () => {
	const img = (id: string) => testAttachment({ id, kind: "image" });
	const zero = { markers: 0, fileMarkers: 0, pasted: 0 };

	it("counts text and reports no change when tags match", () => {
		const list = [img("a")];
		const doc = `see ${IMAGE_MARKER}`;
		const step = syncTagRemovals(list, doc, undefined, zero);
		expect(step.kept.map((a) => a.id)).toEqual(["a"]);
		expect(step.cleared).toBe(false);
		expect(step.counts).toEqual({ markers: 1, fileMarkers: 0, pasted: 0 });
	});

	it("drops orphan attachments and flags the clear", () => {
		const list = [img("a"), img("b")];
		const step = syncTagRemovals(list, "no tags", undefined, {
			markers: 2,
			fileMarkers: 0,
			pasted: 0
		});
		expect(step.kept).toEqual([]);
		expect(step.cleared).toBe(true);
		expect(step.counts.markers).toBe(0);
	});
});
