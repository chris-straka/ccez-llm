<!-- New-annotations dock: unsent drafts filed from this chat,
reviewed before sending (the filed half lives in the
previous-annotations sent-refs card on sent messages). The page owns
the annotations array, the open/edit/highlight ids, the draft, and
the save/quote/copy/remove behaviors; this component owns the dock
markup, the inline editor, and their surfaces (Svelte scoping binds
the CSS to this markup). -->
<script lang="ts">
	import {
		annotationCountLabel,
		reviewEditKey,
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
		save: (id: AnnotationId) => void;
		pencil: (id: AnnotationId) => void;
	}

	interface Props {
		items: Annotation[];
		open: boolean;
		editingId?: AnnotationId | null;
		draft?: string;
		box?: HTMLTextAreaElement | null;
		highlightId?: AnnotationId | null;
		/** Pill button (the page parks focus here after saves). */
		pillEl?: HTMLButtonElement | null;
		actions: ReviewDockActions;
	}

	let {
		items,
		open,
		editingId = $bindable(null),
		draft = $bindable(""),
		box = $bindable(null),
		highlightId = $bindable(null),
		pillEl = $bindable(null),
		actions
	}: Props = $props();

	function focusPill(): void {
		pillEl?.focus({ preventScroll: true });
	}

	function cancelEdit(): void {
		editingId = null;
		highlightId = null;
		// Cancel unmounts the focused textarea:
		// park focus on the pill or the
		// overlay drops on touch.
		focusPill();
	}

	function editKey(event: KeyboardEvent, id: AnnotationId): void {
		const action = reviewEditKey(event.key, event.shiftKey);
		if (action === "save") {
			event.preventDefault();
			actions.save(id);
		} else if (action === "cancel") {
			event.preventDefault();
			cancelEdit();
		}
	}
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
			? "1 unsent annotation"
			: `${items.length} unsent annotations`}
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
			>
				<div class="review-head">
					<span class="review-num">{n + 1}.</span>
					<button
						type="button"
						class="review-quote"
						title="Jump to this annotation in the chat"
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
						class="review-del"
						aria-label="Delete annotation {n + 1}"
						title="Delete annotation"
						onclick={() => actions.remove(ann.id)}
					>
						<ActionIcon kind="close" />
					</button>
				</div>
				{#if editingId === ann.id}
					<label>
						<span class="review-label">-</span>
						<textarea
							rows="2"
							bind:this={box}
							bind:value={draft}
							placeholder="Add an optional annotation…"
							aria-label="Edit annotation. Enter saves, Shift+Enter adds a line, Escape cancels."
							onkeydown={(e) => editKey(e, ann.id)}></textarea>
					</label>
					<div class="review-edit-actions">
						<button type="button" onclick={() => actions.save(ann.id)}
							>Save</button
						>
						<button type="button" onclick={cancelEdit}>Cancel</button>
					</div>
				{:else}
					<div class="review-head">
						<span class="review-label">-</span>
						<span class="review-comment">{ann.comment || "—"}</span>
						<button
							type="button"
							class="review-pencil"
							title="Edit annotation"
							aria-label="Edit annotation {n + 1}"
							onclick={() => {
								// Desktop edits at the mark in the
								// floating card, phones in the
								// composer (see
								// editAnnotationAtMark) — the
								// inline textarea below stays
								// retired.
								highlightId = ann.id;
								actions.pencil(ann.id);
							}}
						>
							<ActionIcon kind="pencil" />
						</button>
					</div>
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
	.review label {
		display: block;
		font-size: 1rem;
		margin-top: 0.3rem;
	}
	.review textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin-top: 0.25rem;
		font: inherit;
		color: inherit;
		background: #fff;
		background: var(--field);
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		padding: 0.4rem 0.6rem;
		resize: vertical;
	}
	.review textarea:focus {
		outline: none;
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	/* The edit box stays readable in dark mode: the near-black field
	surface swallows typed text under dim panels, so edits ride a
	raised surface with light ink instead. */
	:global(html[data-theme="dark"]) .review textarea {
		background: #3a3a3c;
		color: #f2f2f7;
		border-color: #636366;
	}
	:global(html[data-theme="dark"]) .review textarea::placeholder {
		color: #aeaeb2;
	}
	/* Save is the solid primary pill (same fill as the send button);
	Cancel is quiet text — the two never look like twins. */
	.review-edit-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.35rem;
	}
	.review-edit-actions button {
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		border-radius: 999px;
		padding: 0.28rem 0.9rem;
		border: 1px solid #1c1c1e;
		border-color: var(--invert);
		background: #1c1c1e;
		background: var(--invert);
		color: #fff;
		color: var(--invert-ink);
		/* On the base (not :hover) so Save and Cancel animate
		symmetrically in and back out, instead of snapping one way. */
		transition:
			opacity 0.15s ease,
			color 0.15s ease,
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.review-edit-actions button:hover {
		opacity: 0.8;
	}
	/* Light theme Save: the accent fill like the send button (dark keeps
	the inverted fill). Cancel rides the quiet rule below, untouched. */
	:global(html[data-theme="light"])
		.review-edit-actions
		button:not(:last-child) {
		border-color: #007aff;
		border-color: var(--accent);
		background: #007aff;
		background: var(--accent);
		color: #fff;
	}
	.review-edit-actions button:last-child {
		border-color: transparent;
		background: none;
		color: #6e6e73;
		color: var(--muted);
		font-weight: 400;
	}
	.review-edit-actions button:last-child:hover {
		opacity: 1;
		color: #1c1c1e;
		color: var(--ink);
		text-decoration: underline;
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
	:global(.app[data-android]) .review label {
		font-size: calc(0.82rem * var(--font-scale, 1));
	}
	:global(.app[data-android]) .review-head button.review-copy :global(.action-glyph) {
		height: calc(0.8rem * var(--font-scale, 1));
	}
	:global(.app[data-android]) .review-head button.review-del :global(.action-glyph) {
		height: calc(0.8rem * var(--font-scale, 1));
	}
	/* Per-note edit is a pencil in the message-action style (same
	stroke icon, same quiet gray) instead of a text button. It rides
	right after the note text — not margin-left:auto at the card's far
	edge, where the cursor overshoots the card reaching it and the
	whole overlay drops. */
	.review-head button.review-pencil {
		display: inline-flex;
		align-items: center;
		/* Top of the note line, not the row's middle: centered sits
		a breath low next to the italic note. */
		align-self: flex-start;
		margin-top: 0.2em;
		margin-left: 0;
		flex-shrink: 0;
		color: #6e6e73;
		color: var(--muted);
		padding: 0.15rem;
		border-radius: 6px;
		/* On the base (not :hover) so the color animates symmetrically
		in and back out, instead of snapping one way. */
		transition: color 0.15s ease;
	}
	.review-head button.review-pencil :global(.action-glyph) {
		height: 0.95rem;
	}
	/* Per-note copy rides at the row's end in the pencil's style:
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
		/* Same 0.15s color beat as the pencil: all three icons light
		up together instead of the copy snapping first. */
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
		/* Same 0.15s color beat as copy and pencil. */
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
	/* Hover goes accent-blue instead of going ink: the pencil is small
	and quiet-gray, so an ink hover read as disappearing. Color only —
	no background, no glow, no underline: the signal stays inside the
	glyph's own box. */
	.review-head button.review-pencil:hover {
		color: #007aff;
		color: var(--accent);
		text-decoration: none;
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
	/* Thumb-sized edit targets on phones. */
	:global(.app[data-android]) .review-edit-actions button {
		padding: 0.6rem 1.2rem;
		min-height: 2.75rem;
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
