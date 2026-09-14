import { describe, it, expect } from "vitest";
import {
	IMAGE_MARKER,
	IMAGE_MAX_DIM,
	MAX_FILE_CHARS,
	countMarkerLines,
	fitDimensions,
	imageMarkerInsert,
	imageTokens,
	isTextFile,
	removeMarkerLine,
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
	it("strips pasted-image marker lines on send", () => {
		const text = `hello\n${IMAGE_MARKER}\nworld`;
		expect(stripImageMarkers(text)).toBe("hello\nworld");
		expect(stripImageMarkers("no markers")).toBe("no markers");
	});

	it("says [Pasted image] with no trailing space and no leading blank line", () => {
		expect(IMAGE_MARKER).toBe("[Pasted image]");
		expect(imageMarkerInsert("")).toBe(`${IMAGE_MARKER}\n`);
		expect(imageMarkerInsert("draft\n")).toBe(`${IMAGE_MARKER}\n`);
		// Mid-line: own line, but no blank line before the tag.
		expect(imageMarkerInsert("hello")).toBe(`\n${IMAGE_MARKER}\n`);
		// Stacked pastes: each tag keeps its own line.
		expect(imageMarkerInsert(`${IMAGE_MARKER}\n`)).toBe(`${IMAGE_MARKER}\n`);
	});

	it("removes one marker line at a time", () => {
		const text = `hello\n${IMAGE_MARKER}\n${IMAGE_MARKER}\nworld`;
		expect(removeMarkerLine(text)).toBe(`hello\n${IMAGE_MARKER}\nworld`);
		expect(removeMarkerLine("no markers")).toBe("no markers");
	});

	it("counts marker lines including legacy trailing-space tags", () => {
		expect(countMarkerLines(`${IMAGE_MARKER} \nhello\n${IMAGE_MARKER}`)).toBe(2);
		expect(countMarkerLines("plain")).toBe(0);
	});
});

describe("attachment budgets", () => {
	it("text attachments cost ~4 chars per token, capped by MAX_FILE_CHARS", () => {
		expect(MAX_FILE_CHARS).toBe(100_000);
		expect(estimateTextTokens("a".repeat(400))).toBe(100);
	});
});
