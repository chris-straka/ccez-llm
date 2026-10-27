import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_HELP_URL, buildAppHelp } from "./app-help";
import { fetchToolDef, validFetchUrl } from "./tools";

describe("app help", () => {
	it("is offered through the fetch tool at an address that never resolves", () => {
		expect(fetchToolDef().function.description).toContain(APP_HELP_URL);
		expect(validFetchUrl(APP_HELP_URL)).toBe(true);
		expect(new URL(APP_HELP_URL).hostname.endsWith(".invalid")).toBe(true);
	});

	it("lists the platform's own keys or gestures", () => {
		const mac = buildAppHelp("mac");
		expect(mac).toContain("Keyboard and mouse shortcuts");
		expect(mac).toContain("- Reply to an open note: R");
		const touch = buildAppHelp("touch");
		expect(touch).toContain("Gestures (phone)");
		expect(touch).toContain("- Annotate: Select text, then Annotate");
		expect(touch).not.toContain("Keyboard and mouse shortcuts");
	});

	it("the Android runner's copy is current (bun scripts/app-help.ts)", () => {
		const rust = readFileSync(
			new URL("../../src-tauri/src/app_help_touch.md", import.meta.url),
			"utf8"
		);
		expect(rust).toBe(buildAppHelp("touch"));
	});
});
