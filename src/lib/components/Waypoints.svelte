<!-- Waypoint jump menu: a hamburger floating at the viewport's
middle-right, revealing the message list on hover, focus, or pinned
click (touch uses the composer's jump trigger opening a bottom
sheet instead). The page owns the open flag (shared with the
composer trigger and keyboard nav), the wrap node (keyboard nav and
nearness read it), the points, and jump; this component owns the
nav markup and its surfaces. -->
<script lang="ts">
	import { fade } from "svelte/transition";
	import { waypointLabel, type ChatMsg } from "$lib/chat";

	/** Page-owned waypoint behaviors. */
	export interface WaypointsActions {
		toggle: () => void;
		close: () => void;
		jump: (index: number, event: MouseEvent) => void;
	}

	interface Props {
		points: number[];
		messages: ChatMsg[];
		pos: number;
		settingsOpen: boolean;
		previewing: boolean;
		/** Open flag (shared with the composer trigger). */
		open?: boolean;
		/** Wrap node (page keyboard nav and nearness read it). */
		wrapEl?: HTMLElement | undefined;
		actions: WaypointsActions;
	}

	let {
		points,
		messages,
		pos,
		settingsOpen,
		previewing,
		open = $bindable(false),
		wrapEl = $bindable(),
		actions
	}: Props = $props();

	/** Touch pull-down start (sheet swipe-to-close, this gesture only). */
	let touchY: number | null = null;
</script>

