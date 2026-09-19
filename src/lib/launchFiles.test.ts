import { describe, it, expect, vi } from "vitest";
import {
	consumeLaunchFiles,
	isMarkdownFilename,
	splitLaunchFiles,
	type LaunchParamsLike,
	type LaunchQueueLike
} from "./launchFiles";

function textFile(name: string, content = "x"): File {
	return new File([content], name, { type: "text/plain" });
}

describe("launchQueue intake", () => {
	it("returns false and calls nothing without a queue", () => {
		const onFiles = vi.fn();
		expect(consumeLaunchFiles(null, onFiles)).toBe(false);
		expect(consumeLaunchFiles(undefined, onFiles)).toBe(false);
		expect(onFiles).not.toHaveBeenCalled();
	});

	it("resolves handles to files and skips unreadable ones", async () => {
		let consumer!: (params: LaunchParamsLike) => void;
		const queue: LaunchQueueLike = {
			setConsumer: (callback) => {
				consumer = callback;
			}
		};
		const seen: File[][] = [];
		expect(
			consumeLaunchFiles(queue, (files) => {
				seen.push(files);
			})
		).toBe(true);
		const good = textFile("notes.md", "hello");
		consumer({
			files: [
				{ getFile: async () => good },
				{
					getFile: async () => {
						throw new Error("locked");
					}
				}
			]
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(seen).toEqual([[good]]);
	});

	it("never calls back on an empty launch", async () => {
		let consumer!: (params: LaunchParamsLike) => void;
		const queue: LaunchQueueLike = {
			setConsumer: (callback) => {
				consumer = callback;
			}
		};
		const onFiles = vi.fn();
		consumeLaunchFiles(queue, onFiles);
		consumer({ files: [] });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(onFiles).not.toHaveBeenCalled();
	});
});
describe("markdown filename split", () => {
	it("matches .md and .markdown case-insensitively", () => {
		expect(isMarkdownFilename("notes.md")).toBe(true);
		expect(isMarkdownFilename("NOTES.MD")).toBe(true);
		expect(isMarkdownFilename("doc.markdown")).toBe(true);
		expect(isMarkdownFilename("photo.png")).toBe(false);
		expect(isMarkdownFilename("md")).toBe(false);
	});

	it("routes markdown to the composer and the rest to attachments", () => {
		const md = textFile("notes.md");
		const upper = textFile("UPPER.MARKDOWN");
		const png = new File(["x"], "shot.png", { type: "image/png" });
		expect(splitLaunchFiles([md, png, upper])).toEqual({
			markdown: [md, upper],
			rest: [png]
		});
	});
});
