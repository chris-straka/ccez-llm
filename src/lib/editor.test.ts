import { describe, it, expect } from "vitest";
import {
	trimPasteTail,
	sendPasteFolds,
	pasteToggleAction,
	markerCut,
	markerCutAt,
	pastedCutAt,
	attachTagRanges,
	tagCopyPlan,
	tagCopyIndexes,
	removedMarkerIndexes,
	dataUrlsToImageFiles,
	expandDeletionUnits,
	collapsedPasteInsert
} from "./editor";
import {
	stripAttachmentMarkers,
	removeMarker,
	removePastedAt,
	countPastedTags,
	pastedTextMarker,
	IMAGE_MARKER,
	FILE_MARKER
} from "./attachments";

describe("collapsedPasteInsert", () => {
	it("lands one trailing space past the collapsed span", () => {
		const text = "lorem ipsum dolor sit amet";
		const collapsed = collapsedPasteInsert(7, text);
		expect(collapsed.insert).toBe(`${text} `);
		expect([collapsed.pasteFrom, collapsed.pasteTo]).toEqual([
			7,
			7 + text.length
		]);
		expect(collapsed.chars).toBe(text.length);
		expect(collapsed.anchor).toBe(7 + text.length + 1);
	});
});

describe("trimPasteTail", () => {
	it("strips trailing newlines but keeps content and interior breaks", () => {
		expect(trimPasteTail("hello world\n\n\n")).toBe("hello world");
		expect(trimPasteTail("one\ntwo\n")).toBe("one\ntwo");
		expect(trimPasteTail("one\r\ntwo\r\n\r\n")).toBe("one\r\ntwo");
	});

	it("leaves clean text alone", () => {
		expect(trimPasteTail("hello world")).toBe("hello world");
		expect(trimPasteTail("one\ntwo")).toBe("one\ntwo");
		expect(trimPasteTail("")).toBe("");
	});

	it("collapses newline-only pastes to empty (the caller swallows those)", () => {
		expect(trimPasteTail("\n\n\n")).toBe("");
	});

	it("keeps leading newlines and trailing spaces on the last line", () => {
		expect(trimPasteTail("\nhello")).toBe("\nhello");
		expect(trimPasteTail("hello   \n\n")).toBe("hello   ");
	});
});

describe("sendPasteFolds", () => {
	it("matches composerText output exactly when nothing is pasted", () => {
		const docs = [
			"hello world",
			"  padded  ",
			"\n\nhello\n\n",
			`before\n${IMAGE_MARKER}\nafter`,
			`${IMAGE_MARKER}\nonly text`,
			`text\n${IMAGE_MARKER}\n`,
			// Same-line tags (composer inserts beside the caret): the
			// tag strips, beside-prose and blank lines survive.
			`${IMAGE_MARKER} describe this`,
			`look ${IMAGE_MARKER} here`,
			`hello\n\n${IMAGE_MARKER} \nworld`,
			`${IMAGE_MARKER} ${IMAGE_MARKER} `,
			`${FILE_MARKER} read this`,
			`look ${FILE_MARKER} here`,
			`${IMAGE_MARKER} ${FILE_MARKER} `,
			""
		];
		for (const doc of docs) {
			const { text, folds } = sendPasteFolds(doc, []);
			expect(text).toBe(stripAttachmentMarkers(doc).trim());
			expect(folds).toEqual([]);
		}
	});

	it("maps a basic span into send coordinates", () => {
		const doc = "hello PASTED world";
		const { text, folds } = sendPasteFolds(doc, [
			{ from: 6, to: 12, chars: 6 }
		]);
		expect(text).toBe(doc);
		expect(folds).toEqual([{ start: 6, end: 12, chars: 6 }]);
	});

	it("shifts spans past marker lines and trim", () => {
		const doc = `\n\n${IMAGE_MARKER}\nhello PASTED`;
		const { text, folds } = sendPasteFolds(doc, [
			{ from: 23, to: 29, chars: 6 }
		]);
		expect(text).toBe("hello PASTED");
		expect(folds).toEqual([{ start: 6, end: 12, chars: 6 }]);
	});

	it("drops spans touched by stripping instead of misplacing them", () => {
		const doc = `aaa\n${IMAGE_MARKER}\nbbb`;
		expect(sendPasteFolds(doc, [{ from: 2, to: 24, chars: 22 }]).folds).toEqual(
			[]
		);
	});

	it("drops invalid spans and sorts the rest", () => {
		const doc = "aa bb cc";
		const { folds } = sendPasteFolds(doc, [
			{ from: 6, to: 8, chars: 2 },
			{ from: 0, to: 2, chars: 2 },
			{ from: -1, to: 2, chars: 3 },
			{ from: 5, to: 5, chars: 0 },
			{ from: 0, to: 99, chars: 99 }
		]);
		expect(folds).toEqual([
			{ start: 0, end: 2, chars: 2 },
			{ start: 6, end: 8, chars: 2 }
		]);
	});
});

