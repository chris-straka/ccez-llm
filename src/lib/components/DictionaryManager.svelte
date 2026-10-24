<!-- Dictionary manager: every language pack in one wide sheet (most
of the window on desktop, the whole screen on phones), grouped like
the language menus, so fifty of them read as a map instead of a long
column in Settings. Each tile says whether its pack is on disk (and
how big), downloading, or on offer (and how big a download); a pack
can be fetched ahead of reading or removed, and all of them removed
at once behind a confirm. Opened from Settings → Dictionaries; the
page renders it and gives Escape to it first. -->
<script lang="ts">
	import { onMount } from "svelte";
	import type { AppSettings } from "$lib/settings";
	import {
		DICT_LANGS,
		dictGroups,
		dictMatches,
		dictSummary,
		dictTile,
		type InstalledDictionary,
		type OfferedDictionary
	} from "$lib/dict-manager";
	import {
		dictDownloads,
		dictionaryCatalog,
		installDictionary,
		listDictionaries,
		removeDictionary
	} from "$lib/dictionary.svelte";
	import { DICTIONARY_CREDITS } from "$lib/licenses";
	import ActionIcon from "./ActionIcon.svelte";
	import Modal from "./Modal.svelte";

	interface Props {
		settings: AppSettings;
		android: boolean;
		onClose: () => void;
	}

	let { settings = $bindable(), android, onClose }: Props = $props();

	let installed: InstalledDictionary[] = $state([]);
	let catalog: Record<string, OfferedDictionary> | null = $state(null);
	let query = $state("");
	let confirmAll = $state(false);
	let filterEl: HTMLInputElement | undefined = $state();

	const groups = dictGroups();
	const credits = DICTIONARY_CREDITS.map(
		(c) => `${c.name} (${c.license})`
	).join(" and ");

	function refresh(): void {
		void listDictionaries().then((list) => (installed = list));
	}

	onMount(() => {
		void dictionaryCatalog().then((c) => (catalog = c));
		// Phones keep the keyboard down until the field is tapped.
		if (!android) filterEl?.focus();
	});

	// Re-read the folder whenever a download starts or ends.
	$effect(() => {
		void Object.keys(dictDownloads).length;
		refresh();
	});

	const shown = $derived(
		groups
			.map((g) => ({
				label: g.label,
				total: g.langs.length,
				have: g.langs.filter((l) => installed.some((d) => d.lang === l.lang))
					.length,
				tiles: g.langs
					.filter((l) => dictMatches(l, query))
					.map((l) => dictTile(l, installed, dictDownloads, catalog))
			}))
			.filter((g) => g.tiles.length > 0)
	);

	function download(lang: string): void {
		settings.dictionarySkip = settings.dictionarySkip.filter((l) => l !== lang);
		void installDictionary(lang).then(refresh);
	}

	async function remove(langs: string[]): Promise<void> {
		settings.dictionarySkip = [
			...new Set([...settings.dictionarySkip, ...langs])
		];
		for (const lang of langs) await removeDictionary(lang);
		confirmAll = false;
		refresh();
	}

	/** Backdrop click only; keyboard users get Esc and the × button. */
	function veilClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) onClose();
	}
</script>

<Modal
	label="Dictionaries"
	labelledby="dict-heading"
	veilClass="dict-veil"
	cardClass="dict-modal"
	onVeilClick={veilClick}
