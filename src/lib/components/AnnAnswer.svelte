<!-- Annotation answer popup (the remodel): the separate request's
answer, read below its highlight with the quote's wash held. Pure
presentational: the page owns open state, placement (below the
badge anchor via placeAnnCard), the readings line, and fade-out;
this component owns the card markup and its surface (Svelte scoping
binds the CSS to this markup). The quote itself never renders here
(the highlighted word upstream is the title); the readings line is
locally generated, sanitized upstream (pinyin escapes, furigana is
sanitized, tashkeel is escaped model text) — answer text renders
as plain text, never HTML, so model output can't inject markup.
No close button: clicking off the card closes it (Esc too). -->
<script lang="ts">
	import type { AnnotationId } from "$lib/annotations";

	/** Page-owned answer behaviors. */
	export interface AnnAnswerActions {
		addToPrompt: (id: AnnotationId) => void;
	}

	interface Props {
		id: AnnotationId;
		answer: string;
		/** Sanitized readings line (ruby/vowelled quote) or null. */
		readingsHtml: string | null;
		/** Fade-out in flight (unmounts when the ramp ends). */
		closing: boolean;
		x: number;
		y: number;
		width: number;
		actions: AnnAnswerActions;
	}

	let { id, answer, readingsHtml, closing, x, y, width, actions }: Props =
		$props();
</script>

<div
	class="ann-answer"
	class:closing
	style="left: {x}px; top: {y}px; width: {width}px"
	role="dialog"
	aria-label="Annotation answer"
>
	{#if readingsHtml}
		<p class="ann-answer-readings">{@html readingsHtml}</p>
	{/if}
	<p class="ann-answer-text">{answer}</p>
	<div class="ann-answer-row">
		<button
			type="button"
			class="ann-answer-add"
			aria-label="Add answer to prompt"
			title="Add answer to prompt"
			onclick={() => actions.addToPrompt(id)}>Add to prompt</button
		>
	</div>
</div>

<style>
	@keyframes ann-answer-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.ann-answer {
		position: fixed;
		z-index: 60;
		padding: 0.6rem 0.7rem 0.5rem;
		border-radius: 10px;
		font-size: 0.85rem;
		/* Opaque surface: translucent cards bleed message text
		through behind the answer. */
		background: #fff;
		background: var(--bg-raised);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		color: #1c1c1e;
		color: var(--ink);
		animation: ann-answer-in 0.16s ease;
	}
	:global(html[data-theme="dark"]) .ann-answer {
		background: #1c1c1e;
	}
	/* Stark-contrast preference: opaque always, with a hairline so
	the card edge never dissolves into the thread. */
	@media (prefers-contrast: more) {
		.ann-answer {
			background: #fff;
			background: var(--bg-raised);
			border: 1px solid #1c1c1e;
			border-color: var(--strong);
		}
	}
	.ann-answer.closing {
		animation: none;
		opacity: 0;
		transition: opacity 0.16s ease;
		pointer-events: none;
	}
	/* Readings context line (not a title): the quote with its
	readings, smaller and dimmer than the answer. Furigana spans
	ride the same overlay geometry as message text (scoped here —
	the message rules live under .rendered, which never wraps
	this card). */
	.ann-answer-readings {
		margin: 0 0 0.35rem;
		font-size: 0.92em;
		opacity: 0.85;
		line-height: 1.6;
	}
	.ann-answer-readings :global(.frb) {
		position: relative;
		white-space: nowrap;
	}
	.ann-answer-readings :global(.frt) {
		position: absolute;
		bottom: 100%;
		left: 50%;
		transform: translateX(-50%);
		margin-left: -0.3em;
		white-space: nowrap;
		font-size: 0.62em;
		line-height: 1.2;
		color: #6e6e73;
		color: var(--muted);
		pointer-events: none;
	}
	.ann-answer-text {
		margin: 0 0 0.5rem;
		line-height: 1.45;
	}
	.ann-answer-row {
		display: flex;
		align-items: center;
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
	@media (prefers-reduced-motion: reduce) {
		.ann-answer {
			animation: none;
		}
		.ann-answer.closing {
			transition: none;
		}
	}
</style>
