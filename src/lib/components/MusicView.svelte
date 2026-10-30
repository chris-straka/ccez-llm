<!-- A music chat: a video player for one song at a time. With no song
yet it is a search box (a pasted YouTube link finds that video);
with one, the video's picture plays muted in step with the app's one
music player (`music`), so the sound keeps going when this chat is
left and the top bar takes over. Loop is on unless turned off. -->
<script lang="ts">
	import { formatDuration } from "$lib/listen";
	import { music } from "$lib/music.svelte";
	import {
		findSongs,
		songErrorCopy,
		type Song,
		type SongSource
	} from "$lib/songs";
	import { fade, fly } from "svelte/transition";

	interface Props {
		song: Song | null;
		/** This chat (the bar opens it while its song plays). */
		chatId: string;
		/** Where songs are found (null on the web build). */
		source: SongSource | null;
		actions: {
			/** Make `song` this chat's song and play it. */
			pick: (song: Song) => void;
			/** Back to picking a song. */
			change: () => void;
			/** Turn the chat back into a plain one. */
			leave: () => void;
		};
	}

	let { song, chatId, source, actions }: Props = $props();

	const reduceMotion =
		typeof matchMedia === "function" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches;
	const ms = (n: number): number => (reduceMotion ? 0 : n);
	/** Rise in, or (Reduce Motion) only fade. */
	const rise = { y: reduceMotion ? 0 : 14, duration: 260 };

	let query = $state("");
	let searching = $state(false);
	let error = $state("");
	let results = $state<(Song & { duration: number })[] | null>(null);
	let seq = 0;
	let typing: ReturnType<typeof setTimeout> | null = null;
	let box = $state<HTMLInputElement | null>(null);
	let vid = $state<HTMLVideoElement | null>(null);

	/** The player holds this chat's song. */
	const mine = $derived(song !== null && music.song?.id === song.id);
	const playing = $derived(mine && music.status === "playing");
	const length = $derived(mine && music.duration > 0 ? music.duration : 0);

	async function search(): Promise<void> {
		if (typing) clearTimeout(typing);
		typing = null;
		const q = query.trim();
		if (!q) return;
		const n = ++seq;
		searching = true;
		error = "";
		try {
			if (!source) throw new Error("listen-needs-app");
			const rows = await findSongs(source, q);
			if (n !== seq) return;
			results = rows;
			// A pasted link plays at once: it is the song.
			const only = rows[0];
			if (rows.length === 1 && only && q.includes("youtu")) actions.pick(only);
		} catch (e) {
			if (n === seq) {
				error = songErrorCopy(e);
				results = [];
			}
		} finally {
			if (n === seq) searching = false;
		}
	}

	function onInput(value: string): void {
		query = value;
		if (typing) clearTimeout(typing);
		typing = value.trim() ? setTimeout(() => void search(), 450) : null;
		if (!value.trim()) {
			seq++;
			results = null;
			error = "";
			searching = false;
		}
	}

	function togglePlay(): void {
		if (!song) return;
		if (mine) music.toggle();
		else void music.play(song, chatId);
	}

	// The picture follows the sound: fetched once, played muted, and
	// pulled back into step whenever it drifts (a seek, a loop).
	$effect(() => {
		if (mine) void music.loadPicture();
	});
	$effect(() => {
		if (!vid) return;
		if (playing) void vid.play().catch(() => {});
		else vid.pause();
	});
	$effect(() => {
		void music.time;
		if (!vid || !mine) return;
		const t = music.now();
		if (Math.abs(vid.currentTime - t) > 0.35) vid.currentTime = t;
	});
	// Ready to type into, but only while the app already has the
	// keyboard: a window in the background never takes it.
	$effect(() => {
		if (!song && document.hasFocus()) box?.focus({ preventScroll: true });
	});
</script>

