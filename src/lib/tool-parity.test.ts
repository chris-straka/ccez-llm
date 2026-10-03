import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchToolDef } from "./tools";

/**
 * Both engines offer fetch_url with one description: the TypeScript
 * provider (tools.ts) and the Android runner (turn.rs). Asserts on
 * source: the Rust request body only exists on device, and the two
 * copies once drifted (the native one lost its when-to-use and feed
 * guidance).
 */
describe("fetch_url description parity", () => {
	it("turn.rs sends the same description as tools.ts", () => {
		const rust = readFileSync(
			new URL("../../src-tauri/src/turn.rs", import.meta.url),
			"utf8"
		);
		const match = /"name": "fetch_url",\s*"description": "([^"]*)"/.exec(rust);
		expect(match?.[1]).toBe(fetchToolDef().function.description);
	});
});
