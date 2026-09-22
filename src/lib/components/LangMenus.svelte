<!-- Reply-language pills: a hover preview of an empty chat shows the
same pills, inert: they preview the empty state, but every tap belongs
to the active chat — hovering away restores it. Rendered under the
hero on every platform; an open pill escapes as a fitted fixed
sheet (drop under the pill, or centered for long lists). The page
owns the open menu, the sheet anchor, the active code, and every
behavior; this component owns the row markup and its surfaces. -->
<script lang="ts">
	import {
		LANGUAGE_MENUS,
		quickKeyFor,
		type LanguageMenu,
		type ReplyLanguage
	} from "$lib/languages";
	import { tauriBackendAvailable } from "$lib/secrets";

	/** Page-owned language-menu behaviors. */
	export interface LangMenusActions {
		toggle: (id: LanguageMenu["id"], el: HTMLElement) => void;
		pick: (lang: ReplyLanguage) => void;
	}

	interface Props {
		openId: LanguageMenu["id"] | null;
		anchor: {
			left: number;
			maxH: number;
			mode: "drop" | "center";
			top: number;
		} | null;
		activeCode: string | null;
		previewing: boolean;
		actions: LangMenusActions;
	}

	let { openId, anchor, activeCode, previewing, actions }: Props =
		$props();
</script>

