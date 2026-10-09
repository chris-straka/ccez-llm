<!-- Learner news panel: region chips plus story cards under the hero
language pills. The page owns the panel state (fetch, region,
staged story, launch); this component owns the markup, the card
pick animation, and the surfaces. A picked card flies into the
chat as the staged article, and the session choices show under
it. Session start buttons are emoji-only by the owner's call;
everything else is theme tokens, never raw hex. -->
<script lang="ts">
	import { fly, fade } from "svelte/transition";
	import { replyLanguageFor } from "$lib/languages";
	import {
		CEFR_LEVELS,
		SUMMARY_SIZES,
		sessionWords,
		type CefrLevel,
		type NewsKind,
		type NewsPanelState,
		type NewsStaged,
		type NewsStory,
		type SummarySize
	} from "$lib/news";

	interface Props {
		panel: NewsPanelState;
		staged: NewsStaged | null;
		busy: string | null;
		images: Record<string, string | null>;
		actions: {
			region: (gl: string) => void;
			pick: (link: string) => void;
			unpick: () => void;
			kind: (kind: NewsKind) => void;
			level: (level: CefrLevel) => void;
			size: (size: SummarySize) => void;
			launch: () => void;
			close: () => void;
			retry: () => void;
		};
	}

	let { panel, staged, busy, images, actions }: Props = $props();

	const lang = $derived(replyLanguageFor(panel.code));
	const activeRegion = $derived(
		panel.regions.find((r) => r.gl === panel.region)
	);
	const stagedStory = $derived(
		staged ? (panel.stories.find((s) => s.link === staged.link) ?? null) : null
	);
	/** Plain status words under the chips; one line, always there,
	 * so nothing below it moves when the words change. */
	const status = $derived.by(() => {
		const from = activeRegion?.label ?? "";
		if (panel.status === "loading") return "Getting today's headlines…";
		if (panel.status === "translating")
			return `Translating ${panel.stories.length} ${from} headlines into ${panel.langName}…`;
		if (panel.status === "ready" && activeRegion?.translate)
			return `Translated from ${from} headlines`;
		if (panel.status === "ready") return `Top stories · ${from}`;
		return "";
	});
	/** Cards the loading grid reserves (no jump when stories land). */
	const SKELETONS = 8;

	// Hotlink-dead images fall back to the outlet initial (same box).
	let broken = $state<Record<string, boolean>>({});
	let loaded = $state<Record<string, boolean>>({});
	const reduceMotion =
		typeof matchMedia !== "undefined" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches;
	const motionMs = (ms: number): number => (reduceMotion ? 0 : ms);

	function imageFor(story: NewsStory): string | null | undefined {
		if (broken[story.link]) return null;
		return story.image ?? images[story.link];
	}

	/* Pick choreography: the other cards fade, then the picked one
	flies from its grid slot into the chat (FLIP on transform only,
	no layout animation). */
	let leaving = $state<string | null>(null);
	let flipFrom: DOMRect | null = null;
	function pickCard(event: MouseEvent, story: NewsStory): void {
		if (panel.status !== "ready" || leaving || busy) return;
		flipFrom = (event.currentTarget as HTMLElement).getBoundingClientRect();
		leaving = story.link;
		setTimeout(() => {
			leaving = null;
			actions.pick(story.link);
		}, motionMs(160));
	}
	function flipIn(node: HTMLElement): void {
		const from = flipFrom;
		flipFrom = null;
		if (!from || reduceMotion || typeof node.animate !== "function") return;
		const to = node.getBoundingClientRect();
		if (to.width === 0 || to.height === 0) return;
		const dx = from.left - to.left;
		const dy = from.top - to.top;
		const s = from.width / to.width;
		node.animate(
			[
				{
					transformOrigin: "top left",
					transform: `translate(${dx}px, ${dy}px) scale(${s})`
				},
				{ transformOrigin: "top left", transform: "none" }
			],
			{ duration: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
		);
	}
</script>

<div
	class="news-panel"
	class:is-staged={stagedStory !== null}
	role="region"
	aria-label="{panel.langName} news"
>
	<div class="news-bar">
		{#if panel.regions.length > 1 && panel.status !== "unsupported" && panel.status !== "needs-shell"}
			<div class="news-chips" role="group" aria-label="News region">
				{#each panel.regions as region, i (region.gl)}
					{#if i > 0 && !!region.icon !== !!panel.regions[i - 1]?.icon}
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
						in:fly={{ y: 8, duration: motionMs(200), delay: motionMs(i * 25) }}
					>
						{region.icon ?? region.label}
					</button>
				{/each}
			</div>
		{:else}
			<span class="news-chips"></span>
		{/if}
		<button
			type="button"
			class="news-x"
			aria-label="Close news"
			title="Close news"
			onclick={() => actions.close()}
		>
			✕
		</button>
	</div>
	<p class="news-meta">
		{#key panel.code}
			<span class="news-lang" in:fly={{ y: 6, duration: motionMs(220) }}
				>{lang ? `${lang.native} ${lang.badge}` : panel.langName}</span
			>
		{/key}
		{#if status}
			<span class="news-status" aria-live="polite">{status}</span>
		{/if}
	</p>

	{#if stagedStory && staged}
		{@const image = imageFor(stagedStory)}
		{@const levelTag =
			CEFR_LEVELS.find((l) => l.level === staged.level)?.tag ?? ""}
		{@const words = sessionWords(staged.kind, staged.size)}
		<div class="news-stage">
			<div class="session" use:flipIn>
				<div class="stage-card">
					<div class="stage-thumb">
						{#if image}
							<img
								src={image}
								alt=""
								draggable="false"
								onerror={() => {
									broken[stagedStory.link] = true;
								}}
							/>
						{:else}
							<span class="news-img-fallback" aria-hidden="true"
								>{stagedStory.source.trim().charAt(0)}</span
							>
						{/if}
					</div>
					<div class="stage-text">
						<span class="news-headline">{stagedStory.title}</span>
						{#if stagedStory.source}
							<span class="news-source">{stagedStory.source}</span>
						{/if}
					</div>
					<button
						type="button"
						class="stage-x"
						aria-label="Back to headlines"
						title="Back to headlines"
						disabled={busy !== null}
						onclick={() => actions.unpick()}>✕</button
					>
				</div>
				<div
					class="stage-opts"
					in:fly={{ y: 10, duration: motionMs(260), delay: motionMs(220) }}
				>
					<div class="opt-row">
						<span class="opt-label" id="news-kind">Session</span>
						<div class="seg" role="group" aria-labelledby="news-kind">
							<button
								type="button"
								class="seg-opt"
								class:on={staged.kind === "talk"}
								aria-pressed={staged.kind === "talk"}
								title="Two locals discuss the story; join in any time"
								onclick={() => actions.kind("talk")}>Conversation</button
							>
							<button
								type="button"
								class="seg-opt"
								class:on={staged.kind === "read"}
								aria-pressed={staged.kind === "read"}
								title="A summary at your level and length"
								onclick={() => actions.kind("read")}>Summary</button
							>
						</div>
					</div>
					<div class="opt-row">
						<span class="opt-label" aria-hidden="true"
							>Level · {staged.level} {levelTag}</span
						>
						<div class="seg" role="group" aria-label="Level">
							{#each CEFR_LEVELS as level (level.level)}
								<button
									type="button"
									class="seg-opt"
									class:on={staged.level === level.level}
									aria-pressed={staged.level === level.level}
									title={level.tag}
									onclick={() => actions.level(level.level)}
								>
									{level.level}
								</button>
							{/each}
						</div>
					</div>
					<div class="opt-row">
						<span class="opt-label" aria-hidden="true"
							>Length · about {words} words</span
						>
						<div class="seg" role="group" aria-label="Length">
							{#each SUMMARY_SIZES as size (size.size)}
								<button
									type="button"
									class="seg-opt"
									class:on={staged.size === size.size}
									aria-pressed={staged.size === size.size}
									title="About {sessionWords(staged.kind, size.size)} words"
									onclick={() => actions.size(size.size)}
								>
									{size.label}
								</button>
							{/each}
						</div>
					</div>
					<button
						type="button"
						class="news-start"
						disabled={busy !== null || staged.article === "error"}
						onclick={() => actions.launch()}
					>
						{#if busy !== null}
							<span class="news-dots">Starting</span>
						{:else}
							{staged.kind === "talk" ? "Start conversation" : "Start summary"}
						{/if}
					</button>
					<!-- Only a pending fetch or a failure speaks here: a ready
					article needs no line. -->
					{#if staged.article === "error" || (staged.article === "loading" && busy === null)}
						<p class="stage-note" aria-live="polite">
							{#if staged.article === "error"}
								<span role="alert">{staged.error}</span>
								<button
									type="button"
									class="news-retry"
									onclick={() => actions.retry()}
								>
									Retry
								</button>
							{:else}
								<span class="news-dots">Reading the article</span>
							{/if}
						</p>
					{/if}
				</div>
			</div>
		</div>
	{:else if panel.status === "loading"}
		<ul class="news-cards" aria-busy="true" aria-label="Loading headlines">
			{#each Array.from({ length: SKELETONS }, (_, i) => i) as i (i)}
				<li
					class="news-card skel-card"
					aria-hidden="true"
					in:fade={{ duration: motionMs(200) }}
				>
					<span class="news-thumb"><span class="news-skel"></span></span>
					<span class="news-text">
						<span class="skel-line"></span>
						<span class="skel-line short"></span>
						<span class="skel-line tiny"></span>
					</span>
				</li>
			{/each}
		</ul>
	{:else if panel.status === "translating" || (panel.status === "ready" && panel.stories.length > 0)}
		{@const translating = panel.status === "translating"}
		<ul
			class="news-cards"
			class:leaving={leaving !== null}
			aria-busy={translating}
		>
			{#each panel.stories as story, i (story.link)}
				{@const image = imageFor(story)}
				<li
					class="news-item"
					class:picked={leaving === story.link}
					in:fly={{
						y: 14,
						duration: motionMs(280),
						delay: motionMs(Math.min(i * 40, 360))
					}}
				>
					<button
						type="button"
						class="news-card"
						disabled={translating}
						aria-label={translating ? "Headline translating" : story.title}
						onclick={(e) => pickCard(e, story)}
					>
						<span class="news-thumb">
							{#if image}
								<img
									class="news-img"
									class:loaded={loaded[story.link]}
									src={image}
									alt=""
									loading="lazy"
									decoding="async"
									draggable="false"
									onload={() => {
										loaded[story.link] = true;
									}}
									onerror={() => {
										broken[story.link] = true;
									}}
								/>
							{:else if image === undefined}
								<span class="news-skel"></span>
							{:else}
								<span
									class="news-img-fallback"
									in:fade={{ duration: motionMs(250) }}
									>{story.source.trim().charAt(0)}</span
								>
							{/if}
						</span>
						<span class="news-text">
							{#if translating}
								<span class="skel-line"></span>
								<span class="skel-line short"></span>
							{:else}
								<span
									class="news-headline"
									in:fade={{ duration: motionMs(220) }}>{story.title}</span
								>
							{/if}
							{#if story.source}
								<span class="news-source">{story.source}</span>
							{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if panel.status === "error"}
		<p class="news-note" role="alert">{panel.error}</p>
		<button type="button" class="news-retry" onclick={() => actions.retry()}
			>Retry</button
		>
	{:else if panel.status === "unsupported"}
		<p class="news-note">Google News has no {panel.langName} edition yet.</p>
	{:else if panel.status === "needs-shell"}
		<p class="news-note">
			News needs the app shell — the browser preview can't reach it.
		</p>
	{:else}
		<p class="news-note">No stories right now.</p>
		<button type="button" class="news-retry" onclick={() => actions.retry()}
			>Retry</button
		>
	{/if}
</div>

<style>
	.news-panel {
		/* The panel follows the text size like messages do: every size
		below rides --u (1rem at 100%, scaled with --font-scale). */
		--u: calc(1rem * var(--font-scale, 1));
		font-size: var(--u);
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		gap: calc(0.55 * var(--u, 1rem));
		width: calc(100% - calc(2.4 * var(--u, 1rem)));
		padding-bottom: calc(1 * var(--u, 1rem));
		/* Chrome, not content: nothing here selects on a click. */
		user-select: none;
		-webkit-user-select: none;
	}
	.news-bar {
		display: flex;
		align-items: center;
		gap: calc(0.5 * var(--u, 1rem));
	}
	.news-chips {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: calc(0.4 * var(--u, 1rem));
		overflow-x: auto;
		padding: calc(0.15 * var(--u, 1rem)) calc(0.1 * var(--u, 1rem))
			calc(0.25 * var(--u, 1rem));
		scrollbar-width: none;
	}
	.news-chips::-webkit-scrollbar {
		display: none;
	}
	/* Home editions (word chips) | world desks (flag chips). */
	.news-sep {
		flex: 0 0 auto;
		width: 1px;
		height: calc(1.6 * var(--u, 1rem));
		margin: 0 calc(0.3 * var(--u, 1rem));
		background: #8e8e93;
		background: var(--line-hover);
	}
	.news-chip {
		flex: 0 0 auto;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		background: transparent;
		color: #1c1c1e;
		color: var(--ink);
		border-radius: 999px;
		padding: calc(0.4 * var(--u, 1rem)) calc(0.85 * var(--u, 1rem));
		font-size: calc(0.85 * var(--u, 1rem));
		min-height: calc(2.5 * var(--u, 1rem));
		cursor: pointer;
		white-space: nowrap;
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease,
			color 0.18s ease,
			transform 0.12s ease;
	}
	.news-chip:hover {
		border-color: #8e8e93;
		border-color: var(--line-hover);
	}
	.news-chip:active {
		transform: scale(0.94);
	}
	.news-chip.on {
		background: #007aff;
		background: var(--accent);
		border-color: #007aff;
		border-color: var(--accent);
		color: #fff;
		color: var(--accent-ink);
		font-weight: 650;
		animation: chip-pop 0.28s cubic-bezier(0.2, 0.8, 0.2, 1.4);
	}
	@keyframes chip-pop {
		from {
			transform: scale(0.9);
		}
		to {
			transform: none;
		}
	}
	.news-chip.icon {
		font-size: calc(1.1 * var(--u, 1rem));
		line-height: 1;
		padding: calc(0.4 * var(--u, 1rem)) calc(0.65 * var(--u, 1rem));
	}
	.news-x {
		flex: 0 0 auto;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		background: transparent;
		color: #6e6e73;
		color: var(--muted);
		border-radius: 999px;
		width: calc(2.5 * var(--u, 1rem));
		height: calc(2.5 * var(--u, 1rem));
		font-size: calc(0.95 * var(--u, 1rem));
		line-height: 1;
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease;
	}
	.news-x:hover {
		color: #1c1c1e;
		color: var(--ink);
		border-color: #8e8e93;
		border-color: var(--line-hover);
	}
	.news-meta {
		margin: 0;
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: calc(0.25 * var(--u, 1rem)) calc(0.6 * var(--u, 1rem));
		min-height: 1.5em;
		font-size: calc(0.85 * var(--u, 1rem));
		color: #6e6e73;
		color: var(--muted);
	}
	.news-lang {
		display: inline-block;
		font-weight: 650;
		color: #1c1c1e;
		color: var(--ink);
	}
	.news-note {
		margin: 0;
		color: #6e6e73;
		color: var(--muted);
		font-size: calc(0.9 * var(--u, 1rem));
	}
	.news-retry {
		align-self: flex-start;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		background: transparent;
		color: #1c1c1e;
		color: var(--ink);
		border-radius: calc(0.6 * var(--u, 1rem));
		padding: calc(0.4 * var(--u, 1rem)) calc(0.9 * var(--u, 1rem));
		font-size: calc(0.85 * var(--u, 1rem));
		min-height: calc(2.5 * var(--u, 1rem));
		cursor: pointer;
	}

	/* Grid: as many 12.5em columns as fit (three on a laptop at 100%,
	two at big text in a mid window). em is --u here, so giant text
	sizes drop columns instead of squeezing headlines. */
	.news-cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(
			auto-fill,
			minmax(min(100%, 12.5em), 1fr)
		);
		gap: calc(0.75 * var(--u, 1rem));
	}
	.news-item {
		display: flex;
		transition:
			opacity 0.16s ease,
			transform 0.16s ease;
	}
	.news-cards.leaving .news-item:not(.picked) {
		opacity: 0;
		transform: scale(0.97);
	}
	.news-card {
		box-sizing: border-box;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: calc(0.5 * var(--u, 1rem));
		padding: calc(0.55 * var(--u, 1rem)) calc(0.55 * var(--u, 1rem))
			calc(0.7 * var(--u, 1rem));
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: calc(0.85 * var(--u, 1rem));
		background: #fff;
		background: var(--bg-raised);
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		position: relative;
		transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	/* Hover ring and shadow live on a layer that only fades: no
	border or shadow repaint per frame, same ease in and out. */
	.news-card::after {
		content: "";
		position: absolute;
		inset: -1px;
		border-radius: inherit;
		border: 1px solid #8e8e93;
		border-color: var(--line-hover);
		box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.news-card:disabled {
		cursor: progress;
	}
	@media (hover: hover) {
		.news-card:not(:disabled):hover {
			transform: translateY(-3px);
		}
		.news-card:not(:disabled):hover::after {
			opacity: 1;
		}
		.news-card:not(:disabled):hover .news-img.loaded {
			transform: scale(1.04);
		}
	}
	.news-card:not(:disabled):active {
		transform: translateY(-1px) scale(0.985);
		transition-duration: 0.1s;
	}
	.news-card:focus-visible,
	.news-start:focus-visible,
	.seg-opt:focus-visible,
	.news-chip:focus-visible {
		outline: 2px solid #007aff;
		outline-color: var(--accent);
		outline-offset: 2px;
	}
	.news-thumb {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: calc(0.55 * var(--u, 1rem));
		overflow: hidden;
		background: #e5e5ea;
		background: var(--line-soft);
	}
	.news-img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transition:
			opacity 0.3s ease,
			transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.news-img.loaded {
		opacity: 1;
	}
	.news-skel {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.news-img-fallback {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #6e6e73;
		color: var(--muted);
		font-size: calc(1.8 * var(--u, 1rem));
		font-weight: 700;
	}
	.news-text {
		display: flex;
		flex-direction: column;
		gap: calc(0.3 * var(--u, 1rem));
		padding: 0 calc(0.2 * var(--u, 1rem));
		min-width: 0;
	}
	.news-headline {
		font-size: calc(0.93 * var(--u, 1rem));
		font-weight: 600;
		line-height: 1.32;
		color: #1c1c1e;
		color: var(--ink);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		/* Three lines reserved: rows line up and nothing jumps
		when translated titles arrive. */
		min-height: calc(1.32em * 3);
	}
	.news-source {
		font-size: calc(0.76 * var(--u, 1rem));
		color: #6e6e73;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.skel-line {
		position: relative;
		display: block;
		height: calc(0.8 * var(--u, 1rem));
		margin: calc(0.22 * var(--u, 1rem)) 0;
		border-radius: calc(0.3 * var(--u, 1rem));
		overflow: hidden;
		background: #e5e5ea;
		background: var(--line-soft);
	}
	.skel-line.short {
		width: 70%;
	}
	.skel-line.tiny {
		width: 35%;
		height: calc(0.6 * var(--u, 1rem));
	}
	.skel-card {
		box-sizing: border-box;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: calc(0.85 * var(--u, 1rem));
		padding: calc(0.55 * var(--u, 1rem)) calc(0.55 * var(--u, 1rem))
			calc(0.7 * var(--u, 1rem));
		display: flex;
		flex-direction: column;
		gap: calc(0.5 * var(--u, 1rem));
		background: #fff;
		background: var(--bg-raised);
	}
	.skel-card .news-text {
		/* Same footprint as a real headline block plus source. */
		min-height: calc(
			calc(0.93 * var(--u, 1rem)) * 1.32 * 3 + calc(1.3 * var(--u, 1rem))
		);
	}

	/* List rows with a thumbnail wherever the grid would fall to one
	column (two 12.5em columns plus the 0.75em gap), so no width or
	text size ever gets one huge picture per story. em in a container
	query is the container's font size (--u), so this follows the text
	size; calc(var()) is not allowed here (lightningcss rejects it). */
	@container (width < 25.75em) {
		.news-cards {
			gap: calc(0.5 * var(--u, 1rem));
		}
		.news-card,
		.skel-card {
			display: grid;
			grid-template-columns: calc(6.5 * var(--u, 1rem)) 1fr;
			align-items: start;
			gap: calc(0.7 * var(--u, 1rem));
			padding: calc(0.5 * var(--u, 1rem));
		}
		.news-thumb {
			aspect-ratio: 4 / 3;
		}
		.news-text {
			padding: 0;
		}
		.news-headline {
			min-height: 0;
		}
		.skel-card .news-text {
			min-height: 0;
		}
	}

	/* Staged story: one session card where the story lands, choices
	in reading order, one Start. */
	.news-stage {
		display: flex;
		justify-content: center;
		padding-top: calc(0.75 * var(--u, 1rem));
	}
	.session {
		width: min(100%, calc(32 * var(--u, 1rem)));
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: calc(1.1 * var(--u, 1rem));
		background: #fff;
		background: var(--bg-raised);
		overflow: hidden;
		will-change: transform;
	}
	.stage-card {
		position: relative;
		display: grid;
		grid-template-columns: calc(7.5 * var(--u, 1rem)) 1fr;
		gap: calc(0.9 * var(--u, 1rem));
		align-items: center;
		padding: calc(0.85 * var(--u, 1rem)) calc(2.6 * var(--u, 1rem))
			calc(0.85 * var(--u, 1rem)) calc(0.85 * var(--u, 1rem));
		border-bottom: 1px solid #e5e5ea;
		border-bottom-color: var(--line-soft);
	}
	.stage-thumb {
		position: relative;
		aspect-ratio: 4 / 3;
		border-radius: calc(0.6 * var(--u, 1rem));
		overflow: hidden;
		background: #e5e5ea;
		background: var(--line-soft);
	}
	.stage-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.stage-text {
		display: flex;
		flex-direction: column;
		gap: calc(0.3 * var(--u, 1rem));
		min-width: 0;
	}
	.stage-text .news-headline {
		min-height: 0;
		-webkit-line-clamp: 4;
		line-clamp: 4;
	}
	.stage-x {
		position: absolute;
		top: calc(0.5 * var(--u, 1rem));
		right: calc(0.5 * var(--u, 1rem));
		width: calc(2 * var(--u, 1rem));
		height: calc(2 * var(--u, 1rem));
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: #6e6e73;
		color: var(--muted);
		cursor: pointer;
		transition: color 0.15s ease;
	}
	.stage-x:hover:not(:disabled) {
		color: #1c1c1e;
		color: var(--ink);
	}
	.stage-opts {
		display: flex;
		flex-direction: column;
		gap: calc(0.9 * var(--u, 1rem));
		padding: calc(0.95 * var(--u, 1rem));
	}
	.opt-row {
		display: flex;
		flex-direction: column;
		gap: calc(0.4 * var(--u, 1rem));
	}
	.opt-label {
		padding-left: calc(0.15 * var(--u, 1rem));
		font-size: calc(0.72 * var(--u, 1rem));
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #6e6e73;
		color: var(--muted);
	}
	.seg {
		display: flex;
		gap: calc(0.25 * var(--u, 1rem));
		padding: calc(0.25 * var(--u, 1rem));
		border-radius: calc(0.8 * var(--u, 1rem));
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
	}
	.seg-opt {
		flex: 1 1 0;
		min-height: calc(2.4 * var(--u, 1rem));
		border: 0;
		border-radius: calc(0.6 * var(--u, 1rem));
		background: transparent;
		color: #1c1c1e;
		color: var(--ink);
		font: inherit;
		font-size: calc(0.88 * var(--u, 1rem));
		font-weight: 600;
		cursor: pointer;
		transition:
			background-color 0.18s ease,
			color 0.18s ease,
			transform 0.12s ease;
	}
	.seg-opt:active {
		transform: scale(0.95);
	}
	.seg-opt.on {
		background: #007aff;
		background: var(--accent);
		color: #fff;
		color: var(--accent-ink);
	}
	.news-start {
		min-height: calc(3 * var(--u, 1rem));
		border: 0;
		border-radius: calc(0.8 * var(--u, 1rem));
		background: #007aff;
		background: var(--accent);
		color: #fff;
		color: var(--accent-ink);
		font: inherit;
		font-size: calc(0.95 * var(--u, 1rem));
		font-weight: 650;
		cursor: pointer;
		transition:
			transform 0.12s ease,
			opacity 0.15s ease;
	}
	.news-start:hover:not(:disabled) {
		opacity: 0.92;
	}
	.news-start:active:not(:disabled) {
		transform: scale(0.98);
	}
	.news-start:disabled {
		opacity: 0.55;
		cursor: progress;
	}
	.stage-note {
		margin: -0.35rem 0 0;
		min-height: 1.4em;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: calc(0.6 * var(--u, 1rem));
		font-size: calc(0.82 * var(--u, 1rem));
		color: #6e6e73;
		color: var(--muted);
	}
	.news-dots::after {
		content: "…";
	}

	@media (prefers-reduced-motion: no-preference) {
		.news-skel::after,
		.skel-line::after {
			content: "";
			position: absolute;
			inset: 0;
			background: linear-gradient(
				90deg,
				transparent,
				var(--line-hover, rgba(142, 142, 147, 0.35)),
				transparent
			);
			opacity: 0.35;
			transform: translateX(-100%);
			animation: news-shimmer 1.4s ease-in-out infinite;
		}
		@keyframes news-shimmer {
			to {
				transform: translateX(100%);
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
</style>
