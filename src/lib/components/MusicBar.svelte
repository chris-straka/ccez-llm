<!-- The song playing (or paused): a small pill at the top of the
window, on every screen, so music started in a music chat keeps going and
stays one tap from pause. Play / pause, loop (on by default: a song
plays over and over), and × to stop and forget it. State lives in
`music` (module state), so it outlives every panel. -->
<script lang="ts">
	import { music } from "$lib/music.svelte";
	import { fly } from "svelte/transition";

	interface Props {
		/** The music chat on screen shows this song's full player. */
		hidden?: boolean;
	}

	let { hidden = false }: Props = $props();

	const reduceMotion =
		typeof matchMedia === "function" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches;
</script>

{#if music.song && !hidden}
	{@const song = music.song}
	<div
		class="music-bar"
		class:playing={music.status === "playing"}
		role="region"
		aria-label="Music"
		transition:fly={{ y: -12, duration: reduceMotion ? 0 : 200 }}
	>
		{#if song.thumbnail}
			<img class="art" src={song.thumbnail} alt="" draggable="false" />
		{/if}
		<span class="text">
			<span class="title" title={song.title}>{song.title}</span>
			{#if music.status === "error"}
				<span class="sub error" role="alert">{music.error}</span>
			{:else if music.status === "loading"}
				<span class="sub">Loading…</span>
			{:else if song.channel}
				<span class="sub">{song.channel}</span>
			{/if}
		</span>
		<button
			type="button"
			class="tool"
			aria-label={music.status === "playing" ? "Pause music" : "Play music"}
			title={music.status === "playing" ? "Pause" : "Play"}
			disabled={music.status === "loading"}
			onclick={() => music.toggle()}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true">
				{#if music.status === "playing"}
					<path d="M5 3.5v9M11 3.5v9" />
				{:else}
					<path class="solid" d="M5 3l8 5-8 5z" />
				{/if}
			</svg>
		</button>
		<button
			type="button"
			class="tool"
			class:lit={music.loop}
			aria-label="Loop"
			aria-pressed={music.loop}
			title={music.loop
				? "Looping (tap to play once)"
				: "Play once (tap to loop)"}
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
			aria-label="Stop music"
			title="Stop"
			onclick={() => music.close()}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true"
				><path d="M5 5l6 6M11 5l-6 6" /></svg
			>
		</button>
	</div>
{/if}

<style>
	.music-bar {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 0.5 * var(--u, 1rem));
		left: 50%;
		translate: -50% 0;
		z-index: 40;
		display: flex;
		align-items: center;
		gap: calc(0.35 * var(--u, 1rem));
		max-width: min(
			calc(100vw - 1.5 * var(--u, 1rem)),
			calc(26 * var(--u, 1rem))
		);
		padding: calc(0.3 * var(--u, 1rem)) calc(0.35 * var(--u, 1rem));
		border: 1px solid var(--line-soft);
		border-radius: 999px;
		background: color-mix(in srgb, var(--bg-raised) 88%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		box-shadow: 0 4px 18px rgb(0 0 0 / 0.18);
		color: var(--ink);
		font-size: calc(0.82 * var(--u, 1rem));
	}
	.art {
		flex: none;
		width: calc(2.1 * var(--u, 1rem));
		height: calc(2.1 * var(--u, 1rem));
		border-radius: 50%;
		object-fit: cover;
	}
	.playing .art {
		animation: music-turn 12s linear infinite;
	}
	@keyframes music-turn {
		to {
			rotate: 1turn;
		}
	}
	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		padding-inline: calc(0.2 * var(--u, 1rem));
		line-height: 1.25;
	}
	.title,
	.sub {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.title {
		font-weight: 600;
	}
	.sub {
		font-size: 0.88em;
		color: var(--muted);
	}
	.sub.error {
		color: var(--danger, #e5534b);
	}
	.tool {
		flex: none;
		display: grid;
		place-items: center;
		width: calc(2 * var(--u, 1rem));
		height: calc(2 * var(--u, 1rem));
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.tool:hover:not(:disabled) {
		background: var(--hover-wash);
		color: var(--ink);
	}
	.tool:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.tool.lit {
		color: var(--accent);
	}
	.tool svg {
		width: calc(1 * var(--u, 1rem));
		height: calc(1 * var(--u, 1rem));
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.tool svg .solid {
		fill: currentColor;
	}
	@media (prefers-reduced-motion: reduce) {
		.playing .art {
			animation: none;
		}
	}
</style>
