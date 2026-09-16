import { describe, it, expect } from "vitest";
import {
	FILE_MARKER,
	IMAGE_MARKER,
	IMAGE_MAX_DIM,
	MAX_FILE_CHARS,
	countMarkers,
	fileExcerpt,
	fileMarkerInsert,
	fitDimensions,
	imageMarkerInsert,
	imageTokens,
	isTextFile,
	removeMarker,
	removeTags,
	stripAttachmentMarkers
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
		expect(stripAttachmentMarkers(`${IMAGE_MARKER} describe this`)).toBe("describe this");
		expect(stripAttachmentMarkers(`look ${IMAGE_MARKER} here`)).toBe("look here");
		expect(stripAttachmentMarkers(`hello\n\n${IMAGE_MARKER} \nworld`)).toBe("hello\n\nworld");
		// Stacked tags on one line all go, mixed kinds alike.
		expect(stripAttachmentMarkers(`${IMAGE_MARKER} ${IMAGE_MARKER} `)).toBe("");
		expect(stripAttachmentMarkers(`${FILE_MARKER} read this`)).toBe("read this");
		expect(stripAttachmentMarkers(`see ${FILE_MARKER} now`)).toBe("see now");
		expect(stripAttachmentMarkers(`${IMAGE_MARKER} ${FILE_MARKER} `)).toBe("");
	});

	it("says [Pasted image] plus one space, caret staying on the line", () => {
		expect(IMAGE_MARKER).toBe("[Pasted image]");
		expect(imageMarkerInsert("")).toBe(`${IMAGE_MARKER} `);
		expect(imageMarkerInsert("draft\n")).toBe(`${IMAGE_MARKER} `);
		// Mid-draft: no blank line before the tag, still no newline
		// after it — the caret lands after the space, same line.
		expect(imageMarkerInsert("hello")).toBe(`\n${IMAGE_MARKER} `);
		expect(imageMarkerInsert("hello\n")).toBe(`${IMAGE_MARKER} `);
	});

	it("says [Pasted Attachment] under the same contract", () => {
		expect(FILE_MARKER).toBe("[Pasted Attachment]");
		expect(fileMarkerInsert("")).toBe(`${FILE_MARKER} `);
		expect(fileMarkerInsert("hello")).toBe(`\n${FILE_MARKER} `);
		expect(fileMarkerInsert("hello\n")).toBe(`${FILE_MARKER} `);
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
		expect(removeMarker(`${FILE_MARKER} read this`, FILE_MARKER)).toBe("read this");
		expect(removeMarker(`${IMAGE_MARKER} ${FILE_MARKER}`, FILE_MARKER)).toBe(`${IMAGE_MARKER}`);
		expect(removeMarker(`${IMAGE_MARKER} x`, FILE_MARKER)).toBe(`${IMAGE_MARKER} x`);
	});

	it("counts marker tags per kind, even stacked on one line", () => {
		expect(countMarkers(`${IMAGE_MARKER} \nhello\n${IMAGE_MARKER}`)).toBe(2);
		expect(countMarkers(`${IMAGE_MARKER} ${IMAGE_MARKER} `)).toBe(2);
		expect(countMarkers(`look ${IMAGE_MARKER} here`)).toBe(1);
		expect(countMarkers("plain")).toBe(0);
		expect(countMarkers(`${FILE_MARKER} a ${FILE_MARKER}`, FILE_MARKER)).toBe(2);
		expect(countMarkers(`${IMAGE_MARKER} ${FILE_MARKER}`)).toBe(1);
		expect(countMarkers(`${IMAGE_MARKER} ${FILE_MARKER}`, FILE_MARKER)).toBe(1);
	});

	it("cuts tag ranges with offsets for fold mapping", () => {
		expect(removeTags("no markers")).toEqual({ text: "no markers", cuts: [] });
		expect(removeTags(`${IMAGE_MARKER} hi`)).toEqual({ text: "hi", cuts: [{ start: 0, end: 15 }] });
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