describe("pasteToggleAction", () => {
	it("expands while any tag is still collapsed", () => {
		expect(pasteToggleAction(2, 1)).toBe("expand");
		expect(pasteToggleAction(1, 0)).toBe("expand");
	});

	it("collapses back once everything is expanded", () => {
		expect(pasteToggleAction(0, 3)).toBe("collapse");
	});

	it("claims nothing with no tags, so Ctrl+O keeps its thoughts toggle", () => {
		expect(pasteToggleAction(0, 0)).toBe("none");
	});
});

describe("markerCut", () => {
	const docs = [
		"hello world",
		`\n\nhello\n\n`,
		`before\n${IMAGE_MARKER}\nafter`,
		`${IMAGE_MARKER}\nonly text`,
		`text\n${IMAGE_MARKER}\n`,
		`${IMAGE_MARKER} describe this`,
		`look ${IMAGE_MARKER} here`,
		`hello\n\n${IMAGE_MARKER} \nworld`,
		`${IMAGE_MARKER} ${IMAGE_MARKER} `,
		`${FILE_MARKER} read this`,
		`look ${FILE_MARKER} here`,
		`${IMAGE_MARKER} ${FILE_MARKER} `,
		`trailing ${IMAGE_MARKER}   `,
		""
	];
	it("returns null with no tag", () => {
		expect(markerCut("hello world", IMAGE_MARKER)).toBeNull();
		expect(markerCut("", FILE_MARKER)).toBeNull();
	});
	it("applying the cut equals removeMarker on every battery doc", () => {
		for (const marker of [IMAGE_MARKER, FILE_MARKER]) {
			for (const doc of docs) {
				const cut = markerCut(doc, marker);
				const expected = removeMarker(doc, marker);
				if (expected === doc) {
					expect(cut).toBeNull();
				} else {
					expect(cut).not.toBeNull();
					const applied =
						doc.slice(0, cut!.from) + cut!.insert + doc.slice(cut!.to);
					expect(applied).toBe(expected);
				}
			}
		}
	});
	it("drops a blank host line with its newline, keeps beside-prose", () => {
		const cut = markerCut(`a\n${IMAGE_MARKER}\nb`, IMAGE_MARKER);
		expect(cut).toEqual({
			from: 2,
			to: 2 + IMAGE_MARKER.length + 1,
			insert: ""
		});
		const kept = markerCut(`${IMAGE_MARKER} describe`, IMAGE_MARKER);
		expect(kept).toEqual({
			from: 0,
			to: IMAGE_MARKER.length + 1 + "describe".length,
			insert: "describe"
		});
	});

	it("anchors the cut at the index-th occurrence", () => {
		const two = `${IMAGE_MARKER} one\n${IMAGE_MARKER} two`;
		// Index 0 is the legacy cut exactly.
		expect(markerCutAt(two, IMAGE_MARKER, 0)).toEqual(
			markerCut(two, IMAGE_MARKER)
		);
		const second = markerCutAt(two, IMAGE_MARKER, 1);
		expect(second).not.toBeNull();
		const applied =
			two.slice(0, second!.from) + second!.insert + two.slice(second!.to);
		expect(applied).toBe(`${IMAGE_MARKER} one\ntwo`);
		// Out-of-range indexes cut nothing.
		expect(markerCutAt(two, IMAGE_MARKER, 2)).toBeNull();
		expect(markerCutAt(two, IMAGE_MARKER, -1)).toBeNull();
		expect(markerCutAt("no markers", IMAGE_MARKER, 0)).toBeNull();
	});
});