<section class="music" aria-label="Music">
	{#if song}
		<div class="player" in:fly={rise}>
			<button
				type="button"
				class="frame"
				aria-label={playing ? "Pause" : "Play"}
				onclick={togglePlay}
			>
				{#if mine && music.picture}
					<video
						bind:this={vid}
						src={music.picture}
						muted
						loop
						playsinline
						preload="auto"
						in:fade={{ duration: 200 }}
					></video>
				{:else if song.thumbnail}
					<img src={song.thumbnail} alt="" draggable="false" />
				{/if}
				{#if !playing}
					<span class="big-play" transition:fade={{ duration: ms(150) }}>
						{#if mine && music.status === "loading"}
							<span class="spinner" aria-hidden="true"></span>
						{:else}
							<svg viewBox="0 0 16 16" aria-hidden="true"
								><path d="M5.5 3.5l7 4.5-7 4.5z" /></svg
							>
						{/if}
					</span>
				{/if}
			</button>
			<div class="meta">
				<div class="names">
					<h2 class="title">{song.title}</h2>
					{#if mine && music.status === "error"}
						<p class="sub error" role="alert">{music.error}</p>
					{:else}
						<p class="sub">{song.channel}</p>
					{/if}
				</div>
			</div>
			<div class="controls">
				<button
					type="button"
					class="play"
					aria-label={playing ? "Pause" : "Play"}
					disabled={mine && music.status === "loading"}
					onclick={togglePlay}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						{#if playing}
							<path d="M5 3.5v9M11 3.5v9" />
						{:else}
							<path class="solid" d="M5.5 3.5l7 4.5-7 4.5z" />
						{/if}
					</svg>
				</button>
				<span class="clock">{formatDuration(mine ? music.time : 0)}</span>
				<input
					class="seek"
					type="range"
					min="0"
					max={length || 1}
					step="0.1"
					value={mine ? music.time : 0}
					disabled={!length}
					aria-label="Position"
					style:--fill={`${length ? ((mine ? music.time : 0) / length) * 100 : 0}%`}
					oninput={(e) => music.seek(Number(e.currentTarget.value))}
				/>
				<span class="clock">{length ? formatDuration(length) : "–:––"}</span>
				<button
					type="button"
					class="tool"
					class:lit={music.loop}
					aria-label="Loop"
					aria-pressed={music.loop}
					title={music.loop ? "Looping" : "Plays once"}
					onclick={() => music.setLoop(!music.loop)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"
						><path
							d="M3 7V6a2 2 0 0 1 2-2h7M10 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H4M6 14l-2-2 2-2"
						/></svg
					>
				</button>
				<button
					type="button"
					class="tool"
					aria-label="Another song"
					title="Another song"
					onclick={() => {
						query = "";
						results = null;
						actions.change();
					}}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"
						><circle cx="7" cy="7" r="4.2" /><path
							d="M10.2 10.2L13.5 13.5"
						/></svg
					>
				</button>
			</div>
		</div>
	{:else}
		<div class="pick" in:fly={rise}>
			<div class="search">
				<svg class="glass" viewBox="0 0 16 16" aria-hidden="true"
					><circle cx="7" cy="7" r="4.2" /><path
						d="M10.2 10.2L13.5 13.5"
					/></svg
				>
				<input
					bind:this={box}
					type="search"
					placeholder="Paste a YouTube link, or search for a song"
					value={query}
					oninput={(e) => onInput(e.currentTarget.value)}
					onkeydown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							void search();
						}
					}}
					aria-label="Find a song"
				/>
				<button
					type="button"
					class="tool"
					aria-label="Close music"
					title="Close music"
					onclick={actions.leave}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"
						><path d="M5 5l6 6M11 5l-6 6" /></svg
					>
				</button>
			</div>
			{#if error}
				<p class="note error" role="alert">{error}</p>
			{:else if searching}
				<p class="note">Searching…</p>
			{:else if results && results.length === 0}
				<p class="note">Nothing found.</p>
			{:else if !results}
				<p class="note">
					Plays the video with its sound, over and over, while you use the app.
				</p>
			{/if}
			{#if results && results.length > 0}
				<ul class="results">
					{#each results as r, i (r.id)}
						<li in:fly={{ y: 8, duration: ms(200), delay: ms(i * 25) }}>
							<button type="button" class="row" onclick={() => actions.pick(r)}>
								{#if r.thumbnail}
									<img
										class="thumb"
										src={r.thumbnail}
										alt=""
										loading="lazy"
										draggable="false"
									/>
								{:else}
									<span class="thumb"></span>
								{/if}
								<span class="row-text">
									<span class="row-title">{r.title}</span>
									<span class="row-sub"
										>{r.channel}{r.duration
											? ` · ${formatDuration(r.duration)}`
											: ""}</span
									>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</section>

<style>
	.music {
		align-self: center;
		width: 100%;
		max-width: min(100%, 52rem);
		box-sizing: border-box;
		/* Clear of the drag strip and the music bar above it. */
		padding: 4.25rem 0.5rem 1rem;
		color: var(--ink);
	}
	/* As wide as a 16:9 picture half the window tall can be, so the
	title and controls always sit above the composer. */
	.player {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		width: min(100%, calc(50dvh * 16 / 9));
		margin: 0 auto;
	}
	.frame {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		padding: 0;
		border: none;
		border-radius: 14px;
		overflow: hidden;
		background: #000;
		cursor: pointer;
		box-shadow: 0 10px 40px rgb(0 0 0 / 0.35);
	}
	.frame video,
	.frame img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.frame video {
		object-fit: contain;
		background: #000;
	}
	.big-play {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(0 0 0 / 0.28);
	}
	.big-play svg {
		width: 4.2rem;
		height: 4.2rem;
		padding: 1rem;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.92);
		fill: #111;
		box-sizing: border-box;
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.35);
		transition: transform 0.15s ease;
	}
	.frame:hover .big-play svg {
		transform: scale(1.06);
	}
	.spinner {
		width: 2.6rem;
		height: 2.6rem;
		border: 3px solid rgb(255 255 255 / 0.35);
		border-top-color: #fff;
		border-radius: 50%;
		animation: music-spin 0.8s linear infinite;
	}
	@keyframes music-spin {
		to {
			rotate: 1turn;
		}
	}
	.names {
		min-width: 0;
	}
	.title {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 650;
		line-height: 1.3;
		text-wrap: balance;
	}
	.sub {
		margin: 0.15rem 0 0;
		color: var(--muted);
		font-size: 0.92rem;
	}
	.sub.error,
	.note.error {
		color: var(--danger, #e5534b);
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.play {
		flex: none;
		display: grid;
		place-items: center;
		width: 2.8rem;
		height: 2.8rem;
		border: none;
		border-radius: 50%;
		background: var(--ink);
		color: var(--bg);
		cursor: pointer;
		transition: transform 0.15s ease;
	}
	.play:hover:not(:disabled) {
		transform: scale(1.05);
	}
	.play:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.play svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.play svg .solid {
		fill: currentColor;
	}
	.clock {
		flex: none;
		min-width: 2.6rem;
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
		text-align: center;
	}
	.seek {
		flex: 1 1 auto;
		min-width: 4rem;
		height: 1.6rem;
		margin: 0;
		background: transparent;
		appearance: none;
		-webkit-appearance: none;
		cursor: pointer;
	}
	.seek::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--accent) var(--fill),
			var(--line-soft) var(--fill)
		);
	}
	.seek::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		margin-top: -5px;
		border-radius: 50%;
		background: var(--ink);
	}
	.seek::-moz-range-track {
		height: 4px;
		border-radius: 999px;
		background: var(--line-soft);
	}
	.seek::-moz-range-progress {
		height: 4px;
		border-radius: 999px;
		background: var(--accent);
	}
	.seek::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border: none;
		border-radius: 50%;
		background: var(--ink);
	}
	.tool {
		flex: none;
		display: grid;
		place-items: center;
		width: 2.3rem;
		height: 2.3rem;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.tool:hover {
		background: var(--hover-wash);
		color: var(--ink);
	}
	.tool.lit {
		color: var(--accent);
	}
	.tool svg,
	.glass {
		width: 1.1rem;
		height: 1.1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.pick {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		max-width: 40rem;
		margin: 0 auto;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.4rem 0.35rem 1rem;
		border: 1px solid var(--line-soft);
		border-radius: 999px;
		background: var(--bg-raised);
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.12);
		transition: border-color 0.15s ease;
	}
	.search:focus-within {
		border-color: var(--accent);
	}
	.glass {
		flex: none;
		color: var(--muted);
	}
	.search input {
		flex: 1 1 auto;
		min-width: 0;
		height: 2.4rem;
		border: none;
		outline: none;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 1rem;
	}
	.note {
		margin: 0;
		padding: 0 1rem;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.results {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		width: 100%;
		padding: 0.45rem;
		border: none;
		border-radius: 12px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}
	.row:hover {
		background: var(--hover-wash);
	}
	.thumb {
		flex: none;
		width: 7rem;
		max-width: 38%;
		aspect-ratio: 16 / 9;
		border-radius: 8px;
		object-fit: cover;
		background: var(--hover-wash);
	}
	.row-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}
	.row-title {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.row-sub {
		color: var(--muted);
		font-size: 0.85rem;
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
