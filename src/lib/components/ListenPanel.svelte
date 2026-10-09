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

	interface Props {
		mode: ListenMode;
		lang: string;
		langName: string;
		channels: ListenChannel[];
	}

	let { mode, lang, langName, channels }: Props = $props();

	let searchBox = $state<HTMLInputElement | null>(null);

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
			mode.query = "";
			mode.results = null;
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
			<img class="thumb" src={v.thumbnail} alt="" loading="lazy" draggable="false" />
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
	<header class="bar">
		<h2>Listen <span class="lang">· {langName}</span></h2>
		<button type="button" class="close" aria-label="Close listening" onclick={() => mode.close()}>×</button>
	</header>

		<div class="search">
			<input
				bind:this={searchBox}
				type="search"
				placeholder={mode.searchKind === "channel" ? "Find a channel" : "Find a video by name or topic"}
				bind:value={mode.query}
				onkeydown={onSearchKey}
				aria-label="Search YouTube"
			/>
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
								<img class="avatar" src={r.thumbnail} alt="" loading="lazy" draggable="false" />
							{:else}
								<span class="avatar"></span>
							{/if}
							<span class="channel-text">
								<span class="channel-name">{r.title}</span>
								<span class="video-meta">
									{#if view?.status === "ready"}
										{channelLabel(mode.channelVideos(r.id), langName) || "no videos"}
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
			<div class="channel">
				<div class="channel-head">
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
				{#each rows as v (v.id)}
					{@render videoRow(v)}
				{/each}
			</div>
		{/each}
</section>

<style>
	.listen-panel {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: calc(100% - 2.4rem);
		max-width: 40rem;
		padding-bottom: 1.5rem;
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
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-size: 1.25rem;
	}
	h2 .lang {
		color: var(--muted);
		font-weight: 500;
	}
	h3 {
		margin: 0.8rem 0 0;
		font-size: 0.8rem;
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
		font-size: 1.3rem;
		line-height: 1;
		cursor: pointer;
		padding: 0.3rem 0.5rem;
		border-radius: 0.4rem;
	}
	.close:hover,
	.remove:hover {
		color: var(--ink);
		background: var(--hover-wash);
	}
	.search {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.search input {
		flex: 1 1 auto;
		min-width: 0;
		font: inherit;
		font-size: 1rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--line-soft);
		border-radius: 0.7rem;
		background: transparent;
		color: var(--ink);
	}
	.search input:focus {
		outline: none;
		border-color: var(--focus);
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
		font-size: 0.85rem;
		padding: 0.5rem 0.8rem;
		min-height: 2.4rem;
		cursor: pointer;
	}
	.kinds button[aria-checked="true"] {
		background: var(--hover-wash);
		color: var(--ink);
	}
	.filter {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.85rem;
		color: var(--muted);
		cursor: pointer;
	}
	.results,
	.channel {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.video,
	.channel-hit {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		color: var(--ink);
		font: inherit;
		padding: 0.45rem 0.4rem;
		border-radius: 0.6rem;
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
		width: 6.4rem;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 0.45rem;
		background: var(--hover-wash);
	}
	.avatar {
		flex: 0 0 auto;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 50%;
		object-fit: cover;
		background: var(--hover-wash);
	}
	.video-text,
	.channel-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
		flex: 1 1 auto;
	}
	.video-title {
		font-size: 0.95rem;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.video-meta {
		font-size: 0.8rem;
		color: var(--muted);
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
		padding-top: 0.35rem;
		border-top: 1px solid var(--line-soft);
	}
	.channel-head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0 0.4rem;
	}
	.channel-name {
		font-weight: 600;
		font-size: 0.95rem;
	}
	.channel-head .remove {
		margin-left: auto;
		font-size: 1.1rem;
	}
	.add {
		flex: 0 0 auto;
		border: 1px solid var(--line-soft);
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: 0.85rem;
		padding: 0.4rem 0.9rem;
		min-height: 2.4rem;
		border-radius: 999px;
		cursor: pointer;
	}
	.add:disabled {
		color: var(--muted);
		cursor: default;
	}
	.quiet {
		margin: 0.2rem 0.4rem;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.error {
		margin: 0;
		padding: 0.5rem 0.8rem;
		border-radius: 0.6rem;
		background: var(--error-bg);
		color: var(--error-ink);
		font-size: 0.9rem;
	}
</style>
