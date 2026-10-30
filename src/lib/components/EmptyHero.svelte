<!-- Empty-chat hero: greeting, mock-provider note, and the pills
slot (phones render LangMenus here; the composer dock site is a
separate call). The page owns emptiness and the pills; this component
owns the hero markup and its surfaces. Pills cross as a children
snippet so their props stay with their own usage, not drilled
through the hero. In news mode the welcome text goes away and the
pills become the top rail above the story cards. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { fade } from "svelte/transition";
	import { music } from "$lib/music.svelte";

	interface Props {
		mock: boolean;
		newsMode: boolean;
		children: Snippet;
	}

	let { mock, newsMode, children }: Props = $props();

	let root = $state<HTMLDivElement | null>(null);
	const reduceMotion =
		typeof matchMedia === "function" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches;

	// Entering or leaving news/listen moves the pills between the
	// centered greeting and the top rail: glide them there (measure
	// before the change, then play the difference back to zero) so
	// the panel's arrival never reads as a jump.
	let pillsTop: number | null = null;
	const pills = (): Element | null =>
		root?.querySelector(".lang-menus") ?? root?.firstElementChild ?? null;
	$effect.pre(() => {
		void newsMode;
		pillsTop = pills()?.getBoundingClientRect().top ?? null;
	});
	$effect(() => {
		void newsMode;
		const before = pillsTop;
		const after = pills()?.getBoundingClientRect().top;
		if (!root || before === null || after === undefined) return;
		const dy = before - after;
		if (Math.abs(dy) < 2 || typeof root.animate !== "function") return;
		// Reduce Motion: the same change as a short fade, nothing moves.
		root.animate(
			reduceMotion
				? [{ opacity: 0.35 }, { opacity: 1 }]
				: [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
			{
				duration: reduceMotion ? 220 : 340,
				easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
			}
		);
	});
</script>

<div
	class="empty-state"
	class:news-mode={newsMode}
	class:under-music={music.song !== null}
	bind:this={root}
>
	{#if !newsMode}
		<h1
			class="hero"
			in:fade={{
				duration: 220,
				delay: reduceMotion ? 0 : 120
			}}
		>
			What can I do for you?
		</h1>
	{/if}
	{#if mock}
		<p class="mock-note"><strong>Mock provider active.</strong></p>
	{/if}
	{@render children()}
</div>

<style>
	/* Shared column width (hero, sending status): the status keeps
	its global pairing paged; the hero carries its own. */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 1rem 0.5rem;
		align-self: center;
		width: 100%;
		max-width: min(100%, calc(var(--chat-width, 36) * 1rem));
		box-sizing: border-box;
	}
	/* News mode drops the greeting, so the pill rail becomes first
	content: stand it off the drag strip like the first article
	(browser strip, shell strip taller by its padding). */
	.empty-state.news-mode {
		margin-top: 1.75rem;
		/* Headlines browse wider than a chat column reads: up to three
		cards across on a laptop, never narrower than the chat. */
		max-width: min(100%, max(calc(var(--chat-width, 36) * 1rem), 68rem));
	}
	:global(.app[data-titlebar="overlay"]) .empty-state.news-mode {
		margin-top: calc(1.75rem + 1.15rem);
	}
	/* The music bar sits over the top: the rail starts under it. */
	.empty-state.news-mode.under-music {
		margin-top: calc(1.75rem + 3.5rem);
	}
	/* Extras under the pills (study modes, flashcards due) hang below
	the centered block instead of growing it: the greeting holds its
	place whether they show or not. The news rail keeps them in flow. */
	.empty-state:not(.news-mode) {
		position: relative;
	}
	.empty-state :global(.hero-extras) {
		display: contents;
	}
	.empty-state:not(.news-mode) :global(.hero-extras) {
		position: absolute;
		top: calc(100% - 0.4rem);
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
	}
	.hero {
		margin: 0;
		text-align: center;
		text-wrap: balance;
		font-size: 1.65rem;
		font-weight: 650;
		letter-spacing: -0.01em;
		/* Welcome text is chrome, not content: never selectable. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	.mock-note {
		margin: 0;
		color: #6e6e73;
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
