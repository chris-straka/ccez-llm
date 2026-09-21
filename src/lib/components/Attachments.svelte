<!-- Attachment strip: pills and image/pasted-text cards floating over the
thread above the composer, plus the drag-to-scroll strip gesture. The page
owns the attachments array, the expanded-pill set, the drag flag, the OCR
busy id, and the editor/toast side effects; this component owns the strip
markup, the card buttons, and the surfaces (Svelte scoping binds the CSS
to this markup). The inline error line stays paged: it renders in the
page's shared `.error` look, while the strip renders (possibly empty)
whenever the tray area is active. -->
<script lang="ts">
	import {
		fileExcerpt,
		formatTokenCount,
		isPastedTextAttachment,
		type Attachment
	} from "$lib/attachments";
	import ActionIcon from "./ActionIcon.svelte";

	/** Page-owned behaviors the strip and card buttons drive. */
	export interface AttachmentsActions {
		dragStart: (event: PointerEvent) => void;
		dragMove: (event: PointerEvent) => void;
		dragEnd: (event: Event) => void;
		clickGate: (event: MouseEvent) => void;
		toggleExpand: (id: string) => void;
		copy: (att: Attachment) => void;
		recognize: (att: Attachment) => void;
		remove: (id: string) => void;
	}

	interface Props {
		/** Owned by the page (add/remove sync the editor markers). */
		attachments: Attachment[];
		/** Expanded pasted-text pill ids (excerpt ↔ full text). */
		expanded: string[];
		/** Strip pan in progress: cards show the fist. */
		dragging: boolean;
		/** Attachment id with OCR in flight (its button shows …). */
		busyId: string | null;
		/** Composer idle: the strip rides the prompt's slide/fade. */
		idle: boolean;
		/** Inline notice text (tray-active condition only; the line itself
		stays paged in the shared `.error` look). */
		inlineError: string | null;
		actions: AttachmentsActions;
	}

	let {
		attachments,
		expanded,
		dragging,
		busyId,
		idle,
		inlineError,
		actions
	}: Props = $props();
</script>

