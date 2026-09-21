<!-- Phone chat switcher: opened by a two-finger hold on the main
chat. Swipes (and arrows) cycle chats without closing; tapping
away or Esc closes. Desktop never renders it. The page owns which
chat shows and the open flag; this component owns the card, the
actions row, and their surfaces (Svelte scoping binds the CSS to
this markup). The veil/box shell renders through `Modal.svelte`. -->
<script lang="ts">
	import ActionIcon from "./ActionIcon.svelte";
	import Modal from "./Modal.svelte";

	/** Page-owned behaviors the card and actions drive. */
	export interface ChatSwitcherActions {
		close: () => void;
		step: (direction: 1 | -1) => void;
		newChat: () => void;
		deleteActive: () => void;
	}

	interface Props {
		/** Shown chat title (computed by the page from chat state). */
		title: string;
		/** Shown position ("2 / 5", computed by the page). */
		position: string;
		/** Open timestamp: the opening gesture's own compat click
		lands on the veil within a beat, so taps inside the grace
		window never close. */
		openedAt: number;
		actions: ChatSwitcherActions;
	}

	let { title, position, openedAt, actions }: Props = $props();

	function veilClick(event: MouseEvent): void {
		if (event.target !== event.currentTarget) return;
		// The opening gesture's own compat click (double-tap or
		// hold release) lands here within a beat: taps inside
		// the grace window never close.
		if (Date.now() - openedAt < 600) return;
		actions.close();
	}
</script>

<Modal
	label="Switch chat"
	veilClass="chat-switcher"
	cardClass="switcher-card"
	onVeilClick={veilClick}
>
	<button
		type="button"
		class="switcher-arrow"
		aria-label="Older chat"
		onclick={() => actions.step(-1)}>‹</button
	>
	<div class="switcher-mid">
		<div class="switcher-title">
			{title}
		</div>
		<div class="switcher-pos">
			{position}
		</div>
	</div>
	<button
		type="button"
		class="switcher-arrow"
		aria-label="Newer chat"
		onclick={() => actions.step(1)}>›</button
	>
	{#snippet below()}
		<div class="switcher-actions">
			<button
				type="button"
				class="switcher-act"
				title="New chat"
				aria-label="New chat"
				onclick={() => {
					actions.newChat();
					actions.close();
				}}>+</button
			>
			<button
				type="button"
				class="switcher-act"
				title="Delete chat"
				aria-label="Delete chat"
				onclick={() => actions.deleteActive()}
				><ActionIcon kind="delete" /></button
			>
		</div>
	{/snippet}
</Modal>

<style>
	/* Veil/box chrome (chat-switcher seating, switcher-card) lives in
	`Modal.svelte`, which renders those elements. */
	/* Mint/delete pair: floats centered under the card, outside
	its panel — + opens a fresh chat and dismisses, the trash
	drops the shown chat and stays put so a purge streak never
	leaves the menu. Small round buttons, same panel fill as the
	card so they read over the dimmed thread. */
	.switcher-actions {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
		user-select: none;
		-webkit-user-select: none;
		/* Dead space between the round buttons belongs to the veil:
		taps there dismiss like any tap-away instead of dying on the
		container (only the buttons themselves keep pointer events). */
		pointer-events: none;
	}
	.switcher-act {
		pointer-events: auto;
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 2.25rem;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		font-size: 1.2rem;
		line-height: 1;
		background: #fff;
		background: var(--bg);
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 999px;
		box-shadow: 0 12px 48px rgba(0, 0, 0, 0.25);
		color: #1c1c1e;
		color: var(--ink);
		cursor: pointer;
	}
	.switcher-mid {
		flex: 1;
		min-width: 0;
		text-align: center;
	}
	.switcher-title {
		font-weight: 650;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.switcher-pos {
		color: #6e6e73;
		color: var(--dim);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.switcher-arrow {
		flex: none;
		min-width: 2.75rem;
		min-height: 2.75rem;
		font-size: 1.5rem;
		line-height: 1;
		background: none;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 12px;
		color: #1c1c1e;
		color: var(--ink);
		cursor: pointer;
	}
</style>
