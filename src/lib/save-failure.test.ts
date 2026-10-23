import { afterEach, describe, expect, it } from "vitest";
import { onSaveFailure, reportSaveFailure } from "./save-failure";
import { createChatState, persistChats } from "./chat";

const fullStore = {
	getItem: () => null,
	setItem: () => {
		throw new DOMException("full", "QuotaExceededError");
	},
	removeItem: () => undefined
};

afterEach(() => onSaveFailure(null));

describe("save failures", () => {
	it("reach the page's listener", () => {
		let seen = 0;
		onSaveFailure(() => seen++);
		reportSaveFailure();
		expect(seen).toBe(1);
	});

	it("a full store reports instead of failing in silence", () => {
		let seen = 0;
		onSaveFailure(() => seen++);
		persistChats(createChatState(), fullStore);
		expect(seen).toBe(1);
	});
});
