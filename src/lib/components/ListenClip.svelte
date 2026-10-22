<!-- One drill clip, above its message body: the player (picture,
play / restart / slow replay, scrubber, volume, where it sits in the
video with the source link). The clip waiting to be answered hosts
the picture as a card the width of the column; its Show text and Next
steps sit under the text (`ListenSteps`). The transcript is the
message body itself (annotatable like any reply); the translation and
notes fold under it (`ListenGloss`). -->
<script lang="ts">
	import {
		storyboardFrame,
		type ClipState,
		type ListenSession
	} from "$lib/listen";
	import type { Token } from "$lib/listenClips";
	import { markWord, wordAt, wordRanges } from "$lib/listenHighlight";

	interface Props {
		session: ListenSession;
		clip: ClipState;
		/** This clip waits to be answered (the newest clip row). */
		open: boolean;
		playing: { i: number; slow: boolean } | null;
		/** The playhead of the clip playing or paused. */
		position: { i: number; t: number } | null;
		audioStatus: "idle" | "loading" | "ready" | "error";
		/** The video's picture once downloaded (null: still frames). */
		videoUrl: string | null;
		/** Some clip still waits to be answered: that one hosts the
		 * picture, whichever clip is playing. */
		anyOpen: boolean;
		/** This clip's words with their track times (empty: unknown). */
		timed: readonly Token[];
		/** The drill audio's volume, 0-2 (1 = as recorded). */
		volume: number;
		actions: {
			/** Play / pause at a speed (resumes where it paused). */
			play: (slow: boolean) => void;
			/** Play from the clip's start. */
			restart: () => void;
			seek: (t: number) => void;
			openSource: (url: string) => void;
			setVolume: (volume: number) => void;
			/** The pointer is over this clip's player (Space plays it). */
			hover: (over: boolean) => void;
		};
	}

	let {
		session,
		clip,
		open,
		playing,
		position,
		audioStatus,
		videoUrl,
		anyOpen,
		timed,
		volume,
		actions
	}: Props = $props();

	const span = $derived(session.clips[clip.i]);
	const here = $derived(playing?.i === clip.i);
	const answered = $derived(clip.heard !== undefined);
	/** Scrubber: on the clip awaiting a guess and on any clip playing
	 * or paused mid-way. */
	const at = $derived(position?.i === clip.i ? position.t : null);
	const scrub = $derived(Boolean(span) && (open || at !== null));
	/** One picture card in the thread: on the clip waiting to be
	 * answered, or (once every clip is answered) on the clip playing
	 * or paused mid-way. Others keep a small still frame. The card
	 * holds its 16:9 box from the first paint (the still frame, then
	 * the video once it lands), so nothing moves when the video does. */
	const screen = $derived(Boolean(span) && (open || (!anyOpen && at !== null)));
	/** Volume before a mute, so unmuting goes back to it. */
	let unmuted = $state(1);
	let video = $state<HTMLVideoElement | null>(null);
	// The picture follows the sound: muted, same playhead, same speed,
	// whichever clip is sounding (an answered clip finishing its line
	// shows here too, so the picture never jumps rows mid-sentence).
	// The audio element owns time; the video only corrects when it
	// drifts past a few frames and isn't already seeking, so playback
	// stays smooth and seeks never pile up.
	$effect(() => {
		const v = video;
		if (!v || !span) return;
		const t = position?.t ?? span.start;
		v.playbackRate = playing?.slow ? 0.75 : 1;
		if (!v.seeking && Math.abs(v.currentTime - t) > 0.25) v.currentTime = t;
		if (playing) {
			if (v.paused) v.play().catch(() => {});
		} else if (!v.paused) v.pause();
	});
	let row = $state<HTMLDivElement | null>(null);
	// Once the text shows, the word sounding is marked on it as the
	// clip plays (and stays on the word a pause stopped at).
	$effect(() => {
		const shown = clip.heard !== undefined || clip.peeked === true;
		const t = position?.i === clip.i ? position.t : null;
		const body = row?.closest("article")?.querySelector(".rendered");
		if (!shown || t === null || timed.length === 0 || !body) return;
		const k = wordAt(
			timed.map((w) => w.start),
			t
		);
		const ranges = wordRanges(
			body,
			timed.map((w) => w.text)
		);
		markWord(ranges[k] ?? null);
		return () => markWord(null);
	});
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
	const playOn = $derived(here && !playing?.slow);