describe("tagCopyPlan", () => {
	it("stays out of plain selections", () => {
		expect(tagCopyPlan("", true)).toBeNull();
		expect(tagCopyPlan("hello", true)).toBeNull();
		expect(tagCopyPlan(`${FILE_MARKER} notes`, true)).toBeNull();
	});

	it("yields without ClipboardItem support", () => {
		expect(tagCopyPlan(`${IMAGE_MARKER} `, false)).toBeNull();
	});

	it("plans the text plus the image-tag count", () => {
		expect(tagCopyPlan(`${IMAGE_MARKER} `, true)).toEqual({
			text: `${IMAGE_MARKER} `,
			imageTags: 1
		});
		expect(
			tagCopyPlan(`see ${IMAGE_MARKER} and ${IMAGE_MARKER} end`, true)
				?.imageTags
		).toBe(2);
	});
});

describe("attachTagRanges", () => {
	it("spans every tag occurrence in document order", () => {
		expect(attachTagRanges("no tags")).toEqual([]);
		expect(attachTagRanges("")).toEqual([]);
		const doc = `see ${IMAGE_MARKER} and ${FILE_MARKER} end`;
		const ranges = attachTagRanges(doc);
		expect(ranges).toHaveLength(2);
		expect(doc.slice(ranges[0]?.from, ranges[0]?.to)).toBe(IMAGE_MARKER);
		expect(doc.slice(ranges[1]?.from, ranges[1]?.to)).toBe(FILE_MARKER);
		expect(ranges[0]?.from).toBeLessThan(ranges[1]?.from ?? 0);
		// Stacked tags index separately.
		expect(attachTagRanges(`${IMAGE_MARKER}${IMAGE_MARKER}`)).toHaveLength(2);
	});
});

describe("tagCopyIndexes", () => {
	it("addresses a selection's tags in global document order", () => {
		const doc = `${IMAGE_MARKER} one\n${IMAGE_MARKER} two\n${IMAGE_MARKER} three`;
		const firstEnd = `${IMAGE_MARKER} one`.length;
		// First tag alone, middle tag alone, whole doc.
		expect(tagCopyIndexes(doc, 0, firstEnd)).toEqual([0]);
		const secondStart = firstEnd + 1;
		const secondEnd = secondStart + `${IMAGE_MARKER} two`.length;
		expect(tagCopyIndexes(doc, secondStart, secondEnd)).toEqual([1]);
		expect(tagCopyIndexes(doc, 0, doc.length)).toEqual([0, 1, 2]);
	});

	it("stays empty without image tags or with an empty range", () => {
		expect(tagCopyIndexes("plain text", 0, 11)).toEqual([]);
		expect(tagCopyIndexes(`${FILE_MARKER} notes`, 0, 20)).toEqual([]);
		expect(tagCopyIndexes(`${IMAGE_MARKER} `, 3, 3)).toEqual([]);
		expect(tagCopyIndexes(`${IMAGE_MARKER} `, 5, 2)).toEqual([]);
	});
});

