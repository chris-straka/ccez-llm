<!-- Licenses: the app's own license, the data and fonts it uses with
their sources, and every library it ships (JavaScript and Rust, from
the generated list) behind a filter. Opened from Settings; the page
renders it and gives Escape to it first. -->
<script lang="ts">
	import { onMount } from "svelte";
	import {
		APP_LICENSE,
		DATA_CREDITS,
		libraryMatches,
		loadLibraries,
		type Libraries
	} from "$lib/licenses";
	import ActionIcon from "./ActionIcon.svelte";
	import Modal from "./Modal.svelte";

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let libraries = $state<Libraries | null>(null);
	let query = $state("");

	onMount(() => {
		void loadLibraries().then((l) => (libraries = l));
	});

	const lists = $derived(
		libraries
			? [
					{
						label: "App libraries (JavaScript)",
						items: libraries.js.filter((l) => libraryMatches(l, query))
					},
					{
						label: "Native libraries (Rust)",
						items: libraries.rust.filter((l) => libraryMatches(l, query))
					}
				]
			: []
	);

	function veilClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) onClose();
	}
</script>

<Modal
	label="Licenses"
	labelledby="licenses-heading"
	veilClass="dict-veil"
	cardClass="dict-modal"
	onVeilClick={veilClick}
>
	<div class="lic-head">
		<h2 id="licenses-heading">Licenses</h2>
		<button
			type="button"
			class="lic-close"
			aria-label="Close licenses"
			onclick={onClose}
		>
			<ActionIcon kind="close" />
		</button>
	</div>

	<section class="lic-group">
		<h3>Ccez LLM</h3>
		<p>{APP_LICENSE}</p>
	</section>

	<section class="lic-group">
		<h3>Data and fonts</h3>
		<ul class="lic-data">
			{#each DATA_CREDITS as credit (credit.name)}
				<li>
					<span class="lic-name">{credit.name}</span>
					<span class="lic-use">{credit.use}</span>
					<span class="lic-license">{credit.license}</span>
					<span class="lic-url">{credit.url}</span>
				</li>
			{/each}
		</ul>
	</section>

	<section class="lic-group">
		<div class="lic-libs-head">
			<h3>Libraries</h3>
			<input
				type="search"
				class="lic-filter"
				bind:value={query}
				placeholder="Filter by name or license"
				aria-label="Filter libraries"
				autocomplete="off"
				spellcheck={false}
			/>
		</div>
		{#if !libraries}
			<p class="lic-muted">Loading…</p>
		{/if}
		{#each lists as list (list.label)}
			<details class="lic-libs" open={query.trim() !== ""}>
				<summary
					>{list.label}
					<span class="lic-muted">{list.items.length}</span></summary
				>
				<ul class="lic-table">
					{#each list.items as lib (`${lib.name}@${lib.version}`)}
						<li>
							<span class="lic-lib">{lib.name}</span>
							<span class="lic-ver">{lib.version}</span>
							<span class="lic-license">{lib.license}</span>
						</li>
					{/each}
				</ul>
			</details>
		{/each}
	</section>
</Modal>

<style>
	.lic-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 0.6rem;
		border-bottom: 1px solid var(--line-soft);
	}
	.lic-head h2 {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 700;
	}
	.lic-close {
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
	}
	.lic-close:hover {
		color: var(--ink);
		background: var(--hover-wash);
	}
	.lic-group h3 {
		margin: 1.2rem 0 0.5rem;
		font-size: 0.82rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.lic-group p {
		margin: 0;
	}
	.lic-data {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.lic-data li {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--line-soft);
		border-radius: 10px;
		min-width: 0;
	}
	.lic-name {
		font-weight: 600;
	}
	.lic-use,
	.lic-muted {
		font-size: 0.86rem;
		color: var(--muted);
	}
	.lic-license {
		font-size: 0.86rem;
	}
	.lic-url {
		font-size: 0.8rem;
		color: var(--muted);
		overflow-wrap: anywhere;
		user-select: text;
	}
	.lic-libs-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.lic-filter {
		width: 16rem;
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
	.lic-libs {
		margin-top: 0.4rem;
	}
	.lic-libs summary {
		min-height: 2.4rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}
	.lic-libs summary::-webkit-details-marker {
		display: none;
	}
	/* The list's disclosure arrow, turning down when open. */
	.lic-libs summary::before {
		content: "";
		width: 0.45rem;
		height: 0.45rem;
		border-right: 1.6px solid currentColor;
		border-bottom: 1.6px solid currentColor;
		transform: rotate(-45deg);
		transition: transform 0.15s ease;
	}
	.lic-libs[open] summary::before {
		transform: rotate(45deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.lic-libs summary::before {
			transition: none;
		}
	}
	/* Three even columns of name, version, license; many columns of
	rows where the sheet is wide. */
	.lic-table {
		columns: 22rem auto;
		column-gap: 2rem;
		margin: 0.2rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.86rem;
	}
	.lic-table li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 0.6rem;
		padding: 0.22rem 0;
		border-bottom: 1px solid var(--line-soft);
		break-inside: avoid;
	}
	.lic-lib {
		overflow-wrap: anywhere;
	}
	.lic-ver {
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	.lic-table .lic-license {
		color: var(--muted);
		text-align: end;
	}
</style>
