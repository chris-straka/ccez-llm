import { describe, expect, it, vi } from "vitest";
import {
	RELEASES_URL,
	compareVersions,
	fetchLatestApk,
	pickApkAsset,
	runUpdateFlow,
	updateButtonLabel,
	updateRouteFor,
	type UpdateFlowDeps,
	type UpdaterUpdate,
	type UpdatePhase
} from "./updates";

describe("updateRouteFor", () => {
	it("routes release Android shells to the in-app updater", () => {
		expect(updateRouteFor(true)).toEqual({ kind: "android" });
		expect(updateRouteFor(true, true, false)).toEqual({ kind: "android" });
	});

	it("routes desktop to the Tauri updater", () => {
		expect(updateRouteFor(false)).toEqual({ kind: "updater" });
		expect(updateRouteFor(false, true)).toEqual({ kind: "updater" });
	});

	it("disables the updater on the web build (no Tauri shell)", () => {
		expect(updateRouteFor(false, false)).toEqual({ kind: "none" });
		// Android keeps its releases route even without a shell (browser preview).
		expect(updateRouteFor(true, false)).toEqual({
			kind: "releases",
			url: RELEASES_URL
		});
	});

	it("points at the newest tagged release, not the list", () => {
		expect(RELEASES_URL).toBe(
			"https://github.com/chris-straka/ccez-llm/releases/latest"
		);
	});

	it("routes dev shells to the dev message instead of the updater", () => {
		expect(updateRouteFor(false, true, true)).toEqual({ kind: "dev" });
		// Dev Android keeps the releases link (no self-update from dev).
		expect(updateRouteFor(true, true, true)).toEqual({
			kind: "releases",
			url: RELEASES_URL
		});
		// Web builds stay disabled regardless of dev.
		expect(updateRouteFor(false, false, true)).toEqual({ kind: "none" });
		// Release desktop shells still use the Tauri updater.
		expect(updateRouteFor(false, true, false)).toEqual({ kind: "updater" });
	});
});

describe("updateButtonLabel", () => {
	it("narrates every stage at the button", () => {
		expect(updateButtonLabel({ stage: "idle" })).toBe("Check for updates");
		expect(updateButtonLabel({ stage: "checking" })).toBe("Checking…");
		expect(updateButtonLabel({ stage: "installing" })).toBe("Installing…");
		expect(updateButtonLabel({ stage: "restarting" })).toBe("Restarting…");
	});
	it("shows download percent when the total is known", () => {
		expect(
			updateButtonLabel({ stage: "downloading", received: 50, total: 100 })
		).toBe("Downloading… 50%");
		expect(
			updateButtonLabel({ stage: "downloading", received: 0, total: null })
		).toBe("Downloading…");
	});
});

/** A found update needs only its version for the flow; the rest of
the plugin class never runs under fakes. */
function fakeUpdate(version: string): UpdaterUpdate {
	return { version } as unknown as UpdaterUpdate;
}

function flowHarness(over: Partial<UpdateFlowDeps> = {}): {
	deps: UpdateFlowDeps;
	phases: UpdatePhase[];
	reports: string[];
} {
	const phases: UpdatePhase[] = [];
	const reports: string[] = [];
	const deps: UpdateFlowDeps = {
		checkForUpdate: async () => null,
		downloadAndInstall: async () => {},
		relaunchApp: async () => {},
		report: (message) => {
			reports.push(message);
		},
		onPhase: (phase) => {
			phases.push(phase);
		},
		...over
	};
	return { deps, phases, reports };
}

