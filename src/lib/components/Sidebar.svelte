<!-- Chat-list drawer: search, rows (pick/export/delete), new-chat,
and the phone settings entry. The page owns chat state, selection,
the search filter text, collapse persistence, and all behaviors;
this component owns the drawer markup and its surfaces (Svelte
scoping binds the CSS to this markup). The search box binds to the
page filter (keyboard nav reads the same list), so typing here
filters the rows the shortcuts operate on. Row hover previews,
keyboard row focus, and document row queries keep working on the
rendered DOM (see focusSideChat). The settings panel is a separate
aside with self-sufficient rules; bare `aside` selectors below match
only this drawer through scoping. -->
<script lang="ts">
	import type { Chat, ChatId } from "$lib/chat";
	import ActionIcon from "./ActionIcon.svelte";

	/** Page-owned drawer behaviors (state and effects stay in the page). */
	export interface SidebarActions {
		/** Collapse on empty-area double-tap (persists). */
		collapse: () => void;
		dragWindow: (event: MouseEvent) => void;
		zoomWindow: (event: MouseEvent) => void;
		/** Focus the search box (keyboard up on tap). */
		focusSearch: () => void;
		/** Clear the search box and refocus it. */
		clearSearch: () => void;
		/** Drop the hover preview (leaving the whole list). */
		endPreview: () => void;
		/** Preview the hovered row's chat. */
		previewHover: (id: ChatId) => void;
		/** Pick a row (selects, transitions, collapses). */
		pick: (id: ChatId) => void;
		exportOne: (item: Chat) => void;
		drop: (id: ChatId) => void;
		/** Hover tip text for a row ("" when the chat is empty). */
		tipFor: (item: Chat) => string;
		newChat: () => void;
		openSettings: () => void;
	}

	interface Props {
		/** Page-filtered chats (keyboard nav reads the same filter). */
		chats: Chat[];
		activeId: ChatId;
		collapsed: boolean;
		android: boolean;
		/** Shell build (export hides where pickers fail). */
		shell: boolean;
		/** New-chat title (page computes via tip()). */
		newTitle: string;
		labelFor: (createdAt: number) => string;
		/** Two-way search box state (page owns the filter text). */
		search: string;
		searchEl: HTMLInputElement | undefined;
		actions: SidebarActions;
	}

	let {
		chats,
		activeId,
		collapsed,
		android,
		shell,
		newTitle,
		labelFor,
		search = $bindable(""),
		searchEl = $bindable(undefined),
		actions
	}: Props = $props();
</script>

<aside
	class:collapsed
	inert={collapsed}
	data-fade-scroll
	ondblclick={(event) => {
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			target.closest("button, input, select, textarea, a")
		)
			return;
		actions.collapse();
	}}
