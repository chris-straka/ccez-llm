<!-- Sent-message attachment folds: file tags above the body and image
folds inline with the prose. One component for both (same models,
same popup card, same actions); the page renders it twice per
message with pre-filtered models and owns the expand state
(expandedTags) plus all behaviors. The popup classes stay :global
(half the tags ride raw {@html} from the message body, which
carries no Svelte scope hash). The `article.user` alignment rules
stay global too until the article itself extracts (the article
renders paged for now). -->
<script lang="ts">
	import type { Attachment, AttachTagModel } from "$lib/attachments";
	import {
		FILE_MARKER,
		IMAGE_MARKER,
		fileExcerpt,
		formatTokenCount
	} from "$lib/attachments";
	import ActionIcon from "./ActionIcon.svelte";

	/** Page-owned fold behaviors (expand state lives in the page). */
	export interface SentAttachmentsActions {
		toggle: (id: string) => void;
		copy: (att: Attachment) => void;
		recognize: (att: Attachment) => void;
	}

	interface Props {
		/** File-tag row ("tags") or inline image folds ("inline"). */
		variant: "tags" | "inline";
		/** Pre-filtered models (text kinds for tags, image for inline). */
		models: AttachTagModel[];
		attachments: Attachment[];
		ocrBusyId: string | null;
		actions: SentAttachmentsActions;
	}

	let { variant, models, attachments, ocrBusyId, actions }: Props = $props();
</script>

