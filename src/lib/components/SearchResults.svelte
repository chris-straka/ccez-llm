<!-- Search result list shared by the desktop palette and the phone
chat switcher: hits arrive grouped by chat (`groupHitsByChat`), so a
chat header prints wherever the chat changes. Each row tags who said
it (you / AI / note) and marks the matched words. The owner keeps
the hits, cursor, and what a pick does. -->
<script lang="ts">
	import { hitTag, markSegments, type SearchHit } from "$lib/chatSearch";

	interface Props {
		hits: SearchHit[];
		cursor: number;
		busy: boolean;
		query: string;
		/** Header text for a chat id. */
		chatTitle: (chatId: string) => string;
		onPick: (hit: SearchHit) => void;
		onHover?: (index: number) => void;
		onHitKey?: (event: KeyboardEvent) => void;
		resultsEl?: HTMLElement | undefined;
	}

	let {
		hits,
		cursor,
		busy,
		query,
		chatTitle,
		onPick,
		onHover,
		onHitKey,
		resultsEl = $bindable(undefined)
	}: Props = $props();
</script>

<div
	class="search-results"
	bind:this={resultsEl}
	data-fade-scroll
	role="listbox"
	aria-label="Search results"
>
	{#if busy && hits.length === 0}
		<p class="search-status" role="status">Searching…</p>
	{:else if query.trim() && hits.length === 0}
		<p class="search-status">No matches.</p>
	{:else}
		{#each hits as hit, n (hit.doc.chatId + (hit.doc.msgId ?? "") + hit.doc.kind + n)}
			{#if n === 0 || hits[n - 1]?.doc.chatId !== hit.doc.chatId}
				<div class="search-chat" role="presentation">{chatTitle(hit.doc.chatId)}</div>
			{/if}
			<button
				type="button"
				role="option"
				aria-selected={n === cursor}
				class="search-hit"
				class:cursor={n === cursor}
				onmouseenter={() => onHover?.(n)}
				onclick={() => onPick(hit)}
				onkeydown={onHitKey}
			>
				<span class="search-kind">{hitTag(hit.doc)}</span>
				<span class="search-snippet"
					>{#each markSegments(hit.snippet, hit.marks) as seg, i (i)}{#if seg.hit}<mark
								>{seg.text}</mark
							>{:else}{seg.text}{/if}{/each}</span
				>
			</button>
		{/each}
	{/if}
</div>

<style>
	.search-results {
		max-height: 50vh;
		max-height: 50dvh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.search-chat {
		font-size: 0.72rem;
		font-weight: 650;
		color: #6e6e73;
		color: var(--dim);
		padding: 0.55rem 0.6rem 0.1rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.search-chat:first-child {
		padding-top: 0.1rem;
	}
	.search-hit {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		text-align: left;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.search-hit.cursor {
		background: #eef4ff;
		background: var(--hl);
		border-color: #e5e5ea;
		border-color: var(--line-soft);
	}
	.search-kind {
		flex: none;
		min-width: 2.2em;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6e6e73;
		color: var(--dim);
	}
	.search-snippet {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.search-snippet mark {
		background: none;
		color: inherit;
		font-weight: 700;
		text-decoration: underline;
		text-decoration-thickness: 2px;
		text-underline-offset: 2px;
	}
	/* Phones and giant text: two lines of context beat one clipped
	line (the snippet is the whole point of a hit). */
	:global(.app[data-android]) .search-snippet {
		white-space: normal;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}
	.search-status {
		font-size: 0.85rem;
		color: #6e6e73;
		color: var(--dim);
		padding: 0.6rem;
		margin: 0;
	}
	/* Phones: the list tracks the text size, capped to the screen
	width; inner sizes follow it in em. */
	:global(.app[data-android]) .search-results {
		font-size: min(calc(1rem * var(--font-scale, 1)), 6vw);
	}
	:global(.app[data-android]) .search-hit {
		font-size: 0.85em;
	}
	:global(.app[data-android]) .search-chat,
	:global(.app[data-android]) .search-kind {
		font-size: 0.72em;
	}
	:global(.app[data-android]) .search-status {
		font-size: 0.85em;
	}
</style>
