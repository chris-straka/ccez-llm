<!-- Learner news panel: region chips plus story cards under the hero
language pills. The page owns the panel state (fetch, region,
picker, launch); this component owns the cards markup and their
surfaces. Emoji buttons are the user's explicit call (no text on
either); everything else is theme tokens, never raw hex. -->
<script lang="ts">
	import { slide, fly, fade } from "svelte/transition";
	import {
		CEFR_LEVELS,
		SUMMARY_SIZES,
		newsCardPressOpensMenu,
		type CefrLevel,
		type NewsKind,
		type NewsPanelState,
		type NewsPicker,
		type SummarySize
	} from "$lib/news";

	interface Props {
		panel: NewsPanelState;
		picker: NewsPicker | null;
		busy: string | null;
		images: Record<string, string | null>;
		actions: {
			region: (gl: string) => void;
			menu: (link: string) => void;
			level: (link: string, level: CefrLevel) => void;
			size: (link: string, size: SummarySize) => void;
			launch: (link: string, kind: NewsKind) => void;
			close: () => void;
			retry: () => void;
		};
	}

	let { panel, picker, busy, images, actions }: Props = $props();
	const activeRegion = $derived(panel.regions.find((r) => r.gl === panel.region));
	// Hotlink-dead images fall back to the outlet initial (same box);
	// removing the node left a bare gap instead of a tile.
	let broken = $state<Record<string, boolean>>({});
	// Press-down point (one press at a time component-wide): a
	// drag-release ending on a card belongs to text selection.
	let downAt: { x: number; y: number } | null = null;
	/** Live headline selection inside a card owns the press. */
	function cardSelected(card: HTMLElement): boolean {
		const live = window.getSelection();
		return !!live && !live.isCollapsed && card.contains(live.anchorNode);
	}
	const reduceMotion =
		typeof matchMedia !== "undefined" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches;
	const motionMs = (ms: number): number => (reduceMotion ? 0 : ms);
</script>

