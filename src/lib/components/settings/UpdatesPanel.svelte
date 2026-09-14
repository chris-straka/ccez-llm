<script lang="ts">
	import { DEV_UPDATE_MESSAGE, updateRouteFor } from "$lib/updates";
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
	let checkingUpdate = $state(false);
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
		checkingUpdate = true;
		const route = updateRoute;
		if (route.kind === "none") {
			// Web build: a redeploy updates the site, so there is nothing to check.
			sayUpdate("This web build updates with the site — nothing to check.");
			checkingUpdate = false;
			return;
		}
		if (route.kind === "releases") {
			// No Tauri auto-updater on Android: open the Releases page instead.
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
				checkingUpdate = false;
			}
			return;
		}
		if (route.kind === "dev") {
			// Dev shells have no updater artifacts: explain instead of a fetch error.
			sayUpdate(DEV_UPDATE_MESSAGE);
			checkingUpdate = false;
			return;
		}
		try {
			const update = await check();
			sayUpdate(
				update
					? `Version ${update.version} is available — download it from the release page to install.`
					: "You're on the latest version."
			);
		} catch (error) {
			sayUpdate(
				`Updater unavailable: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			checkingUpdate = false;
		}
	}
</script>

	<section aria-labelledby="updates-heading">
		<h2 id="updates-heading">Updates</h2>
		{#if updateRoute.kind === "none"}
			<p class="result">This web build updates with the site — nothing to check.</p>
		{:else}
			<button type="button" onclick={() => void checkUpdates()} disabled={checkingUpdate}>
				{checkingUpdate ? "Checking…" : "Check for updates"}
			</button>
			{#if updateStatus && !onToast}<p class="note" role="status">{updateStatus}</p>{/if}
		{/if}
	</section>
