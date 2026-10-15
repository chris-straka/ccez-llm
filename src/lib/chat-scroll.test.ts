import { describe, expect, it } from "vitest";
import {
	chatScrollLanding,
	markFor,
	parseChatScrolls,
	serializeChatScrolls,
	type ChatScrollMark
} from "./chat-scroll";

describe("chatScrollLanding", () => {
	it("lands a never-opened chat at the bottom", () => {
		expect(chatScrollLanding(undefined)).toEqual({ kind: "bottom" });
	});
	it("lands a chat left at the bottom at the (new) bottom", () => {
		expect(chatScrollLanding({ bottom: true, top: 900, anchor: null })).toEqual(
			{ kind: "bottom" }
		);
	});
	it("returns a mid-thread chat to its mark", () => {
		const anchor = { id: "msg-4", offset: -30 };
		expect(chatScrollLanding({ bottom: false, top: 1500, anchor })).toEqual({
			kind: "mark",
			top: 1500,
			anchor
		});
	});
});

describe("markFor", () => {
	const anchor = { id: "msg-3", offset: -12 };
	it("files a mid-thread reader by anchor and offset", () => {
		expect(
			markFor({
				stuck: false,
				scrollTop: 1500.4,
				scrollHeight: 4000,
				clientHeight: 800,
				anchor
			})
		).toEqual({ bottom: false, top: 1500, anchor });
	});
	it("files the true bottom as bottom even when unstuck", () => {
		expect(
			markFor({
				stuck: false,
				scrollTop: 3200,
				scrollHeight: 4000,
				clientHeight: 800,
				anchor
			})
		).toEqual({ bottom: true, top: 3200, anchor: null });
	});
	it("files a pinned view as bottom while a stream runs ahead", () => {
		expect(
			markFor({
				stuck: true,
				scrollTop: 3150,
				scrollHeight: 4000,
				clientHeight: 800,
				anchor: null
			}).bottom
		).toBe(true);
	});
	it("keeps a reader a little above the bottom mid-thread", () => {
		expect(
			markFor({
				stuck: false,
				scrollTop: 3160,
				scrollHeight: 4000,
				clientHeight: 800,
				anchor
			}).bottom
		).toBe(false);
	});
});

describe("parseChatScrolls / serializeChatScrolls", () => {
	it("round-trips marks for live chats", () => {
		const marks = new Map<string, ChatScrollMark>([
			["a", { bottom: false, top: 120, anchor: { id: "msg-1", offset: -4 } }],
			["b", { bottom: true, top: 0, anchor: null }]
		]);
		expect(parseChatScrolls(serializeChatScrolls(marks), ["a", "b"])).toEqual(
			marks
		);
	});
	it("prunes deleted chats and malformed entries", () => {
		const raw = JSON.stringify({
			gone: { bottom: false, top: 5, anchor: null },
			a: { bottom: "no", top: 5 },
			b: { bottom: false, top: "x", anchor: { id: 3, offset: 1 } },
			c: null
		});
		expect(parseChatScrolls(raw, ["a", "b", "c"])).toEqual(
			new Map([["b", { bottom: false, top: 0, anchor: null }]])
		);
	});
	it("reads corrupt or missing storage as no marks", () => {
		expect(parseChatScrolls("{oops", ["a"]).size).toBe(0);
		expect(parseChatScrolls(null, ["a"]).size).toBe(0);
		expect(parseChatScrolls("[1,2]", ["a"]).size).toBe(0);
	});
});
