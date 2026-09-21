<!-- Character Inspect overlay: the single Han character under
review with stroke order, components, count, radical, definition,
and readings (Mandarin, Japanese on/kun) — all offline. Rendered
through the shared `Modal.svelte` shell. The page owns the open
character, the stroke vectors, the step, and the reading locale
default; this component owns the overlay markup, the stepper, the
locale toggle, and their surfaces (Svelte scoping binds the CSS to
this markup). Data lookups already live in `$lib/inspect` and
`$lib/reading` (unit-pinned). -->
<script lang="ts">
	import {
		decomposeTree,
		onKunLine,
		type InspectData
	} from "$lib/inspect";
	import {
		HAN_OVERLAY_LANG_TAG,
		isHanOverlayLangUncertain,
		type HanOverlayLang
	} from "$lib/reading";
	import Modal from "./Modal.svelte";

	/** Page-owned inspect behaviors. */
	export interface InspectOverlayActions {
		close: () => void;
		/** Manual stroke step (click; hold repeats via holdStart). */
		step: (delta: 1 | -1) => void;
		holdStart: (delta: 1 | -1) => void;
		holdStop: () => void;
		buzz: (event: TouchEvent) => void;
	}

	interface Props {
		char: string;
		data: InspectData;
		/** KanjiVG stroke paths (null until loaded). */
		strokes: string[] | null;
		/** Current stroke step, 1-based. */
		stroke: number;
		/** Reading locale (the page defaults it on open; the
		toggle writes it here). */
		lang?: HanOverlayLang;
		actions: InspectOverlayActions;
	}

	let {
		char,
		data,
		strokes,
		stroke,
		lang = $bindable("zh"),
		actions
	}: Props = $props();

	const total = $derived(strokes?.length ?? data.strokeCount ?? 0);
	const shown = $derived(Math.min(stroke, Math.max(total, 1)));
	const onKun = $derived(onKunLine(data));
	const decomp = $derived(char ? decomposeTree(char) : null);
	const uncertain = $derived(isHanOverlayLangUncertain(char));

	function veilClick(event: MouseEvent): void {
		if (event.target !== event.currentTarget) return;
		actions.close();
	}
</script>

<Modal
	label="Inspect character"
	labelledby="inspect-heading"
	cardClass="inspect-modal"
	fadeScroll
	onVeilClick={veilClick}
	onBoxTouchEnd={actions.buzz}
