<!-- Character Inspect overlay: the single Han character under
review with stroke order, components, count, radical, definition,
and readings (Mandarin, Japanese on/kun) — all offline. Rendered
through the shared `Modal.svelte` shell. The page owns the open
character, its trail (components open in place, Back returns), the
stroke vectors, the step, the reading locale default, and the
voice; this component owns the overlay markup, the stepper, the
locale toggle, the reading chips, and their surfaces (Svelte
scoping binds the CSS to this markup). Data lookups already live in
`$lib/inspect` and `$lib/reading` (unit-pinned). -->
<script lang="ts">
	import ActionIcon from "./ActionIcon.svelte";
	import {
		decomposeTree,
		isHanChar,
		readingChips,
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
		/** Back along the trail of opened components. */
		back: () => void;
		/** Open a component character in place (pushes the trail). */
		open: (ch: string) => void;
		/** Read one reading aloud in the given voice. */
		speak: (text: string, lang: string) => void;
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
		/** A component was opened from a parent: Back shows. */
		canBack?: boolean;
		actions: InspectOverlayActions;
	}

	let {
		char,
		data,
		strokes,
		stroke,
		lang = $bindable("zh"),
		canBack = false,
		actions
	}: Props = $props();

	const total = $derived(strokes?.length ?? data.strokeCount ?? 0);
	const shown = $derived(Math.min(stroke, Math.max(total, 1)));
	const readings = $derived(readingChips(data));
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
		{#if canBack}
			<button
				type="button"
				class="inspect-back"
				aria-label="Back to the previous character"
				title="Back"
				onclick={actions.back}>‹</button
			>
		{/if}
		<h2 id="inspect-heading">
			Inspect <span lang={HAN_OVERLAY_LANG_TAG[lang]}>{data.char}</span>
		</h2>
		<button
			type="button"
			aria-label="Close character inspect"
			title="Close (Esc)"
			onclick={actions.close}
		>
			<ActionIcon kind="close" />
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
					<span class="inspect-count" aria-live="polite">{shown} / {total}</span
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
				<p class="inspect-components">
					<strong>Components:</strong>
					{#each data.components as part, pi (pi)}
						{#if pi > 0}<span aria-hidden="true"> + </span>{/if}
						{#if isHanChar(part)}
							<button
								type="button"
								class="inspect-part"
								title="Inspect {part}"
								aria-label="Inspect {part}"
								onclick={() => actions.open(part)}>{part}</button
							>
						{:else}
							{part}
						{/if}
					{/each}
				</p>
			{:else}
				<p class="note">
					Component breakdown unavailable offline for this character.
				</p>
			{/if}
			{#if data.strokeCount !== null}
				<p><strong>Strokes:</strong> {data.strokeCount}</p>
			{:else}
				<p class="note">Stroke count unavailable offline for this character.</p>
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
			<!-- Readings are chips that read themselves aloud: the
			Mandarin chip speaks the character (its tone comes from
			the voice), the on/kun chips speak their kana. -->
			{#if lang === "zh"}
				{#if data.mandarin !== null}
					<p class="inspect-readings">
						<strong>Mandarin:</strong>
						<button
							type="button"
							class="inspect-reading"
							lang="zh-Latn-pinyin"
							title="Listen"
							aria-label="Listen to {data.mandarin}"
							onclick={() => actions.speak(data.char, "zh-CN")}
							>{data.mandarin}</button
						>
					</p>
				{:else}
					<p class="note">
						Mandarin reading unavailable offline for this character.
					</p>
				{/if}
			{:else if readings.on.length > 0 || readings.kun.length > 0}
				<p class="inspect-readings inspect-onkun">
					{#if readings.on.length > 0}
						<strong>On:</strong>
						{#each readings.on as chip (chip.romaji)}
							<button
								type="button"
								class="inspect-reading"
								lang="ja"
								title="Listen ({chip.romaji})"
								aria-label="Listen to {chip.kana}"
								onclick={() => actions.speak(chip.kana, "ja-JP")}
								>{chip.kana}</button
							>
						{/each}
					{/if}
					{#if readings.kun.length > 0}
						<strong>Kun:</strong>
						{#each readings.kun as chip (chip.romaji)}
							<button
								type="button"
								class="inspect-reading"
								lang="ja"
								title="Listen ({chip.romaji})"
								aria-label="Listen to {chip.kana}"
								onclick={() => actions.speak(chip.kana, "ja-JP")}
								>{chip.kana}</button
							>
						{/each}
					{/if}
				</p>
			{:else}
				<p class="note">
					Japanese readings unavailable offline for this character.
				</p>
			{/if}
		</div>
	</div>
	{#if decomp && decomp.children.length > 0}
		<!-- Every part is a door: tapping one inspects it in place
		(Back returns to this character). -->
		<div class="inspect-decomp" aria-label="Character decomposition">
			<span class="inspect-decomp-char root">{decomp.char}</span>
			<span class="inspect-decomp-arrow" aria-hidden="true">→</span>
			{#each decomp.children as child, ci (ci)}
				<span class="inspect-decomp-group">
					<button
						type="button"
						class="inspect-decomp-char"
						title="Inspect {child.char}"
						aria-label="Inspect {child.char}"
						onclick={() => actions.open(child.char)}>{child.char}</button
					>
					{#if child.children.length > 0}
						<span class="inspect-decomp-sub">
							<span class="inspect-decomp-arrow" aria-hidden="true">→</span>
							{#each child.children as grand, gi (gi)}
								<button
									type="button"
									class="inspect-decomp-char sub"
									title="Inspect {grand.char}"
									aria-label="Inspect {grand.char}"
									onclick={() => actions.open(grand.char)}>{grand.char}</button
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
		color: var(--ink);
	}
	:global(html[data-theme="dark"]) .modal-head button:hover {
		color: #f2f2f7;
		color: var(--ink);
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
		font-size: 5rem;
		line-height: 1.1;
	}
	.inspect-facts {
		flex: 1;
		min-width: 0;
		font-size: 1.08rem;
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
		width: 8rem;
		height: 8rem;
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
	/* Reading chips and component doors: quiet buttons in the facts'
	own type, a hairline that firms up on hover. */
	.inspect-readings {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.4rem;
	}
	.inspect-reading,
	.inspect-part {
		font: inherit;
		padding: 0.05em 0.45em;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 999px;
		background: none;
		color: inherit;
	}
	.inspect-reading:hover,
	.inspect-part:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	.inspect-back {
		font-size: 1.3rem;
		line-height: 1;
		padding: 0.05rem 0.5rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 8px;
		background: none;
		color: inherit;
	}
	.inspect-back:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	/* Decomposition parts are buttons now: same ink and type as the
	spans they replaced, a hairline underline on hover as the only
	tell. */
	button.inspect-decomp-char {
		font: inherit;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		text-decoration: underline transparent;
		text-underline-offset: 0.15em;
		transition: text-decoration-color 0.15s ease;
	}
	button.inspect-decomp-char:hover {
		text-decoration-color: currentColor;
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
		font-size: 1.4rem;
	}
	/* Phones keep the compact box: the modal already fills the
	width there, and the bigger desktop type would wrap the facts. */
	:global(.app[data-android]) .inspect-char {
		font-size: 3.4rem;
	}
	:global(.app[data-android]) .inspect-svg {
		width: 5.5rem;
		height: 5.5rem;
	}
	:global(.app[data-android]) .inspect-facts {
		font-size: 1rem;
	}
	:global(.app[data-android]) .inspect-decomp {
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
	/* Close is a geometric X sized to the button's text: a text ×
	sits low on its font bearings. */
	.modal-head > button :global(.action-glyph) {
		height: 0.8em;
	}
</style>
