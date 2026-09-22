<!-- Baked-annotation refs card: filed annotations collapsed above a
sent message, count pill summoning the saved quotes. The page owns
the pop flag, the row-edit state (it focuses the box and guards
other gestures on it), the blink, and all behaviors; this component
owns the card markup and its surfaces. Pop/edit/box cross the
boundary as bindables (same pattern as the sidebar search box):
popOpen toggles here, the draft and its focus live here. The
`article` alignment rules stay global until the article itself
extracts (it renders paged for now). -->
<script lang="ts">
	import type { ChatMsgId } from "$lib/chat";
	import type { AnnotationRef } from "$lib/annotations";
	import { annotationCountLabel } from "$lib/annotations";
	import ActionIcon from "./ActionIcon.svelte";

	/** Page-owned card behaviors (state and effects stay in the page). */
	export interface SentRefsActions {
		clearAll: () => void;
		quoteClick: (quote: string, n: number) => void;
		copy: (quote: string, comment: string) => void;
		startEdit: (ref: AnnotationRef) => void;
		saveEdit: () => void;
		cancelEdit: () => void;
	}

	export interface SentRefsEdit {
		messageId: ChatMsgId;
		n: number;
	}

	interface Props {
		msgId: ChatMsgId;
		role: "user" | "assistant";
		android: boolean;
		sentRefs: { refs: AnnotationRef[] };
		/** Which message's card stands open (toggled here). */
		popOpen: ChatMsgId | null;
		/** Row under edit (read here; owned by the page). */
		editing: SentRefsEdit | null;
		/** Edit draft + box (bound here; focused by the page). */
		editDraft: string;
		editBox: HTMLInputElement | null;
		/** Jump-flash target (read here; owned by the page). */
		blink: SentRefsEdit | null;
		actions: SentRefsActions;
	}

	let {
		msgId,
		role,
		android,
		sentRefs,
		popOpen = $bindable(null),
		editing,
		editDraft = $bindable(""),
		editBox = $bindable(null),
		blink,
		actions
	}: Props = $props();
</script>