>
	<div
		class="side-head"
		data-tauri-drag-region
		aria-hidden="true"
		onmousedown={actions.dragWindow}
		ondblclick={actions.zoomWindow}
	></div>
	<!-- Sidebar search: a swipe left-to-right opens the list on this
	box; tapping it focuses with the keyboard up (a real input, never
	auto-focused on open, so the keyboard only comes on tap). -->
	<div class="side-search-wrap">
		<input
			type="search"
			class="side-search"
			bind:this={searchEl}
			bind:value={search}
			placeholder="Search chats"
			aria-label="Search chats"
			inputmode="search"
			enterkeyhint="search"
			autocomplete="off"
			onclick={() => actions.focusSearch()}
		/>
		{#if search}
			<button
				type="button"
				class="side-search-clear"
				aria-label="Clear chat search"
				onclick={() => actions.clearSearch()}>×</button
			>
		{/if}
	</div>
	<ul onmouseleave={() => actions.endPreview()} data-fade-scroll>
		{#each chats as item (item.id)}
			<!-- Preview hover lives on the row, not the label: moving
			within the row (label to export/delete and back) must not
			drop the preview for the hovered chat. Rows clear nothing
			on leave — the gaps between rows would flash the active
			chat while crossing; only leaving the whole list (the ul
			handler below) drops the preview. -->
			<li onmouseenter={() => actions.previewHover(item.id)}>
				<button
					type="button"
					class="side-chat"
					class:active={item.id === activeId}
					onclick={() => actions.pick(item.id)}
				>
					{labelFor(item.createdAt)}
				</button>
				<!-- No export path works in the shell phone (no picker,
				no native dialog bridge, clipboard denied): the button
				hides there instead of toasting failure. Mobile browsers
				keep the download, desktop keeps everything. -->
				{#if !(android && shell)}
					<button
						type="button"
						class="exp"
						title="Export chat as Markdown"
						aria-label="Export chat as Markdown"
						onclick={() => actions.exportOne(item)}
					>
						<ActionIcon kind="export" />
					</button>
				{/if}
				<button
					type="button"
					class="del"
					aria-label="Delete chat"
					onclick={() => actions.drop(item.id)}><ActionIcon kind="close" /></button
				>
				{#if item.messages.length > 0}
					<span class="side-tip" role="tooltip">{actions.tipFor(item)}</span>
				{/if}
			</li>
		{/each}
	</ul>
	<button
		type="button"
		class="new"
		title={newTitle}
		aria-label="New chat"
		onclick={actions.newChat}
	>
		+
	</button>
	{#if android}
		<!-- Touch settings entry: one-finger swipes never open
		settings, so the list owns a visible button (phones have
		no ⌘, to teach) next to the two-finger swipe left. -->
		<button
			type="button"
			class="side-settings"
			aria-label="Open settings"
			title="Settings"
			onclick={actions.openSettings}
		>
			Settings
		</button>
	{/if}
</aside>

<style>
	aside {
		position: fixed;
		left: 0;
		top: 0;
		bottom: 0;
		width: 13rem;
		z-index: 55;
		background: #fff;
		background: var(--bg);
		box-shadow: 8px 0 24px rgba(0, 0, 0, 0.12);
		border-right: 1px solid #e5e5ea;
		border-right-color: var(--line-soft);
		padding: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		overflow-y: auto;
	}
	aside ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	aside li {
		display: flex;
		gap: 0.25rem;
		position: relative;
	}
	/* Hover tip: message counts above the row, inside the drawer
	(the list scrolls, so nothing may stick out sideways). Theme
	surfaces with a hairline ring (never the inverted pill, which
	reads as light-theme chrome in dark mode), pointer-transparent
	so the preview and row buttons never notice it. Scoped to the
	row button itself: hovering the export/delete buttons must not
	summon it. Hover waits 3s before showing (a passing glance
	shouldn't pop it); keyboard focus shows at once. */
	.side-tip {
		position: absolute;
		bottom: calc(100% + 2px);
		left: 0;
		z-index: 5;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: #fff;
		background: var(--bg-raised);
		color: #1c1c1e;
		color: var(--ink);
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		font-size: 0.72rem;
		font-weight: 600;
		border-radius: 6px;
		padding: 0.2rem 0.5rem;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}
	aside .side-chat:hover ~ .side-tip {
		opacity: 1;
		transition-delay: 3s;
	}
	aside .side-chat:focus-visible ~ .side-tip {
		opacity: 1;
	}
	aside li button:first-child {
		flex: 1;
		text-align: left;
	}
	/* The row × overlays instead of reserving its slot, so the chat
	pill spans the full row width flush with the + button below it.
	Keyboard focus brings it back (focus-within); touch has no hover,
	so the × stays in flow there. */
	/* Row buttons share one fixed box: same size, centered glyph, so
	hover states never shift layout. The × reads bigger in a smaller
	button; export sits one box plus a gap left of it. will-change
	pins the compositing layer across the opacity fade: without it
	the layer promotes/drops mid-hover and fractional
	translateY(-50%) paint-snaps a pixel on some engines — the
	buttons must only ever fade in place, never travel. */
	aside li .del {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		width: 1.75rem;
		height: 1.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		font-size: 1.15rem;
		line-height: 1;
		opacity: 0;
		pointer-events: none;
		will-change: opacity;
	}
	aside li:hover .del,
	aside li:focus-within .del {
		opacity: 1;
		pointer-events: auto;
	}
	/* Per-row export: icon-only, parked left of the delete x on the
	same overlay contract (pill keeps full width; keyboard focus
	brings it back; touch keeps it in flow like the x). */
	aside li .exp {
		position: absolute;
		right: 2.1rem;
		top: 50%;
		transform: translateY(-50%);
		width: 1.75rem;
		height: 1.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		will-change: opacity;
		pointer-events: none;
		border: 0;
		background: none;
		cursor: pointer;
		color: #6e6e73;
		color: var(--muted);
		padding: 0;
		line-height: 0;
	}
	aside li:hover .exp,
	aside li:focus-within .exp {
		opacity: 1;
		pointer-events: auto;
	}
	aside li .exp:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	/* The row × rides --dim, never --ink: it must read quieter than
	the label it deletes (see the dark-theme note in the page). */
	aside .del {
		color: #6e6e73;
		color: var(--dim);
	}
	@media (hover: none) {
		aside li .del,
		aside li .exp {
			position: static;
			transform: none;
			opacity: 1;
			pointer-events: auto;
		}
		/* Thumb-sized new-chat button (44px target). */
		aside .new {
			width: 100%;
			min-height: 2.75rem;
			font-size: 1.15rem;
			padding: 0.6rem;
		}
		/* Touch settings entry under it: same thumb target. */
		aside .side-settings {
			width: 100%;
			min-height: 2.75rem;
			margin-top: 0.4rem;
			font-size: 0.95rem;
			padding: 0.6rem;
			border-color: #c7c7cc;
			border-color: var(--line);
		}
	}
	aside button {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		/* Same ButtonText trap as side-chat below: old phone WebViews
		resolve unpinned button colors against the wrong scheme and the
		text vanishes (Settings and + went invisible in light theme). */
		color: #1c1c1e;
		color: var(--ink);
		cursor: pointer;
		/* Never wrap mid-collapse: clip instead of reflowing over itself. */
		white-space: nowrap;
	}
	/* The current chat wears a marker bar, never a background — so the
	hover wash reads on every row including the current one. */
	/* Sidebar chrome is tappable, never selectable: long-presses on
	chat titles, the + button, and the Settings button must never
	raise a text selection (message text keeps its own). */
	aside ul,
	aside button.new,
	aside button.side-settings {
		user-select: none;
		-webkit-user-select: none;
	}
	aside ul button.side-chat {
		position: relative;
		/* Same ButtonText trap as .sel-menu: pin the color explicitly. */
		color: #1c1c1e;
		color: var(--ink);
		/* Uniform row labels: monospace keeps every chat's date/count
		columns aligned no matter the title text. */
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		/* The overlaid icon boxes (delete 1.75rem at right 0, export
		1.75rem at right 2.1rem) sit in this reserved padding, never on
		the title text: the pill keeps its full-width click target while
		the text truncates clear of both icons. */
		padding-right: 4rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	aside button.active {
		background: transparent;
		font-weight: 650;
	}
	aside button.active::before {
		content: "";
		position: absolute;
		left: 0.12rem;
		top: 50%;
		transform: translateY(-50%);
		width: 0.22rem;
		height: 1.05rem;
		border-radius: 999px;
		background: #007aff;
		background: var(--accent);
	}
	aside ul button:hover {
		background: #ececf1;
		background: var(--hover-wash);
	}
	aside .new:hover {
		border-color: #3a3a3c;
		border-color: var(--focus);
	}
	aside .del:hover {
		color: #94250a;
		color: var(--danger);
	}
	aside .new {
		border-color: #c7c7cc;
		border-color: var(--line);
	}
	.side-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		/* 0.8rem aside padding + 0.1rem here = the header's 0.9rem. */
		margin-top: 0.1rem;
		/* No sidebar controls left (⌘B/⌘N live on keys only now): keep
		a grabbable drag strip where the button row was. */
		min-height: 1.25rem;
	}
	/* Sidebar search box (search-mobile): full-width field under the
	drag strip; the clear button sits inside on the right. */
	.side-search-wrap {
		position: relative;
		margin: 0.25rem 0 0.35rem;
	}
	.side-search {
		width: 100%;
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 1.6rem 0.4rem 0.6rem;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		background: var(--field);
		color: inherit;
	}
	.side-search-clear {
		position: absolute;
		right: 0.15rem;
		top: 50%;
		transform: translateY(-50%);
		border: none;
		min-width: 1.5rem;
	}
	aside {
		/* One duration for slide and fade: the old 0.12s opacity
		finished first, so closes read as a fade while the slide ran
		invisibly. Drawers slide both ways now. */
		transition:
			transform 0.22s ease,
			opacity 0.22s ease;
		overflow: hidden;
	}
	aside.collapsed {
		transform: translateX(-105%);
		opacity: 0;
	}
	/* The drawer slides on transform (plus its collapse width), which
	the shared fade shorthand would replace: restate the full list
	here so the scrollbar fade joins instead of killing the slide.
	(The settings panel keeps its own copy in the page.) */
	aside[data-fade-scroll] {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-width 0.22s ease,
			scrollbar-color 0.3s ease;
	}
	aside[data-fade-scroll]:global(.scrolling) {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-width 0.22s ease,
			scrollbar-color 0.12s ease;
	}
	/* Shell traffic-light clearance: the empty head indents like the
	header so the chat list starts at the same x. Android drops the
	clearance and the empty drag strip (no lights, no drag). */
	:global(.app[data-shell="tauri"]) .side-head {
		margin-left: 5.75rem;
		margin-top: 0.35rem;
	}
	:global(.app[data-android]) .side-head {
		margin-left: 0;
		margin-top: 0;
		min-height: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		aside {
			transition: none;
		}
	}
	/* Phones: per-row delete/export boxes, row alignment, drawer
	seating, search size, and bottom settings entry. The .app
	ancestor stays global (it renders paged, unscopable). */
	:global(.app[data-android]) aside li .del {
		padding: 0.6rem;
		min-width: 2.75rem;
		min-height: 2.75rem;
		/* The box grew already; the glyph itself stays text-sized. */
		font-size: 1.15rem;
	}
	/* Per-row export shares the delete box on phones: same thumb
	target, so the two icons sit vertically aligned in the row.
	Desktop keeps the overlaid icon pair. */
	:global(.app[data-android]) aside li .exp {
		padding: 0.6rem;
		min-width: 2.75rem;
		min-height: 2.75rem;
	}
	:global(.app[data-android]) aside li {
		align-items: center;
	}
	/* Phones slide the chat list in from the left covering ~3/4 of
	the width (thumb-reachable, main chat kept as a sliver behind).
	Desktop keeps its left drawer; the settings panel keeps its
	right drawer (one sidebar at a time). */
	:global(.app[data-android]) aside:not(.settings-panel) {
		/* Border-box like the settings sheet: equal width properties
		must paint equal boxes. */
		box-sizing: border-box;
		left: 0;
		right: auto;
		top: 0;
		bottom: 0;
		width: min(78vw, 20rem);
		max-height: none;
		overflow: hidden;
		border-right: 1px solid #e5e5ea;
		border-right-color: var(--line-soft);
		border-top: 0;
		border-radius: 0;
		box-shadow: 8px 0 24px rgba(0, 0, 0, 0.16);
		padding-bottom: calc(0.8rem + env(safe-area-inset-bottom, 0px));
		/* Thumb-first column: search alone at the top with breathing
		room, the list fills the middle, and new + settings ride the
		bottom edge. Desktop keeps its top-down drawer. */
		display: flex;
		flex-direction: column;
		padding-top: calc(2.5rem + env(safe-area-inset-top, 0px));
	}
	:global(.app[data-android]) aside:not(.settings-panel) .side-search-wrap {
		margin-top: 0;
	}
	/* Twice the tap height with adult type. Desktop keeps the
	compact filter. */
	:global(.app[data-android]) aside:not(.settings-panel) .side-search {
		font-size: 1.15rem;
		min-height: 4.5rem;
		padding: 0.8rem 2.2rem 0.8rem 0.8rem;
	}
	:global(.app[data-android]) aside:not(.settings-panel) ul {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
	}
	/* Settings owns the bottom edge at double height: the last child
	of the pile, impossible to miss. Desktop keeps its inline row. */
	:global(.app[data-android]) aside:not(.settings-panel) .side-settings {
		min-height: 5.5rem;
		font-size: 1.15rem;
		margin-top: 0.6rem;
	}
	:global(.app[data-android]) aside:not(.settings-panel).collapsed {
		transform: translateX(-105%);
	}
</style>
