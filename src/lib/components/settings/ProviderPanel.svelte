<script lang="ts">
	import {
		asProviderId,
		builtin,
		getProviderDef,
		listProviders,
		createProvider,
		type ProviderId
	} from "$lib/providers/registry";
	import { maskKey, activeProviderSettings, type AppSettings } from "$lib/settings";
	import { tauriBackendAvailable } from "$lib/secrets";
	import { clearNotice, emptyNotices, flashNotice, MODEL_TIMEOUT_MS } from "$lib/notices";
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
			flashNotice(modelNotice, "banner", "Enter a base URL and API key first.", MODEL_TIMEOUT_MS);
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
		if (active.apiKey.trim() && active.models.length === 0) void refreshModels();
	}
	let editingKey: Record<string, boolean> = $state({});
	const inShell = tauriBackendAvailable();

	const allProviders = $derived(listProviders(settings.customProviders));
	const activeDef = $derived(getProviderDef(settings.activeProviderId, settings.customProviders));
	const activeCustom = $derived(
		settings.customProviders.some((p) => p.id === settings.activeProviderId)
	);
	const active = $derived(activeProviderSettings(settings));
	const showKeyField = $derived(!active.apiKey.trim() || editingKey[settings.activeProviderId]);
	function switchProvider(id: ProviderId) {
		settings.activeProviderId = id;
		maybeFetchModels();
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
			{ id: asProviderId(id), label, defaultBaseUrl: baseUrl, defaultModel: model, keyHint: "API key" }
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
		settings.customProviders = settings.customProviders.filter((p) => p.id !== id);
		delete settings.providers[id];
		switchProvider(builtin("muse"));
	}
	onMount(() => {
		maybeFetchModels();
	});
</script>

<section aria-labelledby="provider-heading">
	<h2 id="provider-heading">Model provider</h2>
	<div class="provider-row" role="radiogroup" aria-label="Active provider">
		{#each allProviders as def (def.id)}
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
			<button type="button" onclick={removeCustomProvider}>Remove {activeDef.label}</button>
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

	<label>
		Base URL
		<input type="url" bind:value={active.baseUrl} autocomplete="off" spellcheck="false" />
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
		{#if modelNotice.banner.message}<span class="hint" role="alert">{modelNotice.banner.message}</span>{/if}
	</label>
	{#if activeDef.keyless}
		<p class="key-state" role="status">No key needed — {activeDef.keyHint}.</p>
	{:else if showKeyField}
		<label>
			API key <span class="hint">{activeDef.keyHint}</span>
			<input
				type="password"
				bind:value={active.apiKey}
				autocomplete="off"
				spellcheck="false"
				onblur={() => (editingKey[settings.activeProviderId] = false)}
			/>
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
		<!-- Keyless providers (on-device Gemma) have no key to reassure
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