describe("runUpdateFlow", () => {
	it("reports up to date without downloading when no update is found", async () => {
		const downloadAndInstall = vi.fn();
		const relaunchApp = vi.fn();
		const { deps, phases, reports } = flowHarness({
			downloadAndInstall,
			relaunchApp
		});
		await runUpdateFlow(deps);
		expect(reports).toEqual(["You're on the latest version."]);
		expect(downloadAndInstall).not.toHaveBeenCalled();
		expect(relaunchApp).not.toHaveBeenCalled();
		expect(phases).toEqual([{ stage: "checking" }]);
	});

	it("downloads, installs, and relaunches when an update is found", async () => {
		const update = fakeUpdate("0.4.14");
		const relaunchApp = vi.fn();
		const seen: string[] = [];
		const { deps, reports } = flowHarness({
			checkForUpdate: async () => update,
			downloadAndInstall: async (_update, onEvent) => {
				onEvent({ event: "Started", data: { contentLength: 200 } });
				onEvent({ event: "Progress", data: { chunkLength: 50 } });
				onEvent({ event: "Progress", data: { chunkLength: 150 } });
				onEvent({ event: "Finished" });
			},
			relaunchApp,
			onPhase: (phase) => {
				seen.push(updateButtonLabel(phase));
			}
		});
		await runUpdateFlow(deps);
		expect(reports).toEqual(["Version 0.4.14 found — downloading it now."]);
		expect(relaunchApp).toHaveBeenCalledTimes(1);
		expect(seen).toEqual([
			"Checking…",
			"Downloading… 0%",
			"Downloading… 25%",
			"Downloading… 99%",
			"Installing…",
			"Restarting…"
		]);
	});

	it("reports a check failure without downloading", async () => {
		const downloadAndInstall = vi.fn();
		const { deps, reports } = flowHarness({
			checkForUpdate: async () => {
				throw new Error("offline");
			},
			downloadAndInstall
		});
		await runUpdateFlow(deps);
		expect(reports).toEqual(["Couldn't check for updates: offline"]);
		expect(downloadAndInstall).not.toHaveBeenCalled();
	});

	it("falls back to the releases page when the install fails", async () => {
		const update = fakeUpdate("0.4.14");
		const relaunchApp = vi.fn();
		const { deps, reports } = flowHarness({
			checkForUpdate: async () => update,
			downloadAndInstall: async () => {
				throw new Error("signature mismatch");
			},
			relaunchApp
		});
		await runUpdateFlow(deps);
		expect(reports).toHaveLength(2);
		expect(reports[1]).toContain("0.4.14");
		expect(reports[1]).toContain(RELEASES_URL);
		expect(relaunchApp).not.toHaveBeenCalled();
	});
});

describe("pickApkAsset", () => {
	const apk = (name: string) => ({
		name,
		browser_download_url: `https://example.com/${name}`
	});
	it("prefers the exact arm64 asset, else the first apk", () => {
		expect(
			pickApkAsset([apk("notes.txt"), apk("CcezLLM-android-arm64.apk")])
		).toBe("https://example.com/CcezLLM-android-arm64.apk");
		expect(pickApkAsset([apk("other.apk")])).toBe(
			"https://example.com/other.apk"
		);
		expect(pickApkAsset([apk("notes.txt")])).toBeNull();
		expect(pickApkAsset([])).toBeNull();
	});
});

describe("compareVersions", () => {
	it("compares dotted versions with or without a v", () => {
		expect(compareVersions("v0.4.18", "0.4.18")).toBe(0);
		expect(compareVersions("v0.4.19", "0.4.18")).toBe(1);
		expect(compareVersions("0.4.18", "v0.5.0")).toBe(-1);
		expect(compareVersions("0.4.9", "0.4.18")).toBe(-1);
		expect(compareVersions("1.0", "0.9.9")).toBe(1);
	});
});

describe("fetchLatestApk", () => {
	const release = (tag: string, names: string[]) =>
		({
			ok: true,
			status: 200,
			json: async () => ({
				tag_name: tag,
				assets: names.map((name) => ({
					name,
					browser_download_url: `https://example.com/${name}`
				}))
			})
		}) as unknown as Response;
	const fetchOf = (response: Response) =>
		(async () => response) as unknown as typeof fetch;
	it("returns the apk when newer, null when current", async () => {
		await expect(
			fetchLatestApk(
				fetchOf(release("v0.4.19", ["CcezLLM-android-arm64.apk"])),
				"0.4.18"
			)
		).resolves.toEqual({
			version: "v0.4.19",
			url: "https://example.com/CcezLLM-android-arm64.apk"
		});
		await expect(
			fetchLatestApk(
				fetchOf(release("v0.4.18", ["CcezLLM-android-arm64.apk"])),
				"0.4.18"
			)
		).resolves.toBeNull();
	});
	it("throws without a tag, an apk, or a response", async () => {
		await expect(
			fetchLatestApk(fetchOf(release("v0.4.19", ["notes.txt"])), "0.4.18")
		).rejects.toThrow("no APK");
		await expect(
			fetchLatestApk(
				fetchOf({
					ok: false,
					status: 404,
					json: async () => ({})
				} as unknown as Response),
				"0.4.18"
			)
		).rejects.toThrow("404");
	});
});
