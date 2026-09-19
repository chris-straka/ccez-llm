<script lang="ts">
	import { DEV_UPDATE_MESSAGE, runUpdateFlow, updateButtonLabel, updateRouteFor } from "$lib/updates";
	import type { UpdatePhase } from "$lib/updates";
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
	const updateRoute = $derived(updateRouteFor(androidUI === true, inShell, import.meta.env.DEV));

	/**
	 * Update result readout: the page toast when one is wired (it
	 * auto-dismisses and never shifts the settings layout), else the
	 * inline fallback below the button.
	 */
	function sayUpdate(message: string): void {
		if (onToast) onToast(message);
		else updateStatus = message;
	}
	async function checkUpdates() {
		if (updatePhase.stage !== "idle") return;
		const route = updateRoute;
		if (route.kind === "releases") {
			// No Tauri auto-updater on Android: open the Releases page instead.
			updatePhase = { stage: "checking" };
			try {
				if (tauriBackendAvailable()) {
					const { invoke } = await import("@tauri-apps/api/core");
					await invoke("plugin:opener|open_url", { url: route.url, with: null });
				} else {
					window.open(route.url, "_blank", "noopener");
				}
				sayUpdate("Grab the newest APK from the latest release page to update.");
			} catch {
				sayUpdate(`Couldn't open it automatically — get the newest APK at ${route.url}`);
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
				downloadAndInstall: (update, onEvent) => update.downloadAndInstall(onEvent),
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
</script>

	<!-- Web builds have no updater shell: the whole section stays out. -->
	{#if updateRoute.kind !== "none"}
		<section aria-labelledby="updates-heading">
			<h2 id="updates-heading">Updates</h2>
			<button type="button" onclick={() => void checkUpdates()} disabled={checkingUpdate}>
				{updateButtonLabel(updatePhase)}
			</button>
			{#if updateStatus && !onToast}<p class="note" role="status">{updateStatus}</p>{/if}
		</section>
	{/if}
