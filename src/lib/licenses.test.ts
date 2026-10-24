import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATA_CREDITS, libraryMatches, loadLibraries } from "./licenses";

describe("licenses", () => {
	it("list every library the app depends on directly", async () => {
		// Stale after a dependency change: run `bun scripts/licenses.ts`.
		const { js, rust } = await loadLibraries();
		const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
			dependencies: Record<string, string>;
		};
		const jsNames = new Set(js.map((l) => l.name));
		for (const name of Object.keys(pkg.dependencies))
			expect(jsNames, name).toContain(name);
		const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
		const section = cargo.slice(cargo.indexOf("[dependencies]")).split("\n");
		const end = section.findIndex((l, i) => i > 0 && l.startsWith("["));
		const deps = section
			.slice(1, end === -1 ? undefined : end)
			.filter((l) => /^[a-z0-9_-]+\s*=/.test(l))
			.map((l) => l.split("=")[0]!.trim());
		const rustNames = new Set(rust.map((l) => l.name.replace(/-/g, "_")));
		for (const name of deps)
			expect(rustNames, name).toContain(name.replace(/-/g, "_"));
		expect(js.every((l) => l.license)).toBe(true);
		expect(rust.every((l) => l.license)).toBe(true);
	});

	it("credit the dictionaries' sources with their licenses", () => {
		expect(DATA_CREDITS.map((c) => c.license)).toContain("CC BY-SA 4.0");
		expect(DATA_CREDITS.every((c) => c.url.startsWith("https://"))).toBe(true);
	});

	it("filter libraries by name or license", () => {
		const lib = { name: "serde", version: "1", license: "MIT OR Apache-2.0" };
		expect(libraryMatches(lib, "SER")).toBe(true);
		expect(libraryMatches(lib, "apache")).toBe(true);
		expect(libraryMatches(lib, "gpl")).toBe(false);
	});
});
