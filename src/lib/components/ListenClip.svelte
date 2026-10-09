<!-- One drill clip, above its message body: play / slow replay, where
it sits in the video (with the source link), and once answered the
guess marked against what was said. The clip waiting to be answered
offers an optional guess field (Enter grades it), Show text (A), and
Next (a); guessing is never required. The transcript is the message
body itself (annotatable like any reply); the translation and notes
fold under it (`ListenGloss`). -->
<script lang="ts">
	import {
		storyboardFrame,
		type ClipState,
		type ListenSession
	} from "$lib/listen";

	interface Props {
		session: ListenSession;
		clip: ClipState;
		/** This clip waits to be answered (the newest clip row). */
		open: boolean;
		playing: { i: number; slow: boolean } | null;
		/** The playhead of the clip playing or paused. */
		position: { i: number; t: number } | null;
		audioStatus: "idle" | "loading" | "ready" | "error";
		actions: {
			play: (slow: boolean) => void;
			seek: (t: number) => void;
			openSource: (url: string) => void;
			/** Grade a typed guess (the next clip follows). */
			guess: (text: string) => void;
			/** Show this clip's text while it still waits. */
			peek: () => void;
			/** Reveal this clip and move on. */
			next: () => void;
		};
	}

	let { session, clip, open, playing, position, audioStatus, actions }: Props =
		$props();

	const span = $derived(session.clips[clip.i]);
	const here = $derived(playing?.i === clip.i);
	const answered = $derived(clip.heard !== undefined);
	/** Scrubber: on the clip awaiting a guess and on any clip playing
	 * or paused mid-way. */
	const at = $derived(position?.i === clip.i ? position.t : null);
	const scrub = $derived(Boolean(span) && (open || at !== null));
	const source = $derived(
		`https://www.youtube.com/watch?v=${session.videoId}&t=${Math.floor(span?.start ?? 0)}s`
	);
	const stamp = $derived.by(() => {
		const s = Math.floor(span?.start ?? 0);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
	});
	// The frame mid-clip, as one cell of a storyboard sprite sheet.
	const frame = $derived(
		session.storyboard && span
			? storyboardFrame(session.storyboard, (span.start + span.end) / 2)
			: null
	);
	/** The sheet's state: a loading one holds the frame's box (no jump
	 * when it lands), a stale or blocked one hides it. */
	let frameState = $state<"loading" | "ok" | "error">("loading");
	const frameStyle = $derived.by(() => {
		const board = session.storyboard;
		if (!frame || !board) return "";
		const box = `aspect-ratio: ${board.width} / ${board.height};`;
		if (frameState !== "ok") return box;
		const x = board.columns > 1 ? (frame.col / (board.columns - 1)) * 100 : 0;
		const y = board.rows > 1 ? (frame.row / (board.rows - 1)) * 100 : 0;
		return (
			`background-image: url("${frame.url}"); ` +
			`background-size: ${board.columns * 100}% ${board.rows * 100}%; ` +
			`background-position: ${x}% ${y}%; ` +
			box
		);
	});
	$effect(() => {
		const url = frame?.url;
		frameState = "loading";
		if (!url) return;
		let live = true;
		const img = new Image();
		img.onload = () => {
			if (live) frameState = "ok";
		};
		img.onerror = () => {
			if (live) frameState = "error";
		};
		img.src = url;
		return () => {
			live = false;
		};
	});
	const words = $derived(
		clip.ops?.filter((o) => o.kind !== "extra").length ?? 0
	);
	const heardWords = $derived(
		clip.ops?.filter((o) => o.kind === "ok" || o.kind === "near").length ?? 0
	);
</script>

