<!-- Annotation answer popover: a filed note's reply, read beside its
highlighted word. The page owns open state, the quote anchor (kept in
step with scrolls) and the fade-out timing; this component measures
itself and places itself against the anchor (placeAnswerPopover):
below the word, flipped above when only the top has room, height
capped with an inner scroll when neither side does, and a tail
pointing back at the word. The quote itself never renders here (the
highlighted word upstream is the title) — answer text renders as plain
text, never HTML, so model output can't inject markup. Lines render
as their own paragraphs; a short first line (the expression and its
meaning) reads as the note's headline. No close button and no tools:
clicking off the card closes it (Esc too); rewording is the E key,
prompt approval the badge's plus/minus. -->
<script lang="ts">
	import { placeAnswerPopover, type AnchorRect } from "$lib/annPop";

	interface Props {
		answer: string;
		/** Fade-out in flight (unmounts when the ramp ends). */
		closing: boolean;
		/** The annotated word's viewport rect. */
		anchor: AnchorRect;
		/** Top edge kept clear above the word (its badge). */
		clearTop: number;
		/** Pointer x of the opening press (wide quotes aim here). */
		pointX: number;
		/** Widest the card may run (px); prose caps it narrower. */
		maxWidth: number;
		/** Word-to-tail breath (px, grows with the text size). */
		gap: number;
		/** Badge whose word this note explains (pulses on open). */
		badgeId: string;
	}

	let {
		answer,
		closing,
		anchor,
		clearTop,
		pointX,
		maxWidth,
		gap,
		badgeId
	}: Props = $props();

	/** Tail depth past the card edge: half the rotated square's diagonal. */
	const TAIL = 9;

	let card: HTMLDivElement | undefined = $state();
	let body: HTMLDivElement | undefined = $state();
	let size = $state<{ w: number; h: number } | null>(null);
	let vw = $state(typeof window === "undefined" ? 1024 : window.innerWidth);
	let vh = $state(typeof window === "undefined" ? 768 : window.innerHeight);

	const lines = $derived(
		answer
			.split(/\n+/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0)
	);
	/** Headline only for a short first line in a multi-line note: an
	old single-paragraph answer stays plain prose. */
	const headed = $derived(lines.length > 1 && (lines[0]?.length ?? 0) <= 90);

	/** The composer's top edge, when it floats over the thread below
	the word: the card treats it as the floor, so a bottom note
	flips above instead of landing on the input. */
	let floor = $state<number | null>(null);
	function readFloor(): void {
		const prompt = document.querySelector(".prompt");
		const top =
			prompt instanceof HTMLElement ? prompt.getBoundingClientRect().top : null;
		floor = top !== null && top > 0 && top < vh ? top : null;
	}
	$effect(() => {
		void vh;
		readFloor();
	});
	const bottomEdge = $derived(
		floor !== null && floor > anchor.bottom + 24 ? floor : vh
	);

	const place = $derived(
		size
			? placeAnswerPopover({
					anchor,
					clearTop,
					pointX,
					cardWidth: size.w,
					cardHeight: size.h,
					viewportWidth: vw,
					viewportHeight: bottomEdge,
					gap,
					tail: TAIL
				})
			: null
	);

	function reducedMotion(): boolean {
		return (
			typeof matchMedia !== "undefined" &&
			matchMedia("(prefers-reduced-motion: reduce)").matches
		);
	}

	/** Natural size: the body's full scroll height plus the card chrome,
	so a capped card still knows how tall it wants to be. offset*
	ignores transforms, so the open scale never skews a measure. */
	function measure(): void {
		if (!card || !body) return;
		const w = card.offsetWidth;
		const h = card.offsetHeight - body.clientHeight + body.scrollHeight;
		if (!size || size.w !== w || size.h !== h) size = { w, h };
	}

	// Observe the text, never the card: the card's own height follows
	// the placement cap, and observing it would loop (measure, cap,
	// resize, measure) inside one frame. Re-runs when the lines
	// change (E rewords) so new paragraphs are observed too.
	$effect(() => {
		void lines;
		if (!card || !body) return;
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		for (const child of Array.from(body.children)) ro.observe(child);
		return () => ro.disconnect();
	});

	// Word pulse on open: the badge pops once (the individual `scale`
	// property composes with its own translate, so geometry holds).
	$effect(() => {
		if (reducedMotion()) return;
		const badge = document.querySelector(`[data-ann-badge="${badgeId}"]`);
		if (!(badge instanceof HTMLElement) || typeof badge.animate !== "function")
			return;
		badge.animate([{ scale: "1" }, { scale: "1.28" }, { scale: "1" }], {
			duration: 320,
			easing: "cubic-bezier(0.3, 0.7, 0.4, 1)"
		});
	});

	// Smooth reposition: when the card's own size moves it (content
	// grew past a side, a flip, an x clamp), glide from the old spot
	// instead of jumping. The edge facing the word is the one that
	// must stay put: a below card keeps its top, an above card its
	// bottom (it grows upward, nothing to glide). Scroll tracking
	// moves the anchor and stays instant. Transform only, one ramp.
	let last: {
		x: number;
		edge: number;
		side: string;
		ax: number;
		ay: number;
	} | null = null;
	let openedAt = 0;
	$effect(() => {
		const p = place;
		if (!p || !card || !size) return;
		const shown = Math.min(size.h, p.maxHeight);
		const edge = p.side === "below" ? p.y : p.y + shown;
		const now = { x: p.x, edge, side: p.side, ax: anchor.left, ay: anchor.top };
		const prev = last;
		last = now;
		if (!prev) {
			openedAt = performance.now();
			return;
		}
		if (prev.ax !== now.ax || prev.ay !== now.ay) return;
		const dx = prev.x - now.x;
		// A flip glides the whole card across the word's line; a
		// same-side move glides its word-facing edge.
		const dy =
			prev.side === now.side
				? prev.edge - now.edge
				: now.side === "above"
					? prev.edge - (now.edge - shown)
					: prev.edge - shown - now.edge;
		if ((dx === 0 && dy === 0) || closing || reducedMotion()) return;
		// The open ramp owns the transform for its first frames.
		if (performance.now() - openedAt < 170) return;
		if (typeof card.animate !== "function") return;
		card.animate(
			[{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
			{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
		);
	});
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
	bind:this={card}
	class="ann-answer"
	class:closing
	class:above={place?.side === "above"}
	class:placed={place !== null}
	style:left="{place?.x ?? 0}px"
	style:top="{place?.y ?? 0}px"
	style:--ann-max-w="{maxWidth}px"
	style:--ann-max-h={place ? `${place.maxHeight}px` : "none"}
	style:--ann-tail-x="{place?.tailX ?? 24}px"
	role="dialog"
	aria-label="Annotation answer"
>
	<div class="ann-answer-body" bind:this={body}>
		{#each lines as line, i (i)}
			<p
				class="ann-answer-text"
				class:ann-answer-head={headed && i === 0}
				dir="auto"
			>
				{line}
			</p>
		{/each}
	</div>
</div>

<style>
	/* Open: scale and fade out of the word (the origin rides the tail,
	so the card grows from the word it explains). Close mirrors it. */
	@keyframes ann-answer-in {
		from {
			opacity: 0;
			transform: translateY(var(--ann-rise, -6px)) scale(0.94);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes ann-answer-out {
		from {
			opacity: 1;
			transform: none;
		}
		to {
			opacity: 0;
			transform: translateY(var(--ann-rise, -6px)) scale(0.96);
		}
	}
	.ann-answer {
		position: fixed;
		z-index: 60;
		/* Unplaced first frame (before the self-measure lands) stays
		invisible; placement lands before paint. */
		visibility: hidden;
		/* Border-box: the max width includes padding and border, so
		the card never spills past the viewport edge on phones. */
		box-sizing: border-box;
		/* Shrink to the note: short notes make a compact bubble, long
		ones wrap at a reading measure or the column cap, whichever
		is narrower. */
		width: max-content;
		max-width: min(var(--ann-max-w, 32rem), 30em);
		/* Same type as the message beside it (see MessageBody's
		.rendered); the popup-size setting rides on top. */
		font-size: calc(0.92rem * var(--font-scale, 1) * var(--annpop-scale, 1));
		line-height: var(--msg-line-height, 1.5);
		border-radius: 14px;
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
		transform-origin: var(--ann-tail-x) 0;
		--ann-rise: -6px;
	}
	.ann-answer.placed {
		visibility: visible;
		animation: ann-answer-in 150ms cubic-bezier(0.2, 0.9, 0.3, 1.15);
	}
	.ann-answer.above {
		transform-origin: var(--ann-tail-x) 100%;
		--ann-rise: 6px;
	}
	/* Tail: a rotated square sharing the card's surface and edge,
	half tucked inside so the ring runs unbroken into it. */
	.ann-answer::before {
		content: "";
		position: absolute;
		left: calc(var(--ann-tail-x) - 6px);
		top: -7px;
		width: 12px;
		height: 12px;
		box-sizing: border-box;
		background: inherit;
		border: inherit;
		border-right-color: transparent;
		border-bottom-color: transparent;
		border-radius: 2px 0 0 0;
		transform: rotate(45deg);
	}
	.ann-answer.above::before {
		top: auto;
		bottom: -7px;
		border: inherit;
		border-left-color: transparent;
		border-top-color: transparent;
		border-radius: 0 0 2px 0;
	}
	.ann-answer-body {
		position: relative;
		max-height: var(--ann-max-h, none);
		overflow-y: auto;
		overscroll-behavior: contain;
		border-radius: inherit;
		padding: 0.7em 1em 0.75em;
	}
	.ann-answer-text {
		margin: 0;
		text-wrap: pretty;
		overflow-wrap: break-word;
	}
	.ann-answer-text + .ann-answer-text {
		margin-top: 0.35em;
		/* Secondary lines (literal sense, example) step back from the
		headline without dropping to the faint muted grey. */
		color: color-mix(in srgb, currentColor 80%, transparent);
	}
	.ann-answer-head {
		font-weight: 600;
	}
	.ann-answer-head + .ann-answer-text {
		margin-top: 0.3em;
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
		animation: ann-answer-out 140ms ease-in forwards;
		pointer-events: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.ann-answer.placed {
			animation: none;
		}
		.ann-answer.closing {
			animation: none;
			opacity: 0;
		}
	}
</style>
