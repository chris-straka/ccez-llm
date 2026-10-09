<!-- Listening drill browse screen (empty chats): the learner's own
channels with their recent videos, YouTube search for channels and
videos with a "has audio in my language" filter, and one tap to add a
channel or start a video. State lives in `ListenMode`. -->
<script lang="ts">
	import {
		availabilityLabel,
		channelLabel,
		drillable,
		formatDuration,
		type ListenChannel,
		type ListenEntry
	} from "$lib/listen";
	import type { ListenMode } from "$lib/listen-mode.svelte";
	import { slide } from "svelte/transition";

	interface Props {
		mode: ListenMode;
		lang: string;
		langName: string;
		channels: ListenChannel[];
		/** ×: back to the welcome screen (same as the news panel's). */
		onClose: () => void;
	}

	let { mode, lang, langName, channels, onClose }: Props = $props();

	let searchBox = $state<HTMLInputElement | null>(null);
	const reduceMotion =
		typeof matchMedia === "function" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches;

	/** Videos of a channel row worth showing: drillable first, three. */
	function channelRows(url: string): ListenEntry[] {
		const page = mode.channelViews.get(url)?.page;
		if (!page) return [];
		return page.videos
			.filter((v) => drillable(mode.videoInfo(v.id, lang)))
			.slice(0, 3);
	}

	function onSearchKey(event: KeyboardEvent): void {
		if (event.key === "Enter") {
			event.preventDefault();
			void mode.search();
		} else if (event.key === "Escape" && mode.query) {
			event.preventDefault();
			event.stopPropagation();
			mode.setQuery("");
		}
	}

	function setKind(kind: "video" | "channel"): void {
		if (mode.searchKind === kind) return;
		mode.searchKind = kind;
		mode.results = null;
		if (mode.query.trim()) void mode.search();
		searchBox?.focus();
	}
</script>

