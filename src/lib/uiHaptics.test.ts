import { describe, expect, it } from "vitest";
import { AMBIENT_GAP_MS, beatAllowed } from "./uiHaptics";

describe("beatAllowed", () => {
	it("stands down right behind another beat", () => {
		expect(beatAllowed(1000, 1000 - AMBIENT_GAP_MS + 1, AMBIENT_GAP_MS)).toBe(
			false
		);
	});
	it("fires once the gap has passed", () => {
		expect(beatAllowed(1000, 1000 - AMBIENT_GAP_MS, AMBIENT_GAP_MS)).toBe(true);
		expect(beatAllowed(1000, 0, AMBIENT_GAP_MS)).toBe(true);
	});
});
