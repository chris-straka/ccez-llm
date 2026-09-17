import { describe, it, expect } from "vitest";
import { trimPasteTail, sendPasteFolds, pasteToggleAction, markerCut, tagCopyPlan } from "./editor";
import {
	stripAttachmentMarkers,
	removeMarker,
	IMAGE_MARKER,
	FILE_MARKER
} from "./attachments";

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
		const { text, folds } = sendPasteFolds(doc, [{ from: 6, to: 12, chars: 6 }]);
		expect(text).toBe(doc);
		expect(folds).toEqual([{ start: 6, end: 12, chars: 6 }]);
	});

	it("shifts spans past marker lines and trim", () => {
		const doc = `\n\n${IMAGE_MARKER}\nhello PASTED`;
		const { text, folds } = sendPasteFolds(doc, [{ from: 23, to: 29, chars: 6 }]);
		expect(text).toBe("hello PASTED");
		expect(folds).toEqual([{ start: 6, end: 12, chars: 6 }]);
	});

	it("drops spans touched by stripping instead of misplacing them", () => {
		const doc = `aaa\n${IMAGE_MARKER}\nbbb`;
		expect(sendPasteFolds(doc, [{ from: 2, to: 24, chars: 22 }]).folds).toEqual([]);
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
					const applied = doc.slice(0, cut!.from) + cut!.insert + doc.slice(cut!.to);
					expect(applied).toBe(expected);
				}
			}
		}
	});
	it("drops a blank host line with its newline, keeps beside-prose", () => {
		const cut = markerCut(`a\n${IMAGE_MARKER}\nb`, IMAGE_MARKER);
		expect(cut).toEqual({ from: 2, to: 2 + IMAGE_MARKER.length + 1, insert: "" });
		const kept = markerCut(`${IMAGE_MARKER} describe`, IMAGE_MARKER);
		expect(kept).toEqual({
			from: 0,
			to: IMAGE_MARKER.length + 1 + "describe".length,
			insert: "describe"
		});
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
		expect(tagCopyPlan(`see ${IMAGE_MARKER} and ${IMAGE_MARKER} end`, true)?.imageTags).toBe(2);
	});
});
