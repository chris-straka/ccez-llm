<!-- Selection readings: pronunciation panels for just the highlight —
the flat pinyin panel plus one furigana panel per back-to-back kanji
group, docked above the highlight (below only without headroom).
Pure presentational: pointer-transparent, no interactions. The page
owns placement, tracking, and dismiss (see trackSelPinyin,
dismissSelPanels); this component owns the panels and their surfaces
(Svelte scoping binds the CSS to this markup). The document tint
(`.rendered .frbtN`) stays paged: it styles message content, not the
panels. -->
<script lang="ts">
	import type { GroupedRun } from "$lib/reading";

	/** Flat pinyin panel state (rendered fields only; quote and
	messageId stay paged). */
	export interface PinyinPanel {
		x: number;
		y: number;
		above: boolean;
		html: string;
	}

	/** One furigana group panel (rendered fields only). */
	export interface FuriganaPanel {
		x: number;
		y: number;
		above: boolean;
		/** Lone single-run highlight: ink text, no document tint. */
		plain: boolean;
		runs: Pick<GroupedRun, "start" | "reading" | "color">[];
	}

	interface Props {
		pinyin: PinyinPanel | null;
		furigana: FuriganaPanel[] | null;
		previewing: boolean;
	}

	let { pinyin, furigana, previewing }: Props = $props();
</script>

{#if pinyin && !previewing}
	<!-- Selection readings: pronunciations for just the highlight,
	docked above it (below only without headroom) — on phones the
	menu rises above the panels (see liftSelMenuAboveReadings) instead
	of owning the above slot. Pointer-transparent so it never
	disturbs the selection or blocks the native menu; the highlight
	clearing dismisses it (see trimMessageDrag), and scrolling
	tracks it (see trackSelPinyin). -->
	<div
		class="sel-pinyin"
		class:above={pinyin.above}
		style="left: {pinyin.x}px; top: {pinyin.y}px"
		aria-live="polite"
	>
		<!-- eslint-disable-line svelte/no-at-html-tags -- html is "…" or readingsOnly output (inert by unit test, see reading.ts) -->{@html pinyin.html}
	</div>
{/if}
{#if furigana && !previewing}
	<!-- Furigana group panels: one per back-to-back kanji group,
	furigana only, each anchored to its own group. Same glass as
	the flat panel; the selected kanji glow in matching colors
	in the document (see tintSelectionSpans). -->
	{#each furigana as panel, pi (pi)}
		<div
			class="sel-pinyin"
			class:above={panel.above}
			style="left: {panel.x}px; top: {panel.y}px"
			aria-live="polite"
		>
			{#each panel.runs as run (run.start)}
				{#if panel.plain}
					<span class="spr"><span class="srt">{run.reading}</span></span>
				{:else}
					<span class="spr pk{run.color}"
						><span class="srt">{run.reading}</span></span
					>
				{/if}
			{/each}
		</div>
	{/each}
{/if}

<style>
	.sel-pinyin {
		position: fixed;
		z-index: 50;
		pointer-events: none;
		/* Hug the characters: when long readings scrunch onto
		several lines, the width pass (see shrinkPanelToContent)
		narrows the glass to the longest laid-out line — never a
		slab spanning the max-width. No pure-CSS shape does this:
		shrink-to-fit resolves long text to the cap. */
		max-width: 20rem;
		/* Scrunched (wrapped) readings balance into even centered
		lines, so the glass hugs the characters instead of spanning
		a longest-line slab. Single-line panels already shrink-wrap,
		so this changes nothing there. */
		text-align: center;
		text-wrap: balance;
		/* Tight sides: the popup hugs its readings (runs carry no
		inner padding of their own). */
		padding: 0.3rem 0.2rem;
		border-radius: 8px;
		/* Rides the chat text size (never the prompt's own): a fixed
		0.85rem panel next to 370% type reads as a toy. */
		font-size: calc(0.85rem * var(--font-scale, 1));
		background: rgba(255, 255, 255, 0.88);
		-webkit-backdrop-filter: blur(18px) saturate(1.6);
		backdrop-filter: blur(18px) saturate(1.6);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		color: #1c1c1e;
		color: var(--ink);
	}
	:global(html[data-theme="dark"]) .sel-pinyin {
		background: rgba(30, 30, 32, 0.88);
	}
	/* Centered on the highlight whatever the panel width (and so
	whatever the font size): the style left is the highlight's
	center. Above hangs 4px over its top edge; below clears 4px
	under it. */
	.sel-pinyin {
		transform: translateX(-50%);
	}
	.sel-pinyin.above {
		transform: translate(-50%, calc(-100% - 4px));
	}
	.sel-pinyin:not(.above) {
		margin-top: 4px;
	}
	/* Annotated furigana runs: colors cycle continuously across the
	highlight so every popup links its own document tint. A lone
	single-run popup renders plain (no pk class, ink text). No
	repeated kanji or kana anywhere. */
	.sel-pinyin .spr {
		display: inline-block;
		white-space: nowrap;
	}
	.sel-pinyin .srt {
		display: block;
	}
	.sel-pinyin .pk0 .srt {
		color: var(--pair0);
	}
	.sel-pinyin .pk1 .srt {
		color: var(--pair1);
	}
	.sel-pinyin .pk2 .srt {
		color: var(--pair2);
	}
	.sel-pinyin .pk3 .srt {
		color: var(--pair3);
	}
</style>
