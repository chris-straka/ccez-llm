<!-- Settings drawer: right-side overlay panel hosting SettingsPanel.
The page owns the open flag, the settings object, token labels, and
every behavior; this component owns the drawer shell (open-space
double-click to close, inert while shut), the fixed-width inner, and
their surfaces. The panel node crosses as $bindable (page focus
bookkeeping reads it). -->
<script lang="ts">
	import type { AppSettings } from "$lib/settings";
	import type { VoiceLangFollow } from "$lib/voiceTiers";
	import SettingsPanel from "./SettingsPanel.svelte";

	/** Page-owned drawer behaviors. */
	export interface SettingsDrawerActions {
		commit: () => void;
		toast: (message: string) => void;
		panelClose: () => void;
		shortcuts: () => void;
		expand: (event: MouseEvent) => void;
		drawerClose: () => void;
		gameLine: () => void;
	}

	interface Props {
		open: boolean;
		settings: AppSettings;
		tokensLabel: string;
		tokensTitle: string;
		android: boolean;
		/** Follow-chat voice target (page pill state); omitted in
		unit renders, where the panel falls back to the current tag. */
		followVoice?: VoiceLangFollow | null;
		/** Panel node (page focus bookkeeping reads it). */
		panelEl?: HTMLElement | undefined;
		actions: SettingsDrawerActions;
	}

	let {
		open,
		settings = $bindable(),
		tokensLabel,
		tokensTitle,
		android,
		followVoice = null,
		panelEl = $bindable(),
		actions
	}: Props = $props();
</script>

<!-- Keep Meta+,. -->
<aside
	class="settings-panel"
	class:closed={!open}
	bind:this={panelEl}
	data-fade-scroll
	aria-label="Settings"
	inert={!open}
	ondblclick={(e) => {
		// Open space only: the tap must land on the panel's own
		// padding (the aside, inner wrapper, or a section/fieldset
		// box itself). Text, controls, and anything inside them
		// keep their behavior — including double-click text picks.
		const t = e.target instanceof Element ? e.target : null;
		if (t?.closest("aside, .settings-inner, section, fieldset") === t)
			actions.drawerClose();
	}}
>
	<!-- Fixed-width inner: the panel clips instead of reflowing text mid-collapse. -->
	<div class="settings-inner">
		<SettingsPanel
			bind:settings
			{followVoice}
			onCommit={actions.commit}
			onToast={actions.toast}
			onClose={actions.panelClose}
			onShortcuts={actions.shortcuts}
			onGameLineToggle={actions.gameLine}
			onExpand={(event: MouseEvent) => actions.expand(event)}
			{tokensLabel}
			{tokensTitle}
			androidUI={android}
		/>
	</div>
</aside>

<style>
	/* Overlay drawer, right side: same contract as the chat list —
	the main chat never squeezes. */
	.settings-panel {
		position: fixed;
		/* Kept from the old shared `aside` drawer rule (now in
		Sidebar.svelte): a single-child column, unchanged. */
		display: flex;
		flex-direction: column;
		right: 0;
		/* The chat-list drawer rule parks asides left: reset it here or
		the right-docked panel over-constrains and left wins. */
		left: auto;
		top: 0;
		bottom: 0;
		width: 22rem;
		/* Interface-size zoom (Settings > Interface size): text,
		padding, and widths scale together per surface, which rem
		can't do. Zoom multiplies the fixed width too (22rem reads
		55rem at 250%), so the reciprocal var caps the rendered box
		to the viewport — a no-op at 100% on any sane window. */
		zoom: var(--ui-scale, 1);
		max-width: calc(100vw * var(--ui-scale-inv, 1));
		z-index: 55;
		box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
		border-left: 1px solid #e5e5ea;
		border-left-color: var(--line-soft);
		padding: 1.2rem 0.7rem 2rem;
		overflow-y: auto;
		overflow-x: hidden;
		background: #fff;
		background: var(--bg);
		/* Same drawer contract as the chat list (see aside): the
		fade used to finish first and swallow the closing slide. */
		transition:
			transform 0.22s ease,
			opacity 0.22s ease;
	}
	.settings-panel.closed {
		transform: translateX(105%);
		opacity: 0;
	}
	.settings-inner {
		/* Container for the narrow-sheet footer query (panels.css). All
		inner widths are definite, so inline-size containment changes
		nothing except enabling the query. */
		container-type: inline-size;
		width: 20.6rem;
		flex-shrink: 0;
		/* Right-docked panels clip from the left: the header (the close
		target) stays put while collapsing, so it lands back under the cursor. */
		margin-left: auto;
	}
	/* Full-width settings sheet on phones: no sliver to tap, no
	weird one-tap-close strip, no gap down the right side. left+right
	with auto width fills exactly (a 100% width would add the padding
	on top and overflow); border-box keeps that promise. The inner
	column centers itself. */
	:global(.app[data-android]) .settings-panel {
		box-sizing: border-box;
		left: 0;
		/* Definite reciprocal width, not left+right constraints: under
		zoom the constraints fix the border box but leave the layout
		width indefinite, so content sizes to min-content and spills
		past the sheet. The reciprocal renders exactly full-width
		(identical to the constraints at 100%) while giving children
		a definite width to wrap in. */
		right: auto;
		width: calc(100vw * var(--ui-scale-inv, 1));
		padding-top: calc(1.2rem + env(safe-area-inset-top, 0px));
	}
	:global(.app[data-android]) .settings-inner {
		/* Fill the sheet exactly: auto margins would beat align-items:
		stretch and pin the inner to min-content (overflowing under zoom),
		so size it explicitly and center only the max-width-capped box.
		Leave the base flex-shrink: 0 alone: in this column container it
		governs height, protecting the scroll content. */
		width: 100%;
		max-width: 26rem;
		min-width: 0;
		align-self: center;
		margin-left: 0;
		margin-right: 0;
	}
	/* The drawers slide on transform (plus their collapse widths),
	which the shared fade shorthand would replace: restate the full
	list here so the scrollbar fade joins instead of killing the
	slide. Keeps transform, or closes read as a fade. */
	.settings-panel[data-fade-scroll] {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-color 0.22s ease,
			scrollbar-color 0.3s ease;
	}
	.settings-panel[data-fade-scroll]:global(.scrolling) {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-color 0.22s ease,
			scrollbar-color 0.12s ease;
	}
	@media (prefers-reduced-motion: reduce) {
		aside,
		.settings-panel {
			transition: none;
		}
	}
</style>
