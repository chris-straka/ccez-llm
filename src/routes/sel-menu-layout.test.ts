import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Selection-menu / composer-dock button layout invariants.
 *
 * Asserted on +page.svelte source because button order is markup,
 * not behavior jsdom can exercise meaningfully. Phones split the
 * actions: the floating menu holds Annotate then Copy (always —
 * no hold-to-arm), the composer dock holds Speak then Inspect.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

function blockAfter(
	source: string,
	marker: string,
	endMarker = "{:else}",
	length = 4000
): string {
	const at = source.indexOf(marker);
	if (at < 0) throw new Error(`marker missing: ${marker}`);
	const end = source.indexOf(endMarker, at);
	const cap = end >= 0 ? end : at + length;
	return source.slice(at, Math.min(cap, at + length));
}

describe("phone selection layout", () => {
	it("floats Annotate then Copy, never Speak or Inspect", () => {
		const menu = blockAfter(
			pageSource(),
			"Phone selection menu: Annotate then Copy"
		);
		expect(menu.indexOf(">Annotate</button")).toBeGreaterThan(-1);
		expect(menu.indexOf(">Copy</button")).toBeGreaterThan(-1);
		expect(menu.indexOf(">Annotate</button")).toBeLessThan(
			menu.indexOf(">Copy</button")
		);
		expect(menu).not.toContain("Speak selection");
		expect(menu).not.toContain("Inspect character");
	});

	it("docks Speak then Inspect, never Annotate", () => {
		const dock = blockAfter(
			pageSource(),
			"Phone action dock: Speak, and (for a single",
			"{/if}"
		);
		expect(dock.indexOf(">Speak</button")).toBeGreaterThan(-1);
		expect(dock.indexOf(">Speak</button")).toBeLessThan(
			dock.indexOf(">Inspect</button")
		);
		expect(dock).not.toContain("Annotate selection");
	});

	it("retired the hold-to-arm Copy gate", () => {
		const source = pageSource();
		expect(source).not.toContain("copyArmed");
		expect(source).not.toContain("COPY_HOLD_MS");
		expect(source).not.toContain("armCopyButton");
	});

	it("lifts the menu above the readings panel on speak", () => {
		const source = pageSource();
		expect(source).toContain("liftSelMenuAbovePinyin");
		expect(source).toContain("menuYAbovePanel(pr.top, mr.height)");
	});
});
