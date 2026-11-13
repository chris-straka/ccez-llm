import { describe, expect, it } from "vitest";
import { answer } from "../../functions/api/_shared";
import { notOwner } from "../../functions/api/_access";

const at = (headers: Record<string, string>) =>
	new Request("https://llm.ccez.uk/api/fetch?url=https://example.com/", {
		headers
	});

describe("the website's news functions", () => {
	it("answer only the owner's login", async () => {
		const ctx = (headers: Record<string, string>, aud?: string) => ({
			request: at(headers),
			env: aud ? { ACCESS_AUD: aud } : {},
			waitUntil: () => undefined
		});
		// Not set up: nothing gets through.
		expect(await notOwner(ctx({ "sec-fetch-site": "same-origin" }))).toBe(
			"not set up"
		);
		// The old header alone is no longer enough (any script could send it).
		expect(
			await notOwner(ctx({ "sec-fetch-site": "same-origin" }, "aud"))
		).toBe("login");
		expect(
			await notOwner(ctx({ cookie: "CF_Authorization=not.a" }, "aud"))
		).toBe("malformed");
	});

	it("never let a fetched page run on the site's origin", () => {
		const res = answer("<script>alert(1)</script>", 200, true);
		expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("content-security-policy")).toContain("sandbox");
	});
});
