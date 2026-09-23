<!-- New-annotations dock: unsent drafts filed from this chat,
reviewed before sending (the filed half lives in the
previous-annotations sent-refs card on sent messages). The page owns
the annotations array, the open/highlight ids, and the
quote/copy/remove/stage/exclusion behaviors; this component owns the
dock markup and its surfaces (Svelte scoping binds the CSS to this
markup). No edit affordances live here: questions are asked through
the staged send-prompt pill, never revised in the overlay. -->
<script lang="ts">
	import {
		annotationCountLabel,
		canAddToPrompt,
		type Annotation,
		type AnnotationId
	} from "$lib/annotations";
	import ActionIcon from "./ActionIcon.svelte";

	/** Page-owned dock behaviors. */
	export interface ReviewDockActions {
		toggle: () => void;
		clearAll: () => void;
		quote: (ann: Annotation) => void;
		copy: (quote: string, comment: string) => void;
		remove: (id: AnnotationId) => void;
		stage: (id: AnnotationId) => void;
		unstage: (id: AnnotationId) => void;
		setExcluded: (id: AnnotationId, excluded: boolean) => void;
	}

	interface Props {
		items: Annotation[];
		open: boolean;
		/** Annotation currently staged in the send prompt (its row
		offers Unstage: the dock's way to close a no-send). */
		stagedId?: AnnotationId | null;
		highlightId?: AnnotationId | null;
		/** Pill button (the page parks focus here after actions). */
		pillEl?: HTMLButtonElement | null;
		actions: ReviewDockActions;
	}

	let {
		items,
		open,
		stagedId = null,
		highlightId = $bindable(null),
		pillEl = $bindable(null),
		actions
	}: Props = $props();
</script>

