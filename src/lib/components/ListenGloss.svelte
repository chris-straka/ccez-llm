<!-- Under an answered drill clip: its English translation and notes,
folded behind one quiet "English" toggle so the row stays the French
alone until asked. Nothing translates before the fold opens: opening it
asks for this clip's translation, shows it running, and offers Try
again if it failed. -->
<script lang="ts">
	import type { ClipState } from "$lib/listen";

	interface Props {
		clip: ClipState;
		/** The fold opened: translate this clip (a no-op once asked). */
		translate: () => void;
		regrade: () => void;
	}

	let { clip, translate, regrade }: Props = $props();

	let open = $state(false);
	const notes = $derived(clip.notes ?? []);
</script>

{#if clip.heard !== undefined}
	<div class="gloss">
		<button
			type="button"
			class="toggle"
			class:open
			aria-expanded={open}
			onclick={(e) => {
				e.stopPropagation();
				open = !open;
				if (open) translate();
			}}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true"
				><path d="M2 3.5h6M5 2v1.5M3.2 3.5c.5 2.4 2 4.2 4 5.2" /><path
					d="M6.8 3.5c-.4 2.2-1.8 4.3-4.3 5.6"
				/><path d="M8.5 14l2.75-6.5L14 14M9.4 12h3.7" /></svg
			>
			English
		</button>
		{#if open}
			<div class="card">
				{#if clip.grade === "pending"}
					<span class="shimmer" aria-label="Translating"></span>
					<span class="shimmer short" aria-hidden="true"></span>
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
					<p class="translation">{clip.translation}</p>
					{#if notes.length > 0}
						<ul class="notes">
							{#each notes as n, k (k)}
								<li><strong>{n.expr}</strong> {n.meaning}</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* Everything here is sized off the message text (em, with a floor)
	so it keeps pace with the text size instead of staying tiny. */
	.gloss {
		margin-top: 0.35em;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		font: inherit;
		font-size: max(0.85rem, 0.42em);
		padding: 0.3em 0.85em 0.3em 0.7em;
		border: 1px solid var(--line-soft);
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.toggle:hover {
		color: var(--ink);
		border-color: var(--line-hover);
	}
	.toggle.open {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.toggle svg {
		width: 1.15em;
		height: 1.15em;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	/* The English reads smaller than the French it glosses, set off by
	a quiet rule rather than a box. */
	.card {
		margin-top: 0.45em;
		padding: 0.1em 0 0.1em 0.7em;
		border-left: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
		font-size: 0.7em;
		color: var(--muted);
		animation: gloss-in 0.18s ease;
	}
	.translation {
		margin: 0;
		color: var(--ink);
	}
	.notes {
		margin: 0.35em 0 0;
		padding: 0;
		list-style: none;
	}
	.notes li + li {
		margin-top: 0.2em;
	}
	.notes strong {
		color: var(--ink);
		font-weight: 600;
		margin-right: 0.35em;
	}
	.line {
		margin: 0;
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: var(--accent);
		cursor: pointer;
	}
	/* Translating: two soft bars where the text will land. */
	.shimmer {
		display: block;
		height: 0.8em;
		width: 70%;
		margin: 0.25em 0;
		border-radius: 0.4em;
		background: linear-gradient(
			90deg,
			var(--line-soft) 25%,
			var(--line) 50%,
			var(--line-soft) 75%
		);
		background-size: 200% 100%;
		animation: gloss-shimmer 1.3s linear infinite;
	}
	.shimmer.short {
		width: 40%;
	}
	@keyframes gloss-in {
		from {
			opacity: 0;
			transform: translateY(-2px);
		}
	}
	@keyframes gloss-shimmer {
		to {
			background-position: -200% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.card,
		.shimmer {
			animation: none;
		}
		.toggle {
			transition: none;
		}
	}
</style>
