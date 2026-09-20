// Update routing: the Tauri auto-updater is desktop-only, so on Android
// "check for updates" means opening the latest release page for the newest
// APK (/releases/latest redirects to the newest tagged release, not the
// list the app was installed from), and on the web build (no Tauri shell
// at all) there is nothing to check — a redeploy updates the site, so the
// updater stays disabled.
export const RELEASES_URL =
	"https://github.com/chris-straka/ccez-llm/releases/latest";

type DownloadEvent = import("@tauri-apps/plugin-updater").DownloadEvent;
/** The plugin's Update class, surfaced for flow-dependency typing. */
export type UpdaterUpdate = import("@tauri-apps/plugin-updater").Update;

export type UpdateRoute =
	| { kind: "updater" }
	| { kind: "releases"; url: string }
	| { kind: "android" }
	| { kind: "none" }
	| { kind: "dev" };

/**
 * Dev-build readout: dev shells have no updater artifacts, so `check()`
 * fails with a fetch error — explain instead of surfacing it.
 */
export const DEV_UPDATE_MESSAGE =
	"Dev builds don't check for updates — version checks run in release builds.";

export function updateRouteFor(
	androidUI: boolean,
	inShell = true,
	isDev = false
): UpdateRoute {
	// Release shells self-update in app (download + installer); dev
	// and browser previews keep the releases link instead.
	if (androidUI) {
		if (inShell && !isDev) return { kind: "android" };
		return { kind: "releases", url: RELEASES_URL };
	}
	if (!inShell) return { kind: "none" };
	if (isDev) return { kind: "dev" };
	return { kind: "updater" };
}

/** Latest-release API behind the releases page above. */
export const RELEASES_API_URL =
	"https://api.github.com/repos/chris-straka/ccez-llm/releases/latest";
/** Arm64 APK asset name (see the release workflow's rename rules). */
export const APK_ASSET_NAME = "CcezLLM-android-arm64.apk";

export interface ReleaseAsset {
	name: string;
	browser_download_url: string;
}

/**
 * Download URL for the update APK: the exact arm64 asset when the
 * release carries it, else the first `.apk` asset. Null when the
 * release has no APK yet. Pure and unit-tested.
 */
export function pickApkAsset(assets: ReleaseAsset[]): string | null {
	const exact = assets.find((a) => a.name === APK_ASSET_NAME);
	const fallback = assets.find((a) =>
		a.name.toLowerCase().endsWith(".apk")
	);
	const url = (exact ?? fallback)?.browser_download_url ?? "";
	return url || null;
}

/**
 * Numeric dotted-version compare after stripping a leading `v`
 * (`v0.4.18` vs `0.4.18`): -1/0/1. Non-numeric segments count 0.
 * Pure and unit-tested.
 */
export function compareVersions(a: string, b: string): number {
	const parts = (v: string): number[] =>
		v
			.trim()
			.replace(/^v/i, "")
			.split(".")
			.map((n) => {
				const parsed = parseInt(n, 10);
				return Number.isFinite(parsed) ? parsed : 0;
			});
	const left = parts(a);
	const right = parts(b);
	const len = Math.max(left.length, right.length);
	for (let i = 0; i < len; i++) {
		const diff = (left[i] ?? 0) - (right[i] ?? 0);
		if (diff !== 0) return diff < 0 ? -1 : 1;
	}
	return 0;
}

export interface LatestApk {
	version: string;
	url: string;
}

/**
 * Newest release APK newer than `currentVersion`, or null when up to
 * date. Throws when the check fails or the release has no APK. Fetch
 * is injected so tests run without a network. Pure-logic wrapper.
 */
export async function fetchLatestApk(
	fetchImpl: typeof fetch,
	currentVersion: string
): Promise<LatestApk | null> {
	const res = await fetchImpl(RELEASES_API_URL, {
		headers: { Accept: "application/vnd.github+json" }
	});
	if (!res.ok) throw new Error(`release check failed (${res.status})`);
	const body = (await res.json()) as {
		tag_name?: unknown;
		assets?: unknown;
	};
	const tag = typeof body.tag_name === "string" ? body.tag_name : "";
	const assets = Array.isArray(body.assets)
		? (body.assets as ReleaseAsset[])
		: [];
	const url = pickApkAsset(assets);
	if (!tag || !url) throw new Error("this release has no APK yet");
	if (compareVersions(tag, currentVersion) <= 0) return null;
	return { version: tag, url };
}

/**
 * Button readout for the updater flow: one label per stage, so the
 * button narrates the whole run at the point of attention instead of
 * idling on "Check for updates" between state flips.
 */
export type UpdatePhase =
	| { stage: "idle" }
	| { stage: "checking" }
	| { stage: "downloading"; received: number; total: number | null }
	| { stage: "installing" }
	| { stage: "restarting" };

export function updateButtonLabel(phase: UpdatePhase): string {
	switch (phase.stage) {
		case "checking":
			return "Checking…";
		case "downloading":
			if (phase.total === null || phase.total <= 0) return "Downloading…";
			return `Downloading… ${Math.min(99, Math.round((phase.received / phase.total) * 100))}%`;
		case "installing":
			return "Installing…";
		case "restarting":
			return "Restarting…";
		case "idle":
			return "Check for updates";
	}
}

function updateErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Injected updater flow: check, then download + install + relaunch
 * when an update is found. All Tauri calls arrive as dependencies so
 * this stays pure-logic and unit-testable with fakes (no shell, no
 * DOM). Report carries terminal readouts (toast or inline); onPhase
 * drives the button label above.
 */
export interface UpdateFlowDeps {
	checkForUpdate: () => Promise<UpdaterUpdate | null>;
	downloadAndInstall: (
		update: UpdaterUpdate,
		onEvent: (event: DownloadEvent) => void
	) => Promise<void>;
	relaunchApp: () => Promise<void>;
	report: (message: string) => void;
	onPhase: (phase: UpdatePhase) => void;
}

export async function runUpdateFlow(deps: UpdateFlowDeps): Promise<void> {
	deps.onPhase({ stage: "checking" });
	let update: UpdaterUpdate | null;
	try {
		update = await deps.checkForUpdate();
	} catch (error) {
		deps.report(`Couldn't check for updates: ${updateErrorMessage(error)}`);
		return;
	}
	if (!update) {
		deps.report("You're on the latest version.");
		return;
	}
	deps.report(`Version ${update.version} found — downloading it now.`);
	let received = 0;
	let total: number | null = null;
	try {
		await deps.downloadAndInstall(update, (event) => {
			if (event.event === "Started") {
				total = event.data.contentLength ?? null;
				deps.onPhase({ stage: "downloading", received, total });
			} else if (event.event === "Progress") {
				received += event.data.chunkLength;
				deps.onPhase({ stage: "downloading", received, total });
			} else {
				deps.onPhase({ stage: "installing" });
			}
		});
	} catch (error) {
		deps.report(
			`Version ${update.version} didn't install automatically (${updateErrorMessage(error)}) — download it from ${RELEASES_URL}.`
		);
		return;
	}
	deps.onPhase({ stage: "restarting" });
	await deps.relaunchApp();
}
