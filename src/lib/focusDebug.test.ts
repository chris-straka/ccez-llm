// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { describeFocusTarget } from "./focusDebug";

describe("describeFocusTarget", () => {
	it("labels an attached field with tag, id, and classes", () => {
		document.body.innerHTML =
			'<input id="base-url" class="settings-field mono extra fourth" />';
		const el = document.getElementById("base-url");
		// First three classes only; the fourth is noise.
		expect(describeFocusTarget(el)).toBe("INPUT#base-url.settings-field.mono.extra");
	});

	it("marks a detached node so swaps are visible", () => {
		const el = document.createElement("textarea");
		el.id = "ann-edit";
		expect(describeFocusTarget(el)).toBe("TEXTAREA#ann-edit [detached]");
	});

	it("handles nullish targets without throwing", () => {
		expect(describeFocusTarget(null)).toBe("null");
		expect(describeFocusTarget(undefined)).toBe("undefined");
	});
});