<div class="lang-menus" aria-label="Reply language" inert={previewing}>
	{#each LANGUAGE_MENUS as menu (menu.id)}
		<div class="lang-menu">
			<button
				type="button"
				aria-haspopup="true"
				aria-expanded={openId === menu.id}
				title="Reply in a {menu.label.toLowerCase()} language"
				onclick={(e) => actions.toggle(menu.id, e.currentTarget)}
			>
				<span aria-hidden="true">{menu.marker}</span>
				{menu.label}
			</button>
			{#if openId === menu.id}
				<!-- The open list escapes the thread scroller as a fitted
				fixed sheet (left/max-height ride inline from the pill
				rect): in-flow it would clip past the scroller box. Short
				lists drop under their pill, long ones center. -->
				<div
					class="lang-list"
					class:lang-list-fixed={anchor !== null}
					class:lang-list-drop={
						anchor !== null && anchor.mode === "drop"
					}
					role="menu"
					style={anchor
						? `left: ${anchor.left}px; max-height: ${anchor.maxH}px;${anchor.mode === "drop" ? ` top: ${anchor.top}px;` : ""}`
						: undefined}
				>
					<!-- Menu-click clears only languages without a number key
					(keyed ones clear by repeating the key). -->
					{#each [...menu.languages].sort( (a, b) => a.name.localeCompare(b.name, "en") ) as lang (lang.code)}
						{@const quickKey = quickKeyFor(lang.code)}
						<button
							type="button"
							role="menuitem"
							class:selected={activeCode === lang.code}
							title={quickKey && tauriBackendAvailable() ? `${lang.name} (${quickKey})` : lang.name}
							onclick={() => actions.pick(lang)}
						>
							<span class="badge" aria-hidden="true">{lang.badge}</span>
							{lang.name}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	/* Four region menus share one row on a phone: no wrap, tighter
	chrome. Desktop keeps the wrapping rhythm. */
	:global(.app[data-android]) .lang-menus {
		flex-wrap: nowrap;
		gap: 0.4rem;
	}
	/* The row slots under the hero on every platform (no dock
	anymore): kill the empty-screen auto margin and its padding —
	the empty-state gap owns the rhythm now. */
	:global(.empty-state) .lang-menus {
		margin-top: 0.25rem;
		padding: 0;
	}
	/* Under-hero pills open downward. Fixed sheets (below) are
	exempt: their top rides inline or centers. */
	:global(.empty-state) .lang-menu .lang-list:not(.lang-list-fixed) {
		top: calc(100% + 0.35rem);
		bottom: auto;
	}
	/* The open sheet escapes the thread scroller as a fitted fixed
	panel (left/max-height ride inline from the pill rect): the
	scroller clips anything past its box, which read as five
	languages cut by a rectangle. Short lists drop under their
	pill (.lang-list-drop, top rides inline); long ones center on
	the screen (top:50% plus translateY). The list never sets a
	top/bottom pair (an over-constrained fixed box stretches
	full-band and reads as a massive empty panel). Long lists cap
	at max-height and scroll. */
	.lang-menu .lang-list-fixed {
		position: fixed;
		top: 50%;
		bottom: auto;
		left: auto;
		right: auto;
		transform: translateY(-50%);
		z-index: 60;
		overflow-y: auto;
	}
	.lang-menu .lang-list-fixed.lang-list-drop {
		top: auto;
		transform: none;
	}
	:global(.app[data-android]) .lang-menu > button {
		font-size: 0.75rem;
		padding: 0.3rem 0.55rem;
		white-space: nowrap;
	}
	/* Narrow phones (S24 is 360 CSS px): four pills plus gaps overrun
	by ~16px, clipping Classics half off-screen — and a clipped pill
	anchors its sheet from a rect the user can't see. Tighten gaps
	and padding instead of scrolling or renaming; wider phones keep
	the roomier row above. */
	@media (max-width: 380px) {
		:global(.app[data-android]) .lang-menus {
			gap: 0.2rem;
		}
		:global(.app[data-android]) .lang-menu > button {
			padding: 0.3rem 0.35rem;
		}
	}
	.lang-menus {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.lang-menus {
		width: calc(100% - 2.4rem);
		max-width: calc(var(--chat-width, 36) * 1rem);
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
	}
	:global(main.empty) .lang-menus {
		justify-content: center;
	}
	/* No row-level fade here: hovering open space inside the row lit
	every button at once and the opacity shimmer read as movement.
	Each pill answers only for itself (border-color on
	.lang-menu > button:hover below); the row stays put on all
	platforms. Touch layouts untouched. */
	.lang-menu {
		position: relative;
	}
	.lang-menu > button {
		font-size: 0.82rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		background: none;
		cursor: pointer;
		padding: 0.4rem 0.8rem;
		color: #1c1c1e;
		color: var(--ink);
		transition: border-color 0.15s ease;
	}
	.lang-menu > button:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	.lang-list {
		position: absolute;
		z-index: 40;
		/* Desktop opens upward over the composer, never down past it
		(phones override below: their pills hang under the hero). */
		bottom: calc(100% + 0.35rem);
		left: 0;
		/* Shrink-wrap the longest name: a fixed min-width leaves dead
		space right of every short option and pushes right-edge menus
		(like African) off-screen. */
		min-width: 0;
		width: max-content;
		max-width: calc(100vw - 1rem);
		/* Full extent, never a scrollbar: the longest menu is 15 items
		and the list opens upward over the messages. */
		display: flex;
		flex-direction: column;
		padding: 0.3rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		background: #fff;
		background: var(--bg-raised);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}
	@media (hover: none) {
		/* A phone can't fit the 15-item list above the pills, so it
		gets a capped sheet with its own scroll instead of flying off
		the top of the screen. Desktop keeps full extent, no scrollbar. */
		.lang-list {
			max-height: 52vh;
			overflow-y: auto;
		}
		/* Phone menus must not trail off-screen: middle menus center
		under their button, while the edge menus hug their own edge
		(Europe's list spilled left, Classics' right). The capped
		max-width still bounds every list to the viewport. Fitted
		sheets carry their own geometry, so these in-flow rules
		exempt them. */
		.lang-menu .lang-list:not(.lang-list-fixed) {
			left: 50%;
			right: auto;
			transform: translateX(-50%);
		}
		.lang-menu:first-child .lang-list:not(.lang-list-fixed) {
			left: 0;
			transform: none;
		}
		.lang-menu:last-child .lang-list:not(.lang-list-fixed) {
			left: auto;
			right: 0;
			transform: none;
		}
	}
	/* The last menu (Classics) hugs the right edge: a left-anchored
	list of long nowrap names trails off the page there. Right-anchor
	it instead (all viewports — narrow desktop windows clip it too).
	Fitted sheets carry their own geometry, so they stay exempt. */
	.lang-menu:last-child .lang-list:not(.lang-list-fixed) {
		left: auto;
		right: 0;
	}
	.lang-list button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		border: 0;
		border-radius: 7px;
		background: none;
		cursor: pointer;
		padding: 0.35rem 0.45rem;
		text-align: left;
		color: #1c1c1e;
		color: var(--ink);
		white-space: nowrap;
		transition: background-color 0.15s ease;
	}
	.lang-list button:hover,
	.lang-list button:focus-visible {
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	.lang-list button.selected {
		font-weight: 650;
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	.badge {
		display: inline-block;
		min-width: 2rem;
		text-align: center;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #3a3a3c;
		color: var(--focus);
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 6px;
		padding: 0.1rem 0.3rem;
	}
</style>
