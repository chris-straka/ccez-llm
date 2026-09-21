<!-- Shortcuts modal: the desktop chord list (or the touch
equivalents on phones) with a filter. Rendered through the shared
`Modal.svelte` shell. The page owns the open flag and the filter
reset/focus (⌘F focuses the field while open); this component owns
the list, the field, and their surfaces (Svelte scoping binds the
CSS to this markup). Row data already lives in `$lib/shortcuts`
(unit-pinned); the close-button title rides a prop so the page's
`tip()` helper stays paged with its other users. -->
<script lang="ts">
	import { tauriBackendAvailable } from "$lib/secrets";
	import {
		desktopShortcuts,
		filteredShortcuts,
		touchShortcuts
	} from "$lib/shortcuts";
	import Modal from "./Modal.svelte";

	interface Props {
		android: boolean;
		mac: boolean;
		/** Filter text (the page clears it on open). */
		query?: string;
		/** Filter field (the page focuses it on ⌘F). */
		inputEl?: HTMLInputElement | null;
		/** Close-button title (page computes via tip()). */
		closeTitle: string;
		onClose: () => void;
	}

	let {
		android,
		mac,
		query = $bindable(""),
		inputEl = $bindable(null),
		closeTitle,
		onClose
	}: Props = $props();

	/** Backdrop click only; keyboard users get Esc and the × button. */
	function veilClick(event: MouseEvent): void {
		if (event.target !== event.currentTarget) return;
		onClose();
	}

	const rows = $derived(
		android
			? filteredShortcuts(touchShortcuts(), query)
			: filteredShortcuts(desktopShortcuts(mac, tauriBackendAvailable()), query)
	);
</script>

<Modal
	label={android ? "Touch gestures" : "Keyboard shortcuts"}
	labelledby={android ? undefined : "shortcuts-heading"}
	fadeScroll
	onVeilClick={veilClick}
>
	<div class="modal-head">
		{#if !android}<h2 id="shortcuts-heading">
				Keyboard shortcuts
			</h2>{/if}
		<input
			type="search"
			class="shortcuts-filter"
			bind:this={inputEl}
			bind:value={query}
			placeholder={mac ? "Filter (⌘F)" : "Filter (Ctrl+F)"}
			aria-label={android ? "Filter gestures" : "Filter shortcuts"}
			autocomplete="off"
			spellcheck={false}
		/>
		<button type="button" aria-label="Close shortcuts" title={closeTitle} onclick={onClose}>
			×
		</button>
	</div>
	<!-- Android milestone: key chords don't exist on a phone, so the
	same modal teaches the touch equivalents (rows switch source by
	platform above). -->
	<dl class="keys">
		{#each rows as row (row.name)}
			<div>
				<dt>{row.name}</dt>
				<dd>{row.keys}</dd>
			</div>
		{:else}
			<div class="keys-empty">No matches</div>
		{/each}
	</dl>
</Modal>

<style>
	/* Dialog head row (copied from the page sheet while the palette
	and inspect dialogs still render paged — Svelte scoping binds
	each stylesheet to its own markup; the paged copy drops when the
	last head user moves through `Modal.svelte`). */
	.modal-head {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.35rem;
	}
	.modal-head h2 {
		font-size: 1.05rem;
		font-weight: 700;
		margin: 0;
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
	.modal-head .shortcuts-filter + button {
		margin-left: 0;
	}
	:global(html[data-theme="dark"]) .modal-head button:hover {
		color: #f2f2f7;
	}
	/* Shortcuts filter: sits between the heading and ×, same field
	chrome as the search palette input. */
	.shortcuts-filter {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		background: var(--field);
		color: inherit;
	}
	/* The filter reads dead on focus without this: same ring as the
	selected article, so keyboard users see where they are. */
	.shortcuts-filter:focus-visible {
		outline: 2px solid #3a3a3c;
		outline-color: var(--focus);
		outline-offset: 1px;
	}
	.keys-empty {
		padding: 0.6rem 0;
		color: var(--muted);
		font-size: 0.8rem;
	}
	.keys {
		margin: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		column-gap: 2rem;
	}
	.keys div {
		display: flex;
		gap: 0.7rem;
		padding: 0.26rem 0;
		border-top: 1px solid #e5e5ea;
		border-top-color: var(--line-soft);
		font-size: 0.8rem;
	}
	/* Two-column grid: the whole first row skips the divisor. */
	.keys div:nth-child(-n + 2) {
		border-top: 0;
	}
	.keys dt {
		flex: 0 0 8rem;
		color: #3a3a3c;
		color: var(--focus);
	}
	.keys dd {
		margin: 0;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		color: #1c1c1e;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	/* The gestures list goes single-column on phones: two columns
	overflow a 360px viewport by ~60px, clipping the very text that
	teaches the gestures. Touch descriptions are prose, not key
	chords, so they drop the monospace too. The .app ancestor stays
	global (it renders paged, unscopable). */
	:global(.app[data-android]) .keys {
		grid-template-columns: 1fr;
	}
	:global(.app[data-android]) .keys div:nth-child(2) {
		border-top: 1px solid #e5e5ea;
	}
	:global(.app[data-android]) .keys dd {
		font-family: inherit;
		font-size: 0.8rem;
	}
	:global(html[data-theme="dark"]) :global(.app[data-android]) .keys div:nth-child(2) {
		border-top-color: #38383a;
	}
</style>