{#if points.length > 3 && !settingsOpen && !previewing}
	<nav aria-label="Waypoints">
		{#if open}
			<!-- Sheet backdrop: a press outside the sheet (which is
			outside .wp-wrap) also trips the pinned-menu closer. -->
			<button
				type="button"
				class="wp-veil"
				tabindex={-1}
				aria-label="Close message list"
				transition:fade={{ duration: 150 }}
				onclick={actions.close}
			></button>
		{/if}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="wp-wrap"
			class:open
			bind:this={wrapEl}
			onkeydown={(e) => {
				if (e.key === "Escape") actions.close();
			}}
			onmouseleave={() => {
				// Hovering outside closes the menu after a jump.
				// Focus on a menu *item* keeps it (tabbing users
				// don't lose their place to a mouse jiggle), but
				// focus lingering on the toggle after a mouse click
				// must not pin it open.
				const menu = wrapEl?.querySelector(".wp-menu");
				const deep =
					menu != null &&
					document.activeElement instanceof Element &&
					menu.contains(document.activeElement);
				if (open && !deep) actions.close();
			}}
		>
			<button
				type="button"
				class="wp-btn"
				data-fade-scroll
				title="Jump to a message"
				aria-label="Jump to a message"
				aria-haspopup="true"
				aria-expanded={open}
				onclick={actions.toggle}
			>
				{#each points as index (index)}
					<span class="wp-tick" aria-hidden="true"></span>
				{/each}
			</button>
			<div
				class="wp-menu"
				role="menu"
				tabindex={-1}
				aria-label="Waypoints"
				data-fade-scroll
				ontouchstart={(e) => (touchY = e.touches[0]?.clientY ?? null)}
				ontouchend={(e) => {
					const start = touchY;
					touchY = null;
					const end = e.changedTouches[0]?.clientY;
					if (start == null || end == null) return;
					const menu = e.currentTarget;
					if (
						menu instanceof HTMLElement &&
						menu.scrollTop <= 0 &&
						end - start > 56
					)
						actions.close();
				}}
			>
				<div class="wp-sheet-head">
					<span>Jump to a message</span>
					<button
						type="button"
						aria-label="Close message list"
						onclick={actions.close}>×</button
					>
				</div>
				{#each points as index, n (index)}
					{@const target = messages[index]}
					<button
						type="button"
						role="menuitem"
						aria-current={n === pos - 1}
						title={waypointLabel(target?.content ?? "", 200)}
						onclick={(e) => actions.jump(index, e)}
					>
						<span
							class="wp-dot"
							data-role={target?.role ?? "user"}
							aria-hidden="true"
						></span>
						{waypointLabel(target?.content ?? "") || `Message ${index + 1}`}
					</button>
				{/each}
			</div>
		</div>
	</nav>
{/if}

<style>
	nav {
		display: flex;
		gap: 0.3rem;
		padding: 0.4rem 1.2rem;
		border-bottom: 1px solid #e5e5ea;
		border-bottom-color: var(--line-soft);
		overflow-x: auto;
	}
	nav button {
		font-size: 0.75rem;
		min-width: 1.6rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 999px;
		background: #fff;
		background: var(--bg-raised);
		/* No unclassed button renders inside nav today, but ButtonText
		would strike here the moment one does. */
		color: #1c1c1e;
		color: var(--ink);
		cursor: pointer;
	}
	/* Waypoint jump menu: a hamburger floating at the viewport's
	middle-right, revealing the message list on hover, focus, or
	pinned click. No strip — the bar is gone. */
	nav[aria-label="Waypoints"] {
		position: fixed;
		right: 1.75rem;
		top: 50%;
		transform: translateY(-50%);
		z-index: 40;
		border: 0;
		padding: 0;
		overflow: visible;
	}
	.wp-wrap {
		position: relative;
	}
	/* One tick per message: the stack grows with the chat, then scrolls. */
	.wp-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		max-height: 4rem;
		overflow-y: auto;
		border: 0;
		background: none;
		padding: 0.3rem 0.15rem;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
	}
	.wp-tick {
		display: block;
		flex-shrink: 0;
		width: 1.3rem;
		height: 3px;
		border-radius: 2px;
		background: currentColor;
	}
	/* The open panel overlaps the tick stack (no dead gap): sliding the
	pointer down off the ticks lands straight on the menu. */
	.wp-menu {
		position: absolute;
		right: 0;
		top: 0;
		z-index: 50;
		min-width: 12rem;
		max-width: 20rem;
		max-height: 60vh;
		overflow-y: auto;
		padding: 0.4rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 16px;
		background: #fff;
		background: var(--bg-raised);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		/* Fade out first, then hide: the delayed visibility flip keeps
		the panel painted for the whole opacity ramp. */
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 0.3s ease,
			visibility 0s linear 0.3s;
	}
	.wp-wrap:hover .wp-menu,
	.wp-menu:focus-within,
	.wp-wrap.open .wp-menu {
		/* Reveal now, fade in: the incoming transition governs. */
		opacity: 1;
		visibility: visible;
		transition:
			opacity 0.3s ease,
			visibility 0s;
	}
	.wp-menu button {
		display: block;
		width: 100%;
		text-align: left;
		font-size: 0.85rem;
		color: #1c1c1e;
		color: var(--ink);
		border: 0;
		border-radius: 10px;
		background: none;
		cursor: pointer;
		padding: 0.45rem 0.7rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		user-select: none;
		-webkit-user-select: none;
		transition: background-color 0.18s ease;
	}
	.wp-menu button:hover {
		background: #f1f1f4;
		background: color-mix(in oklab, var(--ink) 6%, transparent);
		background: var(--bg-wash);
	}
	/* Hidden until the pointer comes near (JS toggles .wp-near by
	distance); nearness alone brings the stack to a dim rest.
	Clickable only while visible. */
	.wp-btn {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.18s ease;
	}
	/* :global — toggled from JS (mousemove distance), invisible to the
	compiler, so scoping must not prune it. */
	.wp-wrap:global(.wp-near) .wp-btn {
		opacity: 0.35;
		pointer-events: auto;
	}
	.wp-btn:focus-visible {
		opacity: 1;
		pointer-events: auto;
	}
	/* While the panel is up it covers the tick stack, so the trigger
	rests with it: no doubled chrome, and on hover-off the ticks fade
	back only after the menu is gone. Focus keeps its button (the
	:not guard) so keyboard users never tab onto an invisible toggle. */
	.wp-wrap:hover .wp-btn:not(:focus-visible),
	.wp-wrap:focus-within .wp-btn:not(:focus-visible),
	.wp-wrap.open .wp-btn:not(:focus-visible) {
		opacity: 0;
		pointer-events: none;
	}
	/* Touch-only waypoint chrome: toolbar jump icon, sheet backdrop,
	sheet head, current-item mark. Display none on pointer devices,
	where the hover ticks and floating card stay. Role dots ride both
	menus. */
	.wp-veil,
	.wp-sheet-head {
		display: none;
	}
	.wp-dot {
		display: inline-block;
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		margin-right: 0.55rem;
		transform: translateY(-1px);
		background: #007aff;
		background: var(--accent);
	}
	.wp-dot[data-role="assistant"] {
		background: #30d158;
	}
	.wp-menu button[aria-current="true"] {
		background: #f1f1f4;
		background: var(--bg-wash);
		font-weight: 600;
	}
	/* Touch waypoint rules live after the base waypoint block (later in
	this file): equal-specificity overrides must come second to win. */
	@keyframes wp-sheet-in {
		from {
			transform: translateY(1rem);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	/* Same clobber, smaller victims: the waypoint tick stack and its menu
	carry data-fade-scroll for their own overflow, which ate the opacity
	fades. Restate both lists here. */
	.wp-btn[data-fade-scroll] {
		transition:
			opacity 0.18s ease,
			scrollbar-color 0.3s ease;
	}
	.wp-btn[data-fade-scroll]:global(.scrolling) {
		transition:
			opacity 0.18s ease,
			scrollbar-color 0.12s ease;
	}
	.wp-menu[data-fade-scroll] {
		transition:
			opacity 0.18s ease,
			visibility 0s linear 0.18s,
			scrollbar-color 0.3s ease;
	}
	.wp-menu[data-fade-scroll]:global(.scrolling) {
		transition:
			opacity 0.18s ease,
			visibility 0s linear 0.18s,
			scrollbar-color 0.12s ease;
	}
	/* Touch waypoint: the tick strip is pointer-sized and parked on the
	wrong edge for thumbs, so touch gets a jump icon in the composer
	tools opening a bottom sheet. Desktop keeps its hover ticks and
	floating card untouched. Later than the base waypoint rules, so
	equal-specificity ties win. */
	@media (hover: none) {
		.wp-btn {
			display: none;
		}
		/* Touch has no hover intent: a tap's sticky :hover/:focus would
		paint the sheet over the pill before the click lands, stealing
		it. Closed-only (the :not guard), so the open sheet survives the
		sticky hover + pill focus that opening by tap leaves behind. The
		sheet opens on wpOpen only; keyboard/AT activation is a click,
		so it still opens. */
		.wp-wrap:not(.open):hover .wp-menu,
		.wp-wrap:not(.open):focus-within .wp-menu {
			opacity: 0;
			visibility: hidden;
			transition:
				opacity 0.18s ease,
				visibility 0s linear 0.18s;
		}
		nav[aria-label="Waypoints"] {
			top: auto;
			right: 0;
			left: 0;
			bottom: 0;
			transform: none;
			pointer-events: none;
		}
		.wp-veil {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 60;
			border: 0;
			/* Full-bleed square corners: without this the legacy
			`nav button` pill radius turns the backdrop into an oval. */
			border-radius: 0;
			background: rgba(0, 0, 0, 0.32);
			pointer-events: auto;
		}
		.wp-menu {
			position: fixed;
			left: 0.75rem;
			right: 0.75rem;
			bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
			top: auto;
			z-index: 62;
			min-width: 0;
			max-width: none;
			max-height: 55vh;
			border-radius: 20px;
			padding: 0.25rem 0.4rem 0.5rem;
			pointer-events: auto;
		}
		.wp-wrap.open .wp-menu {
			animation: wp-sheet-in 0.18s ease-out;
		}
		.wp-sheet-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.35rem 0.1rem 0.35rem 0.7rem;
			font-size: 0.8rem;
			color: #8e8e93;
		}
		.wp-menu .wp-sheet-head button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 2.75rem;
			height: 2.75rem;
			padding: 0;
			font-size: 1.4rem;
			line-height: 1;
			color: inherit;
		}
		.wp-menu button[role="menuitem"] {
			padding: 0.75rem 0.7rem;
			font-size: 0.9rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.wp-wrap.open .wp-menu {
			animation: none;
		}
	}
	:global(html[data-theme="dark"]) .wp-sheet-head {
		color: #98989f;
	}
</style>
