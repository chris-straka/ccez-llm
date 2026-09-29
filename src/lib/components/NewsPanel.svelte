<!-- Learner news panel: region chips plus story cards under the hero
language pills. The page owns the panel state (fetch, region,
picker, launch); this component owns the cards markup and their
surfaces. Emoji buttons are the user's explicit call (no text on
either); everything else is theme tokens, never raw hex. -->
<script lang="ts">
	import {
		CEFR_LEVELS,
		SUMMARY_SIZES,
		type CefrLevel,
		type NewsKind,
		type NewsPanelState,
		type NewsPicker
	} from "$lib/news";

	interface Props {
		panel: NewsPanelState;
		picker: NewsPicker | null;
		busy: string | null;
		actions: {
			region: (gl: string) => void;
			toggle: (link: string, kind: NewsKind) => void;
			pick: (link: string, kind: NewsKind, value: string) => void;
			level: (link: string, level: CefrLevel) => void;
			close: () => void;
			retry: () => void;
		};
	}

	let { panel, picker, busy, actions }: Props = $props();
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
	{#if panel.fallback}
		<p class="news-note">
			No {panel.langName} edition yet — showing {panel.regions[0]?.label ??
				"global"} headlines in English; sessions run in {panel.langName}.
		</p>
	{/if}
	{#if panel.regions.length > 1 && panel.status !== "unsupported" && panel.status !== "needs-shell"}
		<div class="news-chips" role="group" aria-label="News region">
			{#each panel.regions as region (region.gl)}
				<button
					type="button"
					class="news-chip"
					class:on={panel.region === region.gl}
					aria-pressed={panel.region === region.gl}
					onclick={() => actions.region(region.gl)}
				>
					{region.label}
				</button>
			{/each}
		</div>
	{/if}
	{#if panel.status === "loading"}
		<p class="news-note">Fetching {panel.langName} headlines…</p>
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
			{#each panel.stories as story (story.link)}
				<li class="news-card">
					<p class="news-card-title">{story.title}</p>
					{#if story.source}
						<p class="news-card-source">{story.source}</p>
					{/if}
					<div class="news-card-btns">
						<button
							type="button"
							class="news-btn"
							class:open={picker?.link === story.link && picker?.kind === "talk"}
							aria-label="Discuss this story"
							title="Discuss with two locals (pick a level)"
							aria-expanded={picker?.link === story.link &&
								picker?.kind === "talk"}
							disabled={busy !== null}
							onclick={() => actions.toggle(story.link, "talk")}
						>
							🗣️
						</button>
						<button
							type="button"
							class="news-btn"
							class:open={picker?.link === story.link && picker?.kind === "read"}
							aria-label="Summarize this story"
							title="Summarize (pick a length)"
							aria-expanded={picker?.link === story.link &&
								picker?.kind === "read"}
							disabled={busy !== null}
							onclick={() => actions.toggle(story.link, "read")}
						>
							📰
						</button>
						{#if busy === story.link}
							<span class="news-busy" role="status">Fetching the article…</span>
						{/if}
					</div>
					{#if picker?.link === story.link && picker?.kind === "talk" && busy === null}
						<div class="news-pick" role="group" aria-label="Conversation level">
							{#each CEFR_LEVELS as level (level.level)}
								<button
									type="button"
									class="news-opt"
									title={level.tag}
									onclick={() => actions.pick(story.link, "talk", level.level)}
								>
									{level.level}
								</button>
							{/each}
						</div>
					{/if}
					{#if picker?.link === story.link && picker?.kind === "read" && busy === null}
						<div class="news-pick" role="group" aria-label="Summary level">
							{#each CEFR_LEVELS as level (level.level)}
								<button
									type="button"
									class="news-opt"
									class:on={(picker.level ?? "B2") === level.level}
									aria-pressed={(picker.level ?? "B2") === level.level}
									title={level.tag}
									onclick={() => actions.level(story.link, level.level)}
								>
									{level.level}
								</button>
							{/each}
						</div>
						<div class="news-pick" role="group" aria-label="Summary length">
							{#each SUMMARY_SIZES as size (size.size)}
								<button
									type="button"
									class="news-opt"
									title="About {size.words} words"
									onclick={() => actions.pick(story.link, "read", size.size)}
								>
									{size.label}
								</button>
							{/each}
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
		gap: 0.6rem;
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
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.news-card-source {
		margin: 0;
		font-size: 0.78rem;
		color: #6e6e73;
		color: var(--muted);
	}
	.news-card-btns {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.news-btn {
		border: 1px solid transparent;
		background: transparent;
		border-radius: 0.6rem;
		font-size: 1.3rem;
		line-height: 1;
		min-width: 2.75rem;
		min-height: 2.75rem;
		cursor: pointer;
	}
	.news-btn.open {
		border-color: #007aff;
		border-color: var(--accent);
	}
	.news-btn:disabled {
		opacity: 0.45;
		cursor: default;
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
	.news-opt {
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		background: transparent;
		color: #1c1c1e;
		color: var(--ink);
		border-radius: 0.55rem;
		padding: 0.4rem 0.7rem;
		font-size: 0.85rem;
		font-weight: 600;
		min-height: 2.75rem;
		cursor: pointer;
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
