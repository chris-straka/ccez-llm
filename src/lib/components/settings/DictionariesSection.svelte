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
disk, with sizes, so a removed one stays removed until asked for. -->
<div class="dicts">
	<label class="check">
		<input type="checkbox" bind:checked={settings.wordCardDictionaries} />
		<span>Download dictionaries for word cards (Wiktionary, JMdict)</span>
	</label>
	{#if rows.length > 0}
		<ul class="note dict-list" aria-label="Dictionaries">
			{#each rows as row (row.lang)}
				<li>
					<span>{name(row.lang)}, {row.state}</span>
					{#if row.action === "remove"}
						<button
							type="button"
							aria-label="Remove {name(row.lang)} dictionary"
							onclick={() => void remove(row.lang)}>Remove</button
						>
					{:else if row.action === "download"}
						<button
							type="button"
							aria-label="Download {name(row.lang)} dictionary"
							onclick={() => download(row.lang)}>Download</button
						>
					{/if}
				</li>
			{/each}
		</ul>
		{#if installed.length > 1}
			<p class="note dict-total">{dictSize(total)} in all</p>
		{/if}
	{/if}
</div>

<style>
	.dict-list {
		list-style: none;
		padding: 0;
		margin: 0.35rem 0 0 1.7rem;
	}
	.dict-list li {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		padding: 0.1rem 0;
	}
	.dict-total {
		margin-left: 1.7rem;
	}
</style>
