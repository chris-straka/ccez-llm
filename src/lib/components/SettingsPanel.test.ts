import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Settings-footer stamps must ride import.meta.env, never vite
 * `define` globals: a previous `define`-globals revision silently
 * never reached the Svelte bundle, so every release build printed
 * the "build release" fallback instead of its version. These assert
 * on source because the substitution happens at build time, where
 * no unit runner can see it — the proof is the built bundle, this
 * test only pins the mechanism. Comments are stripped first so
 * prose (including this one) can't trip the assertions.
 */
function sourceOf(path: string): string {
	const src = readFileSync(new URL(path, import.meta.url), "utf8");
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "")
		.replace(/<!--[\s\S]*?-->/g, "");
}

describe("settings build stamp", () => {
	it("reads version and stamp from import.meta.env", () => {
		const src = sourceOf("./SettingsPanel.svelte");
		expect(src).toContain("import.meta.env.VITE_BUILD_STAMP");
		expect(src).toContain("import.meta.env.VITE_APP_VERSION");
		expect(src).not.toContain("__BUILD_STAMP__");
		expect(src).not.toContain("__APP_VERSION__");
	});

	it("defaults both from the build, not from runner env", () => {
		const config = sourceOf("../../../vite.config.js");
		expect(config).toContain("VITE_APP_VERSION");
		expect(config).toContain("VITE_BUILD_STAMP");
		expect(config).toContain("package.json");
		expect(config).not.toContain("__APP_VERSION__");
		expect(config).not.toContain("__BUILD_STAMP__");
	});
});
