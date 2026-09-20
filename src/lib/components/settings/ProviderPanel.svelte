<script lang="ts" module>
	/**
	 * Last AICore support verdict, kept across panel opens so a
	 * reopen doesn't re-flash the ML Kit radio on unsupported
	 * hardware. Unknown until the first mount probe resolves.
	 */
	let lastMlkitSupport: boolean | null = null;
</script>

<script lang="ts">
	import {
		asProviderId,
		builtin,
		getProviderDef,
		listProviders,
		createProvider,
		type ProviderId
	} from "$lib/providers/registry";
	import {
		maskKey,
		activeProviderSettings,
		type AppSettings
	} from "$lib/settings";
	import { tauriBackendAvailable } from "$lib/secrets";
		import {
		downloadedMB,
		isOnDeviceProvider,
		onDeviceErrorCopy,
		onDeviceStatus,
		onDeviceUnsupported,
		openAICorePage,
		type OnDeviceStatus
	} from "$lib/ondevice/bridge";
	import { isAndroidUserAgent, visibleProviderIds } from "$lib/platform";
	import {
		clearNotice,
		emptyNotices,
		flashNotice,
		MODEL_TIMEOUT_MS
	} from "$lib/notices";
	import { onMount } from "svelte";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
	}

	let { settings = $bindable() }: Props = $props();
	let modelLoading = $state(false);
	let modelNotice = $state(emptyNotices());
	async function refreshModels() {
		clearNotice(modelNotice, "banner");
		if (!active.baseUrl.trim() || !active.apiKey.trim()) {
			flashNotice(
				modelNotice,
				"banner",
				"Enter a base URL and API key first.",
				MODEL_TIMEOUT_MS
			);
			return;
		}
		modelLoading = true;
		try {
			active.models = await createProvider(
				settings.activeProviderId,
				active,
				settings.customProviders
			).listModels();
		} catch (error) {
			flashNotice(
				modelNotice,
				"banner",
				error instanceof Error ? error.message : String(error),
				MODEL_TIMEOUT_MS
			);
		} finally {
			modelLoading = false;
		}
	}
	function maybeFetchModels() {
		if (active.apiKey.trim() && active.models.length === 0)
			void refreshModels();
	}
	let editingKey: Record<string, boolean> = $state({});
	/** Paste-button failure (clipboard denied, empty): cleared on edit. */
	let keyPasteError = $state("");
	/**
	 * Phone keyboards hide paste on password fields, so the field gets
	 * its own button. The tap is the clipboard-read user gesture; when
	 * the WebView denies it, the hint names the long-press fallback.
	 */
	async function pasteKey(): Promise<void> {
		keyPasteError = "";
		try {
			const text = await navigator.clipboard.readText();
			if (!text.trim()) {
				keyPasteError = "Clipboard is empty.";
				return;
			}
			active.apiKey = text.trim();
		} catch {
			keyPasteError =
				"Couldn't read the clipboard — long-press the field to paste.";
		}
	}
	const inShell = tauriBackendAvailable();

	const allProviders = $derived(listProviders(settings.customProviders));
	/**
	 * Radios follow the provider gating contract (platform.ts):
	 * local-mlkit lists only where its bridge ships (Android shell —
	 * not iOS, not desktop), and offline Android narrows to ML Kit
	 * alone. Online state tracks the window events while the panel
	 * is open, so an offline drop re-narrows without a reopen.
	 */
	const androidBridge = isAndroidUserAgent(navigator.userAgent);
	let online = $state(navigator.onLine);
	/**
	 * Mount-probe verdict on AICore support (Android shell only): the
	 * ML Kit radio lists only on positively supported hardware, so it
	 * fails nowhere — not even at send time. Unknown (pre-probe) and
	 * failed probes hide it; reopening re-probes.
	 */
	let mlkitSupported = $state(lastMlkitSupport);
	const listedProviders = $derived.by(() => {
		const visible = new Set(
			visibleProviderIds(
				allProviders.map((p) => p.id),
				{ android: androidBridge, online, local: androidBridge }
			)
		);
		return allProviders.filter(
			(p) =>
				visible.has(p.id) &&
				(!isOnDeviceProvider(p.id) || mlkitSupported === true)
		);
	});
	const activeDef = $derived(
		getProviderDef(settings.activeProviderId, settings.customProviders)
	);
	const activeCustom = $derived(
		settings.customProviders.some((p) => p.id === settings.activeProviderId)
	);
	const active = $derived(activeProviderSettings(settings));
	const showKeyField = $derived(
		!active.apiKey.trim() || editingKey[settings.activeProviderId]
	);
	function switchProvider(id: ProviderId) {
		settings.activeProviderId = id;
		maybeFetchModels();
		void probeOnDevice();
	}
	/**
	 * On-device readiness under the ML Kit pill: ready, downloading
	 * with the MB count, or the short reason copy (wrong device, no
	 * model yet). Probed when the panel opens (every switch too); the
	 * only poll in settings re-probes while a download runs so the
	 * count moves, and terminal states stop it.
	 */
	let onDeviceNote = $state("");
	/** Machine reason behind the note (drives the AI Core button). */
	let onDeviceReason: string | null = $state(null);
	/** Store-open failure for the AI Core button; cleared on edit. */
	let aicoreOpenError = $state("");
	/**
	 * AI Core's store page (hidden system component — the button is
	 * the only way to reach it). Failures name the fallback instead
	 * of going silent.
	 */
	async function openAICoreOnce(): Promise<void> {
		aicoreOpenError = "";
		try {
			await openAICorePage();
		} catch {
			aicoreOpenError = "Couldn't open the store app.";
		}
	}
	let onDeviceProbing = $state(false);
	let downloadTimer: number | undefined;
	function clearDownloadTimer(): void {
		if (downloadTimer !== undefined) {
			window.clearTimeout(downloadTimer);
			downloadTimer = undefined;
		}
	}
	/** Downloading copy with the MB count when the probe carries one. */
	function downloadNote(status: OnDeviceStatus): string {
		const mb = downloadedMB(status.downloadedBytes);
		return mb === null
			? "Downloading the on-device model — it works offline after this once."
			: `Downloading the on-device model — ${mb} so far. It works offline after this once.`;
	}
	async function probeOnDevice(): Promise<void> {
		clearDownloadTimer();
		const wantNote = isOnDeviceProvider(settings.activeProviderId);
		if (!androidBridge && !wantNote) {
			onDeviceNote = "";
			return;
		}
		if (wantNote) onDeviceProbing = true;
		try {
			const status = await onDeviceStatus();
			if (androidBridge) {
				// Shell only: a phone browser has the UA but no
				// bridge, so it must not list the pill either. A
				// failed probe stays unknown (hidden now, re-probed
				// on the next open) rather than caching a false no.
				mlkitSupported = inShell && !onDeviceUnsupported(status);
				if (mlkitSupported) lastMlkitSupport = true;
			}
			if (!wantNote) {
				onDeviceNote = "";
				onDeviceReason = null;
				return;
			}
			onDeviceReason = status.reason ?? null;
			onDeviceNote =
				status.state === "ready"
					? "On-device model ready — replies never leave this phone."
					: status.state === "downloading"
						? downloadNote(status)
						: onDeviceErrorCopy(status.reason ?? "unsupported") +
							// The native one-liner behind a bare "failed":
							// settings-only detail, never toasted.
							(status.detail ? ` (${status.detail})` : "");
			if (status.state === "downloading") {
				downloadTimer = window.setTimeout(() => void probeOnDevice(), 3000);
			}
		} catch {
			if (wantNote) {
				onDeviceNote = onDeviceErrorCopy("unsupported");
				onDeviceReason = null;
			}
		} finally {
			onDeviceProbing = false;
		}
	}
	let customName = $state("");
	let customBaseUrl = $state("");
	let customModel = $state("");
	let customError = $state("");

	/** Cline-style: any OpenAI-compatible endpoint becomes a provider. */
	function addCustomProvider(): void {
		customError = "";
		const label = customName.trim();
		const baseUrl = customBaseUrl.trim().replace(/\/+$/, "");
		const model = customModel.trim();
		if (!label) {
			customError = "Give the provider a name.";
			return;
		}
		if (!/^https?:\/\/.+/i.test(baseUrl)) {
			customError = "Base URL must start with http(s)://.";
			return;
		}
		if (!model) {
			customError = "Enter a model id.";
			return;
		}
		const slug =
			label
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "") || "provider";
		const taken = new Set<string>(allProviders.map((p) => p.id));
		let id = `custom-${slug}`;
		let n = 2;
		while (taken.has(id)) id = `custom-${slug}-${n++}`;
		settings.customProviders = [
			...settings.customProviders,
			{
				id: asProviderId(id),
				label,
				defaultBaseUrl: baseUrl,
				defaultModel: model,
				keyHint: "API key"
			}
		];
		settings.providers[id] = { baseUrl, apiKey: "", model, models: [] };
		customName = "";
		customBaseUrl = "";
		customModel = "";
		switchProvider(asProviderId(id));
	}

	function removeCustomProvider(): void {
		const id = settings.activeProviderId;
		if (!settings.customProviders.some((p) => p.id === id)) return;
		settings.customProviders = settings.customProviders.filter(
			(p) => p.id !== id
		);
		delete settings.providers[id];
		switchProvider(builtin("muse"));
	}
	onMount(() => {
		maybeFetchModels();
		void probeOnDevice();
		const updateOnline = (): void => {
			online = navigator.onLine;
		};
		window.addEventListener("online", updateOnline);
		window.addEventListener("offline", updateOnline);
		return () => {
			window.removeEventListener("online", updateOnline);
			window.removeEventListener("offline", updateOnline);
			clearDownloadTimer();
		};
	});