describe("removedMarkerIndexes", () => {
	const two = `${IMAGE_MARKER} one\n${IMAGE_MARKER} two`;

	it("reports deleted occurrences per kind in document order", () => {
		// Deleting the first tag's span reports image index 0 …
		const firstEnd = two.indexOf("\n");
		expect(removedMarkerIndexes(two, [{ from: 0, to: firstEnd }])).toEqual({
			image: [0],
			file: []
		});
		// … and the second reports index 1 (the desync fix: the host
		// drops the matching attachment, not the newest).
		const secondStart = firstEnd + 1;
		expect(
			removedMarkerIndexes(two, [{ from: secondStart, to: two.length }])
		).toEqual({
			image: [1],
			file: []
		});
	});

	it("separates kinds and spans whole-document wipes", () => {
		const mixed = `${IMAGE_MARKER} ${FILE_MARKER} ${IMAGE_MARKER}`;
		expect(
			removedMarkerIndexes(mixed, [{ from: 0, to: mixed.length }])
		).toEqual({
			image: [0, 1],
			file: [0]
		});
		// Empty and inverted ranges remove nothing.
		expect(removedMarkerIndexes(two, [])).toEqual({ image: [], file: [] });
		expect(removedMarkerIndexes(two, [{ from: 4, to: 4 }])).toEqual({
			image: [],
			file: []
		});
	});
});

describe("dataUrlsToImageFiles", () => {
	const PNG =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

	it("rehydrates data URLs into paste-ready files in order", async () => {
		const files = await dataUrlsToImageFiles([PNG, PNG]);
		expect(files.map((f) => f.name)).toEqual([
			"pasted-image-0.png",
			"pasted-image-1.png"
		]);
		expect(files[0]?.type).toBe("image/png");
		expect(files[0]?.size).toBeGreaterThan(0);
	});

	it("skips non-data and unreadable entries", async () => {
		await expect(
			dataUrlsToImageFiles(["https://example.com/a.png"])
		).resolves.toEqual([]);
		await expect(
			dataUrlsToImageFiles(["data:image/png;base64,!!!"])
		).resolves.toEqual([]);
		await expect(dataUrlsToImageFiles([])).resolves.toEqual([]);
	});
});

describe("expandDeletionUnits", () => {
	const tag = IMAGE_MARKER; // "[Pasted image]", 14 chars
	it("leaves prose deletions alone", () => {
		expect(
			expandDeletionUnits("hello world", [], [{ from: 5, to: 6 }])
		).toEqual([{ from: 5, to: 6 }]);
		expect(expandDeletionUnits("", [], [])).toEqual([]);
	});

	it("takes the whole tag from any touch", () => {
		const doc = `${tag} `;
		// Backspace inside, Delete at the start, Backspace at the end.
		expect(expandDeletionUnits(doc, [], [{ from: 5, to: 6 }])).toEqual([
			{ from: 0, to: 14 }
		]);
		expect(expandDeletionUnits(doc, [], [{ from: 0, to: 1 }])).toEqual([
			{ from: 0, to: 14 }
		]);
		expect(expandDeletionUnits(doc, [], [{ from: 13, to: 14 }])).toEqual([
			{ from: 0, to: 14 }
		]);
	});

	it("spares neighbors the tag merely borders", () => {
		const doc = `${tag} x`;
		expect(expandDeletionUnits(doc, [], [{ from: 14, to: 15 }])).toEqual([
			{ from: 14, to: 15 }
		]);
		expect(expandDeletionUnits(doc, [], [{ from: 15, to: 16 }])).toEqual([
			{ from: 15, to: 16 }
		]);
	});

	it("covers file tags and tag-plus-prose selections", () => {
		const doc = `a${FILE_MARKER}b`;
		expect(expandDeletionUnits(doc, [], [{ from: 2, to: 3 }])).toEqual([
			{ from: 1, to: 20 }
		]);
		const mixed = `ab${tag}cd`;
		expect(expandDeletionUnits(mixed, [], [{ from: 1, to: 19 }])).toEqual([
			{ from: 1, to: 19 }
		]);
	});

	it("takes a whole collapsed span, ignoring bad ones", () => {
		const doc = "x".repeat(120);
		expect(
			expandDeletionUnits(
				doc,
				[{ from: 0, to: 100, chars: 100 }],
				[{ from: 50, to: 51 }]
			)
		).toEqual([{ from: 0, to: 100 }]);
		expect(
			expandDeletionUnits(
				doc,
				[
					{ from: 5, to: 5, chars: 0 },
					{ from: -4, to: 900, chars: 9 }
				],
				[{ from: 50, to: 51 }]
			)
		).toEqual([{ from: 50, to: 51 }]);
	});

	it("merges expansions that meet", () => {
		const doc = `${tag}${tag}`;
		expect(
			expandDeletionUnits(
				doc,
				[],
				[
					{ from: 5, to: 6 },
					{ from: 19, to: 20 }
				]
			)
		).toEqual([{ from: 0, to: 28 }]);
	});

	it("takes a whole pasted-text tag from any touch", () => {
		const paste = pastedTextMarker(120); // "[Pasted 120 chars]", 18 chars
		const doc = `${paste} `;
		expect(expandDeletionUnits(doc, [], [{ from: 5, to: 6 }])).toEqual([
			{ from: 0, to: paste.length }
		]);
		expect(expandDeletionUnits(doc, [], [{ from: 0, to: 1 }])).toEqual([
			{ from: 0, to: paste.length }
		]);
		// Fixed-marker lookalikes still match only themselves.
		expect(expandDeletionUnits(`${tag} x`, [], [{ from: 15, to: 16 }])).toEqual(
			[{ from: 15, to: 16 }]
		);
	});
});