{#snippet videoRow(v: ListenEntry)}
	{@const info = mode.videoInfo(v.id, lang)}
	{@const probing = mode.probing.has(`${lang}|${v.id}`)}
	{@const ok = drillable(info)}
	<button
		type="button"
		class="video"
		class:unavailable={info !== undefined && !ok}
		disabled={(info !== undefined && !ok) || mode.starting !== null}
		onclick={() => void mode.start(v.id)}
	>
		{#if v.thumbnail}
			<img
				class="thumb"
				src={v.thumbnail}
				alt=""
				loading="lazy"
				draggable="false"
			/>
		{:else}
			<span class="thumb"></span>
		{/if}
		<span class="video-text">
			<span class="video-title">{v.title}</span>
			<span class="video-meta">
				{v.channel}{v.duration ? ` · ${formatDuration(v.duration)}` : ""}
				{#if mode.starting === v.id}
					· <span class="busy">Loading…</span>
				{:else if info}
					· <span class:avail={ok}>{availabilityLabel(info, langName)}</span>
				{:else if probing}
					· <span class="busy">checking…</span>
				{/if}
			</span>
		</span>
	</button>
{/snippet}

<section class="listen-panel" aria-label="Listen">
	<div class="search">
		<span class="box">
			<input
				bind:this={searchBox}
				type="search"
				placeholder={mode.searchKind === "channel"
					? "Find a channel"
					: "Find a video by name or topic"}
				bind:value={() => mode.query, (v: string) => mode.setQuery(v)}
				onkeydown={onSearchKey}
				aria-label="Search YouTube"
			/>
			{#if mode.query}
				<button
					type="button"
					class="clear"
					aria-label="Clear search"
					title="Clear (Esc)"
					onclick={() => {
						mode.setQuery("");
						searchBox?.focus();
					}}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"
						><path d="M5 5l6 6M11 5l-6 6" /></svg
					>
				</button>
			{/if}
		</span>
		<div class="kinds" role="radiogroup" aria-label="Search for">
			<button
				type="button"
				role="radio"
				aria-checked={mode.searchKind === "video"}
				onclick={() => setKind("video")}>Videos</button
			>
			<button
				type="button"
				role="radio"
				aria-checked={mode.searchKind === "channel"}
				onclick={() => setKind("channel")}>Channels</button
			>
		</div>
		<button
			type="button"
			class="close search-close"
			aria-label="Close"
			onclick={onClose}>×</button
		>
	</div>
	<label class="filter">
		<input type="checkbox" bind:checked={mode.onlyAvailable} />
		Only with {langName} audio
	</label>

	{#if mode.error}
		<p class="error" role="alert">{mode.error}</p>
	{/if}

	{#if mode.searching}
		<p class="quiet">Searching…</p>
	{:else if mode.results}
		<div class="results">
			{#each mode.shownResults() as r (r.id)}
				{#if r.kind === "video"}
					{@render videoRow(r)}
				{:else}
					{@const view = mode.channelViews.get(r.id)}
					<div class="channel-hit">
						{#if r.thumbnail}
							<img
								class="avatar"
								src={r.thumbnail}
								alt=""
								loading="lazy"
								draggable="false"
							/>
						{:else}
							<span class="avatar"></span>
						{/if}
						<span class="channel-text">
							<span class="channel-name">{r.title}</span>
							<span class="video-meta">
								{#if view?.status === "ready"}
									{channelLabel(mode.channelVideos(r.id), langName) ||
										"no videos"}
								{:else if view?.status === "error"}
									{view.error}
								{:else}
									<span class="busy">checking…</span>
								{/if}
							</span>
						</span>
						<button
							type="button"
							class="add"
							disabled={mode.hasChannel(r.id)}
							onclick={() => mode.addChannel({ url: r.id, name: r.title })}
						>
							{mode.hasChannel(r.id) ? "Added" : "Add"}
						</button>
					</div>
				{/if}
			{:else}
				<p class="quiet">Nothing with {langName} audio there.</p>
			{/each}
		</div>
	{/if}

	<h3>Your channels</h3>
	{#if channels.length === 0}
		<p class="quiet">Search for a channel you watch, then add it here.</p>
	{/if}
	{#each channels as c (c.url)}
		{@const view = mode.channelViews.get(c.url)}
		{@const rows = channelRows(c.url)}
		<div
			class="channel"
			role="group"
			aria-label={c.name}
			onmouseenter={() => (mode.hoveredChannel = c.url)}
			onmouseleave={() => {
				if (mode.hoveredChannel === c.url) mode.hoveredChannel = null;
			}}
		>
			<div class="channel-head">
				<button
					type="button"
					class="fold"
					aria-expanded={!c.folded}
					aria-label={c.folded
						? `Show ${c.name}'s videos`
						: `Fold ${c.name}'s videos`}
					title="Fold (F)"
					onclick={() => mode.toggleFold(c.url)}
				>
					<svg class:open={!c.folded} viewBox="0 0 16 16" aria-hidden="true"
						><path d="M6 4l4 4-4 4" /></svg
					>
				</button>
				<span class="channel-name">{view?.page?.name ?? c.name}</span>
				<span class="video-meta">
					{#if view?.status === "ready"}
						{channelLabel(mode.channelVideos(c.url), langName)}
					{:else if view?.status === "error"}
						{view.error}
					{:else}
						<span class="busy">checking…</span>
					{/if}
				</span>
				<button
					type="button"
					class="remove"
					aria-label={`Remove ${c.name}`}
					title="Remove from your channels"
					onclick={() => mode.removeChannel(c.url)}>×</button
				>
			</div>
			{#if !c.folded}
				<div
					class="channel-videos"
					transition:slide={{ duration: reduceMotion ? 0 : 180 }}
				>
					{#each rows as v (v.id)}
						{@render videoRow(v)}
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</section>

<style>
	.listen-panel {
		/* Controls stay put at any text size (--u, a fixed 1rem), as in
		the News panel. Only reading text (titles, meta, channel names)
		rides --t (scaled with --font-scale) and ends in an ellipsis
		where it runs out of room. */
		--u: 1rem;
		--t: calc(1rem * var(--font-scale, 1));
		font-size: var(--u);
		display: flex;
		flex-direction: column;
		gap: calc(0.6 * var(--u, 1rem));
		width: calc(100% - calc(2.4 * var(--u, 1rem)));
		max-width: calc(40 * var(--u, 1rem));
		padding-bottom: calc(1.5 * var(--u, 1rem));
		user-select: none;
		-webkit-user-select: none;
		animation: listen-in 0.22s ease both;
	}
	@keyframes listen-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.listen-panel {
			animation: none;
		}
	}
	h3 {
		margin: calc(0.8 * var(--u, 1rem)) 0 0;
		font-size: calc(0.8 * var(--u, 1rem));
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.close,
	.remove {
		border: none;
		background: transparent;
		color: var(--muted);
		font-size: calc(1.3 * var(--u, 1rem));
		line-height: 1;
		cursor: pointer;
		padding: calc(0.3 * var(--u, 1rem)) calc(0.5 * var(--u, 1rem));
		border-radius: calc(0.4 * var(--u, 1rem));
	}
	.search-close {
		margin-left: auto;
	}
	.close:hover,
	.remove:hover {
		color: var(--ink);
		background: var(--hover-wash);
	}
	/* Phones: the box takes the row, the switch and × wrap below. */
	.search {
		display: flex;
		flex-wrap: wrap;
		gap: calc(0.5 * var(--u, 1rem));
		align-items: center;
	}
	/* The box and its clear button: a small round × inside the field's
	right edge, unlike the panel's close × which sits apart. */
	.box {
		position: relative;
		flex: 1 1 calc(15 * var(--u, 1rem));
		min-width: 0;
		display: flex;
	}
	.search input {
		flex: 1 1 auto;
		min-width: 0;
		font: inherit;
		font-size: calc(1 * var(--u, 1rem));
		padding: calc(0.6 * var(--u, 1rem)) calc(2.4 * var(--u, 1rem))
			calc(0.6 * var(--u, 1rem)) calc(0.8 * var(--u, 1rem));
		border: 1px solid var(--line-soft);
		border-radius: calc(0.7 * var(--u, 1rem));
		background: transparent;
		color: var(--ink);
	}
	.search input:focus {
		outline: none;
		border-color: var(--focus);
	}
	.search input::-webkit-search-cancel-button {
		-webkit-appearance: none;
		appearance: none;
	}
	.clear {
		position: absolute;
		right: calc(0.55 * var(--u, 1rem));
		top: 50%;
		transform: translateY(-50%);
		width: calc(1.4 * var(--u, 1rem));
		height: calc(1.4 * var(--u, 1rem));
		display: grid;
		place-items: center;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: var(--line-soft);
		color: var(--ink);
		cursor: pointer;
		animation: clear-in 0.12s ease;
	}
	.clear:hover {
		background: var(--line);
	}
	.clear svg {
		width: calc(0.7 * var(--u, 1rem));
		height: calc(0.7 * var(--u, 1rem));
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}
	@keyframes clear-in {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.clear {
			animation: none;
		}
	}
	.kinds {
		display: flex;
		border: 1px solid var(--line-soft);
		border-radius: 999px;
		overflow: hidden;
		flex: 0 0 auto;
	}
	.kinds button {
		border: none;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: calc(0.85 * var(--u, 1rem));
		padding: calc(0.5 * var(--u, 1rem)) calc(0.8 * var(--u, 1rem));
		min-height: calc(2.4 * var(--u, 1rem));
		cursor: pointer;
	}
	.kinds button[aria-checked="true"] {
		background: var(--hover-wash);
		color: var(--ink);
	}
	.filter {
		display: flex;
		align-items: center;
		gap: calc(0.45 * var(--u, 1rem));
		font-size: calc(0.85 * var(--u, 1rem));
		color: var(--muted);
		cursor: pointer;
	}
	.results,
	.channel {
		display: flex;
		flex-direction: column;
		gap: calc(0.15 * var(--u, 1rem));
	}
	.video,
	.channel-hit {
		display: flex;
		align-items: center;
		gap: calc(0.7 * var(--u, 1rem));
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		color: var(--ink);
		font: inherit;
		padding: calc(0.45 * var(--u, 1rem)) calc(0.4 * var(--u, 1rem));
		border-radius: calc(0.6 * var(--u, 1rem));
		transition: background-color 0.15s ease;
	}
	.video {
		cursor: pointer;
	}
	.video:hover:not(:disabled) {
		background: var(--hover-wash);
	}
	.video:disabled {
		cursor: default;
	}
	.video.unavailable {
		opacity: 0.55;
	}
	.thumb {
		flex: 0 0 auto;
		width: calc(6.4 * var(--u, 1rem));
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: calc(0.45 * var(--u, 1rem));
		background: var(--hover-wash);
	}
	.avatar {
		flex: 0 0 auto;
		width: calc(2.6 * var(--u, 1rem));
		height: calc(2.6 * var(--u, 1rem));
		border-radius: 50%;
		object-fit: cover;
		background: var(--hover-wash);
	}
	.video-text,
	.channel-text {
		display: flex;
		flex-direction: column;
		gap: calc(0.15 * var(--u, 1rem));
		min-width: 0;
		flex: 1 1 auto;
	}
	.video-title {
		font-size: calc(0.95 * var(--t, 1rem));
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.video-meta {
		font-size: calc(0.8 * var(--t, 1rem));
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.avail {
		color: var(--ok);
	}
	.busy {
		animation: listen-pulse 1.4s ease-in-out infinite;
	}
	@keyframes listen-pulse {
		50% {
			opacity: 0.4;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.busy {
			animation: none;
		}
	}
	.channel {
		padding-top: calc(0.35 * var(--u, 1rem));
		border-top: 1px solid var(--line-soft);
	}
	.channel-head {
		display: flex;
		align-items: baseline;
		gap: calc(0.6 * var(--u, 1rem));
		padding: 0 calc(0.4 * var(--u, 1rem));
	}
	.channel-name {
		font-weight: 600;
		font-size: calc(0.95 * var(--t, 1rem));
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.fold {
		align-self: center;
		display: grid;
		place-items: center;
		border: none;
		background: transparent;
		color: var(--muted);
		padding: calc(0.2 * var(--u, 1rem));
		margin-left: -0.2rem;
		border-radius: calc(0.3 * var(--u, 1rem));
		cursor: pointer;
	}
	.fold:hover {
		color: var(--ink);
		background: var(--hover-wash);
	}
	.fold svg {
		width: calc(0.8 * var(--u, 1rem));
		height: calc(0.8 * var(--u, 1rem));
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: transform 0.15s ease;
	}
	.fold svg.open {
		transform: rotate(90deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.fold svg {
			transition: none;
		}
	}
	.channel-head .remove {
		margin-left: auto;
		font-size: calc(1.1 * var(--u, 1rem));
	}
	.add {
		flex: 0 0 auto;
		border: 1px solid var(--line-soft);
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: calc(0.85 * var(--u, 1rem));
		padding: calc(0.4 * var(--u, 1rem)) calc(0.9 * var(--u, 1rem));
		min-height: calc(2.4 * var(--u, 1rem));
		border-radius: 999px;
		cursor: pointer;
	}
	.add:disabled {
		color: var(--muted);
		cursor: default;
	}
	.quiet {
		margin: calc(0.2 * var(--u, 1rem)) calc(0.4 * var(--u, 1rem));
		color: var(--muted);
		font-size: calc(0.9 * var(--u, 1rem));
	}
	.error {
		margin: 0;
		padding: calc(0.5 * var(--u, 1rem)) calc(0.8 * var(--u, 1rem));
		border-radius: calc(0.6 * var(--u, 1rem));
		background: var(--error-bg);
		color: var(--error-ink);
		font-size: calc(0.9 * var(--u, 1rem));
	}
</style>