<!-- Previous-annotations card: filed annotations baked onto a sent
message, collapsed above it. The count stays visible like the
composer pill; hovering (or tabbing to) the number itself reveals
the saved quotes. Provider context is unaffected — only the display
is redacted. A refs-only message always shows the pill: unfolded,
its body is just an em-dash (see REFS_ONLY_BODY). -->
<div class="ann-refs" class:open={popOpen === msgId}>
	<button
		type="button"
		class="ann-refs-pill"
		aria-label={sentRefs.refs.length === 1
			? "1 annotation"
			: `${sentRefs.refs.length} annotations`}
		aria-expanded={popOpen === msgId}
		onclick={() => (popOpen = popOpen === msgId ? null : msgId)}
	>
		{annotationCountLabel(sentRefs.refs.length)}
	</button>
	<div class="ann-refs-pop" role="tooltip">
		{#if role === "user"}
			<!-- Sent-card Clear-all: strip the baked block, keeping the
			bare prompt (a refs-only message clears to nothing and is
			deleted). -->
			<div class="ann-refs-head">
				<button
					type="button"
					class="ann-refs-clear"
					title="Remove every baked annotation from this message"
					aria-label="Clear all sent annotations"
					onclick={() => actions.clearAll()}
				>
					Clear all
				</button>
			</div>
		{/if}
		{#each sentRefs.refs as ref (ref.n)}
			<!-- Only the quote navigates, like the composer card: one
			jump per annotation, on the text itself. The note stays
			selectable, buttons keep their clicks (see refsQuoteClick),
			drag-selects stay picks. -->
			<div
				class="ann-refs-item"
				class:blink={blink?.messageId === msgId && blink?.n === ref.n}
			>
				<span class="ann-refs-num">{ref.n}.</span>
				<span class="ann-refs-body">
					<button
						type="button"
						class="ann-refs-quote"
						title="Jump to this annotation in the chat"
						onclick={() => actions.quoteClick(ref.quote, ref.n)}
					>
						“{ref.quote}”
					</button>
					{#if editing?.messageId === msgId && editing.n === ref.n}
						<!-- Desktop row edit (see startRefsEdit): a
						single-line field — newlines would break the baked
						block shape. Enter saves, Escape cancels (global). -->
						<input
							type="text"
							class="ann-refs-input"
							bind:this={editBox}
							bind:value={editDraft}
							aria-label="Edit note {ref.n}. Enter saves, Escape cancels."
							onkeydown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									actions.saveEdit();
								}
							}}
						/>
					{:else if ref.comment}
						<span class="ann-refs-comment">{ref.comment}</span>
					{/if}
				</span>
				{#if editing?.messageId === msgId && editing.n === ref.n}
					<button
						type="button"
						class="ann-refs-edit-btn"
						onclick={() => actions.saveEdit()}
					>
						Save
					</button>
					<button
						type="button"
						class="ann-refs-edit-btn"
						onclick={() => actions.cancelEdit()}
					>
						Cancel
					</button>
				{:else}
					<button
						type="button"
						class="ann-refs-copy"
						title="Copy annotation"
						aria-label="Copy annotation {ref.n}"
						onclick={() => actions.copy(ref.quote, ref.comment)}
					>
						<ActionIcon kind="copy" />
					</button>
					{#if !android}
						<!-- Desktop only: phones never edited previous
						notes in place (no pencil there today), and the
						row stays a clean jump target. -->
						<button
							type="button"
							class="ann-refs-pencil"
							data-refs-pencil={ref.n}
							title="Edit note"
							aria-label="Edit note {ref.n}"
							onclick={() => actions.startEdit(ref)}
						>
							<ActionIcon kind="pencil" />
						</button>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	/* Baked-refs count floats above the message (overlay, never
	in-flow): annotated history keeps the exact dimensions of plain
	history. No circle, no border — just the number, quiet. */
	.ann-refs {
		position: absolute;
		top: -1.2rem;
		/* Span the message: the card below fills this box, so the
		sent menu is the full chat width, not a 24rem strip. */
		left: 0.8rem;
		right: 0.8rem;
		display: flex;
		margin: 0;
	}
	/* The pill floats above its message into the gap: a refs-carrying
	article stands further off the previous message so the count never
	crowds the row above. The article renders paged for now, so its
	ancestor stays global. */
	:global(article):has(.ann-refs) {
		margin-top: calc(var(--msg-gap, 0.35rem) + 1.1rem);
	}
	:global(article.user) .ann-refs {
		/* The user bubble is narrow: span it like above, but keep
		the count hugging its right edge. */
		justify-content: flex-end;
	}
	.ann-refs-pill {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: #6e6e73;
		/* The count tracks the chat text size like badges do (dampened:
		never compounding rem, just the message scale). */
		font-size: calc(0.72rem * var(--font-scale, 1));
		font-weight: 650;
		line-height: 1.4;
		padding: 0 0.1rem;
		/* A disclosure button like any other: the hand invites the
		click that toggles its card (in-text badges already point). */
		cursor: pointer;
	}
	/* Opens overlapping its number pill (flush with the row's bottom
	edge): the cursor is already inside the card the moment it
	appears, so hovering the number never needs a travel gap. The
	invisible bridge below stays as backstop for the fade. */
	.ann-refs-pop {
		position: absolute;
		bottom: 0;
		/* Fill the stretched container (see .ann-refs): the menu is
		as wide as the message, never the old 24rem strip. Narrow
		user bubbles keep the 14rem floor, extending left. */
		left: 0;
		right: 0;
		z-index: 40;
		min-width: min(14rem, calc(100vw - 2rem));
		/* Backstop only: the container already lives inside the
		chat column, so this bites on nothing reachable. */
		max-width: calc(100vw - 2rem);
		/* Twice as tall as before (a long list on the first message
		still scrolls in place instead of shooting past the top —
		the viewport bound stays). */
		max-height: min(60vh, 48rem);
		overflow-y: auto;
		background: #1c1c1e;
		color: #f2f2f7;
		/* Transparent by default so the light theme can paint just
		the edge without shifting geometry on theme switch. */
		border: 1px solid transparent;
		border-radius: 10px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		padding: 0.55rem 0.75rem;
		/* Tracks the chat text size like the count pill above it,
		so the saved quotes never sit tiny under huge type. */
		font-size: calc(0.8rem * var(--font-scale, 1));
		line-height: 1.45;
		/* Notes stay selectable for copying: the article disables
		selection outside .rendered, so re-enable it here (the quote
		keeps its own none as the jump control). */
		user-select: text;
		-webkit-user-select: text;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}
	:global(article.user) .ann-refs-pop {
		/* Right-anchored: a narrow bubble's floor extends left,
		like before, instead of spilling right past the screen. */
		left: auto;
		right: 0;
		width: 100%;
	}
	/* The number itself summons the card — not the row around it. The
	invisible bridge keeps it open while crossing into the card. */
	.ann-refs-pill::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		bottom: 100%;
		height: 0.5rem;
	}
	/* Click-toggle only — no hover-open anywhere: hover flaps the
	card while reaching for its buttons (a copy click reads as a
	jump when the card reopens under the cursor). The pill is a
	plain disclosure button, so Enter/Space toggle like a click. */
	.ann-refs.open .ann-refs-pop,
	.ann-refs-pop:hover {
		opacity: 1;
		pointer-events: auto;
	}
	.ann-refs-item {
		/* Draft-card order per line (quote + copy up top, note +
		pencil below): the DOM keeps body grouping, so the grid
		flattens it (display: contents below) and places each
		control into its line/column explicitly. */
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		column-gap: 0.45rem;
		row-gap: 0.3rem;
		align-items: center;
		padding: 0.2rem 0;
		/* Default cursor on the row: only the quote points (like the
		draft card). The row still jumps on a clean press — the quote
		is the promise, the row keeps the target generous. */
		cursor: default;
	}
	.ann-refs-item + .ann-refs-item {
		border-top: 1px solid rgba(255, 255, 255, 0.14);
	}
	/* Pressed-row blink: same wash as the draft rows, so a sent
	jump reads even where the highlight wash can't paint. */
	.ann-refs-item.blink {
		background: #eef4ff;
		background: var(--hl);
		border-radius: 6px;
	}
	.ann-refs-num {
		font-weight: 700;
		flex-shrink: 0;
		grid-column: 1;
		grid-row: 1 / span 2;
	}
	/* Quote line then note line: the note reads below the thing
	annotated, never squeezed to its right. The body is layout
	transparent (contents) so the item grid places the quote,
	copy, note, and pencil into their own cells. */
	.ann-refs-body {
		display: contents;
	}
	.ann-refs-quote {
		grid-column: 2;
		grid-row: 1;
	}
	.ann-refs-comment,
	.ann-refs-input {
		grid-column: 2;
		grid-row: 2;
	}
	.ann-refs-copy {
		grid-column: 3;
		grid-row: 1;
		margin-left: 0;
	}
	.ann-refs-pencil {
		grid-column: 3;
		grid-row: 2;
	}
	/* Edit mode: Save takes the copy slot, Cancel the cell after
	(Save-then-Cancel like the draft card). */
	.ann-refs-edit-btn {
		grid-column: 3;
		grid-row: 1;
	}
	button.ann-refs-edit-btn + button.ann-refs-edit-btn {
		grid-column: 4;
	}
	/* Only the quote navigates (see refsQuoteClick): unselectable
	quote with a pointer cursor, so a click reads as a jump and
	never as a text pick. The quote is one line, cut with an
	ellipsis — the full text lives at the mark. Notes stay
	selectable for copying, on one line that scrolls sideways. */
	.ann-refs-quote {
		/* A real button (keyboard reachable), reset to text. */
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		text-decoration: underline;
		text-decoration-color: transparent;
		transition: text-decoration-color 0.15s ease;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Same link contract as the composer card's quote — including
	the fading underline (line always drawn, transparent at rest). */
	.ann-refs-quote:hover {
		text-decoration: underline;
		text-decoration-color: currentcolor;
	}
	/* Italic gloss on the quote: pale grey on the dark card, the
	quiet voice on light (see the theme block below) — same role as
	the draft card's note. The row editor below stays roman, like
	every other field. */
	.ann-refs-comment {
		color: #c7c7cc;
		font-style: italic;
		white-space: nowrap;
		overflow-x: auto;
		min-width: 0;
	}
	/* Per-annotation copy in the sent-refs card: icon only, no text,
	in the quote line's end cell (see the item grid above). */
	.ann-refs-copy {
		flex: none;
		align-self: center;
		display: inline-flex;
		border: 0;
		background: none;
		color: #c7c7cc;
		cursor: pointer;
		padding: 0.1rem;
		border-radius: 6px;
	}
	.ann-refs-copy :global(.action-glyph) {
		/* Same chat-text tracking as the card around it. */
		height: calc(0.75rem * var(--font-scale, 1));
	}
	.ann-refs-copy:hover {
		color: #fff;
	}
	/* Row pencil: same icon-only voice as the copy button, in the
	note line's end cell (see the item grid above). */
	.ann-refs-pencil {
		flex: none;
		align-self: center;
		display: inline-flex;
		border: 0;
		background: none;
		color: #c7c7cc;
		cursor: pointer;
		padding: 0.1rem;
		border-radius: 6px;
	}
	.ann-refs-pencil :global(.action-glyph) {
		height: calc(0.75rem * var(--font-scale, 1));
	}
	.ann-refs-pencil:hover {
		color: #fff;
	}
	/* Row note editor: a single-line field in the comment's slot, so
	the row never grows — long drafts scroll sideways like the note
	they replace. */
	.ann-refs-input {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		color: #f2f2f7;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 6px;
		padding: 0.15rem 0.4rem;
		min-width: 0;
	}
	.ann-refs-input:focus {
		outline: none;
		border-color: rgba(255, 255, 255, 0.45);
	}
	/* Save/Cancel take the icon buttons' slots at the row's end. */
	.ann-refs-edit-btn {
		flex: none;
		align-self: center;
		border: 1px solid rgba(255, 255, 255, 0.25);
		border-radius: 6px;
		background: none;
		color: #f2f2f7;
		font: inherit;
		font-size: 0.85em;
		padding: 0.15rem 0.5rem;
		cursor: pointer;
	}
	.ann-refs-edit-btn:hover {
		border-color: #aeaeb2;
	}
	/* Sent-card head: Clear-all rides top-right like the draft
	card's tools row (same quiet voice, danger on hover). */
	.ann-refs-head {
		display: flex;
		justify-content: flex-end;
		padding: 0.15rem 0.1rem 0.05rem;
	}
	.ann-refs-clear {
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 0.85rem;
		color: #c7c7cc;
		padding: 0.1rem 0.3rem;
	}
	.ann-refs-clear:hover {
		color: #ff6961;
		color: var(--danger);
	}
	/* Light theme: the sent card matches the draft card (panel
	surface, soft edge, ink text) instead of floating dark. */
	:global(html[data-theme="light"]) .ann-refs-pop {
		background: #fafafc;
		background: var(--panel);
		color: #1c1c1e;
		color: var(--ink);
		border-color: #e5e5ea;
		border-color: var(--line-soft);
	}
	:global(html[data-theme="light"]) .ann-refs-item + .ann-refs-item {
		border-top-color: #e5e5ea;
		border-top-color: var(--line-soft);
	}
	:global(html[data-theme="light"]) .ann-refs-comment {
		color: #6e6e73;
		color: var(--muted);
	}
	:global(html[data-theme="light"]) .ann-refs-copy,
	:global(html[data-theme="light"]) .ann-refs-pencil {
		color: #6e6e73;
		color: var(--muted);
	}
	:global(html[data-theme="light"]) .ann-refs-copy:hover,
	:global(html[data-theme="light"]) .ann-refs-pencil:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	:global(html[data-theme="light"]) .ann-refs-input {
		color: #1c1c1e;
		color: var(--ink);
		background: #fff;
		background: var(--field);
		border-color: #c7c7cc;
		border-color: var(--line);
	}
	:global(html[data-theme="light"]) .ann-refs-input:focus {
		border-color: #8e8e93;
		border-color: var(--line-hover);
	}
	:global(html[data-theme="light"]) .ann-refs-edit-btn {
		border-color: #c7c7cc;
		border-color: var(--line);
		color: #1c1c1e;
		color: var(--ink);
	}
	:global(html[data-theme="light"]) .ann-refs-edit-btn:hover {
		border-color: #3a3a3c;
		border-color: var(--focus);
	}
</style>