describe("pastedCutAt", () => {
	const battery = [
		"plain text",
		`look ${pastedTextMarker(12)} here`,
		`${pastedTextMarker(7)} `,
		`before\n${pastedTextMarker(200)} \nafter`,
		`a ${pastedTextMarker(9)} b ${pastedTextMarker(44)}`,
		`${IMAGE_MARKER} ${pastedTextMarker(5)}`
	];

	it("matches removePastedAt on every battery doc and index", () => {
		for (const doc of battery) {
			const count = countPastedTags(doc);
			for (let index = 0; index < count + 1; index++) {
				const cut = pastedCutAt(doc, index);
				if (index >= count) {
					expect(cut).toBeNull();
					continue;
				}
				expect(cut).not.toBeNull();
				const applied =
					doc.slice(0, cut?.from) + (cut?.insert ?? "") + doc.slice(cut?.to);
				expect(applied).toBe(removePastedAt(doc, index));
			}
		}
		expect(pastedCutAt(pastedTextMarker(5), -1)).toBeNull();
	});
});

describe("pasted tags in shared tag flows", () => {
	it("removedMarkerIndexes reports pasted occurrences per order", () => {
		const doc = `${IMAGE_MARKER} ${pastedTextMarker(10)} ${pastedTextMarker(20)}`;
		const secondStart = doc.indexOf(pastedTextMarker(20));
		expect(
			removedMarkerIndexes(doc, [{ from: secondStart, to: doc.length }])
		).toEqual({
			image: [],
			file: [],
			pasted: [1]
		});
		// Docs without pastes keep the exact old shape.
		expect(removedMarkerIndexes(`${IMAGE_MARKER} x`, [])).toEqual({
			image: [],
			file: []
		});
	});

	it("attachTagRanges spans pasted tags in document order", () => {
		const doc = `see ${IMAGE_MARKER} and ${pastedTextMarker(33)} end`;
		const ranges = attachTagRanges(doc);
		expect(ranges).toHaveLength(2);
		expect(doc.slice(ranges[0]?.from, ranges[0]?.to)).toBe(IMAGE_MARKER);
		expect(doc.slice(ranges[1]?.from, ranges[1]?.to)).toBe(
			pastedTextMarker(33)
		);
	});
});