</script>

<div
	class="clip"
	class:open
	class:answered
	class:has-screen={screen}
	bind:this={row}
>
	<!-- The player: picture on top, its controls joined underneath as
	one card. Without a picture the controls are a plain row. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="player"
		onpointerenter={(e) => {
			if (e.pointerType === "mouse") actions.hover(true);
		}}
		onpointerleave={() => actions.hover(false)}
	>
		{#if screen}
			<!-- The picture is the big play button: a click plays or
			pauses (Space does the same while the pointer is here). -->
			<button
				type="button"
				class="screen"
				aria-label="The clip's video"
				title={playOn ? "Pause" : "Play"}
				disabled={audioStatus === "error"}
				onclick={(e) => {
					e.stopPropagation();
					actions.play(false);
				}}
			>
				{#if videoUrl}
					<video
						bind:this={video}
						src={videoUrl}
						muted
						playsinline
						preload="auto"
						disablepictureinpicture
						aria-hidden="true"
						onloadedmetadata={(e) => {
							// A seek before metadata is dropped: land on the clip now.
							if (span) e.currentTarget.currentTime = position?.t ?? span.start;
						}}
					></video>
				{:else if frame && frameState === "ok"}
					<span class="poster" style={frameStyle} aria-hidden="true"></span>
				{/if}
				{#if !playOn}
					<span class="big-play" aria-hidden="true">
						<svg viewBox="0 0 16 16"
							><path
								d="M5 3.2v9.6c0 .5.6.8 1 .5l7.2-4.8a.6.6 0 0 0 0-1L6 2.7c-.4-.3-1 0-1 .5Z"
							/></svg
						>
					</span>
				{/if}
			</button>
		{/if}
		<div class="controls">
			{#if !screen && frame && frameState !== "error"}
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
				class:on={playOn}
				aria-label={playOn ? "Pause" : "Play clip"}
				title="Play · Space over the video"
				disabled={audioStatus === "error"}
				onclick={(e) => {
					e.stopPropagation();
					actions.play(false);
				}}
			>
				{#if playOn}
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
				class="icon restart"
				aria-label="Play from the start"
				title="Play from the start"
				disabled={audioStatus === "error"}
				onclick={(e) => {
					e.stopPropagation();
					actions.restart();
				}}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true"
					><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3" /><path
						d="M3.2 2.6v2.6h2.6"
					/></svg
				>
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
			{#if screen}
				<!-- Volume: the icon mutes; hovering (or focusing) it
				slides out the level, up to 200%. -->
				<span class="volume">
					<button
						type="button"
						class="icon"
						aria-label={volume === 0 ? "Unmute" : "Mute"}
						title={`Volume ${Math.round(volume * 100)}%`}
						onclick={(e) => {
							e.stopPropagation();
							if (volume > 0) {
								unmuted = volume;
								actions.setVolume(0);
							} else actions.setVolume(unmuted || 1);
						}}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true"
							><path class="fill" d="M2.5 6h2.2L8 3.3v9.4L4.7 10H2.5z" />
							{#if volume === 0}
								<path d="M10.5 6.2l3.4 3.6M13.9 6.2l-3.4 3.6" />
							{:else}
								<path d="M10.4 6.1a2.6 2.6 0 0 1 0 3.8" />
								{#if volume > 0.6}<path d="M12.2 4.4a5 5 0 0 1 0 7.2" />{/if}
							{/if}</svg
						>
					</button>
					<input
						class="level"
						type="range"
						min="0"
						max="2"
						step="0.05"
						value={volume}
						aria-label="Volume"
						style="--fill: {(volume / 2) * 100}%"
						oninput={(e) => actions.setVolume(Number(e.currentTarget.value))}
						onchange={(e) => e.currentTarget.blur()}
						onclick={(e) => e.stopPropagation()}
					/>
				</span>
			{/if}
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
	</div>
	{#if answered && !clip.skipped && (clip.ops?.length ?? 0) > 0}
		<!-- A guess typed before guessing left the drill, marked. -->
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
	/* Round icon buttons (restart, volume): the slow pill's outline,
	no label. */
	.icon {
		flex: 0 0 auto;
		width: 2rem;
		height: 2rem;
		display: grid;
		place-items: center;
		border: 1px solid var(--line-soft);
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		padding: 0;
	}
	.icon:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--line-hover);
	}
	.icon:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.icon svg {
		width: 0.95rem;
		height: 0.95rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.icon svg .fill {
		fill: currentColor;
		stroke: none;
	}
	/* The level slides out of the volume icon on hover or focus. */
	.volume {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.level {
		width: 0;
		opacity: 0;
		margin: 0;
		height: 1rem;
		background: transparent;
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		transition:
			width 0.2s ease,
			opacity 0.2s ease;
	}
	.volume:hover .level,
	.volume:focus-within .level {
		width: 4.5rem;
		opacity: 1;
	}
	.level::-webkit-slider-runnable-track {
		height: 3px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--accent) var(--fill),
			rgba(242, 242, 247, 0.3) var(--fill)
		);
	}
	.level::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 0.7rem;
		height: 0.7rem;
		margin-top: calc(1.5px - 0.35rem);
		border-radius: 50%;
		background: var(--accent);
	}
	.level::-moz-range-track {
		height: 3px;
		border-radius: 999px;
		background: rgba(242, 242, 247, 0.3);
	}
	.level::-moz-range-thumb {
		width: 0.7rem;
		height: 0.7rem;
		border: none;
		border-radius: 50%;
		background: var(--accent);
	}
	/* The clip in play shows its picture as one card the width of the
	column with its controls joined underneath, like any player. The
	picture never passes ~60% of the window's height, so the controls
	and the steps under the text still fit above the composer. */
	.clip.has-screen .player {
		align-self: center;
		box-sizing: border-box;
		width: min(100%, calc(60dvh * 16 / 9));
		border-radius: 0.7rem;
		overflow: hidden;
		background: #000;
		animation: screen-in 0.25s ease;
	}
	.screen {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		padding: 0;
		border: none;
		background: #000;
		cursor: pointer;
	}
	.screen:disabled {
		cursor: default;
	}
	.screen video,
	.screen .poster {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.screen .poster {
		background-repeat: no-repeat;
		/* The storyboard cell is tiny: soften it while the video loads. */
		filter: blur(2px);
	}
	/* Paused or waiting: a quiet play mark over the picture. */
	.big-play {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 4rem;
		height: 4rem;
		margin: -2rem 0 0 -2rem;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.45);
		color: #fff;
		opacity: 0.85;
		transition:
			opacity 0.15s ease,
			transform 0.15s ease;
	}
	.screen:hover .big-play {
		opacity: 1;
		transform: scale(1.05);
	}
	.big-play svg {
		width: 1.8rem;
		height: 1.8rem;
		fill: currentColor;
		margin-left: 0.2rem;
	}
	.clip.has-screen .controls {
		padding: 0.4rem 0.6rem;
		background: #1c1c1e;
		color: #f2f2f7;
	}
	.clip.has-screen .where,
	.clip.has-screen .source {
		color: rgba(242, 242, 247, 0.72);
	}
	.clip.has-screen .source:hover {
		color: #fff;
	}
	.clip.has-screen .slow,
	.clip.has-screen .icon {
		color: rgba(242, 242, 247, 0.8);
		border-color: rgba(242, 242, 247, 0.28);
	}
	.clip.has-screen .slow.on,
	.clip.has-screen .slow:hover,
	.clip.has-screen .icon:hover:not(:disabled) {
		color: #fff;
		border-color: rgba(242, 242, 247, 0.6);
	}
	.clip.has-screen .scrub {
		flex: 1 1 9rem;
	}
	.clip.has-screen .scrub::-webkit-slider-runnable-track {
		background: linear-gradient(
			to right,
			var(--accent) var(--fill),
			rgba(242, 242, 247, 0.3) var(--fill)
		);
	}
	.clip.has-screen .scrub::-moz-range-track {
		background: linear-gradient(
			to right,
			var(--accent) var(--fill),
			rgba(242, 242, 247, 0.3) var(--fill)
		);
	}
	@keyframes screen-in {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.clip.has-screen .player,
		.level,
		.big-play {
			animation: none;
			transition: none;
		}
	}
</style>
