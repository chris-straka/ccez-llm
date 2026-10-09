import { describe, it, expect } from "vitest";
import {
	canEditMessage,
	rerunIndexFor,
	toggleAidKinds,
	toggleSingleAid
} from "./message-actions";

describe("toggleAidKinds", () => {
	it("lifts every kind when all are pinned, else pins the missing ones", () => {
		expect(
			toggleAidKinds(["pinyin", "furigana"], ["pinyin", "furigana"])
		).toEqual({
			pin: [],
			unpin: ["pinyin", "furigana"]
		});
		expect(toggleAidKinds(["pinyin", "furigana"], [])).toEqual({
			pin: ["pinyin", "furigana"],
			unpin: []
		});
		expect(toggleAidKinds(["pinyin", "furigana"], ["pinyin"])).toEqual({
			pin: ["furigana"],
			unpin: []
		});
	});

	it("toggles nothing for empty offers", () => {
		expect(toggleAidKinds([], [])).toEqual({ pin: [], unpin: [] });
	});
});

describe("toggleSingleAid", () => {
	it("pins, unpins, or stays off unoffered kinds", () => {
		expect(toggleSingleAid(["pinyin"], [], "pinyin")).toBe("pin");
		expect(toggleSingleAid(["pinyin"], ["pinyin"], "pinyin")).toBe("unpin");
		expect(toggleSingleAid(["pinyin"], [], "furigana")).toBe(null);
		expect(toggleSingleAid([], [], "pinyin")).toBe(null);
	});
});

describe("canEditMessage", () => {
	it("pulls own messages only, never missing rows", () => {
		const messages = [{ role: "user" }, { role: "assistant" }];
		expect(canEditMessage(messages, 0)).toBe(true);
		expect(canEditMessage(messages, 1)).toBe(false);
		expect(canEditMessage(messages, 2)).toBe(false);
		expect(canEditMessage(messages, -1)).toBe(false);
		expect(canEditMessage([], 0)).toBe(false);
	});
});

describe("rerunIndexFor", () => {
	const messages = [{ role: "user" }, { role: "assistant" }, { role: "user" }, { role: "assistant" }];
	it("reruns your message itself, a reply from the turn it answered", () => {
		expect(rerunIndexFor(messages, 2, false)).toBe(2);
		expect(rerunIndexFor(messages, 3, false)).toBe(2);
		expect(rerunIndexFor(messages, 1, false)).toBe(0);
	});
	it("does nothing mid-send, off the list, or with no turn above", () => {
		expect(rerunIndexFor(messages, 3, true)).toBeNull();
		expect(rerunIndexFor(messages, 9, false)).toBeNull();
		expect(rerunIndexFor([{ role: "assistant" }], 0, false)).toBeNull();
	});
});
