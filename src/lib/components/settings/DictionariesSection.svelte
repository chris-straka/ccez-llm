<script lang="ts">
	import type { AppSettings } from "$lib/settings";
	import { replyLanguageFor } from "$lib/languages";
	import {
		dictDownloads,
		dictSize,
		installDictionary,
		listDictionaries,
		removeDictionary,
		type InstalledDictionary
	} from "$lib/dictionary.svelte";

	interface Props {
		settings: AppSettings;
	}

	let { settings = $bindable() }: Props = $props();

	let installed: InstalledDictionary[] = $state([]);

	function refresh(): void {
		void listDictionaries().then((list) => (installed = list));
	}

	// Re-read the folder whenever a download starts or ends.
	$effect(() => {
		void Object.keys(dictDownloads).length;
		refresh();
	});

	const name = (lang: string): string => replyLanguageFor(lang)?.name ?? lang;

	interface Row {
		lang: string;
		/** Size on disk, or the download's progress. */
		state: string;
		action?: "remove" | "download";
	}

	const rows: Row[] = $derived.by(() => {
		const out: Row[] = installed.map((d) =>
			d.lang in dictDownloads
				? {
						lang: d.lang,
						state: `updating ${Math.round((dictDownloads[d.lang] ?? 0) * 100)}%`
					}
				: { lang: d.lang, state: dictSize(d.bytes), action: "remove" }
		);
		for (const lang of Object.keys(dictDownloads))
			if (!installed.some((d) => d.lang === lang))
				out.push({
					lang,
					state: `downloading ${Math.round((dictDownloads[lang] ?? 0) * 100)}%`
				});
		for (const lang of settings.dictionarySkip)
			if (!out.some((r) => r.lang === lang))
				out.push({ lang, state: "removed", action: "download" });
		return out.sort((a, b) => name(a.lang).localeCompare(name(b.lang)));
	});

	const total = $derived(installed.reduce((n, d) => n + d.bytes, 0));

	async function remove(lang: string): Promise<void> {
		if (!settings.dictionarySkip.includes(lang))
			settings.dictionarySkip = [...settings.dictionarySkip, lang];
		await removeDictionary(lang);
		refresh();
	}

	function download(lang: string): void {
		settings.dictionarySkip = settings.dictionarySkip.filter((l) => l !== lang);
		void installDictionary(lang).then(refresh);
	}
</script>

<!-- Packs download per language on first use; this lists what's on
disk as an aligned table (language, size, action), so a removed one
stays removed until asked for. -->
<fieldset class="dicts">
	<legend>Dictionaries</legend>
	<label class="check">
		<input type="checkbox" bind:checked={settings.wordCardDictionaries} />
		<span>Download for word cards as you read (Wiktionary, JMdict)</span>
	</label>
	{#if rows.length > 0}
		<ul class="dict-list" aria-label="Dictionaries">
			{#each rows as row (row.lang)}
				<li class="dict-row" class:off={row.action === "download"}>
					<span class="dict-name">{name(row.lang)}</span>
					<span class="dict-size">{row.state}</span>
					{#if row.action === "remove"}
						<button
							type="button"
							class="dict-act"
							aria-label="Remove {name(row.lang)} dictionary"
							onclick={() => void remove(row.lang)}>Remove</button
						>
					{:else if row.action === "download"}
						<button
							type="button"
							class="dict-act"
							aria-label="Download {name(row.lang)} dictionary"
							onclick={() => download(row.lang)}>Download</button
						>
					{:else}
						<span class="dict-act-gap"></span>
					{/if}
				</li>
			{/each}
		</ul>
		{#if installed.length > 1}
			<p class="dict-total">
				{installed.length} languages · {dictSize(total)}
			</p>
		{/if}
	{/if}
</fieldset>

<style>
	.dict-list {
		list-style: none;
		padding: 0;
		margin: 0.6rem 0 0;
		border-top: 1px solid var(--line-soft);
	}
	/* One row per language: name, size flush right in even digits,
	then the action, every row on the same columns. */
	.dict-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 4.6rem;
		align-items: center;
		gap: 0.8rem;
		min-height: 2.6rem;
		border-bottom: 1px solid var(--line-soft);
	}
	.dict-name {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.dict-size {
		font-variant-numeric: tabular-nums;
		text-align: end;
		color: var(--muted);
	}
	.dict-row.off .dict-name {
		color: var(--muted);
	}
	/* Quiet text actions: seven bordered buttons in a column read as
	a toolbar. The hit area stays a full row tall. */
	.dict-act {
		justify-self: end;
		min-height: 2.4rem;
		padding: 0 0.2rem;
		font: inherit;
		font-size: 0.84rem;
		color: var(--muted);
		background: none;
		border: 0;
		cursor: pointer;
		transition: color 0.15s ease;
	}
	.dict-act:hover,
	.dict-act:focus-visible {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.dict-total {
		margin: 0.45rem 0 0;
		font-size: 0.84rem;
		text-align: end;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	:global(.app[data-android]) .dict-row {
		min-height: 2.9rem;
	}
</style>
