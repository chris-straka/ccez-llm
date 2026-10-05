<!-- Command palette: full-text search across chats/annotations,
rendered through the shared `Modal.svelte` shell. The page owns the
palette object (open flag, query, hits, busy, cursor), element focus,
and the search behaviors; this component owns the dialog markup, the
hit list, and their surfaces (Svelte scoping binds the CSS to this
markup). Field writes ride the shared object like the notices proxy
(see Toasts.svelte). The box seating (`.search-palette`) lives in
`Modal.svelte` with the other dialog chrome. -->
<script lang="ts">
	import ActionIcon from "./ActionIcon.svelte";
	import type { SearchHit } from "$lib/chatSearch";
	import type { PaletteState } from "$lib/palette";
	import Modal from "./Modal.svelte";
	import SearchResults from "./SearchResults.svelte";

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
		/** Chat header text for grouped hits. */
		chatTitle: (chatId: string) => string;
	}

	let {
		palette,
		inputEl = $bindable(undefined),
		resultsEl = $bindable(undefined),
		actions,
		chatTitle
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
			placeholder='Search chats · "phrase" from:me in:notes'
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
			<ActionIcon kind="close" />
		</button>
	</div>
	<SearchResults
		hits={palette.hits}
		cursor={palette.cursor}
		busy={palette.busy}
		query={palette.query}
		{chatTitle}
		bind:resultsEl
		onPick={actions.enter}
		onHover={(n: number) => {
			palette.cursor = n;
		}}
		onHitKey={hitKey}
	/>
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
		color: var(--ink);
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
	/* Close is a geometric X sized to the button's text: a text ×
	sits low on its font bearings. */
	.modal-head button :global(.action-glyph) {
		height: 0.8em;
	}
	/* Phones track the text size (capped to the screen width): the
	field and the hit list below read at giant sizes too. */
	:global(.app[data-android]) .modal-head {
		font-size: min(calc(1rem * var(--font-scale, 1)), 6.5vw);
	}
	:global(.app[data-android]) .search-input {
		font-size: inherit;
	}
	:global(.app[data-android]) .modal-head button {
		font-size: 1.1em;
		min-width: 2.75rem;
		min-height: 2.75rem;
	}
</style>
