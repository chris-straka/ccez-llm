<!-- Floating selection menu: Annotate (+Inspect for a qualifying
single Han character) on desktop, Annotate + Copy on phones. The
page owns the menu state, placement, drag, and idle-dismiss; this
component owns the buttons, their touch activation, and the
surfaces (Svelte scoping binds the CSS to this markup). iOS keeps
Annotate docked instead (see the composer dock): Apple's callout
can't be suppressed, so a floating menu would double it. -->
<script lang="ts">
	import { fade } from "svelte/transition";
	import { shouldShowInspect } from "$lib/inspect";
	import type { ChatMsgId } from "$lib/chat";

	/** Mirrors the page's selMenu state (structural, not nominal). */
	export interface SelMenuState {
		x: number;
		y: number;
		/** Highlight rect (viewport px): centers the create box when narrow. */
		left: number;
		w: number;
		quote: string;
		/** Containing paragraph text: the single-char guess reads it for kana. */
		context: string;
		messageId: ChatMsgId;
		/** Live range at summon time: menu hover puts the highlight
		back when WebKit empties it (no DOM change, so still valid). */
		range: Range | null;
	}

	/** Page-owned behaviors the buttons and drag stroke drive. */
	export interface SelMenuActions {
		press: () => void;
		dragStart: (event: TouchEvent) => void;
		dragMove: (event: TouchEvent) => void;
		dragEnd: () => void;
		enter: () => void;
		leave: () => void;
		annotate: () => void;
		annotateTouch: (event: TouchEvent) => void;
		copy: () => void;
		copyTouch: (event: TouchEvent) => void;
		inspect: () => void;
		inspectTouch: (event: TouchEvent) => void;
		btnTouch: (event: TouchEvent) => void;
	}

	interface Props {
		// The page passes its full menu state; the buttons only read
		// position and quote (placement, context, and range stay paged).
		menu: Pick<SelMenuState, "x" | "y" | "quote">;
		dragging: boolean;
		android: boolean;
		inspectEnabled: boolean;
		actions: SelMenuActions;
		menuEl?: HTMLElement | null;
	}

	let {
		menu,
		dragging,
		android,
		inspectEnabled,
		actions,
		menuEl = $bindable(null)
	}: Props = $props();
</script>

<div
	class="sel-menu"
	class:sel-menu-drag={dragging}
	bind:this={menuEl}
	style="left: {menu.x}px; top: {menu.y}px"
	role="menu"
	tabindex="-1"
	transition:fade={{ duration: 150 }}
	onmousedown={actions.press}
	ontouchstart={(e) => {
		actions.press();
		actions.dragStart(e);
	}}
	ontouchmove={actions.dragMove}
	ontouchend={actions.dragEnd}
	ontouchcancel={actions.dragEnd}
	onmouseenter={actions.enter}
	onmouseleave={actions.leave}
>
	{#if android}
		<!-- Phone selection menu: Annotate then Copy, always
		(no hold-to-arm). The native callout is suppressed, so
		this replaces it in the desktop popup's style. Speak
		and Inspect live in the composer dock instead — never
		here. -->
		<button
			type="button"
			onmousedown={actions.press}
			onclick={actions.annotate}
			ontouchstart={actions.btnTouch}
			ontouchend={actions.annotateTouch}>Annotate</button
		>
		<button
			type="button"
			aria-label="Copy selection"
			onmousedown={actions.press}
			onclick={actions.copy}
			ontouchstart={actions.btnTouch}
			ontouchend={actions.copyTouch}>Copy</button
		>
	{:else}
		<!-- Desktop: Annotate floats above the highlight while
		the OS bubble keeps its own slot. Copy and Read Aloud
		live on the message action rows instead of doubling
		here. Inspect joins Annotate only for a single
		kanji/hanzi highlight with the setting on; everything
		else gets Annotate alone. -->
		<button
			type="button"
			onmousedown={actions.press}
			onclick={actions.annotate}
			ontouchstart={actions.btnTouch}
			ontouchend={actions.annotateTouch}>Annotate</button
		>
		{#if shouldShowInspect(menu.quote, inspectEnabled)}
			<button
				type="button"
				aria-label="Inspect character"
				onmousedown={actions.press}
				ontouchstart={actions.btnTouch}
				ontouchend={actions.inspectTouch}
				onclick={actions.inspect}>Inspect</button
			>
		{/if}
	{/if}
</div>

<style>
	/* System-callout look: one translucent pill, hairline dividers, no
	gaps. On iOS this IS the selection menu (the native callout is
	suppressed over messages), so it should feel at home there — a
	generic pill with text buttons, no Apple marks. The ring seats it
	on white: blur + shadow alone read as a smudge over text. */
	.sel-menu {
		position: fixed;
		/* Tap-and-drag moves the menu: no browser gesture may own
		the stroke (taps still fire; the drift guard eats post-drag
		button taps). */
		/* Programmatic hops (readings-panel lift, edge clamps) glide
		up instead of jumping; the finger's own drag stays 1:1 via
		.sel-menu-drag below. Mount never animates (no prior box). */
		transition:
			top 0.18s ease,
			left 0.18s ease;
		touch-action: none;
		z-index: 50;
		display: flex;
		align-items: stretch;
		padding: 0;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.88);
		-webkit-backdrop-filter: blur(18px) saturate(1.6);
		backdrop-filter: blur(18px) saturate(1.6);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		overflow: hidden;
		/* The menu is chrome, not text: dragging across it must not
		start a selection of its own label. */
		user-select: none;
		-webkit-user-select: none;
	}
	:global(html[data-theme="dark"]) .sel-menu {
		background: rgba(30, 30, 32, 0.88);
	}
	.sel-menu.sel-menu-drag {
		transition: none;
	}
	.sel-menu button {
		/* The menu reads next to message text, so it tracks the text
		size like the annotation pill does — a fixed button next to
		370% type is unreadable. */
		font-size: calc(0.95rem * var(--font-scale, 1));
		border: 0;
		border-radius: 0;
		background: none;
		/* Buttons resolve color to system ButtonText, never inheritance:
		pin it or dark mode reads phone-default black. */
		color: #1c1c1e;
		color: var(--ink);
		cursor: pointer;
		padding: 0.55rem 0.95rem;
		white-space: nowrap;
	}
	/* Single-button menu (Annotate alone): no dividers; Inspect adds
	a hairline between the two when a single Han character qualifies. */
	.sel-menu button + button {
		border-left: 1px solid #e5e5ea;
		border-left-color: var(--line-soft);
	}
	.sel-menu button:hover {
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	.sel-menu button:active {
		opacity: 0.55;
	}
</style>