<div class="news-panel" role="region" aria-label="{panel.langName} news">
	<div class="news-head">
		<span class="news-title">📰 {panel.langName} news</span>
		<button
			type="button"
			class="news-x"
			aria-label="Close news"
			onclick={() => actions.close()}
		>
			✕
		</button>
	</div>
	{#if panel.regions.length > 1 && panel.status !== "unsupported" && panel.status !== "needs-shell"}
		<div class="news-chips" role="group" aria-label="News region">
			{#each panel.regions as region, i (region.gl)}
				{#if i > 0 && !!region.translate !== !!panel.regions[i - 1]?.translate}
					<span class="news-sep" aria-hidden="true"></span>
				{/if}
				<button
					type="button"
					class="news-chip"
					class:on={panel.region === region.gl}
					class:icon={!!region.icon}
					aria-pressed={panel.region === region.gl}
					aria-label={region.label}
					title={region.label}
					onclick={() => actions.region(region.gl)}
					in:fly={{ y: 8, duration: motionMs(200), delay: motionMs(i * 30) }}
				>
					{region.icon ?? region.label}
				</button>
			{/each}
		</div>
	{/if}
	{#if activeRegion?.translate && panel.status === "ready"}
		<p class="news-note">Translated from {activeRegion.label} headlines.</p>
	{/if}
	{#if panel.status === "loading"}
		<p class="news-note" in:fade={{ duration: motionMs(150) }}>
			Fetching {panel.langName} headlines…
		</p>
	{:else if panel.status === "translating"}
		<p class="news-note" in:fade={{ duration: motionMs(150) }}>
			Translating headlines into {panel.langName}…
		</p>
	{:else if panel.status === "error"}
		<p class="news-note" role="alert">{panel.error}</p>
		<button type="button" class="news-retry" onclick={() => actions.retry()}>
			Retry
		</button>
	{:else if panel.status === "unsupported"}
		<p class="news-note">Google News has no {panel.langName} edition yet.</p>
	{:else if panel.status === "needs-shell"}
		<p class="news-note">
			News needs the app shell — the browser preview can't reach it.
		</p>
	{:else if panel.stories.length === 0}
		<p class="news-note">No stories right now.</p>
		<button type="button" class="news-retry" onclick={() => actions.retry()}>
			Retry
		</button>
	{:else}
		<ul class="news-cards">
			{#each panel.stories as story, i (story.link)}
				{@const open = picker?.link === story.link}
				{@const resolved = story.image ?? images[story.link] ?? undefined}
				<li
					class="news-card"
					class:open
					in:fly={{ y: 14, duration: motionMs(260), delay: motionMs(Math.min(i * 45, 400)) }}
				>
					<div
						role="button"
						tabindex="0"
						class="news-open"
						aria-label="{story.title} — options"
						aria-expanded={open}
						data-story-link={story.link}
						onpointerdown={(e) => {
							downAt = { x: e.clientX, y: e.clientY };
						}}
						onkeydown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								actions.menu(story.link);
							}
						}}
						onclick={(e) => {
							// Keyboard clicks (detail 0) never dragged: a
							// stale down-point must not eat the menu.
							const dragged =
								downAt && e.detail > 0
									? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
									: 0;
							downAt = null;
							if (
								newsCardPressOpensMenu({
									draggedPx: dragged,
									headlineSelected: cardSelected(e.currentTarget)
								})
							)
								actions.menu(story.link);
						}}
						oncontextmenu={(e) => {
							// A standing selection owns long-press and
							// right-click (the page summons or speaks);
							// plain presses open the card menu as before.
							if (cardSelected(e.currentTarget)) return;
							e.preventDefault();
							actions.menu(story.link);
						}}
					>
						{#if resolved && !broken[story.link]}
							<img
								class="news-img"
								src={resolved}
								alt=""
								loading="lazy"
								draggable="false"
								onerror={() => {
									broken[story.link] = true;
								}}
								in:fade={{ duration: motionMs(250) }}
							/>
						{:else if !story.image && images[story.link] === undefined}
							<span class="news-skel" aria-hidden="true"></span>
						{:else}
							<span
								class="news-img-fallback"
								aria-hidden="true"
								in:fade={{ duration: motionMs(250) }}
								>{story.source.trim().charAt(0)}</span
							>
						{/if}
						<span class="news-card-title">{story.title}</span>
						{#if story.source}
							<span class="news-card-source">{story.source}</span>
						{/if}
						<span class="news-hint" aria-hidden="true">⋯</span>
					</div>
					{#if busy === story.link}
						<span class="news-busy" role="status">Fetching the article…</span>
					{/if}
					{#if open && busy === null}
						<div
							class="news-menu"
							role="group"
							aria-label="Story options"
							transition:slide={{ duration: motionMs(200) }}
						>
							<div
								class="news-launch"
								in:fly={{ y: 10, duration: motionMs(220), delay: motionMs(60) }}
							>
								<button
									type="button"
									class="news-go"
									aria-label="Discuss this story"
									title="Discuss with two locals"
									onclick={() => actions.launch(story.link, "talk")}
								>
									🗣️
								</button>
								<button
									type="button"
									class="news-go"
									aria-label="Summarize this story"
									title="Summarize at this level and length"
									onclick={() => actions.launch(story.link, "read")}
								>
									📰
								</button>
							</div>
							<div
								class="news-pick"
								role="group"
								aria-label="Level"
								in:fly={{ y: 10, duration: motionMs(220), delay: motionMs(130) }}
							>
								{#each CEFR_LEVELS as level (level.level)}
									<button
										type="button"
										class="news-opt"
										class:on={(picker?.level ?? "B2") === level.level}
										aria-pressed={(picker?.level ?? "B2") === level.level}
										title={level.tag}
										onclick={() => actions.level(story.link, level.level)}
									>
										{level.level}
									</button>
								{/each}
							</div>
							<div
								class="news-pick"
								role="group"
								aria-label="Summary length"
								in:fly={{ y: 10, duration: motionMs(220), delay: motionMs(200) }}
							>
								{#each SUMMARY_SIZES as size (size.size)}
									<button
										type="button"
										class="news-opt"
										class:on={(picker?.size ?? "medium") === size.size}
										aria-pressed={(picker?.size ?? "medium") === size.size}
										title="About {size.words} words"
										onclick={() => actions.size(story.link, size.size)}
									>
										{size.label}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.news-panel {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: calc(100% - 2.4rem);
		max-width: calc(var(--chat-width, 36) * 1rem);
		padding-bottom: 1rem;
	}
	.news-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.news-title {
		font-size: 1rem;
		font-weight: 650;
		color: #1c1c1e;
		color: var(--ink);
	}
	.news-x {
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		background: transparent;
		color: #6e6e73;
		color: var(--muted);
		border-radius: 999px;
		min-width: 2.75rem;
		min-height: 2.75rem;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}
	.news-chips {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		padding-bottom: 0.25rem;
		scrollbar-width: thin;
	}
	.news-sep {
		flex: 0 0 auto;
		width: 1px;
		align-self: stretch;
		margin: 0.35rem 0.2rem;
		background: #e5e5ea;
		background: var(--line-soft);
	}
	.news-chip {
		flex: 0 0 auto;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		background: transparent;
		color: #1c1c1e;
		color: var(--ink);
		border-radius: 999px;
		padding: 0.45rem 0.8rem;
		font-size: 0.85rem;
		min-height: 2.75rem;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.news-chip.on {
		background: #007aff;
		background: var(--accent);
		border-color: #007aff;
		border-color: var(--accent);
		color: #fff;
		color: var(--accent-ink);
		font-weight: 650;
	}
	.news-chip.icon {
		font-size: 1.15rem;
		line-height: 1;
		padding: 0.45rem 0.7rem;
	}
	.news-note {
		margin: 0;
		color: #6e6e73;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.news-retry {
		align-self: flex-start;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		background: transparent;
		color: #1c1c1e;
		color: var(--ink);
		border-radius: 0.6rem;
		padding: 0.45rem 0.9rem;
		font-size: 0.85rem;
		min-height: 2.75rem;
		cursor: pointer;
	}
	.news-cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
		align-items: start;
		gap: 0.6rem;
	}
	.news-img {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 0.5rem;
		background: #e5e5ea;
		background: var(--line-soft);
	}
	.news-skel,
	.news-img-fallback {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 0.5rem;
		background: #e5e5ea;
		background: var(--line-soft);
	}
	.news-img-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		color: #6e6e73;
		color: var(--muted);
		font-size: 2rem;
		font-weight: 700;
	}
	@media (prefers-reduced-motion: no-preference) {
		.news-skel {
			animation: news-pulse 1.6s ease-in-out infinite;
		}
		@keyframes news-pulse {
			50% {
				opacity: 0.55;
			}
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.news-panel *,
		.news-panel *::before,
		.news-panel *::after {
			animation: none !important;
			transition: none !important;
		}
	}
	.news-card {
		background: #fff;
		background: var(--bg-raised);
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 0.8rem;
		padding: 0.7rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.news-card-title {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		line-height: 1.35;
		color: #1c1c1e;
		color: var(--ink);
		transition: color 0.15s ease;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		/* Short titles pad up: every card holds three lines. */
		min-height: 4.05em;
	}
	.news-card-source {
		margin: 0;
		max-width: 100%;
		font-size: 0.78rem;
		color: #6e6e73;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.news-open {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.news-open:focus-visible,
	.news-go:focus-visible,
	.news-opt:focus-visible {
		outline: 2px solid #007aff;
		outline-color: var(--accent);
		outline-offset: 2px;
	}
	.news-open:hover .news-card-title,
	.news-open:focus-visible .news-card-title {
		color: #007aff;
		color: var(--accent);
	}
	.news-hint {
		position: absolute;
		right: 0;
		bottom: 0;
		padding-left: 0.4rem;
		background: #fff;
		background: var(--bg-raised);
		font-size: 0.85rem;
		line-height: 1.4;
		opacity: 0;
		transform: translateY(4px);
		transition:
			opacity 0.15s ease,
			transform 0.15s ease;
	}
	.news-open:hover .news-hint,
	.news-open:focus-visible .news-hint {
		opacity: 1;
		transform: none;
	}
	.news-card.open .news-hint {
		display: none;
	}
	@media (hover: none) {
		.news-hint {
			display: none;
		}
	}
	.news-menu {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.news-launch {
		display: flex;
		gap: 0.35rem;
	}
	.news-go {
		flex: 1;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		background: transparent;
		border-radius: 0.6rem;
		font-size: 1.3rem;
		line-height: 1;
		min-height: 2.75rem;
		cursor: pointer;
		transition:
			transform 0.1s ease,
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.news-go:active {
		transform: scale(0.96);
	}
	.news-busy {
		font-size: 0.8rem;
		color: #6e6e73;
		color: var(--muted);
	}
	.news-pick {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.news-pick > .news-opt {
		flex: 1 1 auto;
	}
	.news-opt {
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		background: transparent;
		color: #1c1c1e;
		color: var(--ink);
		border-radius: 0.55rem;
		padding: 0.4rem 0.5rem;
		font-size: 0.8rem;
		font-weight: 600;
		min-height: 2.75rem;
		text-align: center;
		white-space: nowrap;
		cursor: pointer;
		transition:
			transform 0.1s ease,
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.news-opt:active {
		transform: scale(0.96);
	}
	.news-opt.on {
		background: #007aff;
		background: var(--accent);
		border-color: #007aff;
		border-color: var(--accent);
		color: #fff;
		color: var(--accent-ink);
	}
</style>
