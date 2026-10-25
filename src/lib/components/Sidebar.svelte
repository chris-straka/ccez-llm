<!-- Chat list: on desktop a window centered over the dimmed chat
(owner, 2026-10-24) with the rows grouped by day on the left and the
hovered chat's last messages on the right; on phones the slide-in
drawer. Search, rows (pick/export/delete), new-chat, and the phone
settings entry. The page owns chat state, selection,
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
	import { isImeKey } from "$lib/editContext";
	import { chatGroup, chatTitle, previewText } from "$lib/sidebar";

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
		/** Open the inline rename field on a row. */
		startRename: (item: Chat) => void;
		/** Save the rename draft (blank clears the name). */
		commitRename: () => void;
	}

	interface Props {
		/** Page-filtered chats (keyboard nav reads the same filter). */
		chats: Chat[];
		activeId: ChatId;
		/** Chats with a reply in flight (any number at once): their
		rows pulse the thinking dots until the reply settles. */
		working: ReadonlySet<ChatId>;
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
		/** Row being renamed (page-owned so Esc cancels it). */
		renamingId: ChatId | null;
		renameDraft: string;
		renameEl: HTMLInputElement | undefined;
		/** The chat the desktop window previews (hovered, else open). */
		preview?: Chat | null;
		actions: SidebarActions;
	}

	let {
		chats,
		activeId,
		working,
		collapsed,
		android,
		shell,
		newTitle,
		labelFor,
		search = $bindable(""),
		searchEl = $bindable(undefined),
		renamingId,
		renameDraft = $bindable(""),
		renameEl = $bindable(undefined),
		preview = null,
		actions
	}: Props = $props();

	/** Desktop: the centered window; phones keep the drawer. */
	const windowed = $derived(!android);
	/** Each row's day group, shown where it changes (window only). */
	const groups = $derived(chats.map((c) => chatGroup(c.createdAt)));
	/** A row's time under its day header: the time today and
	yesterday, the date further back (the header says the day). */
	function rowLabel(createdAt: number, group: string | undefined): string {
		if (!windowed) return labelFor(createdAt);
		const date = new Date(createdAt);
		return group === "Today" || group === "Yesterday"
			? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
			: date.toLocaleDateString([], { month: "short", day: "numeric" });
	}
	/** The preview's last few messages, oldest first. */
	const previewMessages = $derived(
		(preview?.messages ?? [])
			.filter((m) => m.content.trim())
			.slice(-6)
			.map((m) => ({
				id: m.id,
				own: m.role === "user",
				text: previewText(m.content)
			}))
	);

	/** Phone rename: a still long-press on a row. The click that
	follows the release must not also open the chat. */
	const HOLD_MS = 550;
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let heldOpen = false;
	function holdStart(item: Chat): void {
		heldOpen = false;
		holdTimer = setTimeout(() => {
			holdTimer = null;
			heldOpen = true;
			actions.startRename(item);
		}, HOLD_MS);
	}
	function holdCancel(): void {
		if (holdTimer) clearTimeout(holdTimer);
		holdTimer = null;
	}
</script>

