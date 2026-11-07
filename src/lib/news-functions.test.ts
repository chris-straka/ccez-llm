import { describe, expect, it } from "vitest";
import { answer, foreign } from "../../functions/api/_shared";

const at = (headers: Record<string, string>) =>
	new Request("https://llm.ccez.uk/api/fetch?url=https://example.com/", {
		headers
	});

describe("the website's news functions", () => {
	it("answer only the site's own page", () => {
		expect(foreign(at({ "sec-fetch-site": "same-origin" }))).toBe(false);
		// A script with no browser headers used it as a proxy (2026-11-06).
		expect(foreign(at({}))).toBe(true);
		expect(foreign(at({ "sec-fetch-site": "cross-site" }))).toBe(true);
		expect(foreign(at({ "sec-fetch-site": "none" }))).toBe(true);
		expect(
			foreign(
				at({ "sec-fetch-site": "same-origin", origin: "https://evil.example" })
			)
		).toBe(true);
	});

	it("never let a fetched page run on the site's origin", () => {
		const res = answer("<script>alert(1)</script>", 200, true);
		expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("content-security-policy")).toContain("sandbox");
	});
});
