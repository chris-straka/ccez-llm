import { describe, expect, it } from "vitest";
import { glideFrom } from "./promptGlide";

describe("glideFrom", () => {
	it("skips the first measure and unchanged heights", () => {
		expect(glideFrom(null, 100, null, false)).toBeNull();
		expect(glideFrom(100, 100, null, false)).toBeNull();
	});
	it("glides from the last natural height", () => {
		expect(glideFrom(100, 120, null, false)).toBe(100);
		expect(glideFrom(120, 100, null, false)).toBe(120);
	});
	it("restarts an in-flight glide from where it is on screen", () => {
		expect(glideFrom(120, 140, 110, false)).toBe(110);
	});
	it("snaps under reduced motion", () => {
		expect(glideFrom(100, 120, null, true)).toBeNull();
	});
});