<div class="clip" class:open class:answered>
	<div class="controls">
		{#if frame && frameState !== "error"}
			<span
				class="frame"
				class:shown={frameState === "ok"}
				style={frameStyle}
				aria-hidden="true"
			></span>
		{/if}
		<button
			type="button"
			class="play"
			class:on={here && !playing?.slow}
			aria-label={here && !playing?.slow ? "Pause" : "Play clip"}
			title="Play (Space)"
			disabled={audioStatus === "error"}
			onclick={(e) => {
				e.stopPropagation();
				actions.play(false);
			}}
		>
			{#if here && !playing?.slow}
				<svg viewBox="0 0 16 16" aria-hidden="true"
					><rect x="4" y="3.5" width="2.8" height="9" rx="1" /><rect
						x="9.2"
						y="3.5"
						width="2.8"
						height="9"
						rx="1"
					/></svg
				>
			{:else}
				<svg viewBox="0 0 16 16" aria-hidden="true"
					><path
						d="M5 3.2v9.6c0 .5.6.8 1 .5l7.2-4.8a.6.6 0 0 0 0-1L6 2.7c-.4-.3-1 0-1 .5Z"
					/></svg
				>
			{/if}
		</button>
		<button
			type="button"
			class="slow"
			class:on={here && playing?.slow}
			title="Slow replay (S)"
			disabled={audioStatus === "error"}
			onclick={(e) => {
				e.stopPropagation();
				actions.play(true);
			}}>0.75×</button
		>
		{#if scrub && span}
			<input
				class="scrub"
				type="range"
				min={span.start}
				max={span.end}
				step="0.05"
				value={at ?? span.start}
				aria-label="Position in the clip"
				disabled={audioStatus !== "ready"}
				style="--fill: {(((at ?? span.start) - span.start) /
					Math.max(span.end - span.start, 0.01)) *
					100}%"
				oninput={(e) => actions.seek(Number(e.currentTarget.value))}
				onchange={(e) => e.currentTarget.blur()}
				onclick={(e) => e.stopPropagation()}
			/>
		{/if}
		<span class="where">
			{clip.i + 1} / {session.clips.length}
			{#if audioStatus === "loading"}
				· <span class="busy">loading audio…</span>
			{:else if audioStatus === "error"}
				· audio didn't load
			{/if}
		</span>
		<button
			type="button"
			class="source"
			title="Open at {stamp} on YouTube"
			onclick={(e) => {
				e.stopPropagation();
				actions.openSource(source);
			}}>{stamp} ↗</button
		>
	</div>
	{#if open}
		<div class="ask">
			<input
				class="guess-box"
				type="text"
				lang={session.lang}
				autocomplete="off"
				spellcheck="false"
				placeholder="Type what you hear (optional)"
				aria-label="Type what you hear"
				onkeydown={(e) => {
					if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
						e.preventDefault();
						const text = e.currentTarget.value.trim();
						if (!text) return;
						e.currentTarget.value = "";
						actions.guess(text);
					} else if (e.key === "Enter") {
						e.preventDefault();
						actions.next();
					} else if (e.key === "Escape") {
						e.currentTarget.blur();
					}
				}}
			/>
			<button
				type="button"
				class="step"
				title="Show the text, stay on this clip (A)"
				disabled={clip.peeked}
				onclick={(e) => {
					e.stopPropagation();
					actions.peek();
				}}>Show text</button
			>
			<button
				type="button"
				class="step next"
				title="Reveal and play the next clip (a)"
				onclick={(e) => {
					e.stopPropagation();
					actions.next();
				}}>Next ›</button
			>
		</div>
	{:else if answered}
		{#if clip.skipped}
			<p class="verdict">Revealed</p>
		{:else}
			<p class="guess" aria-label="Your guess, marked">
				{#each clip.ops ?? [] as op, k (k)}
					{#if op.kind === "ok"}
						<span class="w ok">{op.guess}</span>
					{:else if op.kind === "near"}
						<span class="w near" title="Heard right; spelled {op.ref}"
							>{op.guess}</span
						>
					{:else if op.kind === "wrong"}
						<span class="w wrong"
							><s>{op.guess}</s> <span class="fix">{op.ref}</span></span
						>
					{:else if op.kind === "missed"}
						<span class="w missed" title="Missed">{op.ref}</span>
					{:else}
						<span class="w extra"><s>{op.guess}</s></span>
					{/if}
				{/each}
			</p>
			<p class="verdict">
				{heardWords === words ? "All of it" : `${heardWords} of ${words} words`}
			</p>
		{/if}
	{/if}
</div>

<style>
	.clip {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.4rem;
		user-select: none;
		-webkit-user-select: none;
		animation: clip-in 0.2s ease both;
	}
	@keyframes clip-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.clip,
		.frame.shown {
			animation: none;
		}
		.frame,
		.play {
			transition: none;
		}
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.frame {
		flex: 0 0 auto;
		width: 4.5rem;
		border-radius: 0.4rem;
		background-color: var(--bg-raised);
		background-repeat: no-repeat;
		/* Answering shrinks the open clip's frame and play button to the
		row size: eased, so the eye follows the clip instead of losing it. */
		transition:
			width 0.28s ease,
			border-radius 0.28s ease;
	}
	.frame.shown {
		animation: frame-in 0.25s ease;
	}
	@keyframes frame-in {
		from {
			opacity: 0;
		}
	}
	.clip.open .frame {
		width: 9rem;
		border-radius: 0.6rem;
	}
	.play {
		flex: 0 0 auto;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 50%;
		border: none;
		background: var(--accent);
		color: var(--accent-ink);
		display: grid;
		place-items: center;
		cursor: pointer;
		transition:
			transform 0.12s ease,
			width 0.28s ease,
			height 0.28s ease,
			background-color 0.28s ease,
			color 0.28s ease;
	}
	.play:active {
		transform: scale(0.94);
	}
	.play svg {
		width: 1.1rem;
		height: 1.1rem;
		fill: currentColor;
	}
	.clip:not(.open) .play {
		width: 2rem;
		height: 2rem;
		background: transparent;
		color: var(--accent);
		border: 1px solid var(--line-soft);
	}
	.clip:not(.open) .play svg {
		width: 0.85rem;
		height: 0.85rem;
	}
	.slow {
		border: 1px solid var(--line-soft);
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 0.8rem;
		padding: 0.25rem 0.6rem;
		min-height: 2rem;
		border-radius: 999px;
		cursor: pointer;
	}
	.slow.on,
	.slow:hover {
		color: var(--ink);
		border-color: var(--line-hover);
	}
	.play:disabled,
	.slow:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.where {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.source {
		margin-left: auto;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--muted);
		text-decoration: none;
	}
	.source:hover {
		color: var(--accent);
	}
	.verdict {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.guess {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.3em;
		margin: 0.1rem 0 0;
		line-height: 1.6;
	}
	.w.ok {
		color: var(--ok);
	}
	.w.near {
		color: var(--ok);
		text-decoration: underline dotted;
		text-underline-offset: 0.2em;
	}
	.w.wrong s,
	.w.extra s {
		color: var(--danger);
		opacity: 0.8;
	}
	.w.wrong .fix {
		color: var(--ink);
		font-weight: 600;
	}
	.w.missed {
		color: var(--muted);
		text-decoration: underline dashed;
		text-underline-offset: 0.2em;
	}
	.busy {
		animation: clip-pulse 1.4s ease-in-out infinite;
	}
	@keyframes clip-pulse {
		50% {
			opacity: 0.4;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.busy {
			animation: none;
		}
	}
	/* A slim track that fills to the playhead. Blurs after a drag so
	Space goes back to play / pause. */
	.scrub {
		flex: 0 1 9rem;
		min-width: 4rem;
		height: 1rem;
		margin: 0;
		background: transparent;
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
	}
	.scrub::-webkit-slider-runnable-track {
		height: 3px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--accent) var(--fill),
			var(--line) var(--fill)
		);
	}
	.scrub::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 0.7rem;
		height: 0.7rem;
		margin-top: calc(1.5px - 0.35rem);
		border-radius: 50%;
		background: var(--accent);
	}
	.scrub::-moz-range-track {
		height: 3px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--accent) var(--fill),
			var(--line) var(--fill)
		);
	}
	.scrub::-moz-range-thumb {
		width: 0.7rem;
		height: 0.7rem;
		border: none;
		border-radius: 50%;
		background: var(--accent);
	}
	.scrub:disabled {
		opacity: 0.4;
		cursor: default;
	}
	/* The waiting clip's row: an optional guess field and two quiet
	steps. Nothing here takes focus by itself, so the drill's single-
	letter keys keep working until the field is clicked. */
	.ask {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.guess-box {
		flex: 1 1 12rem;
		min-width: 0;
		font: inherit;
		font-size: 0.9rem;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--line-soft);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--ink);
	}
	.guess-box:focus {
		outline: none;
		border-color: var(--focus);
	}
	.step {
		flex: 0 0 auto;
		font: inherit;
		font-size: 0.8rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--line-soft);
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.step:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--line-hover);
	}
	.step:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.step.next {
		color: var(--accent);
	}
</style>