{#if windowed}
	<!-- Dims only: a click goes through to the chat, whose click-back
	closes the list, as it always has. -->
	<div class="side-veil" class:shown={!collapsed} aria-hidden="true"></div>
{/if}
<aside
	class:collapsed
	class:windowed
	inert={collapsed}
	data-fade-scroll
	onmouseleave={() => windowed && actions.endPreview()}
	ondblclick={(event) => {
		const target = event.target;
		// The preview's text picks words on double-click like any text.
		if (
			target instanceof HTMLElement &&
			target.closest("button, input, select, textarea, a, .side-preview")
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
				onclick={() => actions.clearSearch()}
				><ActionIcon kind="close" /></button
			>
		{/if}
	</div>
	<!-- The window drops the preview on leaving the whole window, so
	the pointer can cross into the preview pane to read and scroll it;
	the drawer drops it on leaving the list. -->
	<ul onmouseleave={() => windowed || actions.endPreview()} data-fade-scroll>
		{#each chats as item, i (item.id)}
			<!-- Preview hover lives on the row, not the label: moving
			within the row (label to export/delete and back) must not
			drop the preview for the hovered chat. Rows clear nothing
			on leave — the gaps between rows would flash the active
			chat while crossing; only leaving the whole list (the ul
			handler below) drops the preview. -->
			<!-- The first row of each day carries the day's name, drawn
			above it (window only): the list stays chat rows only. -->
			<li
				onmouseenter={() => actions.previewHover(item.id)}
				data-group={windowed && groups[i] !== groups[i - 1]
					? groups[i]
					: undefined}
			>
				{#if renamingId === item.id}
					<!-- Inline rename: Enter or tapping away saves, Esc
					cancels (the page's Esc ladder), blank goes back to
					the automatic title. -->
					<input
						class="side-rename"
						bind:this={renameEl}
						bind:value={renameDraft}
						aria-label="Chat name"
						maxlength="60"
						autocomplete="off"
						spellcheck={false}
						onkeydown={(event) => {
							if (event.key === "Enter" && !isImeKey(event)) {
								event.preventDefault();
								actions.commitRename();
							}
						}}
						onblur={() => actions.commitRename()}
					/>
				{:else}
					<button
						type="button"
						class="side-chat"
						data-chat-id={item.id}
						class:active={item.id === activeId}
						class:working={working.has(item.id)}
						aria-busy={working.has(item.id)}
						onclick={() => {
							if (heldOpen) {
								heldOpen = false;
								return;
							}
							actions.pick(item.id);
						}}
						ontouchstart={() => holdStart(item)}
						ontouchmove={holdCancel}
						ontouchend={holdCancel}
						ontouchcancel={holdCancel}
						oncontextmenu={(event) => {
							// Android raises a context menu on long-press:
							// the hold owns that gesture here.
							if (android) event.preventDefault();
						}}
					>
						<span class="side-title">{chatTitle(item)}</span>
						<span class="side-time"
							>{rowLabel(
								item.createdAt,
								groups[i]
							)}{#if working.has(item.id)}<span
									class="side-working tdots"
									aria-hidden="true"
									><span>.</span><span>.</span><span>.</span></span
								>{/if}</span
						>
					</button>
				{/if}
				{#if !android}
					<button
						type="button"
						class="ren"
						title="Rename chat"
						aria-label="Rename chat"
						onclick={() => actions.startRename(item)}
					>
						<ActionIcon kind="pencil" />
					</button>
				{/if}
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
					onclick={() => actions.drop(item.id)}
					><ActionIcon kind="close" /></button
				>
				{#if item.messages.length > 0}
					<span class="side-tip" role="tooltip">{actions.tipFor(item)}</span>
				{/if}
			</li>
		{/each}
	</ul>
	{#if windowed}
		<section class="side-preview" aria-label="Chat preview">
			{#if preview}
				<h2 class="side-preview-title">{chatTitle(preview)}</h2>
				<p class="side-preview-time">{labelFor(preview.createdAt)}</p>
				{#each previewMessages as m (m.id)}
					<p class="side-preview-msg" class:own={m.own} dir="auto">{m.text}</p>
				{:else}
					<p class="side-preview-empty">No messages yet.</p>
				{/each}
			{/if}
		</section>
	{/if}
	<button
		type="button"
		class="new"
		title={newTitle}
		aria-label="New chat"
		onclick={actions.newChat}
	>
		<span class="new-plus" aria-hidden="true">+</span><span class="new-label"
			>New chat</span
		>
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
		/* Interface-size zoom (see the settings drawer): the
		reciprocal cap keeps the rendered box on narrow windows
		and phones, where 13rem at 250% would spill past 412px. */
		zoom: var(--ui-scale, 1);
		max-width: calc(100vw * var(--ui-scale-inv, 1));
		z-index: 55;
		background: #fff;
		background: var(--bg-chrome);
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
	/* Rename pencil: one more box left of export, same overlay
	contract (desktop only; phones rename with a long-press). */
	aside li .ren {
		position: absolute;
		right: 4.2rem;
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
	aside li:hover .ren,
	aside li:focus-within .ren {
		opacity: 1;
		pointer-events: auto;
	}
	aside li .ren:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	aside li .ren :global(.action-glyph) {
		height: 0.95rem;
	}
	/* Inline rename field: takes the row's place at the row's size. */
	.side-rename {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 0.82rem;
		padding: 0.55rem 0.6rem;
		border: 1px solid #c7c7cc;
		border-color: var(--focus);
		border-radius: 8px;
		background: #fff;
		background: var(--field);
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
		aside li .ren,
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
		overflow: hidden;
		min-width: 0;
	}
	/* The overlaid icon boxes (delete at right 0, export at 2.1rem,
	rename at 4.2rem, 1.75rem each) appear on hover: the row's text fades
	out beneath them instead of reserving their width, so idle rows
	show the whole title and nothing moves on hover. */
	@media (hover: hover) {
		aside li:hover .side-chat > span,
		aside li:focus-within .side-chat > span {
			-webkit-mask-image: linear-gradient(
				to right,
				#000 calc(100% - 6.6rem),
				transparent calc(100% - 5.8rem)
			);
			mask-image: linear-gradient(
				to right,
				#000 calc(100% - 6.6rem),
				transparent calc(100% - 5.8rem)
			);
		}
	}
	/* Two-line row: the opening question names the chat, the time
	sits under it, smaller and quieter (monospace keeps the times'
	columns aligned row to row). Each line ellipsizes on its own. */
	.side-title,
	.side-time {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.side-time {
		margin-top: 0.05rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.68rem;
		font-weight: 400;
		color: #6e6e73;
		color: var(--dim);
	}
	/* Reply in flight: the thinking dots (same three colors as the
	thread's chip) trail the timestamp, which is always short, so
	a long title never clips them. */
	.side-working {
		margin-left: 0.3em;
		font-family: system-ui, sans-serif;
		font-size: 0.9rem;
		font-weight: 700;
		line-height: 0;
	}
	.side-working span:nth-child(1) {
		color: var(--accent);
	}
	.side-working span:nth-child(2) {
		color: #5ac8fa;
		color: var(--thinking-2);
	}
	.side-working span:nth-child(3) {
		color: #34c759;
		color: var(--thinking-3);
	}
	@media (prefers-reduced-motion: reduce) {
		.side-working span {
			animation: none;
		}
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
	:global(.app[data-titlebar="overlay"]) .side-head {
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
		padding: 0.8rem 3rem 0.8rem 0.8rem;
	}
	/* Thumb-sized clear (44px) inside the field's right padding. */
	:global(.app[data-android]) aside:not(.settings-panel) .side-search-clear {
		min-width: 2.75rem;
		min-height: 2.75rem;
		font-size: 1.15rem;
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
	/* Phones keep the bare + at the thumb; the label is desktop's. */
	:global(.app[data-android]) aside .new-label {
		display: none;
	}
	/* Desktop drawer: sized for the display it sits on (wider and
	larger type on big windows, never under 15rem), New chat first
	under the search as a labelled row, rows with room to read, and
	the time line in the text face. The count tip takes the time
	line's place in its own row instead of floating over the row
	above (it covered the search box on the first row). */
	:global(.app:not([data-android])) aside {
		width: clamp(15rem, 17vw, 21rem);
		padding: 0.9rem 0.85rem;
		gap: 0.55rem;
		font-size: clamp(1rem, 0.85rem + 0.25vw, 1.12rem);
	}
	:global(.app:not([data-android])) aside .side-head {
		order: 0;
	}
	:global(.app:not([data-android])) aside .side-search-wrap {
		order: 1;
		margin: 0.2rem 0 0;
	}
	:global(.app:not([data-android])) aside .new {
		order: 2;
	}
	:global(.app:not([data-android])) aside ul {
		order: 3;
		gap: 0.15rem;
	}
	:global(.app:not([data-android])) aside button,
	:global(.app:not([data-android])) aside .side-search,
	:global(.app:not([data-android])) .side-rename {
		font-size: 0.9em;
	}
	:global(.app:not([data-android])) aside .side-search {
		padding: 0.5em 1.9em 0.5em 0.7em;
		border-radius: 10px;
	}
	:global(.app:not([data-android])) aside .new {
		display: flex;
		align-items: center;
		gap: 0.5em;
		width: 100%;
		padding: 0.5em 0.7em;
		border-radius: 10px;
		text-align: left;
		color: var(--ink);
	}
	:global(.app:not([data-android])) aside .new-plus {
		width: 1em;
		text-align: center;
		font-size: 1.15em;
		line-height: 1;
		color: var(--accent);
	}
	:global(.app:not([data-android])) aside ul button.side-chat {
		padding: 0.5em 0.7em 0.5em 0.85em;
		border-radius: 10px;
	}
	:global(.app:not([data-android])) aside button.active {
		background: color-mix(in srgb, var(--hover-wash) 55%, transparent);
		font-weight: 600;
	}
	:global(.app:not([data-android])) aside ul button:hover {
		background: var(--hover-wash);
	}
	:global(.app:not([data-android])) .side-title {
		font-weight: 500;
	}
	:global(.app:not([data-android])) aside button.active .side-title {
		font-weight: 650;
	}
	:global(.app:not([data-android])) .side-time {
		margin-top: 0.12em;
		font-family: inherit;
		font-variant-numeric: tabular-nums;
		font-size: 0.8em;
		color: var(--muted);
	}
	:global(.app:not([data-android])) aside .side-tip {
		bottom: auto;
		top: calc(50% + 0.1em);
		left: 0.6em;
		max-width: calc(100% - 7.2rem);
		padding: 0 0.25em;
		border: 0;
		border-radius: 4px;
		box-shadow: none;
		background: var(--hover-wash);
		color: var(--muted);
		font-size: 0.72em;
		font-weight: 500;
		line-height: 1.6;
	}
	/* Desktop window: centered over the dimmed chat, the list (search,
	new chat, rows grouped by day) on the left, the preview on the
	right. Closed, it fades out in place. */
	:global(.app:not([data-android])) aside.windowed {
		box-sizing: border-box;
		inset: 0;
		margin: auto;
		width: min(60rem, calc((100vw - 4rem) * var(--ui-scale-inv, 1)));
		height: min(42rem, calc((100dvh - 4rem) * var(--ui-scale-inv, 1)));
		max-width: none;
		z-index: 58;
		display: grid;
		grid-template-columns: minmax(15rem, 22rem) minmax(0, 1fr);
		grid-template-rows: auto auto minmax(0, 1fr);
		column-gap: 1.4rem;
		row-gap: 0.55rem;
		padding: 1rem;
		overflow: hidden;
		border: 1px solid var(--line-soft);
		border-radius: 14px;
		box-shadow: 0 12px 48px rgba(0, 0, 0, 0.25);
	}
	/* Fade only: the list mounts windowed before the phone check
	runs, and a scale here would carry into the drawer's first
	slide. */
	aside.windowed.collapsed {
		transform: none;
		opacity: 0;
		visibility: hidden;
	}
	/* Visible at once on open (the next frame focuses the current
	row, and a hidden row can't take focus), hidden only once the
	close fade ends. */
	aside.windowed[data-fade-scroll],
	aside.windowed[data-fade-scroll]:global(.scrolling) {
		transition:
			transform 0.18s ease,
			opacity 0.18s ease,
			visibility 0s,
			scrollbar-color 0.3s ease;
	}
	aside.windowed.collapsed[data-fade-scroll],
	aside.windowed.collapsed[data-fade-scroll]:global(.scrolling) {
		transition:
			transform 0.18s ease,
			opacity 0.18s ease,
			visibility 0s 0.18s,
			scrollbar-color 0.3s ease;
	}
	aside.windowed .side-head {
		display: none;
	}
	aside.windowed .side-search-wrap {
		grid-column: 1;
		grid-row: 1;
		margin: 0;
	}
	aside.windowed .new {
		grid-column: 1;
		grid-row: 2;
	}
	aside.windowed ul {
		grid-column: 1;
		grid-row: 3;
		min-height: 0;
		overflow-y: auto;
	}
	aside.windowed li[data-group] {
		margin-top: 1.7rem;
	}
	aside.windowed li[data-group]:first-child {
		margin-top: 1.3rem;
	}
	aside.windowed li[data-group]::before {
		content: attr(data-group);
		position: absolute;
		bottom: calc(100% + 0.25rem);
		left: 0.85em;
		font-size: 0.72em;
		font-weight: 650;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
		pointer-events: none;
	}
	.side-preview {
		grid-column: 2;
		grid-row: 1 / 4;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.2rem 0.2rem 0.6rem 1.4rem;
		border-left: 1px solid var(--line-soft);
	}
	.side-preview-title {
		margin: 0;
		font-size: 1.05em;
		font-weight: 650;
	}
	.side-preview-time {
		margin: -0.4rem 0 0.4rem;
		font-size: 0.8em;
		color: var(--muted);
	}
	.side-preview-msg {
		margin: 0;
		max-width: 46ch;
		font-size: 0.92em;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.side-preview-msg.own {
		align-self: flex-end;
		color: var(--muted);
		text-align: end;
	}
	.side-preview-empty {
		margin: 0;
		color: var(--muted);
	}
	.side-veil {
		position: fixed;
		inset: 0;
		z-index: 57;
		pointer-events: none;
		background: rgba(0, 0, 0, 0.35);
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 0.18s ease,
			visibility 0.18s;
	}
	.side-veil.shown {
		opacity: 1;
		visibility: visible;
	}
	@media (prefers-reduced-motion: reduce) {
		.side-veil,
		aside.windowed {
			transition: none;
		}
	}
	/* Close is a geometric X sized to the button's text: a text ×
	sits low on its font bearings. */
	.side-search-clear :global(.action-glyph) {
		height: 0.8em;
	}
</style>
