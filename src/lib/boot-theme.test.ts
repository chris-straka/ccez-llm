import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it, expect } from "vitest";

/**
 * Cold-start theme paint: app.html resolves the saved theme before
 * first paint so a returning cold start (process died while away)
 * opens on the app's own background instead of flashing black when
 * the saved theme differs from the system scheme. Runs the shipped
 * inline script in a sandbox — not a source grep.
 */
function bootThemeScript(): string {
	const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
	const start = html.indexOf("<script>");
	const end = html.indexOf("</script>", start);
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return html.slice(start + "<script>".length, end);
}

function paint(opts: {
	stored: string | null;
	legacyStored?: string | null;
	systemDark: boolean;
	storage?: boolean;
	media?: boolean;
}): string {
	const dataset: Record<string, string> = {};
	const store = new Map<string, string>();
	if (opts.stored !== null) store.set("ccez-llm-settings-v1", opts.stored);
	if (opts.legacyStored) store.set("ccez-studio-settings-v1", opts.legacyStored);
	const sandbox: Record<string, unknown> = {
		document: { documentElement: { dataset } }
	};
	if (opts.storage !== false) {
		sandbox.window = {
			localStorage: {
				getItem: (key: string): string | null => store.get(key) ?? null
			},
			matchMedia:
				opts.media === false
					? undefined
					: () => ({ matches: opts.systemDark })
		};
	} else {
		sandbox.window = opts.media === false ? {} : { matchMedia: () => ({ matches: opts.systemDark }) };
	}
	runInNewContext(bootThemeScript(), sandbox);
	return dataset["theme"] ?? "";
}

describe("boot theme paint", () => {
	it("paints the saved dark theme on a light system", () => {
		expect(
			paint({ stored: JSON.stringify({ theme: "dark" }), systemDark: false })
		).toBe("dark");
	});

	it("paints the saved light theme on a dark system (no black flash)", () => {
		expect(
			paint({ stored: JSON.stringify({ theme: "light" }), systemDark: true })
		).toBe("light");
	});

	it("follows the system on system mode", () => {
		expect(
			paint({ stored: JSON.stringify({ theme: "system" }), systemDark: true })
		).toBe("dark");
		expect(
			paint({ stored: JSON.stringify({ theme: "system" }), systemDark: false })
		).toBe("light");
	});

	it("falls back to the system with no stored settings", () => {
		expect(paint({ stored: null, systemDark: true })).toBe("dark");
	});

	it("reads the legacy key when the current one is missing", () => {
		expect(
			paint({
				stored: null,
				legacyStored: JSON.stringify({ theme: "dark" }),
				systemDark: false
			})
		).toBe("dark");
	});

	it("survives corrupt storage and missing APIs without throwing", () => {
		expect(paint({ stored: "{nope", systemDark: true })).toBe("dark");
		expect(
			paint({ stored: null, systemDark: false, storage: false, media: false })
		).toBe("light");
	});
});
