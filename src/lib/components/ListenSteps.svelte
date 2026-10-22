<!-- Under the clip waiting to be answered, at the end of its text:
Show text (the eye; A) keeps the clip and shows what was said; Next
(the down arrow; a) reveals it and plays the next clip. Both scale with
the text size, like the row's other actions. -->
<script lang="ts">
	interface Props {
		/** The text already shows (Show text was used). */
		peeked: boolean;
		peek: () => void;
		next: () => void;
	}

	let { peeked, peek, next }: Props = $props();
</script>

<div class="steps">
	{#if !peeked}
		<button
			type="button"
			class="step"
			aria-label="Show text"
			title="Show the text, stay on this clip (A)"
			onclick={(e) => {
				e.stopPropagation();
				peek();
			}}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true"
				><path
					d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z"
				/><circle cx="8" cy="8" r="2" /></svg
			>
		</button>
	{/if}
	<button
		type="button"
		class="step next"
		aria-label="Next clip"
		title="Reveal and play the next clip (a)"
		onclick={(e) => {
			e.stopPropagation();
			next();
		}}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true"
			><path d="M8 2.5v10" /><path d="M3.8 8.5 8 12.7l4.2-4.2" /></svg
		>
	</button>
</div>

<style>
	/* Sized off the message text (em) with a floor, so the steps stay
	easy to hit at small sizes and keep pace at giant ones. */
	.steps {
		display: flex;
		gap: 0.6em;
		margin-top: 0.35em;
		font-size: max(1rem, 0.5em);
	}
	.step {
		width: 2.4em;
		height: 2.4em;
		display: grid;
		place-items: center;
		padding: 0;
		border: 1px solid var(--line-soft);
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			transform 0.12s ease;
	}
	.step:hover {
		color: var(--ink);
		border-color: var(--line-hover);
	}
	.step:active {
		transform: scale(0.94);
	}
	.step.next {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.step svg {
		width: 1.15em;
		height: 1.15em;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@media (prefers-reduced-motion: reduce) {
		.step {
			transition: none;
		}
	}
</style>
