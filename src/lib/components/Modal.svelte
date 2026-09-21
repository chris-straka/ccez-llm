<!-- Shared modal shell: dim veil plus dialog box. The page's dialogs
(Switcher, Shortcuts, Palette, Inspect) render their content through
it so the veil/box surfaces live in one place instead of one copy
per dialog. The page keeps its own veil/box rules until the last
dialog moves (Svelte scoping binds each stylesheet to its own
markup), then they follow.
Taste note: no redesign — the existing dim veil and panel surfaces
move here verbatim. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		/** Dialog name for assistive tech (skipped when labelledby
		names a visible heading instead). */
		label: string;
		/** Visible heading id labelling the dialog (desktop
		shortcuts modal); omit for aria-label. Explicit undefined
		passes (exactOptionalPropertyTypes). */
		labelledby?: string | undefined;
		/** Edge-fade scroll hook on the box (see the page's
		fade-scroll tracker). */
		fadeScroll?: boolean;
		/** Extra veil class (e.g. "chat-switcher" for top seating). */
		veilClass?: string;
		/** Extra box class (e.g. "switcher-card"). */
		cardClass?: string;
		/** Veil tap: dialogs close on taps that land on the veil
		itself, never on content. */
		onVeilClick: (event: MouseEvent) => void;
		/** Box touch-end passthrough (e.g. the inspect overlay's
		tap haptic). Omit when the dialog needs none. */
		onBoxTouchEnd?: (event: TouchEvent) => void;
		/** Box content. */
		children: Snippet;
		/** Optional veil content outside the box (e.g. the
		switcher actions floating under the card). */
		below?: Snippet;
	}

	let {
		label,
		labelledby,
		fadeScroll = false,
		veilClass = "",
		cardClass = "",
		onVeilClick,
		onBoxTouchEnd,
		children,
		below
	}: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="modal-veil {veilClass}" onclick={onVeilClick}>
	<div
		class="modal {cardClass}"
		role="dialog"
		aria-modal="true"
		aria-label={labelledby ? undefined : label}
		aria-labelledby={labelledby}
		data-fade-scroll={fadeScroll || undefined}
		ontouchend={onBoxTouchEnd}
		tabindex="-1"
	>
		{@render children()}
	</div>
	{@render below?.()}
</div>

<style>
	.modal-veil {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
	}
	.modal {
		width: min(52rem, calc(100vw - 3rem));
		max-height: min(38rem, calc(100vh - 3rem));
		max-height: min(38rem, calc(100dvh - 3rem));
		overflow-y: auto;
		background: #fff;
		background: var(--bg);
		color: #1c1c1e;
		color: var(--ink);
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 14px;
		box-shadow: 0 12px 48px rgba(0, 0, 0, 0.25);
		padding: 0.9rem 1.4rem 1rem;
		box-sizing: border-box;
	}
	/* Per-dialog chrome variants live here with the shell (the veil
	and box render here, so variant rules scope correctly): content
	rules stay in each dialog. */
	/* Phone chat switcher veil: the card rides near the top of the
	screen (not centered) — a thumb stays near the arrows while the
	thread below stays readable. */
	.modal-veil.chat-switcher {
		flex-direction: column;
		justify-content: flex-start;
		align-items: center;
		gap: 0.75rem;
		padding-top: 18dvh;
	}
	/* Phone chat switcher card: title plus position between two thumb
	arrows. Rendered only on phones (androidUI gate in markup), so no
	platform prefix is needed; desktop never sees it. */
	.switcher-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		width: min(22rem, calc(100vw - 3rem));
		padding: 1rem 1.2rem;
		/* A menu, not a document: its title and position never
		select (long-presses there summon handles otherwise). */
		user-select: none;
		-webkit-user-select: none;
	}
	/* Search palette box: pinned to the top so the phone keyboard
	never covers the input; hits read as full-width rows. */
	.search-palette {
		align-self: flex-start;
		margin-top: 8vh;
		margin-top: 8dvh;
		padding: 0.7rem 0.9rem 0.8rem;
	}
	/* Character Inspect box: narrow modal, big glyph beside the
	facts, schematic stroke progress below. */
	.inspect-modal {
		width: min(28rem, calc(100vw - 3rem));
	}
</style>
