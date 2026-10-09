import { describe, expect, it } from "vitest";
import config from "./vite.config.js";

/** The web CSP is `font-src 'self'`: fonts must never inline as data: URLs. */
describe("vite build config", () => {
	it("never inlines fonts, leaves other assets to the default limit", () => {
		const resolved = (
			config as () => { build?: { assetsInlineLimit?: unknown } }
		)();
		const limit = resolved.build?.assetsInlineLimit as (
			file: string,
			content: Buffer
		) => boolean | undefined;
		const tiny = Buffer.alloc(100);
		expect(
			limit("node_modules/katex/dist/fonts/KaTeX_Size3-Regular.woff2", tiny)
		).toBe(false);
		expect(limit("x.woff", tiny)).toBe(false);
		expect(limit("x.ttf", tiny)).toBe(false);
		expect(limit("icon.svg", tiny)).toBeUndefined();
	});
});
