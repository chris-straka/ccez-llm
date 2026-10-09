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

function boot(opts: {
	stored: string | null;
	legacyStored?: string | null;
	systemDark: boolean;
	storage?: boolean;
	media?: boolean;
}): Record<string, string> {
	const dataset: Record<string, string> = {};
	const store = new Map<string, string>();
	if (opts.stored !== null) store.set("ccez-llm-settings-v1", opts.stored);
	if (opts.legacyStored)
		store.set("ccez-studio-settings-v1", opts.legacyStored);
	const sandbox: Record<string, unknown> = {
		document: { documentElement: { dataset } }
	};
	if (opts.storage !== false) {
		sandbox.window = {
			localStorage: {
				getItem: (key: string): string | null => store.get(key) ?? null
			},
			matchMedia:
				opts.media === false ? undefined : () => ({ matches: opts.systemDark })
		};
	} else {
		sandbox.window =
			opts.media === false
				? {}
				: { matchMedia: () => ({ matches: opts.systemDark }) };
	}
	runInNewContext(bootThemeScript(), sandbox);
	return dataset;
}

function paint(opts: Parameters<typeof boot>[0]): string {
	return boot(opts)["theme"] ?? "";
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

	it("pins the saved dark style before first paint", () => {
		expect(
			boot({
				stored: JSON.stringify({ theme: "dark", darkStyle: "ink" }),
				systemDark: false
			})["darkStyle"]
		).toBe("ink");
		expect(
			boot({ stored: JSON.stringify({ darkStyle: "warm" }), systemDark: true })[
				"darkStyle"
			]
		).toBe("warm");
		// Unknown or missing styles paint the default palette.
		expect(
			boot({ stored: JSON.stringify({ darkStyle: "neon" }), systemDark: true })[
				"darkStyle"
			]
		).toBe("graphite");
		expect(boot({ stored: "{nope", systemDark: true })["darkStyle"]).toBe(
			"graphite"
		);
	});

	it("pins the saved light style before first paint", () => {
		const stored = JSON.stringify({ theme: "light", lightStyle: "sepia" });
		expect(boot({ stored, systemDark: true })["lightStyle"]).toBe("sepia");
		expect(
			boot({
				stored: JSON.stringify({ lightStyle: "neon" }),
				systemDark: false
			})["lightStyle"]
		).toBe("paper");
		expect(
			boot({
				stored: JSON.stringify({ darkStyle: "contrast" }),
				systemDark: true
			})["darkStyle"]
		).toBe("contrast");
	});

	it("survives corrupt storage and missing APIs without throwing", () => {
		expect(paint({ stored: "{nope", systemDark: true })).toBe("dark");
		expect(
			paint({ stored: null, systemDark: false, storage: false, media: false })
		).toBe("light");
	});
});
