<!-- What DeepSeek looked up for a reply, under it: a quiet row of
overlapping site icons and "N sources". Tapping it opens the list in
place: each search it ran (its words), then each page with its title,
site and link (a new tab on the web; the system browser in the apps,
through the page's link handler). Only what DeepSeek returned
(web-sources.ts); the icon is DeepSeek's `site_icon`, else the site's
own /favicon.ico, else its first letter. -->
<script lang="ts">
	import { slide } from "svelte/transition";
	import type { WebPage, WebSources } from "$lib/web-sources";

	interface Props {
		sources: WebSources;
		/** Message id, for the list's element id. */
		id: string;
	}

	let { sources, id }: Props = $props();
	let open = $state(false);

	/** Icons in the row: the first few sites, one per site. */
	const rowPages = $derived.by(() => {
		const out: WebPage[] = [];
		for (const page of sources.pages) {
			if (out.some((p) => p.host === page.host)) continue;
			out.push(page);
			if (out.length === 4) break;
		}
		return out;
	});
	const count = $derived(sources.pages.length);
	const countLabel = $derived(
		count === 0
			? sources.searches.length === 1
				? "1 search"
				: `${sources.searches.length} searches`
			: count === 1
				? "1 source"
				: `${count} sources`
	);

	/** Per address: 0 DeepSeek's icon, 1 the site's favicon, 2 a letter. */
	let failed: Record<string, number> = $state({});
	function iconSrc(page: WebPage): string | null {
		const stage = failed[page.url] ?? (page.icon ? 0 : 1);
		if (stage === 0 && page.icon) return page.icon;
		if (stage <= 1) {
			try {
				return new URL("/favicon.ico", page.url).href;
			} catch {
				return null;
			}
		}
		return null;
	}
	function iconFailed(page: WebPage): void {
		const stage = failed[page.url] ?? (page.icon ? 0 : 1);
		failed = { ...failed, [page.url]: stage + 1 };
	}
	/** Under the title: the site and its host, or (when the title is
	only the host) the page's address. */
	function pageLine(page: WebPage): string {
		if (page.title === page.host)
			return page.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
		return page.site === page.host ? page.host : `${page.site} · ${page.host}`;
	}
	function letter(page: WebPage): string {
		return (page.site.trim()[0] ?? page.host[0] ?? "?").toUpperCase();
	}
	const reduceMotion =
		typeof matchMedia === "function" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches;
</script>

{#snippet icon(page: WebPage, size: "row" | "list")}
	{@const src = iconSrc(page)}
	<span class="site-icon {size}" aria-hidden="true">
		{#if src}
			<img
				{src}
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				draggable="false"
				onerror={() => iconFailed(page)}
			/>
		{:else}
			<span class="letter">{letter(page)}</span>
		{/if}
	</span>
{/snippet}

<div class="web-sources">
	<button
		type="button"
		class="sources-row"
		aria-expanded={open}
		aria-controls="sources-{id}"
		title={open ? "Hide what it looked up" : "Show what it looked up"}
		onclick={(event) => {
			// The row is its own control: a tap must not also open the
			// message's action row.
			event.stopPropagation();
			open = !open;
		}}
	>
		{#if rowPages.length > 0}
			<span class="stack">
				{#each rowPages as page (page.url)}
					{@render icon(page, "row")}
				{/each}
			</span>
		{/if}
		<span class="count">{countLabel}</span>
	</button>
	{#if open}
		<div
			class="sources-list"
			id="sources-{id}"
			transition:slide={{ duration: reduceMotion ? 0 : 180 }}
		>
			{#if sources.searches.length > 0}
				<ul class="searches" aria-label="Searches">
					{#each sources.searches as search, i (i)}
						<li>
							<svg viewBox="0 0 16 16" aria-hidden="true" class="glass"
								><circle cx="7" cy="7" r="4.25" /><path
									d="M10.2 10.2 13.5 13.5"
								/></svg
							>
							<span class="queries">
								{#if search.queries.length === 0}
									Searched by image
								{:else}
									{#each search.queries as query, q (q)}<span class="query"
											>{query}</span
										>{/each}
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
			{#if sources.pages.length > 0}
				<ol class="pages">
					{#each sources.pages as page (page.url)}
						<li>
							<!-- An outside page, never a route of this app. -->
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<a
								href={page.url}
								target="_blank"
								rel="noopener noreferrer"
								onclick={(event) => event.stopPropagation()}
							>
								{@render icon(page, "list")}
								<span class="page-text">
									<span class="title">{page.title}</span>
									<span class="site">{pageLine(page)}</span>
								</span>
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	{/if}
</div>

<style>
	.web-sources {
		/* Reads at the reply's size, quieter: the status line's scale. */
		font-size: calc(0.85rem * var(--font-scale, 1));
		margin: 0.55rem 0 0.15rem;
		color: #6e6e73;
		color: var(--muted);
		max-width: 100%;
	}
	.sources-row {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		border: 0;
		border-radius: 999px;
		padding: 0.25em 0.6em 0.25em 0.3em;
		margin-left: -0.3em;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		transition: background-color 0.15s ease;
		/* A finger-sized target on phones without a bigger look. */
		min-height: 2rem;
	}
	.sources-row:hover,
	.sources-row[aria-expanded="true"] {
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	.sources-row:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.stack {
		display: inline-flex;
	}
	.site-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		border-radius: 50%;
		overflow: hidden;
		background: #fff;
		background: var(--bg-raised, var(--bg));
	}
	.site-icon.row {
		width: 1.3em;
		height: 1.3em;
		/* Overlapping coins, each ringed in the page's own color. */
		box-shadow: 0 0 0 2px var(--bg, #fff);
	}
	.site-icon.row + .site-icon.row {
		margin-left: -0.28em;
	}
	.site-icon.list {
		width: 1.15em;
		height: 1.15em;
		margin-top: 0.15em;
		box-shadow: 0 0 0 1px var(--line-soft, #e5e5ea);
	}
	.site-icon img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.letter {
		font-size: 0.68em;
		font-weight: 600;
		line-height: 1;
		color: var(--ink);
	}
	.count {
		white-space: nowrap;
	}
	.sources-list {
		margin-top: 0.4rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 0.8rem;
		max-width: 100%;
		box-sizing: border-box;
	}
	.searches,
	.pages {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.searches {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding-bottom: 0.5rem;
		margin-bottom: 0.45rem;
		border-bottom: 1px solid var(--line-soft, #e5e5ea);
	}
	.searches li {
		display: flex;
		align-items: flex-start;
		gap: 0.45em;
	}
	.glass {
		flex: none;
		width: 1em;
		height: 1em;
		margin-top: 0.15em;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.queries {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3em 0.35em;
		min-width: 0;
	}
	.query {
		padding: 0.05em 0.5em;
		border-radius: 999px;
		background: var(--bg-wash, #f1f1f4);
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.pages {
		display: flex;
		flex-direction: column;
	}
	.pages a {
		display: flex;
		align-items: flex-start;
		gap: 0.55em;
		padding: 0.35rem 0.3rem;
		margin: 0 -0.3rem;
		border-radius: 0.5rem;
		color: inherit;
		text-decoration: none;
	}
	.pages a:hover {
		background: var(--bg-wash, #f1f1f4);
	}
	.pages a:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.page-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 0.05rem;
	}
	.title {
		color: var(--ink);
		/* Two lines at most; long titles never widen the reply. */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.site {
		font-size: 0.9em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	@media (prefers-reduced-motion: reduce) {
		.sources-row {
			transition: none;
		}
	}
</style>
