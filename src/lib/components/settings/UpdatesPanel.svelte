<script lang="ts">
	import {
		DEV_UPDATE_MESSAGE,
		fetchLatestApk,
		runUpdateFlow,
		updateButtonLabel,
		updateRouteFor
	} from "$lib/updates";
	import type { LatestApk, UpdatePhase } from "$lib/updates";
	import { tauriBackendAvailable } from "$lib/secrets";
	import { check } from "@tauri-apps/plugin-updater";
	import "./panels.css";

	interface Props {
		androidUI: boolean;
		onToast?: ((message: string) => void) | undefined;
	}

	let { androidUI, onToast }: Props = $props();
	const inShell = tauriBackendAvailable();
	let updateStatus = $state("");
	/** Single-shot flow state: the button narrates each stage, and a
	re-click (or double-click racing the disabled flip) while busy is
	a no-op instead of a second concurrent check. */
	let updatePhase = $state<UpdatePhase>({ stage: "idle" });
	let checkingUpdate = $derived(updatePhase.stage !== "idle");
	/** Where "check for updates" goes: releases page, Tauri updater, or nowhere (web). */
	const updateRoute = $derived(
		updateRouteFor(androidUI === true, inShell, import.meta.env.DEV)
	);

	/**
	 * Update result readout: the page toast when one is wired (it
	 * auto-dismisses and never shifts the settings layout), else the
	 * inline fallback below the button.
	 */
	function sayUpdate(message: string): void {
		if (onToast) onToast(message);
		else updateStatus = message;
	}
	/** Newest release waiting, or a downloaded APK ready to install. */
	let pendingApk = $state<LatestApk | null>(null);
	let apkPath = $state<string | null>(null);
	function updateError(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
	async function checkUpdates() {
		if (updatePhase.stage !== "idle") return;
		const route = updateRoute;
		if (route.kind === "android") {
			if (apkPath) return void installAndroidUpdate();
			if (pendingApk) return void downloadAndroidUpdate();
			return void checkAndroidUpdate();
		}
		if (route.kind === "releases") {
			// Browser and dev previews have no installer bridge: open
			// the Releases page instead.
			updatePhase = { stage: "checking" };
			try {
				if (tauriBackendAvailable()) {
					const { invoke } = await import("@tauri-apps/api/core");
					await invoke("plugin:opener|open_url", {
						url: route.url,
						with: null
					});
				} else {
					window.open(route.url, "_blank", "noopener");
				}
				sayUpdate(
					"Grab the newest APK from the latest release page to update."
				);
			} catch {
				sayUpdate(
					`Couldn't open it automatically — get the newest APK at ${route.url}`
				);
			} finally {
				updatePhase = { stage: "idle" };
			}
			return;
		}
		if (route.kind === "dev") {
			// Dev shells have no updater artifacts: explain instead of a fetch error.
			sayUpdate(DEV_UPDATE_MESSAGE);
			return;
		}
		try {
			await runUpdateFlow({
				checkForUpdate: () => check(),
				downloadAndInstall: (update, onEvent) =>
					update.downloadAndInstall(onEvent),
				relaunchApp: async () => {
					const { relaunch } = await import("@tauri-apps/plugin-process");
					await relaunch();
				},
				report: sayUpdate,
				onPhase: (phase) => {
					updatePhase = phase;
				}
			});
		} finally {
			updatePhase = { stage: "idle" };
		}
	}
	/**
	 * In-app Android update: check the newest release, download its
	 * APK into the app cache, then fire the system installer. The OS
	 * still confirms the install; a first run opens the
	 * unknown-sources page for a one-time allow instead.
	 */
	async function checkAndroidUpdate(): Promise<void> {
		updatePhase = { stage: "checking" };
		try {
			const { getVersion } = await import("@tauri-apps/api/app");
			const latest = await fetchLatestApk(fetch, await getVersion());
			if (!latest) {
				sayUpdate("You're on the latest version.");
				return;
			}
			pendingApk = latest;
			sayUpdate(`Version ${latest.version} found — download it below.`);
		} catch (error) {
			sayUpdate(`Couldn't check for updates: ${updateError(error)}`);
		} finally {
			updatePhase = { stage: "idle" };
		}
	}
	async function downloadAndroidUpdate(): Promise<void> {
		const pending = pendingApk;
		if (!pending) return;
		updatePhase = { stage: "downloading", received: 0, total: null };
		const { invoke } = await import("@tauri-apps/api/core");
		const { listen } = await import("@tauri-apps/api/event");
		const unlisten = await listen<{ received: number; total: number | null }>(
			"update-download-progress",
			(event) => {
				updatePhase = {
					stage: "downloading",
					received: event.payload.received,
					total: event.payload.total
				};
			}
		);
		try {
			const path = await invoke<string>("update_download_apk", {
				url: pending.url
			});
			apkPath = path;
			pendingApk = null;
			sayUpdate("Downloaded — install it below.");
		} catch (error) {
			sayUpdate(`Download failed: ${updateError(error)}`);
		} finally {
			unlisten();
			updatePhase = { stage: "idle" };
		}
	}
	async function installAndroidUpdate(): Promise<void> {
		const path = apkPath;
		if (!path) return;
		updatePhase = { stage: "installing" };
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const status = await invoke<string>("update_install_apk", { path });
			if (status === "needs-approval") {
				sayUpdate(
					"Allow installs from this app once, then tap Install again."
				);
			} else {
				sayUpdate("Opening the installer…");
			}
		} catch (error) {
			sayUpdate(`Installer did not start: ${updateError(error)}`);
		} finally {
			updatePhase = { stage: "idle" };
		}
	}
	/** Android button: check, download the found version, or install. */
	function androidButtonLabel(): string {
		if (updatePhase.stage !== "idle") return updateButtonLabel(updatePhase);
		if (apkPath) return "Install update";
		if (pendingApk) return `Download ${pendingApk.version}`;
		return "Check for updates";
	}
</script>

<!-- Web builds have no updater shell: the whole section stays out. -->
{#if updateRoute.kind !== "none"}
	<section aria-labelledby="updates-heading">
		<h2 id="updates-heading">Updates</h2>
		<button
			type="button"
			onclick={() => void checkUpdates()}
			disabled={checkingUpdate}
		>
			{updateRoute.kind === "android"
				? androidButtonLabel()
				: updateButtonLabel(updatePhase)}
		</button>
		{#if updateStatus && !onToast}<p class="note" role="status">
				{updateStatus}
			</p>{/if}
	</section>
{/if}
