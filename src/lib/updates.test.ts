import { describe, expect, it } from "vitest";
import { RELEASES_URL, updateRouteFor } from "./updates";

describe("updateRouteFor", () => {
	it("routes Android to the releases page", () => {
		expect(updateRouteFor(true)).toEqual({ kind: "releases", url: RELEASES_URL });
	});

	it("routes desktop to the Tauri updater", () => {
		expect(updateRouteFor(false)).toEqual({ kind: "updater" });
		expect(updateRouteFor(false, true)).toEqual({ kind: "updater" });
	});

	it("disables the updater on the web build (no Tauri shell)", () => {
		expect(updateRouteFor(false, false)).toEqual({ kind: "none" });
		// Android keeps its releases route even without a shell (browser preview).
		expect(updateRouteFor(true, false)).toEqual({ kind: "releases", url: RELEASES_URL });
	});

	it("points at the newest tagged release, not the list", () => {
		expect(RELEASES_URL).toBe(
			"https://github.com/chris-straka/ccez-llm/releases/latest"
		);
	});

	it("routes dev shells to the dev message instead of the updater", () => {
		expect(updateRouteFor(false, true, true)).toEqual({ kind: "dev" });
		// Android keeps its releases route in dev (APK flow still applies).
		expect(updateRouteFor(true, true, true)).toEqual({ kind: "releases", url: RELEASES_URL });
		// Web builds stay disabled regardless of dev.
		expect(updateRouteFor(false, false, true)).toEqual({ kind: "none" });
		// Release desktop shells still use the Tauri updater.
		expect(updateRouteFor(false, true, false)).toEqual({ kind: "updater" });
	});
});
