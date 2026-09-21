<!-- Command palette: full-text search across chats/annotations,
rendered through the shared `Modal.svelte` shell. The page owns the
palette object (open flag, query, hits, busy, cursor), element focus,
and the search behaviors; this component owns the dialog markup, the
hit list, and their surfaces (Svelte scoping binds the CSS to this
markup). Field writes ride the shared object like the notices proxy
(see Toasts.svelte). The box seating (`.search-palette`) lives in
`Modal.svelte` with the other dialog chrome. -->
<script lang="ts">
	import type { SearchHit } from "$lib/chatSearch";
	import type { PaletteState } from "$lib/palette";
	import Modal from "./Modal.svelte";

	/** Page-owned search behaviors. */
	export interface SearchPaletteActions {
		query: () => void;
		close: () => void;
		move: (delta: 1 | -1) => void;
		enter: (hit: SearchHit) => void;
		focusHit: (cursor: number) => void;
	}

	interface Props {
		palette: PaletteState;
		/** Search field (the page focuses it on open). */
		inputEl?: HTMLInputElement | undefined;
		/** Results list (the page scrolls hits into view). */
		resultsEl?: HTMLElement | undefined;
		actions: SearchPaletteActions;
	}

	let {
		palette,
		inputEl = $bindable(undefined),
		resultsEl = $bindable(undefined),
		actions
	}: Props = $props();

	function inputKey(event: KeyboardEvent): void {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			actions.move(1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			actions.move(-1);
		} else if (event.key === "Enter") {
			event.preventDefault();
			const hit = palette.hits[palette.cursor];
			if (hit) actions.enter(hit);
		}
	}

	function hitKey(event: KeyboardEvent): void {
		if (event.key === "j" || event.key === "ArrowDown") {
			event.preventDefault();
			actions.move(1);
			actions.focusHit(palette.cursor);
		} else if (event.key === "k" || event.key === "ArrowUp") {
			event.preventDefault();
			actions.move(-1);
			actions.focusHit(palette.cursor);
		}
	}

	function veilClick(event: MouseEvent): void {
		if (event.target !== event.currentTarget) return;
		actions.close();
	}
</script>

<Modal
	label="Search chats"
	cardClass="search-palette"
	fadeScroll
	onVeilClick={veilClick}
>
	<div class="modal-head">
		<input
			type="search"
			class="search-input"
			bind:this={inputEl}
			bind:value={palette.query}
			oninput={actions.query}
			placeholder="Search chats and annotations"
			aria-label="Search chats and annotations"
			inputmode="search"
			enterkeyhint="search"
			autocomplete="off"
			onkeydown={inputKey}
		/>
		<button
			type="button"
			aria-label="Close search"
			title="Close (Esc)"
			onclick={actions.close}
		>
			×
		</button>
	</div>
	<div
		class="search-results"
		bind:this={resultsEl}
		data-fade-scroll
		role="listbox"
		aria-label="Search results"
	>
		{#if palette.busy}
			<p class="search-status" role="status">Searching…</p>
		{:else if palette.query.trim() && palette.hits.length === 0}
			<p class="search-status">No matches.</p>
		{:else}
			{#each palette.hits as hit, n (hit.doc.chatId + (hit.doc.msgId ?? "") + hit.doc.kind)}
				<button
					type="button"
					role="option"
					aria-selected={n === palette.cursor}
					class="search-hit"
					class:cursor={n === palette.cursor}
					onmouseenter={() => (palette.cursor = n)}
					onclick={() => actions.enter(hit)}
					onkeydown={hitKey}
				>
					<span class="search-kind">{hit.doc.kind}</span>
					<span class="search-snippet">{hit.snippet}</span>
				</button>
			{/each}
		{/if}
	</div>
</Modal>

<style>
	/* Dialog head row (copied from the page sheet while the inspect
	dialog still renders paged — Svelte scoping binds each stylesheet
	to its own markup; the paged copy drops when the last head user
	moves through `Modal.svelte`). */
	.modal-head {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.35rem;
	}
	.modal-head button {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 1.1rem;
		line-height: 1;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 8px;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.55rem;
		color: #3a3a3c;
		color: var(--focus);
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.modal-head button:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	:global(html[data-theme="dark"]) .modal-head button:hover {
		color: #f2f2f7;
	}
	.modal-head button:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	.search-input:focus-visible {
		outline: 2px solid #3a3a3c;
		outline-color: var(--focus);
		outline-offset: 1px;
	}
	.search-input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 0.95rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		background: var(--field);
		color: inherit;
	}
	.search-results {
		max-height: 50vh;
		max-height: 50dvh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
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
	.search-status {
		font-size: 0.85rem;
		color: #6e6e73;
		color: var(--dim);
		padding: 0.6rem;
		margin: 0;
	}
</style>
