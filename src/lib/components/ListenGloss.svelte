<!-- Under an answered drill clip: its English translation and notes,
folded behind one quiet "English" toggle so the row stays the French
alone until asked. Also where grading shows it is still running or
failed (with Try again). -->
<script lang="ts">
	import type { ClipState } from "$lib/listen";

	interface Props {
		clip: ClipState;
		regrade: () => void;
	}

	let { clip, regrade }: Props = $props();

	let open = $state(false);
	const notes = $derived(clip.notes ?? []);
</script>

{#if clip.heard !== undefined}
	<div class="gloss">
		{#if clip.grade === "pending"}
			<p class="line busy">translating…</p>
		{:else if clip.grade === "error"}
			<p class="line">
				No translation ·
				<button
					type="button"
					class="link"
					onclick={(e) => {
						e.stopPropagation();
						regrade();
					}}>Try again</button
				>
			</p>
		{:else if clip.translation}
			<button
				type="button"
				class="link toggle"
				aria-expanded={open}
				onclick={(e) => {
					e.stopPropagation();
					open = !open;
				}}
			>
				<svg class:open viewBox="0 0 16 16" aria-hidden="true"
					><path d="M6 4l4 4-4 4" /></svg
				>
				English
			</button>
			{#if open}
				<div class="body">
					<p class="translation">{clip.translation}</p>
					{#if notes.length > 0}
						<ul class="notes">
							{#each notes as n, k (k)}
								<li><strong>{n.expr}</strong>: {n.meaning}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.gloss {
		margin-top: 0.35rem;
	}
	.line {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: var(--accent);
		cursor: pointer;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.toggle:hover {
		color: var(--ink);
	}
	.toggle svg {
		width: 0.8rem;
		height: 0.8rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: transform 0.15s ease;
	}
	.toggle svg.open {
		transform: rotate(90deg);
	}
	/* The English reads smaller than the French it glosses, but still
	tracks the text size. */
	.body {
		margin-top: 0.3rem;
		font-size: 0.7em;
		color: var(--muted);
		animation: gloss-in 0.15s ease;
	}
	.translation {
		margin: 0;
		font-style: italic;
	}
	.notes {
		margin: 0.3rem 0 0;
		padding-left: 1.1em;
	}
	.notes strong {
		color: var(--ink);
		font-weight: 600;
	}
	.busy {
		animation: gloss-pulse 1.4s ease-in-out infinite;
	}
	@keyframes gloss-in {
		from {
			opacity: 0;
		}
	}
	@keyframes gloss-pulse {
		50% {
			opacity: 0.45;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.body,
		.busy {
			animation: none;
		}
		.toggle svg {
			transition: none;
		}
	}
</style>