>
	<div class="modal-head">
		<h2 id="inspect-heading">
			Inspect <span lang={HAN_OVERLAY_LANG_TAG[lang]}>{data.char}</span>
		</h2>
		<button
			type="button"
			aria-label="Close character inspect"
			title="Close (Esc)"
			onclick={actions.close}
		>
			×
		</button>
	</div>
	{#if uncertain}
		<div class="inspect-lang" role="group" aria-label="Reading language">
			<button
				type="button"
				aria-pressed={lang === "ja"}
				aria-label="Show Japanese reading"
				title="Show Japanese reading"
				onclick={() => (lang = "ja")}>日本語</button
			>
			<button
				type="button"
				aria-pressed={lang === "zh"}
				aria-label="Show Chinese reading"
				title="Show Chinese reading"
				onclick={() => (lang = "zh")}>中文</button
			>
		</div>
	{/if}
	<div class="inspect-body">
		<div class="inspect-glyph">
			{#if strokes && strokes.length > 0}
				<!-- KanjiVG vectors (CC BY-SA 3.0): unstepped
				strokes stay grey, stepped ones paint light. -->
				<svg
					viewBox="0 0 109 109"
					class="inspect-svg"
					role="img"
					aria-label={`Stroke order for ${char}`}
				>
					{#each strokes as d, i (i)}
						<path {d} class:painted={i < shown} />
					{/each}
				</svg>
			{:else}
				<div
					class="inspect-char"
					lang={HAN_OVERLAY_LANG_TAG[lang]}
					aria-hidden="true"
				>
					{data.char}
				</div>
			{/if}
			{#if strokes && strokes.length > 0}
				<!-- Stepper waits for the vectors: the static
				char shows first, and the arrows must not offer
				steps through a drawing that isn't here yet. -->
				<div class="inspect-stepper">
					<button
						type="button"
						aria-label="Previous stroke (h)"
						title="Previous stroke (h)"
						disabled={stroke <= 1}
						onpointerdown={() => actions.holdStart(-1)}
						onpointerup={actions.holdStop}
						onpointerleave={actions.holdStop}
						onpointercancel={actions.holdStop}
						onclick={() => actions.step(-1)}>‹</button
					>
					<span class="inspect-count" aria-live="polite"
						>{shown} / {total}</span
					>
					<button
						type="button"
						aria-label="Next stroke (l)"
						title="Next stroke (l)"
						disabled={stroke >= total}
						onpointerdown={() => actions.holdStart(1)}
						onpointerup={actions.holdStop}
						onpointerleave={actions.holdStop}
						onpointercancel={actions.holdStop}
						onclick={() => actions.step(1)}>›</button
					>
				</div>
			{/if}
		</div>
		<div class="inspect-facts">
			{#if data.components.length > 0}
				<p>
					<strong>Components:</strong>
					{data.components.join(" + ")}
				</p>
			{:else}
				<p class="note">
					Component breakdown unavailable offline for this character.
				</p>
			{/if}
			{#if data.strokeCount !== null}
				<p><strong>Strokes:</strong> {data.strokeCount}</p>
			{:else}
				<p class="note">
					Stroke count unavailable offline for this character.
				</p>
			{/if}
			{#if data.radical !== null && data.radicalRest !== null}
				<p>
					<strong>Radical:</strong>
					{data.radical} + {data.radicalRest}
				</p>
			{/if}
			{#if data.definition !== null}
				<p><strong>Definition:</strong> {data.definition}</p>
			{:else}
				<p class="note">
					Unihan definition unavailable offline for this character.
				</p>
			{/if}
			{#if lang === "zh"}
				{#if data.mandarin !== null}
					<p>
						<strong>Mandarin:</strong>
						<span lang="zh-Latn-pinyin">{data.mandarin}</span>
					</p>
				{:else}
					<p class="note">
						Mandarin reading unavailable offline for this character.
					</p>
				{/if}
			{:else if onKun !== null}
				<p class="inspect-onkun">{onKun}</p>
			{:else}
				<p class="note">
					Japanese readings unavailable offline for this character.
				</p>
			{/if}
		</div>
	</div>
	{#if decomp && decomp.children.length > 0}
		<div class="inspect-decomp" aria-label="Character decomposition">
			<span class="inspect-decomp-char root">{decomp.char}</span>
			<span class="inspect-decomp-arrow" aria-hidden="true">→</span>
			{#each decomp.children as child, ci (ci)}
				<span class="inspect-decomp-group">
					<span class="inspect-decomp-char">{child.char}</span>
					{#if child.children.length > 0}
						<span class="inspect-decomp-sub">
							<span class="inspect-decomp-arrow" aria-hidden="true"
								>→</span
							>
							{#each child.children as grand, gi (gi)}
								<span class="inspect-decomp-char sub">{grand.char}</span
								>{#if gi < child.children.length - 1}<span
										class="inspect-decomp-plus"
										aria-hidden="true"
									>
										+
									</span>{/if}
							{/each}
						</span>
					{/if}
				</span>{#if ci < decomp.children.length - 1}<span
						class="inspect-decomp-plus"
						aria-hidden="true"
					>
						+
					</span>{/if}
			{/each}
		</div>
	{:else}
		<p class="note">
			No decomposition in the vendored subset for this character.
		</p>
	{/if}
</Modal>

<style>
	/* Dialog head row (copied from the page sheet; the paged copy
	drops with this move — the last head user — while Shortcuts and
	Palette keep their own copies for the heads they render). */
	.modal-head {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.35rem;
	}
	.modal-head h2 {
		font-size: 1.05rem;
		font-weight: 700;
		margin: 0;
	}
	.modal-head button {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 1.1rem;
		line-height: 1;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 8px;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.55rem;
		color: #3a3a3c;
		color: var(--focus);
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.modal-head button:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	:global(html[data-theme="dark"]) .modal-head button:hover {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .modal-head button:hover {
		color: #f2f2f7;
	}
	/* Reading-locale toggle: small JP/中文 pair for ambiguous Han text. */
	.inspect-lang {
		display: flex;
		gap: 0.35rem;
		margin: 0.2rem 0 0.1rem;
	}
	/* Every inspect button is a control: pointer on hover. The box
	renders in `Modal.svelte`, so the ancestor stays global (the
	inspect-modal class keeps it to this dialog). */
	:global(.inspect-modal) button {
		cursor: pointer;
	}
	.inspect-lang button {
		font-size: 0.8rem;
		padding: 0.15rem 0.5rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 8px;
		background: none;
		color: inherit;
	}
	.inspect-lang button:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	/* Active locale reads as filled, not just bold: bold alone never
	scanned as selected. */
	.inspect-lang button[aria-pressed="true"] {
		font-weight: 700;
		background: #1c1c1e;
		background: var(--invert);
		color: #fff;
		color: var(--invert-ink);
		border-color: transparent;
	}
	.inspect-body {
		display: flex;
		gap: 1.1rem;
		align-items: flex-start;
		margin: 0.4rem 0 0.6rem;
	}
	.inspect-char {
		font-size: 3.4rem;
		line-height: 1.1;
	}
	.inspect-facts {
		flex: 1;
		min-width: 0;
	}
	.inspect-facts p {
		margin: 0.3rem 0;
	}
	:global(.inspect-modal) .note {
		color: #6e6e73;
		color: var(--muted);
		font-size: 0.85rem;
	}
	/* Glyph column: vector (or font) glyph up top, stepper beneath. */
	.inspect-glyph {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		min-width: 5.5rem;
	}
	.inspect-svg {
		width: 5.5rem;
		height: 5.5rem;
	}
	.inspect-svg path {
		fill: none;
		stroke: #8e8e93;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.inspect-svg path.painted {
		stroke: #1c1c1e;
	}
	:global(html[data-theme="dark"]) .inspect-svg path {
		stroke: #48484a;
	}
	:global(html[data-theme="dark"]) .inspect-svg path.painted {
		stroke: #f2f2f7;
	}
	.inspect-stepper {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.inspect-stepper button {
		font-size: 1.1rem;
		line-height: 1;
		padding: 0.1rem 0.5rem;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: none;
		color: inherit;
	}
	.inspect-stepper button:not(:disabled):hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	.inspect-stepper button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.inspect-count {
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
	}
	.inspect-onkun {
		overflow-wrap: anywhere;
	}
	/* Decomposition tree (mdbg-style, two levels): root → parts,
	nested splits inline. */
	.inspect-decomp {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem;
		margin-top: 0.5rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 8px;
		font-size: 1.15rem;
	}
	.inspect-decomp-group {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		padding: 0.15rem 0.4rem;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 6px;
	}
	.inspect-decomp-char.sub {
		font-size: 0.95rem;
	}
	.inspect-decomp-arrow,
	.inspect-decomp-plus {
		color: #6e6e73;
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
