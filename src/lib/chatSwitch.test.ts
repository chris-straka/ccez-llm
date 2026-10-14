import { describe, expect, it } from "vitest";
import type { ChatId } from "./chat";
import { fileComposerDraft, sendAgeSec, syncSendStarts } from "./chatSwitch";

const a = "a" as ChatId;
const b = "b" as ChatId;

describe("syncSendStarts", () => {
	it("keeps a send's start time while other chats come and go", () => {
		const starts = new Map<ChatId, number>();
		syncSendStarts(starts, [a], 1_000);
		syncSendStarts(starts, [a, b], 5_000);
		syncSendStarts(starts, [a, b], 9_000);
		expect(sendAgeSec(starts, a, 25_000)).toBe(24);
		expect(sendAgeSec(starts, b, 25_000)).toBe(20);
	});

	it("drops chats that stopped sending, and a new send starts fresh", () => {
		const starts = new Map<ChatId, number>();
		syncSendStarts(starts, [a], 1_000);
		syncSendStarts(starts, [], 2_000);
		expect(sendAgeSec(starts, a, 3_000)).toBe(0);
		syncSendStarts(starts, [a], 10_000);
		expect(sendAgeSec(starts, a, 12_500)).toBe(2);
	});
});

describe("fileComposerDraft", () => {
	it("files text per chat and clears blank drafts", () => {
		const drafts = new Map<ChatId, { text: string; attachments: string[] }>();
		fileComposerDraft(drafts, a, { text: "half a thought", attachments: [] });
		fileComposerDraft(drafts, b, { text: "   ", attachments: [] });
		expect(drafts.get(a)?.text).toBe("half a thought");
		expect(drafts.has(b)).toBe(false);
		fileComposerDraft(drafts, a, { text: "", attachments: [] });
		expect(drafts.has(a)).toBe(false);
		// An image alone is still a draft.
		fileComposerDraft(drafts, b, { text: "", attachments: ["img"] });
		expect(drafts.get(b)?.attachments).toEqual(["img"]);
	});
});
