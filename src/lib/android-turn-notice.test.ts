import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * The foreground-service notice is title-only ("Reply coming…"): the
 * body line was explicitly unwanted, so this pins its absence in
 * TurnSvc. Asserts on source: the notice only exists on hardware
 * (release service plus the shade).
 */
function turnSvc(): string {
	return readFileSync(
		new URL(
			"../../src-tauri/gen/android/app/src/main/java/studio/ccez/app/TurnSvc.kt",
			import.meta.url
		),
		"utf8"
	);
}

describe("android turn notice", () => {
	it("keeps the title and carries no body text", () => {
		const source = turnSvc();
		expect(source).toContain("Reply coming…");
		expect(source).not.toContain("setContentText");
	});
});
