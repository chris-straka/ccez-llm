<script lang="ts">
	import { readyApk } from "$lib/overlays.svelte";
	import {
		DEV_UPDATE_MESSAGE,
		fetchLatestApk,
		runAndroidOneTap,
		runUpdateFlow,
		updateButtonLabel,
		updateRouteFor
	} from "$lib/updates";
	import type { UpdatePhase } from "$lib/updates";
	import { tauriBackendAvailable } from "$lib/secrets";
	import { isIOSUserAgent } from "$lib/platform";
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
		updateRouteFor(
			androidUI === true,
			inShell,
			import.meta.env.DEV,
			isIOSUserAgent(navigator.userAgent)
		)
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
	/* A downloaded APK ready to install is readyApk.path, shared with the
	background check: the panel is mounted before that check is done,
	and a copy taken then never saw its download. */
	async function checkUpdates() {
		if (updatePhase.stage !== "idle") return;
		const route = updateRoute;
		if (route.kind === "android") return void androidUpdate();
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
	 * In-app Android update, one tap: check, download (progress on the
	 * button), then the system installer (runAndroidOneTap).
	 */
	async function androidUpdate(): Promise<void> {
		updatePhase = { stage: "checking" };
		let unlisten: (() => void) | undefined;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const { listen } = await import("@tauri-apps/api/event");
			unlisten = await listen<{ received: number; total: number | null }>(
				"update-download-progress",
				(event) => {
					updatePhase = {
						stage: "downloading",
						received: event.payload.received,
						total: event.payload.total
					};
				}
			);
			const path = await runAndroidOneTap({
				currentVersion: async () => {
					const { getVersion } = await import("@tauri-apps/api/app");
					return getVersion();
				},
				latest: (current) => fetchLatestApk(fetch, current),
				download: (url) => {
					updatePhase = { stage: "downloading", received: 0, total: null };
					return invoke<string>("update_download_apk", { url });
				},
				install: (path) => {
					updatePhase = { stage: "installing" };
					return invoke<string>("update_install_apk", { path });
				},
				say: sayUpdate,
				ready: readyApk.path || null
			});
			readyApk.path = path ?? "";
		} catch (error) {
			sayUpdate(
				`Couldn't check for updates: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			unlisten?.();
			updatePhase = { stage: "idle" };
		}
	}
	/** Android button: check, download the found version, or install. */
	function androidButtonLabel(): string {
		if (updatePhase.stage !== "idle") return updateButtonLabel(updatePhase);
		if (readyApk.path) return "Install update";
		return "Check for updates";
	}
</script>

<!-- Web builds have no updater shell: the whole section stays out. -->
{#if updateRoute.kind !== "none"}
	<section aria-labelledby="updates-heading">
		<h2 id="updates-heading">Updates</h2>
		<button
			type="button"
			class="row-go"
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
