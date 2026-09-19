import { describe, it, expect } from "vitest";
import {
	OFFLINE_FALLBACK_ID,
	needsNetwork,
	offlineTarget,
	onlineRestore
} from "./offline";

describe("offline fallback", () => {
	it("parks cloud providers on Gemma, leaves local and mock alone", () => {
		expect(needsNetwork("muse")).toBe(true);
		expect(needsNetwork("deepseek")).toBe(true);
		expect(needsNetwork("custom-remote")).toBe(true);
		expect(needsNetwork(OFFLINE_FALLBACK_ID)).toBe(false);
		expect(needsNetwork("mock")).toBe(false);
		expect(offlineTarget("muse")).toBe(OFFLINE_FALLBACK_ID);
		expect(offlineTarget("deepseek")).toBe(OFFLINE_FALLBACK_ID);
		expect(offlineTarget(OFFLINE_FALLBACK_ID)).toBeNull();
		expect(offlineTarget("mock")).toBeNull();
	});

	it("restores only what the drop parked", () => {
		expect(onlineRestore("muse", OFFLINE_FALLBACK_ID)).toBe("muse");
		// Nothing was parked: stay where the user is.
		expect(onlineRestore(null, OFFLINE_FALLBACK_ID)).toBeNull();
		expect(onlineRestore(null, "deepseek")).toBeNull();
		// The user moved on while offline: their pick wins.
		expect(onlineRestore("muse", "deepseek")).toBeNull();
		expect(onlineRestore("muse", "mock")).toBeNull();
	});
});
