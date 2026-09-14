import { describe, it, expect } from "vitest";
import {
	chatToMarkdown,
	exportChatMarkdown,
	exportFilename,
	type SavePickerOptions
} from "./chatExport";

describe("chatToMarkdown", () => {
	it("renders an empty chat as header plus placeholder", () => {
		expect(chatToMarkdown({ messages: [] })).toBe("# Chat export\n\n(empty chat)\n");
	});

	it("sections roles, trims trailing space, and lists attachments", () => {
		const md = chatToMarkdown({
			messages: [
				{ role: "user", content: "hello   \n", attachments: [{ name: "notes.md" }] },
				{ role: "assistant", content: "hi there" },
				{ role: "user", content: "   " }
			]
		});
		expect(md).toBe(
			[
				"# Chat export",
				"",
				"## You",
				"",
				"hello",
				"",
				"- Attachment: notes.md",
				"",
				"---",
				"",
				"## Assistant",
				"",
				"hi there",
				"",
				"---",
				"",
				"## You",
				"",
				"(no text)",
				""
			].join("\n")
		);
	});
});
describe("exportFilename", () => {
	it("names chat-YYYY-MM-DD.md in UTC", () => {
		expect(exportFilename(Date.parse("2026-03-04T05:06:07Z"))).toBe("chat-2026-03-04.md");
	});
});
describe("exportChatMarkdown", () => {
	const chat = { messages: [{ role: "user" as const, content: "hello" }] };

	it("writes through the picker where available", async () => {
		const written: string[] = [];
		const closed: number[] = [];
		const seen: SavePickerOptions[] = [];
		const how = await exportChatMarkdown(chat, {
			picker: async (options: SavePickerOptions) => {
				seen.push(options);
				return {
					createWritable: async () => ({
						write: async (text: string) => void written.push(text),
						close: async () => void closed.push(1)
					})
				};
			}
		});
		expect(how).toBe("picker");
		expect(written).toEqual([chatToMarkdown(chat)]);
		expect(closed).toHaveLength(1);
		expect(seen).toHaveLength(1);
		const options = seen[0];
		expect(options?.suggestedName).toMatch(/^chat-\d{4}-\d{2}-\d{2}\.md$/);
		expect(options?.types).toEqual([
			{ description: "Markdown", accept: { "text/markdown": [".md"] } }
		]);
	});

	it("falls back to download where the picker is missing", async () => {
		const downloads: { text: string; filename: string }[] = [];
		const how = await exportChatMarkdown(chat, {
			picker: null,
			download: (text, filename) => void downloads.push({ text, filename })
		});
		expect(how).toBe("download");
		expect(downloads).toHaveLength(1);
		expect(downloads[0]?.text).toBe(chatToMarkdown(chat));
		expect(downloads[0]?.filename).toMatch(/^chat-\d{4}-\d{2}-\d{2}\.md$/);
	});

	it("throws when no export path exists", async () => {
		await expect(exportChatMarkdown(chat, { picker: null })).rejects.toThrow(
			"No export path available."
		);
	});

	it("propagates picker aborts for the caller to swallow", async () => {
		const aborted = new DOMException("cancelled", "AbortError");
		await expect(
			exportChatMarkdown(chat, {
				picker: async () => {
					throw aborted;
				}
			})
		).rejects.toBe(aborted);
	});
});
