import { describe, it, expect } from "vitest";
import {
	OFFLINE_FALLBACK_ID,
	needsNetwork,
	offlineTarget,
	onlineRestore
} from "./offline";

describe("offline fallback", () => {
	it("parks cloud providers on Gemma, leaves local and mock alone", () => {
		expect(needsNetwork("deepseek-mac")).toBe(true);
		expect(needsNetwork("deepseek")).toBe(true);
		expect(needsNetwork("custom-remote")).toBe(true);
		expect(needsNetwork(OFFLINE_FALLBACK_ID)).toBe(false);
		expect(needsNetwork("mock")).toBe(false);
		expect(offlineTarget("deepseek-mac")).toBe(OFFLINE_FALLBACK_ID);
		expect(offlineTarget("deepseek")).toBe(OFFLINE_FALLBACK_ID);
		expect(offlineTarget(OFFLINE_FALLBACK_ID)).toBeNull();
		expect(offlineTarget("mock")).toBeNull();
	});

	it("restores only what the drop parked", () => {
		expect(onlineRestore("deepseek-mac", OFFLINE_FALLBACK_ID)).toBe(
			"deepseek-mac"
		);
		// Nothing was parked: stay where the user is.
		expect(onlineRestore(null, OFFLINE_FALLBACK_ID)).toBeNull();
		expect(onlineRestore(null, "deepseek")).toBeNull();
		// The user moved on while offline: their pick wins.
		expect(onlineRestore("deepseek-mac", "deepseek")).toBeNull();
		expect(onlineRestore("deepseek-mac", "mock")).toBeNull();
	});
	it("parks on Apple's on-device model on a Mac, and back", () => {
		expect(needsNetwork("apple", true)).toBe(false);
		expect(needsNetwork("apple", false)).toBe(true);
		expect(offlineTarget("deepseek-mac", true)).toBe("apple");
		expect(offlineTarget("apple", true)).toBeNull();
		expect(onlineRestore("deepseek-mac", "apple", true)).toBe("deepseek-mac");
		// Moved on to something else meanwhile: left alone.
		expect(onlineRestore("deepseek-mac", "deepseek", true)).toBeNull();
		// Android still parks on Gemma.
		expect(offlineTarget("deepseek-mac")).toBe(OFFLINE_FALLBACK_ID);
	});
});
