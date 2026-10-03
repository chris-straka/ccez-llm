import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Selection-menu / composer-dock button layout invariants.
 *
 * Asserted on component source because button order is markup.
 * Phones split the actions: the floating menu holds Annotate then
 * Copy, the composer dock holds Speak then Inspect.
 */
function selMenuSource(): string {
	return readFileSync(
		new URL("../lib/components/SelMenu.svelte", import.meta.url),
		"utf8"
	);
}

/** Composer dock moved to Composer.svelte with its markup. */
function composerSource(): string {
	return readFileSync(
		new URL("../lib/components/Composer.svelte", import.meta.url),
		"utf8"
	);
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
		// The floating menu renders from `SelMenu.svelte` now (buttons,
		// drag, and surfaces moved with the markup); the layout pin
		// follows it.
		const menu = blockAfter(
			selMenuSource(),
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
		// The dock renders from `Composer.svelte` now; the layout
		// pin follows it.
		const dock = blockAfter(
			composerSource(),
			"Phone action dock: Speak, and (for a single",
			"{/if}"
		);
		expect(dock.indexOf(">Speak</button")).toBeGreaterThan(-1);
		expect(dock.indexOf(">Speak</button")).toBeLessThan(
			dock.indexOf(">Inspect</button")
		);
		expect(dock).not.toContain("Annotate selection");
	});
});