<!-- New-annotations dock: unsent drafts filed from
this chat, reviewed before sending (the filed half
lives in the previous-annotations sent-refs card on
sent messages). -->
<div class="ann-wrap" class:pinned={open}>
	<button
		type="button"
		class="ann-pill"
		bind:this={pillEl}
		title="Review annotations"
		aria-label={items.length === 1
			? "1 annotation"
			: `${items.length} annotations`}
		aria-expanded={open}
		onclick={actions.toggle}
	>
		{annotationCountLabel(items.length)}
	</button>
	<div
		class="review"
		role="dialog"
		aria-label="Annotations"
		data-fade-scroll
	>
		<div class="review-tools">
			<button
				type="button"
				aria-label="Delete all annotations"
				title="Delete all annotations"
				onclick={actions.clearAll}
			>
				Clear all
			</button>
		</div>
		{#each items as ann, n (ann.id)}
			<!-- Only the quote navigates: one jump per
			annotation, on the text itself. The note stays
			selectable, buttons keep their clicks (see
			reviewQuoteClick), drag-selects stay picks. -->
			<div
				class="review-item"
				class:highlight={highlightId === ann.id}
				class:omitted={ann.excludedFromPrompt === true}
			>
				<div class="review-head">
					<span class="review-num">{n + 1}.</span>
					<button
						type="button"
						class="review-quote"
						class:annotated={ann.answer !== undefined}
						title={ann.answer !== undefined
							? "Annotated text — jump to it in the chat"
							: "Jump to this annotation in the chat"}
						aria-label={ann.answer !== undefined
							? `Annotated text ${n + 1}: ${ann.quote}`
							: `Jump to annotation ${n + 1}`}
						onclick={() => actions.quote(ann)}
					>
						“{ann.quote}”
					</button>
					<button
						type="button"
						class="review-copy"
						title="Copy annotation"
						aria-label="Copy annotation {n + 1}"
						onclick={() => actions.copy(ann.quote, ann.comment)}
					>
						<ActionIcon kind="copy" />
					</button>
					<button
						type="button"
						class="review-omit"
						title={ann.excludedFromPrompt === true
							? "Add back to prompt inclusions"
							: "Remove from prompt inclusions (keeps the annotation)"}
						aria-label={ann.excludedFromPrompt === true
							? `Add annotation ${n + 1} back to prompt inclusions`
							: `Remove annotation ${n + 1} from prompt inclusions`}
						aria-pressed={ann.excludedFromPrompt === true}
						onclick={() =>
							actions.setExcluded(
								ann.id,
								ann.excludedFromPrompt !== true
							)}
					>
						{ann.excludedFromPrompt === true ? "Include" : "Omit"}
					</button>
					<button
						type="button"
						class="review-del"
						aria-label="Delete annotation {n + 1}"
						title="Delete annotation"
						onclick={() => actions.remove(ann.id)}
					>
						<ActionIcon kind="close" />
					</button>
				</div>
				<div class="review-head">
					<span class="review-label">-</span>
					<span class="review-comment">{ann.comment || "—"}</span>
					{#if stagedId === ann.id}
						<!-- The dock's way to close a no-send: unstages
						back here, deleting the send-prompt chip. -->
						<button
							type="button"
							class="review-add"
							title="Unstage this annotation (back to the drawer)"
							aria-label="Unstage annotation {n + 1}"
							onclick={() => actions.unstage(ann.id)}
						>
							Unstage
						</button>
					{:else if canAddToPrompt(ann)}
						<!-- The only Add-to-prompt in the app: blank
						questions stage their wording in the send prompt
						instead of baking a bare "?". The button rides
						the note row (far edge, like delete above) so
						the card stays two rows tall and never slides
						under the messages layer, where its clicks die. -->
						<button
							type="button"
							class="review-add"
							title="Stage this annotation in the send prompt"
							aria-label="Add annotation {n + 1} to prompt"
							onclick={() => actions.stage(ann.id)}
						>
							Add to prompt
						</button>
					{/if}
				</div>
				{#if ann.answer !== undefined}
					<!-- Answers display always: the reply that asked
					this annotation stays readable under it. -->
					<p class="review-answer">{ann.answer}</p>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.review {
		margin: 0.5rem 1.2rem 0;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		background: #fafafc;
		background: var(--panel);
		/* Box-sizing rode the shared width group in the page sheet
		(the group's width/margin lost to the absolute card below,
		but nothing overrode this). */
		box-sizing: border-box;
	}
	.review-item {
		border-radius: 8px;
		padding: 0.35rem 0.5rem;
		/* Default cursor throughout: only the quote button points (see
		.review-quote) — the row itself navigates nowhere. */
	}
	.review-item.highlight {
		background: #eef4ff;
		background: var(--hl);
	}
	.review-head {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		font-size: 1rem;
	}
	/* The note sits a breath below its quote: two stacked heads read
	as one card, never one crowded line. */
	.review-head + .review-head {
		margin-top: 0.45rem;
	}
	.review-head button {
		margin-left: auto;
		flex-shrink: 0;
		font-size: 0.85rem;
		color: #6e6e73;
		color: var(--muted);
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	.review-head button:hover {
		color: #1c1c1e;
		color: var(--ink);
		text-decoration: underline;
	}
	.review-num {
		font-weight: 700;
	}
	.review-label {
		color: #6e6e73;
		color: var(--muted);
		font-size: 0.85rem;
	}
	/* The quote is one line, cut with an ellipsis: long quotes
	never stretch the row (the full text lives at the mark — click
	to jump there). Pointer plus no-select: the quote is the jump
	control, never a pick. */
	.review-quote {
		/* A real button (keyboard reachable), reset to text: the UA
		button face must not leak into the row. */
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: 550;
		color: inherit;
		text-align: left;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
	}
	/* The note reads like a previous message's annotation
	(italic gloss on the quote, not body text): it rides the quiet
	voice so it stays readable on the white light-theme card, where
	the pale dark-card grey washes out. One line that scrolls
	sideways, so the full note fits without stretching the row. */
	.review-comment {
		color: #6e6e73;
		color: var(--muted);
		font-style: italic;
		white-space: nowrap;
		overflow-x: auto;
		min-width: 0;
	}
	/* Omitted inclusions dim but stay listed: the quote still
	jumps, the note still reads — only the send skips them. */
	.review-item.omitted .review-quote,
	.review-item.omitted .review-comment {
		opacity: 0.55;
	}
	/* Add to prompt: the solid primary pill (same fill as the send
	button) — the row's one call to action, never a quiet twin. */
	.review-add {
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		border-radius: 999px;
		padding: 0.28rem 0.9rem;
		border: 1px solid #007aff;
		border-color: var(--accent);
		background: #007aff;
		background: var(--accent);
		color: #fff;
		color: var(--accent-ink);
		transition: opacity 0.15s ease;
	}
	.review-add:hover {
		opacity: 0.8;
	}
	/* The answer always shows under its annotation: plain text at
	note size, never a popup-only reveal. */
	.review-answer {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
		line-height: 1.45;
		color: inherit;
		white-space: pre-wrap;
	}
	/* Annotated-text chip: the answered quote reads green, marking
	which text the answer below belongs to. */
	.review-head button.review-quote.annotated {
		background: #e6f4ea;
		background: var(--ok-wash);
		color: #1f7a4d;
		color: var(--ok);
		border-radius: 999px;
		padding: 0.05rem 0.55rem;
		font-weight: 600;
		text-decoration: none;
	}
	/* Merged pill: the wrap carries the single border; the count and ×
	buttons inside are bare segments. Later than the prompt tool buttons
	so the bare look wins (dark overrides below only recolor). */
	.ann-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 999px;
		background: none;
		padding: 0.2rem 0.35rem;
	}
	.ann-wrap > button {
		border: 0;
		background: none;
		padding: 0 0.3rem;
		font-size: 0.78rem;
		color: #6e6e73;
		color: var(--muted);
		cursor: pointer;
		/* Controls, not content: labels stay out of selections. */
		user-select: none;
		-webkit-user-select: none;
	}
	.ann-wrap > button:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	.ann-pill {
		font-weight: 650;
	}
	/* Clear-all heads the popup, top-right. */
	.review-tools {
		display: flex;
		justify-content: flex-end;
		padding: 0.35rem 0.2rem 0.1rem;
	}
	.review-tools button {
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 0.85rem;
		color: #6e6e73;
		color: var(--muted);
		padding: 0.1rem 0.3rem;
	}
	.review-tools button:hover {
		color: #94250a;
		color: var(--danger);
	}
	/* Phones track the chat text size in the review card: every fixed
	rem above scales with it (desktop keeps its compact sizes). The
	.app ancestor stays global (it renders paged, unscopable). */
	:global(.app[data-android]) .review-head {
		font-size: calc(0.82rem * var(--font-scale, 1));
	}
	:global(.app[data-android]) .review-head button,
	:global(.app[data-android]) .review-tools button,
	:global(.app[data-android]) .review-label {
		font-size: calc(0.75rem * var(--font-scale, 1));
	}
	:global(.app[data-android]) .review-head button.review-copy :global(.action-glyph) {
		height: calc(0.8rem * var(--font-scale, 1));
	}
	:global(.app[data-android]) .review-head button.review-del :global(.action-glyph) {
		height: calc(0.8rem * var(--font-scale, 1));
	}
	:global(.app[data-android]) .review-answer {
		font-size: calc(0.78rem * var(--font-scale, 1));
	}
	/* Omit/Include rides between copy and delete as quiet text:
	the row's only toggle, never an icon twin. Pressed (omitted)
	reads accent; hover underlines like the quote jump. */
	.review-head button.review-omit {
		flex-shrink: 0;
		align-self: center;
		font-size: 0.78rem;
		color: #6e6e73;
		color: var(--muted);
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.2rem;
		text-decoration: underline;
		text-decoration-color: transparent;
		transition: text-decoration-color 0.15s ease;
	}
	.review-head button.review-omit:hover {
		color: #1c1c1e;
		color: var(--ink);
		text-decoration-color: currentcolor;
	}
	.review-head button.review-omit[aria-pressed="true"] {
		color: #007aff;
		color: var(--accent);
		font-weight: 600;
	}
	/* Per-note copy rides at the row's end in the icon style:
	icon only, no text. margin-left:0 keeps it with the quote while
	the delete button's auto margin holds the row's right edge.
	Rows stay one line tall, so the icon never floats in dead
	space. */
	.review-head button.review-copy {
		display: inline-flex;
		align-items: center;
		align-self: center;
		margin-left: 0;
		flex-shrink: 0;
		color: #6e6e73;
		color: var(--muted);
		padding: 0.15rem;
		border-radius: 6px;
		/* Same 0.15s color beat as delete: both icons light up
		together instead of the copy snapping first. */
		transition: color 0.15s ease;
	}
	.review-head button.review-copy :global(.action-glyph) {
		height: 0.95rem;
	}
	.review-head button.review-copy:hover {
		color: #1c1c1e;
		color: var(--ink);
		/* Icon buttons never underline: the generic button hover above
		draws a line under the glyph that flashes during traversal and
		reads as the row jumping. */
		text-decoration: none;
	}
	/* Delete rides the row's far edge as a geometric X (same icon
	voice as copy), never a text × whose font bearings sit it low.
	All three icons self-center against the row's baseline text.
	Hover goes Clear-all red, never underlined. */
	.review-head button.review-del {
		margin-left: auto;
		flex: none;
		align-self: center;
		display: inline-flex;
		align-items: center;
		color: #6e6e73;
		color: var(--muted);
		padding: 0.15rem;
		border-radius: 6px;
		/* Same 0.15s color beat as copy. */
		transition: color 0.15s ease;
	}
	.review-head button.review-del :global(.action-glyph) {
		height: 0.95rem;
	}
	.review-head button.review-del:hover {
		color: #94250a;
		color: var(--danger);
		text-decoration: none;
	}
	/* The quote is a button (keyboard reachable) but reads as plain
	text: opt out of the generic head-button voice (far-edge auto
	margin, small muted type) the icon buttons use. flex-shrink
	re-opts into shrinking — the generic rule pins it off, which
	once let long quotes stretch the whole card instead of clipping. */
	.review-head button.review-quote {
		margin-left: 0;
		flex-shrink: 1;
		font-size: inherit;
		color: inherit;
		/* The underline fades in instead of snapping: the line is
		always drawn but transparent until hover (color, unlike the
		line itself, ramps on the icon beat). */
		text-decoration: underline;
		text-decoration-color: transparent;
		transition: text-decoration-color 0.15s ease;
	}
	/* The quote navigates, so it links: underline on hover like any
	jump control. (Icon buttons never underline — a line under a tiny
	glyph reads as the row jumping.) */
	.review-head button.review-quote:hover {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: currentcolor;
	}
	/* Annotation popover: collapsed to the pill, expands on hover,
	focus, or pinned click. Beats the centered-column group rule.
	Flush against the pill (no gap): the pointer travels straight
	from badge to popup without crossing dead hover space. */
	/* The pill sits at the prompt's right edge, so the card anchors
	right and grows up-and-left — growing right would run it off the
	column (and over the send button's airspace). The pill toggles
	it (pinned): no hover-open anywhere, so reaching for its buttons
	never flaps it shut. */
	.ann-wrap .review {
		position: absolute;
		/* Floats above the tools row with the pill exposed: the open
		card must never cover its own toggle (click-to-close would
		have no target). */
		bottom: calc(100% + 0.5rem);
		right: 0;
		z-index: 60;
		width: max-content;
		min-width: 16rem;
		max-width: min(30rem, calc(100vw - 3rem));
		max-height: 18rem;
		overflow-y: auto;
		margin: 0;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		/* display:none can't fade: the card always lays out but sits
		invisible and untouchable until the pill pins it. */
		visibility: hidden;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 0.16s ease,
			visibility 0.16s;
	}
	.ann-wrap .review-quote {
		overflow-wrap: anywhere;
	}
	/* Click-toggle only, like the sent-refs card above: hover
	flaps the panel while reaching for its buttons. The pill owns
	the state, so tabbing through never strands it open-or-shut. */
	.ann-wrap.pinned .review {
		visibility: visible;
		opacity: 1;
		pointer-events: auto;
	}
	/* Phone: the card anchors left of the paperclip by default — nudge
	it right so it covers the tools cluster instead of the draft. The
	.app ancestor stays global (it renders paged, unscopable). */
	:global(.app[data-android="true"]) .ann-wrap .review {
		right: -2.4rem;
	}
	/* Phones: the wrap sits inline in the tools row (order, static
	position) instead of floating. */
	:global(.app[data-android]) :global(.prompt-tools) .ann-wrap {
		order: 4;
		position: static;
	}
	/* Dock tools hide with the composer tools when the phone dock
	owns the composer (other half stays paged with the buttons). */
	:global(.app[data-android]) :global(.prompt:has(.ann-dock)) .ann-wrap {
		visibility: hidden;
		pointer-events: none;
	}
	/* Tool seating rides the dock's presence: the prompt reserves
	room for the wrap (and the mic+wrap pair) via :has(), matched at
	runtime in the DOM. Fully global — the prompt renders paged. */
	:global(.prompt:has(.ann-wrap)) :global(.ta-input) {
		--tools-pad: 9.5rem;
	}
	:global(.prompt:has(.mic-btn):has(.ann-wrap)) :global(.ta-input) {
		--tools-pad: 11.5rem;
	}
	:global(.app[data-android]) :global(.prompt-tools) .ann-wrap .review {
		position: absolute;
		left: 0.8rem;
		right: 0.8rem;
		bottom: calc(100% + 0.5rem);
		width: auto;
		max-height: min(26rem, 52dvh);
		margin: 0;
		overflow-y: auto;
		z-index: 40;
		font-size: calc(0.92rem * var(--font-scale, 1));
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
	}
</style>
