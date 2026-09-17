import { describe, it, expect } from "vitest";
import {
	chatToMarkdown,
	copyExportText,
	exportChatMarkdown,
	exportFilename,
	type SavePickerOptions
} from "./chatExport";

describe("chatToMarkdown", () => {
	it("renders an empty chat as header plus placeholder", () => {
		expect(chatToMarkdown({ messages: [] })).toBe("# Chat export\n\n(empty chat)\n");
	});

	it("strips stored image literals, leaving the attachment list", () => {
		const md = chatToMarkdown({
			messages: [
				{
					role: "user",
					content: "look [Pasted image]",
					attachments: [{ name: "solo.png" }]
				}
			]
		});
		expect(md).toContain("look\n");
		expect(md).not.toContain("[Pasted image]");
		expect(md).toContain("- Attachment: solo.png");
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

	it("prefers the picker over the native bridge", async () => {
		const native = async () => "saved" as const;
		const how = await exportChatMarkdown(chat, {
			picker: async () => ({
				createWritable: async () => ({ write: async () => {}, close: async () => {} })
			}),
			native
		});
		expect(how).toBe("picker");
	});

	it("resolves native on a completed shell save", async () => {
		const seen: { filename: string; text: string }[] = [];
		const how = await exportChatMarkdown(chat, {
			picker: null,
			native: async (filename, text) => {
				seen.push({ filename, text });
				return "saved";
			}
		});
		expect(how).toBe("native");
		expect(seen).toHaveLength(1);
		expect(seen[0]?.text).toBe(chatToMarkdown(chat));
		expect(seen[0]?.filename).toMatch(/^chat-\d{4}-\d{2}-\d{2}\.md$/);
	});

	it("throws AbortError on a dismissed native save", async () => {
		const failure = exportChatMarkdown(chat, {
			picker: null,
			native: async () => "dismissed" as const
		});
		await expect(failure).rejects.toThrowError(DOMException);
		await expect(failure).rejects.toMatchObject({ name: "AbortError" });
	});

	it("falls through to download when the native bridge is missing", async () => {
		const downloads: { text: string; filename: string }[] = [];
		const how = await exportChatMarkdown(chat, {
			picker: null,
			native: async () => null,
			download: (text, filename) => void downloads.push({ text, filename })
		});
		expect(how).toBe("download");
		expect(downloads).toHaveLength(1);
	});
});

describe("copyExportText", () => {
	it("writes through an injected clipboard", async () => {
		const seen: string[] = [];
		await copyExportText("# Chat export", { writeText: async (text) => void seen.push(text) });
		expect(seen).toEqual(["# Chat export"]);
	});

	it("throws when no clipboard is available", async () => {
		await expect(copyExportText("x", null)).rejects.toThrowError("No export path available.");
	});

	it("serves as the awaited download fallback", async () => {
		const seen: string[] = [];
		const chat = { messages: [{ role: "user", content: "hi" }] };
		const how = await exportChatMarkdown(chat, {
			picker: null,
			native: async () => null,
			download: (text) => copyExportText(text, { writeText: async (t) => void seen.push(t) })
		});
		expect(how).toBe("download");
		expect(seen).toEqual([chatToMarkdown(chat)]);
	});
});
