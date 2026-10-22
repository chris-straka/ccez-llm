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
	/* Sections are soft cards flowing into two columns where the box
	is wide enough (stacked on phones and under heavy interface zoom),
	never split across columns. Each heading wears the accent, the
	selection's blue, so the eye lands on sections first. */
	.keys {
		columns: 2 18rem;
		column-gap: 1rem;
		margin-top: 0.6rem;
	}
	.keys-section {
		break-inside: avoid;
		margin: 0 0 1rem;
		padding: 0.7rem 0.9rem 0.5rem;
		border-radius: 12px;
		background: rgba(120, 120, 128, 0.06);
	}
	.keys-section h3 {
		margin: 0 0 0.35rem;
		font-size: 0.82rem;
		font-weight: 650;
		letter-spacing: 0.01em;
		color: var(--accent);
	}
	.keys dl {
		margin: 0;
	}
	/* One row: the action on the left, its keys right-aligned. A long
	name wraps in its own column; long key lists wrap in theirs. */
	.keys dl div {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, max-content);
		align-items: baseline;
		gap: 0.75rem;
		padding: 0.42rem 0;
		border-top: 1px solid var(--line-soft);
		font-size: 0.84rem;
		line-height: 1.35;
	}
	.keys dl div:first-child {
		border-top: 0;
	}
	.keys dt {
		min-width: 0;
		color: var(--ink);
	}
	.keys dd {
		margin: 0;
		min-width: 0;
		max-width: 15rem;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.3rem;
		font-size: 0.78rem;
		color: var(--ink);
	}
	/* Key chip: one alternative per box, so "⌘B", "⇧⌘H", and
	"J / K walk" read as separate ways in instead of one run. The
	interface font (not monospace) keeps phrases like "Space over the
	video" readable; a slightly heavier bottom edge reads as a key. */
	.chip {
		padding: 0.08rem 0.45rem;
		border: 1px solid var(--line-soft);
		border-bottom-width: 2px;
		border-radius: 6px;
		background: var(--bg);
		color: var(--focus);
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
	/* Gesture phrases run long: on a phone each row stacks, the
	gesture under its action. */
	:global(.app[data-android]) .keys dl div {
		grid-template-columns: minmax(0, 1fr);
		gap: 0.3rem;
	}
	:global(.app[data-android]) .keys dd {
		font-size: 0.8rem;
		max-width: none;
		justify-content: flex-start;
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
