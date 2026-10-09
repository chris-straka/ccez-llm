<!-- End of a drilled video: what was heard, and the clips missed most,
ready to replay. No score beyond that. -->
<script lang="ts">
	import type { DrillSummary, ListenSession } from "$lib/listen";

	interface Props {
		session: ListenSession;
		summary: DrillSummary;
		playing: { i: number; slow: boolean } | null;
		actions: {
			play: (i: number, slow: boolean) => void;
			another: () => void;
		};
	}

	let { session, summary, playing, actions }: Props = $props();
</script>

<div class="end">
	<p class="lead">
		End of the video. You heard {summary.got} of {summary.total} words{summary.perfect > 0
			? `, ${summary.perfect} ${summary.perfect === 1 ? "clip" : "clips"} all of it`
			: ""}.
	</p>
	{#if summary.missed.length > 0}
		<p class="label">Missed most</p>
		<ul>
			{#each summary.missed as i (i)}
				{@const clip = session.clips[i]}
				<li>
					<button
						type="button"
						class="replay"
						class:on={playing?.i === i}
						aria-label={`Replay clip ${i + 1}`}
						onclick={(e) => {
							e.stopPropagation();
							actions.play(i, false);
						}}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true"
							><path d="M5 3.2v9.6c0 .5.6.8 1 .5l7.2-4.8a.6.6 0 0 0 0-1L6 2.7c-.4-.3-1 0-1 .5Z" /></svg
						>
					</button>
					<button
						type="button"
						class="slow"
						aria-label={`Replay clip ${i + 1} slowly`}
						onclick={(e) => {
							e.stopPropagation();
							actions.play(i, true);
						}}>0.75×</button
					>
					<span class="text">{clip?.text}</span>
				</li>
			{/each}
		</ul>
	{/if}
	<button
		type="button"
		class="another"
		onclick={(e) => {
			e.stopPropagation();
			actions.another();
		}}>Another video</button
	>
</div>

<style>
	.end {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		animation: end-in 0.25s ease both;
	}
	@keyframes end-in {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.end {
			animation: none;
		}
	}
	.lead {
		margin: 0;
	}
	.label {
		margin: 0.3rem 0 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.replay {
		flex: 0 0 auto;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 1px solid var(--line-soft);
		background: transparent;
		color: var(--accent);
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.replay.on {
		border-color: var(--accent);
	}
	.replay svg {
		width: 0.85rem;
		height: 0.85rem;
		fill: currentColor;
	}
	.slow {
		flex: 0 0 auto;
		border: 1px solid var(--line-soft);
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 0.75rem;
		padding: 0.2rem 0.5rem;
		min-height: 2rem;
		border-radius: 999px;
		cursor: pointer;
	}
	.text {
		min-width: 0;
	}
	.another {
		align-self: flex-start;
		margin-top: 0.3rem;
		border: 1px solid var(--line-soft);
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: 0.9rem;
		padding: 0.45rem 1rem;
		min-height: 2.5rem;
		border-radius: 999px;
		cursor: pointer;
	}
</style>