>
	<div class="dm-head">
		<div class="dm-title">
			<h2 id="dict-heading">Dictionaries</h2>
			<p class="dm-sum">{dictSummary(installed, DICT_LANGS.size)}</p>
		</div>
		<input
			type="search"
			class="dm-filter"
			bind:this={filterEl}
			bind:value={query}
			placeholder="Filter languages"
			aria-label="Filter languages"
			autocomplete="off"
			spellcheck={false}
		/>
		<button
			type="button"
			class="dm-close"
			aria-label="Close dictionaries"
			onclick={onClose}
		>
			<ActionIcon kind="close" />
		</button>
	</div>
	<p class="dm-note">
		A language downloads by itself the first time you look up a word in it,
		unless you removed it here. Download one ahead and its word cards are
		complete from the first word.
	</p>

	{#each shown as group (group.label)}
		<section class="dm-group" aria-label={group.label}>
			<h3>
				{group.label}
				<span class="dm-count">{group.have} of {group.total}</span>
			</h3>
			<ul class="dm-grid">
				{#each group.tiles as tile (tile.lang)}
					<li class="dm-tile s-{tile.state}">
						<span class="dm-names">
							<span class="dm-name">{tile.name}</span>
							{#if tile.native}
								<span class="dm-native" lang={tile.lang}>{tile.native}</span>
							{/if}
						</span>
						<span class="dm-size">{tile.size}</span>
						{#if tile.state === "installed"}
							<button
								type="button"
								class="dm-act"
								aria-label="Remove {tile.name} dictionary"
								title="Remove"
								onclick={() => void remove([tile.lang])}
							>
								<ActionIcon kind="delete" />
							</button>
						{:else if tile.state === "available"}
							<button
								type="button"
								class="dm-act"
								aria-label="Download {tile.name} dictionary"
								title="Download"
								onclick={() => download(tile.lang)}
							>
								<ActionIcon kind="export" />
							</button>
						{:else}
							<span class="dm-act-gap"></span>
							<span
								class="dm-bar"
								style:--p={tile.progress ?? 0}
								role="progressbar"
								aria-label="Downloading {tile.name}"
								aria-valuenow={Math.round((tile.progress ?? 0) * 100)}
								aria-valuemin={0}
								aria-valuemax={100}
							></span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="dm-empty">No language matches “{query}”.</p>
	{/each}

	<p class="dm-credits">Dictionaries from {credits}.</p>

	{#if installed.length > 1}
		<div class="dm-foot">
			{#if confirmAll}
				<span>Remove all {installed.length} dictionaries?</span>
				<button
					type="button"
					class="dm-btn danger"
					onclick={() => void remove(installed.map((d) => d.lang))}
					>Remove all</button
				>
				<button
					type="button"
					class="dm-btn"
					onclick={() => (confirmAll = false)}>Cancel</button
				>
			{:else}
				<button type="button" class="dm-btn" onclick={() => (confirmAll = true)}
					>Remove all…</button
				>
			{/if}
		</div>
	{/if}
</Modal>

<style>
	.dm-head {
		position: sticky;
		top: -0.9rem;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.8rem 1rem;
		flex-wrap: wrap;
		margin: -0.9rem -1.4rem 0;
		padding: 0.9rem 1.4rem 0.7rem;
		background: var(--bg);
		border-bottom: 1px solid var(--line-soft);
	}
	.dm-title {
		display: flex;
		align-items: baseline;
		gap: 0.3rem 0.8rem;
		flex-wrap: wrap;
		margin-right: auto;
		min-width: 0;
	}
	.dm-title h2 {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 700;
	}
	.dm-sum {
		margin: 0;
		font-size: 0.88rem;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	.dm-filter {
		width: 14rem;
		max-width: 100%;
		min-height: 2.4rem;
		padding: 0 0.7rem;
		font: inherit;
		font-size: 0.9rem;
		color: inherit;
		background: var(--field);
		border: 1px solid var(--line);
		border-radius: 8px;
		box-sizing: border-box;
	}
	.dm-filter:focus {
		outline: none;
		border-color: var(--strong);
	}
	.dm-close,
	.dm-act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		color: var(--muted);
		background: none;
		border: 0;
		border-radius: 8px;
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}
	.dm-close:hover,
	.dm-act:hover,
	.dm-act:focus-visible {
		color: var(--ink);
		background: var(--hover-wash);
	}
	.dm-close :global(.action-glyph),
	.dm-act :global(.action-glyph) {
		width: 1.05rem;
		height: 1.05rem;
	}
	.dm-note {
		max-width: 62ch;
		margin: 0.8rem 0 0.2rem;
		font-size: 0.86rem;
		color: var(--muted);
	}
	.dm-group h3 {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin: 1.2rem 0 0.5rem;
		font-size: 0.82rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.dm-count {
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		font-variant-numeric: tabular-nums;
	}
	/* As many columns as the sheet holds: four or five on a desktop
	window, one or two on a phone. */
	.dm-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(13.5rem, 1fr));
		gap: 0.45rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.dm-tile {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 2.4rem;
		align-items: center;
		gap: 0.5rem;
		min-height: 3.2rem;
		padding: 0 0.2rem 0 0.8rem;
		border: 1px solid var(--line-soft);
		border-radius: 10px;
		overflow: hidden;
	}
	/* On disk: a filled tile, so what's downloaded reads at a glance. */
	.dm-tile.s-installed,
	.dm-tile.s-downloading {
		background: var(--selected-wash);
		border-color: transparent;
	}
	.dm-names {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.25;
	}
	.dm-name {
		overflow-wrap: anywhere;
	}
	.dm-tile.s-installed .dm-name {
		font-weight: 600;
	}
	.dm-native {
		font-size: 0.78rem;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dm-size {
		font-size: 0.84rem;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
		white-space: nowrap;
	}
	/* Download progress: a thin bar along the tile's foot. */
	.dm-bar {
		position: absolute;
		inset: auto 0 0 0;
		height: 3px;
		background: var(--line-soft);
	}
	.dm-bar::after {
		content: "";
		position: absolute;
		inset: 0 auto 0 0;
		width: calc(var(--p) * 100%);
		background: var(--accent);
		transition: width 0.3s ease;
	}
	@media (prefers-reduced-motion: reduce) {
		.dm-bar::after {
			transition: none;
		}
	}
	.dm-empty {
		margin: 1.5rem 0;
		color: var(--muted);
	}
	.dm-credits {
		max-width: 70ch;
		margin: 1.4rem 0 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.dm-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.6rem;
		margin-top: 1.4rem;
		padding-top: 0.8rem;
		border-top: 1px solid var(--line-soft);
		font-size: 0.9rem;
	}
	.dm-btn {
		min-height: 2.4rem;
		padding: 0 0.9rem;
		font: inherit;
		color: inherit;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: 8px;
		cursor: pointer;
	}
	.dm-btn:hover {
		border-color: var(--strong);
	}
	.dm-btn.danger {
		color: var(--danger);
		border-color: currentColor;
	}
</style>