{#if models.length > 0}
	{#if variant === "tags"}
		<!-- Sent-message file tags: one per text attachment with no
		literal left in the text (literals rebuild inline instead, so
		each file shows exactly once). Above the message as body-size
		blue fold buttons like pasted content; clicking floats the
		composer-pill card above the tag, X / click-away / ESC closes.
		A long turn scrolls sideways in place instead of stretching.
		Pasted images ride inline below the text instead (see below).
		-->
		<div class="sent-tags" class:pop-open={models.some((m) => m.open)}>
			{#each models as m (m.id)}
				{@const att = attachments.find((a) => a.id === m.id)}
				<span class="sent-wrap">
					<button
						type="button"
						class="paste-fold sent-fold"
						onclick={() => actions.toggle(m.id)}>{FILE_MARKER}</button
					>
					{#if m.open}
						<span class="sent-open">
							<span class="sent-card">
								{#if m.text !== null}
									<span class="sent-excerpt">{fileExcerpt(m.text)}</span>
								{/if}
								<span class="sent-foot">
									<span class="sent-name">{m.name}</span>
									<span class="sent-tok" title="{m.tokens} tokens"
										>{formatTokenCount(m.tokens)}</span
									>
									{#if att}
										<button
											type="button"
											class="sent-icobtn"
											aria-label="Copy attachment"
											title="Copy attachment"
											onclick={(e) => {
												e.stopPropagation();
												actions.copy(att);
											}}><ActionIcon kind="copy" /></button
										>
										<button
											type="button"
											class="sent-icobtn"
											aria-label="Close preview"
											title="Close preview"
											onclick={() => actions.toggle(m.id)}
											><ActionIcon kind="close" /></button
										>
									{/if}
								</span>
							</span>
						</span>
					{/if}
				</span>
			{/each}
		</div>
	{:else}
		<!-- Sent images ride in the text with the prose (below the
		body, above the action row), never in the strip above: a pasted
		picture reads where it was pasted. Each image is a collapsed
		[Pasted image] fold tag like the pasted-chars tag — clicking
		floats the preview card above it (copy and OCR ride the
		footer), X / click-away / ESC closes, history stays read-only. -->
		<div class="sent-inline">
			{#each models as m (m.id)}
				{@const att = attachments.find((a) => a.id === m.id)}
				<span class="sent-wrap">
					<button
						type="button"
						class="paste-fold sent-fold"
						aria-expanded={m.open}
						onclick={() => actions.toggle(m.id)}>{IMAGE_MARKER}</button
					>
					{#if m.open}
						<span class="sent-open">
							<span class="sent-card">
								{#if m.dataUrl?.startsWith("data:image/")}
									<img class="sent-img" src={m.dataUrl} alt="" />
								{/if}
								<span class="sent-foot">
									<span class="sent-name">{m.name}</span>
									<span class="sent-tok" title="{m.tokens} tokens"
										>{formatTokenCount(m.tokens)}</span
									>
									{#if att}
										<button
											type="button"
											class="sent-icobtn"
											aria-label="Copy attachment"
											title="Copy attachment"
											onclick={(e) => {
												e.stopPropagation();
												actions.copy(att);
											}}><ActionIcon kind="copy" /></button
										>
										{#if att.kind === "image" && att.dataUrl}
											<button
												type="button"
												class="sent-btn"
												disabled={ocrBusyId === att.id}
												onclick={(e) => {
													e.stopPropagation();
													actions.recognize(att);
												}}
												>{ocrBusyId === att.id ? "…" : "OCR"}</button
											>
										{/if}
										<button
											type="button"
											class="sent-icobtn"
											aria-label="Close preview"
											title="Close preview"
											onclick={() => actions.toggle(m.id)}
											><ActionIcon kind="close" /></button
										>
									{/if}
								</span>
							</span>
						</span>
					{/if}
				</span>
			{/each}
		</div>
	{/if}
{/if}

<style>
	/* Sent-message tags: the marker text as links — body-size type,
	underlined, in a sideways-scrolling row when many. Hovering shows
	the composer's big preview card (image or file excerpt). History
	is read-only: no buttons, no meta lines, just the picture. */
	.sent-tags {
		display: flex;
		gap: 0.35rem 0.6rem;
		overflow-x: auto;
		margin-bottom: 0.35rem;
		padding-bottom: 0.15rem;
		/* Body-size like the inline tags (the strip sits outside
		.rendered, whose 0.92rem the buttons would otherwise miss). */
		font-size: calc(0.92rem * var(--font-scale, 1));
	}
	/* Own messages pack to the right edge: the strip hugs it too.
	`safe` keeps the packing when the row fits while overflowing to
	the reachable end when it doesn't (plain flex-end strands the
	first tags off the unreachable start and starves scrollWidth).
	The article renders paged for now, so its ancestor stays global. */
	:global(article.user) .sent-tags {
		justify-content: safe flex-end;
	}
	/* Sent images ride in the text with the prose (below the body,
	above the action row): collapsed fold tags that pop the same
	overlay card the strip uses. Own messages hug the right edge
	like the strip. */
	.sent-inline {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0.5rem 0 0.15rem;
		font-size: calc(0.92rem * var(--font-scale, 1));
	}
	:global(article.user) .sent-inline {
		justify-content: flex-end;
	}
	/* Leftover-strip and inline-image folds reuse the pasted-content
	look (the fold stylesheet lives on the message body, outside
	this tree). */
	.sent-tags .paste-fold,
	.sent-inline .paste-fold {
		flex: none;
		font: inherit;
		font-weight: 700;
		color: #1c1c1e;
		color: var(--ink);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		/* Never wrap mid-tag: the strip scrolls sideways, and a
		wrapped fold would defeat its overflow (many tags must
		scroll, not cloud). Inline tags share the rule so both
		fold kinds read as one line. */
		white-space: nowrap;
	}
	:global(html[data-theme="dark"]) .sent-tags .paste-fold,
	:global(html[data-theme="dark"]) .sent-inline .paste-fold {
		color: #98989f;
		color: var(--muted);
	}
	/* Expanded tag popup: overlay above the tag (below for strip
	tags, which sit atop the message), so opening never moves message
	content and the tag stays visible right below it. Below the
	floating composer in z (prompt is 30), above message chrome.
	Global: half the tags ride raw `{@html}`, which carries no Svelte
	scope hash, so scoped selectors never reach them. */
	:global(.sent-wrap) {
		position: relative;
		display: inline-block;
	}
	:global(.sent-open) {
		display: block;
		position: absolute;
		bottom: 100%;
		/* Centered over the tag (static transform, no motion): the
		card straddles its anchor instead of spilling right. */
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
		margin-bottom: 0.3rem;
	}
	/* Strip popups open upward like inline ones (above the tag, never
	covering the message below). Near the viewport top the card can
	reach the header — accepted: downward covered content instead. */
	/* Unclipped while a popup floats: the strip only scrolls collapsed
	tags; an open popup must escape its box. */
	.sent-tags.pop-open {
		overflow: visible;
	}
	:global(.sent-card) {
		display: block;
		/* Hug the content (capped for huge previews and narrow
		viewports): no stranded wash beside a short preview. Contents
		center, so the image rides the middle with the footer beneath
		it even when the footer is the narrower run. */
		width: max-content;
		max-width: min(16rem, calc(100vw - 2rem));
		padding: 0.4rem 0.5rem;
		font-size: 0.78rem;
		text-align: center;
		background: #eef4ff;
		background: var(--hl);
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 12px;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.18);
	}
	:global(.sent-foot) {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		margin-top: 0.3rem;
	}
	:global(.sent-name) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		/* Shrink-to-fit cards need a bound: long names ellipsize
		instead of stretching the card past its cap. */
		min-width: 0;
		max-width: 12rem;
	}
	:global(.sent-tok) {
		flex: none;
		white-space: nowrap;
		color: #6e6e73;
		color: var(--muted);
	}
	:global(.sent-icobtn) {
		display: inline-flex;
		align-items: center;
		flex: none;
		padding: 0.1rem;
		background: none;
		border: 0;
		cursor: pointer;
		color: #3a3a3c;
		color: var(--ink-soft);
	}
	/* The glyphs ride raw `{@html}` (no static markup carries the
	class), so the rule is global; strip icons size below. */
	:global(.sent-glyph) {
		height: 1em;
	}
	:global(.sent-icobtn .action-glyph) {
		height: 1em;
	}
	:global(.sent-btn) {
		flex: none;
		padding: 0.1rem 0.25rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		background: none;
		border: 0;
		border-radius: 6px;
		cursor: pointer;
		color: #3a3a3c;
		color: var(--ink-soft);
	}
	:global(.sent-btn:disabled) {
		opacity: 0.45;
		cursor: default;
	}
	:global(.sent-img) {
		display: block;
		max-width: 14rem;
		max-height: 10rem;
		margin: 0 auto;
		border-radius: 6px;
	}
	:global(.sent-excerpt) {
		display: block;
		max-height: 8rem;
		overflow: auto;
		white-space: pre-wrap;
		font-size: 0.75rem;
		color: #1c1c1e;
		color: var(--ink);
	}
</style>
