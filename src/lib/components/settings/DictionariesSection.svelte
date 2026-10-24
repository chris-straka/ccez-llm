<script lang="ts">
	import type { AppSettings } from "$lib/settings";
	import {
		DICT_LANGS,
		dictSummary,
		type InstalledDictionary
	} from "$lib/dict-manager";
	import {
		dictDownloads,
		dictManager,
		listDictionaries
	} from "$lib/dictionary.svelte";

	interface Props {
		settings: AppSettings;
	}

	let { settings = $bindable() }: Props = $props();

	let installed: InstalledDictionary[] = $state([]);

	// Re-read the folder when a download starts or ends, and when the
	// manager closes (it may have removed some).
	$effect(() => {
		void Object.keys(dictDownloads).length;
		void dictManager.open;
		void listDictionaries().then((list) => (installed = list));
	});

	const downloading = $derived(Object.keys(dictDownloads).length);
</script>

<!-- Packs download per language on first use. With up to 49 of them
the list lives in the manager (a wide sheet); Settings keeps the
switch, a one-line summary and the way in. -->
<fieldset class="dicts">
	<legend>Dictionaries</legend>
	<label class="check">
		<input type="checkbox" bind:checked={settings.wordCardDictionaries} />
		<span>Download for word cards as you read (Wiktionary, JMdict)</span>
	</label>
	<div class="dict-row">
		<span class="dict-sum"
			>{dictSummary(installed, DICT_LANGS.size)}{downloading > 0
				? ` · ${downloading} downloading`
				: ""}</span
		>
		<button
			type="button"
			class="dict-manage"
			onclick={() => (dictManager.open = true)}>Manage dictionaries</button
		>
	</div>
</fieldset>

<style>
	.dict-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		margin-top: 0.55rem;
	}
	.dict-sum {
		font-size: 0.88rem;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	.dict-manage {
		min-height: 2.6rem;
		padding: 0 0.9rem;
		font: inherit;
		font-size: 0.88rem;
		color: inherit;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: 8px;
		cursor: pointer;
		transition: border-color 0.15s ease;
	}
	.dict-manage:hover {
		border-color: var(--strong);
	}
	:global(.app[data-android]) .dict-manage {
		min-height: 2.9rem;
	}
</style>