</script>

<section aria-labelledby="provider-heading">
	<h2 id="provider-heading">Model provider</h2>
	<div class="provider-row" role="radiogroup" aria-label="Active provider">
		{#each listedProviders as def (def.id)}
			<button
				type="button"
				role="radio"
				aria-checked={settings.activeProviderId === def.id}
				class:selected={settings.activeProviderId === def.id}
				onclick={() => switchProvider(def.id)}
			>
				{def.label}
			</button>
		{/each}
	</div>
	{#if activeCustom}
		<p class="note">
			Custom provider.
			<button type="button" onclick={removeCustomProvider}
				>Remove {activeDef.label}</button
			>
		</p>
	{/if}
	<details class="note provider-add">
		<summary>Add a custom provider…</summary>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				addCustomProvider();
			}}
		>
			<label>
				Name
				<input
					type="text"
					required
					bind:value={customName}
					oninput={() => (customError = "")}
					placeholder="e.g. Kimi"
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			<label>
				Base URL
				<input
					type="url"
					required
					bind:value={customBaseUrl}
					oninput={() => (customError = "")}
					placeholder="https://api.example.com/v1"
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			<label>
				Model
				<input
					type="text"
					required
					bind:value={customModel}
					oninput={() => (customError = "")}
					placeholder="model-id"
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			{#if customError}<span class="hint" role="alert">{customError}</span>{/if}
			<button type="submit">Add provider</button>
		</form>
	</details>

	{#if !isOnDeviceProvider(settings.activeProviderId)}
		<!-- On-device ML Kit has no URL to point and no model to pick:
			showing them reads as user configuration that does nothing. -->
		<label>
			Base URL
			<input
				type="url"
				bind:value={active.baseUrl}
				autocomplete="off"
				spellcheck="false"
			/>
		</label>
		<label>
			Model
			<span class="model-row">
				<input
					type="text"
					list="model-list"
					bind:value={active.model}
					autocomplete="off"
					spellcheck="false"
				/>
				<button
					type="button"
					title="Fetch the model list from this base URL"
					disabled={modelLoading}
					onclick={() => void refreshModels()}
				>
					{modelLoading ? "…" : "Refresh"}
				</button>
			</span>
			<datalist id="model-list">
				{#each active.models as id (id)}<option value={id}></option>{/each}
			</datalist>
			{#if modelNotice.banner.message}<span class="hint" role="alert"
					>{modelNotice.banner.message}</span
				>{/if}
		</label>
	{/if}
	{#if activeDef.keyless}
		<p class="key-state" role="status">No key needed — {activeDef.keyHint}.</p>
		{#if isOnDeviceProvider(settings.activeProviderId)}
			<p class="note" role="status">
				{onDeviceProbing ? "Checking on-device model…" : onDeviceNote}
			</p>
			<p class="note">
				<!-- Manual re-probe: terminal states (error, no model
					yet) never re-poll on their own, so after an AI Core
					update or a restart this is how the pill finds the
					model without closing Settings. -->
				<button
					type="button"
					title="Check the on-device model again"
					disabled={onDeviceProbing}
					onclick={() => void probeOnDevice()}
				>
					{onDeviceProbing ? "Checking…" : "Check again"}
				</button>
			</p>
			{#if onDeviceReason === "stale-aicore" && !onDeviceProbing}
				<!-- AI Core is a hidden system component (unsearchable
					in the store): the button deep-links its page by
					package id. -->
				<p class="note">
					<button type="button" onclick={() => void openAICoreOnce()}
						>Update AI Core</button
					>
					{#if aicoreOpenError}<span class="hint" role="alert"
							>{aicoreOpenError}</span
						>{/if}
				</p>
			{/if}
		{/if}
	{:else if showKeyField}
		<label>
			API key <span class="hint">{activeDef.keyHint}</span>
			<span class="model-row">
				<input
					type="password"
					bind:value={active.apiKey}
					autocomplete="off"
					spellcheck="false"
					oninput={() => (keyPasteError = "")}
					onblur={() => (editingKey[settings.activeProviderId] = false)}
				/>
				<button type="button" onclick={() => void pasteKey()}>Paste</button>
			</span>
			{#if keyPasteError}<span class="hint" role="alert"
					>{keyPasteError}</span
				>{/if}
		</label>
	{:else}
		<p class="key-state" role="status">
			Key loaded: <code>{maskKey(active.apiKey)}</code>
			<button
				type="button"
				onclick={() => (editingKey[settings.activeProviderId] = true)}
			>
				Replace
			</button>
		</p>
	{/if}
	{#if !activeDef.keyless}
		<!-- Keyless providers (on-device ML Kit) have no key to reassure
		about: the note would read as if one were stored. -->
		<p class="note">
			{#if inShell}
				Keys stay in this app's secured storage, never in a file.
			{:else}
				Keys stay on this machine, in this app's local storage.
			{/if}
		</p>
	{/if}
</section>
