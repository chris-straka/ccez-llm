<!-- Shortcuts modal: the desktop chord list (or the touch
equivalents on phones) with a filter. Rendered through the shared
`Modal.svelte` shell. The page owns the open flag and the filter
reset/focus (⌘F focuses the field while open); this component owns
the list, the field, and their surfaces (Svelte scoping binds the
CSS to this markup). Row data already lives in `$lib/shortcuts`
(unit-pinned); the close-button title rides a prop so the page's
`tip()` helper stays paged with its other users. -->
<script lang="ts">
	/** Chip separator: a bare " · " in markup loses its spaces to
	 * Svelte's whitespace trim, so it rides an expression. */
	const SEP = " · ";
	import ActionIcon from "./ActionIcon.svelte";
	import { tauriBackendAvailable } from "$lib/secrets";
	import { currentPlatform } from "$lib/platform";
	import {
		desktopShortcuts,
		filteredShortcuts,
		groupShortcuts,
		keyChips,
		touchShortcuts
	} from "$lib/shortcuts";
	import Modal from "./Modal.svelte";

	interface Props {
		android: boolean;
		mac: boolean;
		/** Flashcards setting: off hides their row. */
		flashcards: boolean;
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
		flashcards,
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

	const groups = $derived(
		groupShortcuts(
			android
				? filteredShortcuts(touchShortcuts(), query)
				: filteredShortcuts(
						desktopShortcuts(
							mac,
							tauriBackendAvailable(),
							flashcards,
							currentPlatform().isWindows
						),
						query
					)
		)
	);
</script>

<Modal
	label={android ? "Touch gestures" : "Keyboard shortcuts"}
	labelledby={android ? undefined : "shortcuts-heading"}
	fadeScroll
	onVeilClick={veilClick}
>
	<div class="modal-head">
		{#if !android}<h2 id="shortcuts-heading">Keyboard shortcuts</h2>{/if}
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
		<button
			type="button"
			aria-label="Close shortcuts"
			title={closeTitle}
			onclick={onClose}
		>
			<ActionIcon kind="close" />
		</button>
	</div>
	<!-- Sections in usage order (hovered-message keys lead on
	desktop); phones teach the touch equivalents from the same
	modal. Each " · " alternative draws as its own chip. -->
	<div class="keys">
		{#each groups as section (section.group)}
			<section class="keys-section">
				<h3>{section.group}</h3>
				<dl>
					{#each section.rows as row (row.name)}
						<div>
							<dt>{row.name}</dt>
							<dd>
								{#each keyChips(row.keys) as chip, i (i)}{#if i > 0}<span
											class="sep">{SEP}</span
										>{/if}<span class="chip">{chip}</span>{/each}
							</dd>
						</div>
					{/each}
				</dl>
			</section>
		{:else}
			<div class="keys-empty">No matches</div>
		{/each}
	</div>
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
		color: var(--ink);
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
	/* Sections flow into two columns where the box is wide enough
	and stack on phones (and under heavy interface zoom), never
	splitting a section across columns. */
	.keys {
		columns: 2 17rem;
		column-gap: 2rem;
	}
	.keys-section {
		break-inside: avoid;
		margin-bottom: 0.9rem;
	}
	.keys-section h3 {
		margin: 0 0 0.2rem;
		font-size: 0.72rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #6e6e73;
		color: var(--dim);
	}
	.keys dl {
		margin: 0;
	}
	.keys dl div {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.7rem;
		padding: 0.26rem 0;
		border-top: 1px solid #e5e5ea;
		border-top-color: var(--line-soft);
		font-size: 0.8rem;
	}
	.keys dl div:first-child {
		border-top: 0;
	}
	.keys dt {
		/* Shrinkable basis: at 100% the name column fits every row,
		so nothing shrinks or wraps; under the interface zoom in a
		capped box the fixed basis would hog the row and starve the
		chord. The name wraps instead, and the chord drops below
		when even that overflows. */
		flex: 0 1 9rem;
		min-width: 0;
		color: #3a3a3c;
		color: var(--focus);
	}
	.keys dd {
		margin: 0;
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		color: #1c1c1e;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	/* Key chip: one alternative per box, so "⌘B", "⇧⌘H", and
	"J / K walk" read as separate ways in instead of one run. */
	.chip {
		padding: 0.05rem 0.4rem;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 6px;
		background: rgba(120, 120, 128, 0.08);
		white-space: nowrap;
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	/* The chips' gap shows the split; the dot stays in the text so
	screen readers, copy, and the filter read "A · B". */
	.sep {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	/* Gestures are prose, not key chords: no monospace, and chips
	may wrap inside so long phrases fit a 360px phone. */
	:global(.app[data-android]) .keys {
		columns: 1;
	}
	:global(.app[data-android]) .keys dd {
		font-family: inherit;
		font-size: 0.8rem;
	}
	:global(.app[data-android]) .chip {
		white-space: normal;
	}
	/* Close is a geometric X sized to the button's text: a text ×
	sits low on its font bearings. */
	.modal-head button :global(.action-glyph) {
		height: 0.8em;
	}
</style>
