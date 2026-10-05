<!-- Annotation answer popup: a staged send's reply, read below its
highlight with the quote's wash held. Pure presentational: the page
owns open state, below-quote placement, and fade-out; this component
owns the card markup and its surface (Svelte scoping binds the CSS to
this markup). The quote itself never renders here (the highlighted
word upstream is the title, with Han readings in the panels above
it) — answer text renders as plain text, never HTML, so model output
can't inject markup. No close button and no tools: clicking off
the card closes it (Esc too). The reply takes the whole card —
rewording is the E key while it is open, prompt approval is the
badge's plus/minus. -->
<script lang="ts">
		interface Props {
		answer: string;
		/** Fade-out in flight (unmounts when the ramp ends). */
		closing: boolean;
		x: number;
		y: number;
		width: number;
	}

	let { answer, closing, x, y, width }: Props = $props();
</script>

<div
	class="ann-answer"
	class:closing
	style="left: {x}px; top: {y}px; width: {width}px"
	role="dialog"
	aria-label="Annotation answer"
>
	<!-- No tools in the card: the reply takes the whole card.
	Rewording is the E key while the card is open; prompt approval
	is the badge's plus/minus. Both live outside so the answer
	reads edge to edge. -->
	<p class="ann-answer-text" dir="auto">{answer}</p>
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
		/* Border-box: the page sizes the card to the clear width, so
		padding must live inside it — content-box spilled the card
		past the viewport edge on narrow phones. */
		box-sizing: border-box;
		padding: 0.6rem 0.7rem 0.5rem;
		border-radius: 10px;
		/* Same size as the create pill root: the card reads at
		message size, never toy-fixed beside scaled type. The
		popup-size setting rides on top (--annpop-scale). */
		font-size: calc(1rem * var(--font-scale, 1) * var(--annpop-scale, 1));
		/* Opaque overlay surface: any see-through let the covered
		lines ghost into the answer. */
		background: #fff;
		background: var(--bg-overlay);
		/* Hairline ring: the edgeless card dissolved into the thread
		on phones — the shadow alone didn't seat it. */
		border: 1px solid #e5e5ea;
		border-color: var(--line-overlay);
		/* Spread ring = scrim, dimming the thread while the answer
		is open (see .ann-pop). */
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		box-shadow:
			0 0 0 100vmax var(--scrim),
			var(--shadow-overlay);
		color: #1c1c1e;
		color: var(--ink);
		animation: ann-answer-in 0.16s ease;
	}
	/* Stark-contrast preference: a strong edge so the card never
	dissolves into the thread. */
	@media (prefers-contrast: more) {
		.ann-answer {
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
	.ann-answer-text {
		margin: 0;
		line-height: 1.45;
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
