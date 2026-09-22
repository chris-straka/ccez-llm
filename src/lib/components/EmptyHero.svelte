<!-- Empty-chat hero: greeting, mock-provider note, and the pills
slot (phones render LangMenus here; the composer dock site is a
separate call). The page owns emptiness and the pills; this component
owns the hero markup and its surfaces. Pills cross as a children
snippet so their props stay with their own usage, not drilled
through the hero. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		mock: boolean;
		children: Snippet;
	}

	let { mock, children }: Props = $props();
</script>

<div class="empty-state">
	<h1 class="hero">What can I do for you?</h1>
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
		font-size: 0.85rem;
	}
</style>
