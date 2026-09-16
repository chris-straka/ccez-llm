import { describe, it, expect } from "vitest";
import {
	IMAGE_MARKER,
	IMAGE_MAX_DIM,
	MAX_FILE_CHARS,
	countMarkers,
	fitDimensions,
	imageMarkerInsert,
	imageTokens,
	isTextFile,
	removeMarker,
	stripImageMarkers
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

describe("image markers", () => {
	it("strips pasted-image marker tags on send, keeping prose and blank lines", () => {
		const text = `hello\n${IMAGE_MARKER}\nworld`;
		expect(stripImageMarkers(text)).toBe("hello\nworld");
		expect(stripImageMarkers("no markers")).toBe("no markers");
		// Tags typed beside prose strip; the user's words and blank
		// lines survive.
		expect(stripImageMarkers(`${IMAGE_MARKER} describe this`)).toBe("describe this");
		expect(stripImageMarkers(`look ${IMAGE_MARKER} here`)).toBe("look here");
		expect(stripImageMarkers(`hello\n\n${IMAGE_MARKER} \nworld`)).toBe("hello\n\nworld");
		// Stacked tags on one line all go.
		expect(stripImageMarkers(`${IMAGE_MARKER} ${IMAGE_MARKER} `)).toBe("");
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

	it("removes one marker tag at a time, sparing beside-prose", () => {
		const text = `hello\n${IMAGE_MARKER}\n${IMAGE_MARKER}\nworld`;
		expect(removeMarker(text)).toBe(`hello\n${IMAGE_MARKER}\nworld`);
		expect(removeMarker("no markers")).toBe("no markers");
		// Pill → tag on a lived-in line: the tag goes, the words stay.
		expect(removeMarker(`${IMAGE_MARKER} describe this`)).toBe("describe this");
		expect(removeMarker(`look ${IMAGE_MARKER} here`)).toBe("look here");
		expect(removeMarker(`${IMAGE_MARKER} `)).toBe("");
	});

	it("counts marker tags, even stacked on one line", () => {
		expect(countMarkers(`${IMAGE_MARKER} \nhello\n${IMAGE_MARKER}`)).toBe(2);
		expect(countMarkers(`${IMAGE_MARKER} ${IMAGE_MARKER} `)).toBe(2);
		expect(countMarkers(`look ${IMAGE_MARKER} here`)).toBe(1);
		expect(countMarkers("plain")).toBe(0);
	});
});

describe("attachment budgets", () => {
	it("text attachments cost ~4 chars per token, capped by MAX_FILE_CHARS", () => {
		expect(MAX_FILE_CHARS).toBe(100_000);
		expect(estimateTextTokens("a".repeat(400))).toBe(100);
	});
});