{#if attachments.length > 0 || inlineError}
	<ul
		class="attachments"
		class:composer-idle={idle}
		class:dragging
		onpointerdown={actions.dragStart}
		onpointermove={actions.dragMove}
		onpointerup={actions.dragEnd}
		oncancel={actions.dragEnd}
		onpointercancel={actions.dragEnd}
		ondragstart={(event) => event.preventDefault()}
		onclickcapture={actions.clickGate}
	>
		{#each attachments as att (att.id)}
			{@const pasted = isPastedTextAttachment(att) && att.text !== null}
			{@const pastedBody = att.text ?? ""}
			{@const pastedOpen = expanded.includes(att.id)}
			<li class:card={(att.kind === "image" && !!att.dataUrl) || pasted}>
				{#if att.kind === "image" && att.dataUrl}
					<!-- Inert thumbnail: clicking previews nothing
					(the big peek is gone) — it only drags the row. -->
					<span class="thumb" aria-hidden="true">
						<img src={att.dataUrl} alt="" draggable="false" />
					</span>
				{:else if !pasted}
					<span class="file-kind" aria-hidden="true">FILE</span>
				{/if}
				{#if pasted}
					<!-- Pasted-text card: same card as images, with
					the text filling the thumbnail's seat (clamped,
					ellipsis) instead of a picture. The preview
					toggles the full text; copy and remove below are
					the shared card buttons. -->
					<button
						type="button"
						class="paste-body"
						class:open={pastedOpen}
						aria-expanded={pastedOpen}
						aria-label={pastedOpen
							? "Collapse pasted text"
							: "Expand pasted text"}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => actions.toggleExpand(att.id)}
					>
						{pastedOpen ? pastedBody : fileExcerpt(pastedBody)}
					</button>
					<span class="file-kind" aria-hidden="true">PASTE</span>
					<span class="tok" title="{att.tokens} tokens"
						>{pastedBody.length} chars</span
					>
				{:else}
					<span class="name" title="{att.name} · ~{att.tokens} tokens"
						>{att.name}</span
					>
					<span class="tok" title="{att.tokens} tokens"
						>{formatTokenCount(att.tokens)}</span
					>
				{/if}
				<button
					type="button"
					class="card-btn"
					aria-label="Copy attachment"
					title="Copy attachment"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => actions.copy(att)}
				>
					<ActionIcon kind="copy" />
				</button>
				{#if att.kind === "image" && att.dataUrl}
					<button
						type="button"
						class="ocr-btn"
						aria-label="Recognize text in image"
						title="Recognize text in image"
						disabled={busyId === att.id}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => actions.recognize(att)}
					>
						{busyId === att.id ? "…" : "OCR"}
					</button>
				{/if}
				<button
					type="button"
					class="card-btn"
					aria-label="Remove attachment"
					title="Remove attachment"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => actions.remove(att.id)}
				>
					<ActionIcon kind="close" />
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.attachments {
		position: absolute;
		left: 1.2rem;
		right: 1.2rem;
		z-index: 25;
		/* Gaps stay thread territory (selectable, scrollable): only
		the pills and cards take pointer events. */
		pointer-events: none;
		list-style: none;
		display: flex;
		/* Cards set the row height; lesser pills center instead of
		stretching into tall capsules beside them. */
		align-items: center;
		flex-wrap: nowrap;
		gap: 0.4rem;
		margin: 0 1.2rem;
		padding: 0.3rem 0 0.15rem;
		box-sizing: border-box;
		max-width: calc(100% - 2.4rem);
		overflow-x: auto;
		/* Plain scrolling row, never a bar: revealing one on hover
		reshapes the row on classic scrollbars, so every card jumps
		a few pixels. Scroll still works (wheel, touch, drag, keys);
		clipped cards are the affordance. */
		scrollbar-width: none;
		/* Pinned tray width (was the shared width group in the page
		stylesheet): the strip never grows with the chat slider. */
		width: calc(100% - 2.4rem);
		max-width: calc(var(--chat-width, 36) * 1rem);
		margin-left: auto;
		margin-right: auto;
	}
	.attachments::-webkit-scrollbar {
		width: 0;
		height: 0;
	}
	.attachments li {
		display: flex;
		align-items: center;
		pointer-events: auto;
		gap: 0.25rem;
		flex-shrink: 0;
		font-size: 0.78rem;
		background: #eef4ff;
		background: var(--hl);
		border-radius: 999px;
		padding: 0.25rem 0.3rem 0.25rem 0.7rem;
		max-width: 100%;
		/* Overflowing rows pan by hand: the card is the grip. */
		cursor: grab;
	}
	/* While the pan owns the gesture every card shows the fist. */
	.attachments.dragging li,
	.attachments.dragging li button {
		cursor: grabbing;
	}
	.attachments .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 16rem;
	}
	.attachments .tok {
		flex: none;
		white-space: nowrap;
		color: #6e6e73;
		color: var(--muted);
	}
	/* Pasted-text pill body: excerpt preview, single-line like the
	file name; expanded it scrolls in place instead of growing the
	strip. */
	.attachments .paste-body {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 16rem;
		text-align: left;
		border-radius: 0.5rem;
		padding: 0.1rem 0.3rem;
	}
	.attachments .paste-body.open {
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 8rem;
		max-width: 20rem;
		overflow: auto;
		text-overflow: clip;
	}
	.attachments button {
		border: 0;
		background: none;
		cursor: pointer;
		color: #3a3a3c;
		color: var(--ink);
	}
	.attachments .thumb {
		border: 0;
		background: none;
		line-height: 0;
		padding: 0;
	}
	/* Image cards: thumbnail preview up top, token/copy/OCR/X footer
	below (the strip itself stays one scrolling row — only the card
	wraps internally). The blue wash is back on the card: it reads
	as one basic pill-card over the thread, text visible between
	the cards. */
	.attachments li.card {
		flex-wrap: wrap;
		row-gap: 0.3rem;
		border-radius: 12px;
		padding: 0.4rem 0.5rem;
		max-width: 12rem;
		align-items: center;
		background: #eef4ff;
		background: var(--hl);
	}
	.attachments li.card .thumb {
		flex: 1 1 100%;
	}
	.attachments .thumb img {
		display: block;
		width: 100%;
		height: 4.5rem;
		object-fit: cover;
		border-radius: 8px;
	}
	/* Pasted-text cards: the same 12rem card as images, with the
	pasted text filling the thumbnail's seat (same 4.5rem) instead
	of a picture — four clamped lines with an ellipsis, never a
	tall pill. The footer (PASTE, chars, copy, X) matches the image
	card's row. */
	.attachments li.card .paste-body {
		flex: 1 1 100%;
		max-width: none;
		height: 4.5rem;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
		white-space: normal;
		text-align: left;
		border-radius: 8px;
		padding: 0.1rem 0.3rem;
	}
	/* Expanded preview scrolls in place like the old pill: same
	card footprint, full text, no strip growth. */
	.attachments li.card .paste-body.open {
		display: block;
		max-width: none;
		max-height: none;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-y: auto;
		text-overflow: clip;
	}
	/* Card buttons are icon-only (message-button copy glyph, close
	glyph), sized to the card's font so they track it. */
	.attachments .card-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem;
		font-size: 0.78rem;
	}
	.attachments .card-btn :global(.action-glyph) {
		height: 1em;
	}
	.attachments .ocr-btn {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 0.1rem 0.25rem;
		border-radius: 6px;
	}
	.attachments .ocr-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.file-kind {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: #6e6e73;
	}
	/* Mobile light theme: the blue wash already shouts — the kind
	pills and OCR read quieter at semibold instead of bold. */
	:global(html[data-theme="light"]) :global(.app[data-android]) .file-kind,
	:global(html[data-theme="light"]) :global(.app[data-android]) .attachments .ocr-btn {
		font-weight: 600;
	}
	/* Dark theme: the pill × keeps its rule (light --focus against
	dark --ink); strip buttons ride light ink. */
	:global(html[data-theme="dark"]) .attachments button {
		color: #f2f2f7;
	}
	/* Idle-hide rides the prompt's slide/fade so no pill lingers over
	the chat, and restores with it on the next input. */
	.attachments {
		transition:
			transform 0.25s ease,
			opacity 0.25s ease,
			visibility 0s;
	}
	.attachments.composer-idle {
		/* Same 0.75rem settle and ramp as the card: the old
		full-height slide outran the prompt — taller trays visibly
		faster. The fade does the hiding; the slide just settles. */
		transform: translateY(0.75rem);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			transform 0.25s ease,
			opacity 0.25s ease,
			visibility 0s linear 0.25s;
	}
	/* Reduced motion settles the summon instantly: no slide, no fade
	ramp on the strip — what lands is the final frame. */
	@media (prefers-reduced-motion: reduce) {
		.attachments {
			transition: none;
		}
	}
</style>
