<!-- Annotation answer popup (the remodel): the separate request's
answer, read in its original context above or below the highlight.
Pure presentational: the page owns open state, placement (the badge
anchor via placeAnnCard), and the add-to-prompt behavior; this
component owns the card markup and its surface (Svelte scoping binds
the CSS to this markup). Answer text renders as plain text — never
HTML — so model output can't inject markup. -->
<script lang="ts">
	import type { AnnotationId } from "$lib/annotations";

	/** Page-owned answer behaviors. */
	export interface AnnAnswerActions {
		addToPrompt: (id: AnnotationId) => void;
		close: () => void;
	}

	interface Props {
		id: AnnotationId;
		quote: string;
		answer: string;
		x: number;
		y: number;
		width: number;
		actions: AnnAnswerActions;
	}

	let { id, quote, answer, x, y, width, actions }: Props = $props();
</script>

<div
	class="ann-answer"
	style="left: {x}px; top: {y}px; width: {width}px"
	role="dialog"
	aria-label="Annotation answer"
>
	<p class="ann-answer-quote">{quote}</p>
	<p class="ann-answer-text">{answer}</p>
	<div class="ann-answer-row">
		<button
			type="button"
			class="ann-answer-add"
			aria-label="Add answer to prompt"
			title="Add answer to prompt"
			onclick={() => actions.addToPrompt(id)}>Add to prompt</button
		>
		<span class="ann-answer-spacer"></span>
		<button
			type="button"
			class="ann-answer-close"
			aria-label="Close answer"
			title="Close answer"
			onclick={actions.close}>×</button
		>
	</div>
</div>

<style>
	.ann-answer {
		position: fixed;
		z-index: 60;
		padding: 0.6rem 0.7rem 0.5rem;
		border-radius: 10px;
		font-size: 0.85rem;
		background: rgba(255, 255, 255, 0.94);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		color: #1c1c1e;
		color: var(--ink);
	}
	:global(html[data-theme="dark"]) .ann-answer {
		background: rgba(30, 30, 32, 0.94);
	}
	.ann-answer-quote {
		margin: 0 0 0.35rem;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ann-answer-text {
		margin: 0 0 0.5rem;
		line-height: 1.45;
	}
	.ann-answer-row {
		display: flex;
		align-items: center;
	}
	.ann-answer-spacer {
		flex: 1;
	}
	.ann-answer-add {
		border: 0;
		border-radius: 999px;
		padding: 0.3rem 0.8rem;
		background: #007aff;
		background: var(--accent);
		color: #fff;
		color: var(--accent-ink);
		font-weight: 700;
		cursor: pointer;
	}
	.ann-answer-close {
		border: 0;
		background: none;
		color: inherit;
		font-size: 1rem;
		line-height: 1;
		padding: 0.3rem 0.5rem;
		cursor: pointer;
	}
</style>
