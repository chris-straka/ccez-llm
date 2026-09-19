import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// npm rejects an `overrides` pin that restates a direct dependency
// (EOVERRIDE: "conflicts with direct dependency"), and that breaks every
// `npx` invocation from the repo directory, including MCP servers.
// A `$` self-reference is npm's supported way to pin transitive copies
// onto the root's version, and bun honors it the same way.
const pkg = JSON.parse(
	// Default-project linting can't resolve node:fs/URL types here; the
	// cast below re-establishes the shape regardless.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
	readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as {
	dependencies?: Record<string, string>;
	overrides?: Record<string, string>;
};

describe("package.json overrides", () => {
	it("uses npm-compatible self-references for direct dependencies", () => {
		for (const [name, spec] of Object.entries(pkg.overrides ?? {})) {
			if (pkg.dependencies?.[name] !== undefined) {
				expect(spec).toBe(`$${name}`);
			}
		}
	});
	// Pinned while CodeMirror is gone: the overrides block left with
	// its deps, so any re-add must update this test — and obey the
	// self-reference rule above.
	it("carries no overrides", () => {
		expect(pkg.overrides ?? {}).toEqual({});
	});
});
