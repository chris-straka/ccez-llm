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
	if (androidUI) return { kind: "releases", url: RELEASES_URL };
	if (!inShell) return { kind: "none" };
	if (isDev) return { kind: "dev" };
	return { kind: "updater" };
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
