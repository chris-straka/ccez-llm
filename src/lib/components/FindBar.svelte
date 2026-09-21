<!-- Find-in-chat bar: floating overlay over the upper messages.
The page owns the find object (query/cursor/hits), hit landing,
and focus; this component owns the bar markup and its surfaces.
Query and input element cross as bindables (same pattern as the
sidebar search box): typing resets the cursor and lands here,
Enter cycles or closes on a lone hit. -->
<script lang="ts">
	export interface FindBarActions {
		input: () => void;
		enter: (shift: boolean) => void;
		step: (dir: -1 | 1) => void;
		close: () => void;
	}

	interface Props {
		query: string;
		inputEl: HTMLInputElement | undefined;
		hitCount: number;
		cursor: number;
		actions: FindBarActions;
	}

	let {
		query = $bindable(""),
		inputEl = $bindable(undefined),
		hitCount,
		cursor,
		actions
	}: Props = $props();

	const countText = $derived(
		hitCount === 0
			? query.trim()
				? "No matches"
				: ""
			: `${Math.min(cursor + 1, hitCount)}/${hitCount}`
	);
</script>

<div class="find-bar" role="search" aria-label="Find in chat">
	<input
		type="search"
		bind:this={inputEl}
		bind:value={query}
		oninput={() => actions.input()}
		onkeydown={(e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				// One hit is "done": close (the cursor dies
				// with the bar). Several keep cycling; none
				// keeps the bar.
				if (hitCount === 1) actions.close();
				else actions.enter(e.shiftKey);
			}
		}}
		placeholder="Find in chat"
		aria-label="Find in chat"
		autocomplete="off"
		spellcheck={false}
	/>
	<span class="find-count" aria-live="polite">
		{countText}
	</span>
	<button
		type="button"
		aria-label="Previous match"
		title="Previous (Shift+Enter)"
		onclick={() => actions.step(-1)}>↑</button
	>
	<button
		type="button"
		aria-label="Next match"
		title="Next (Enter)"
		onclick={() => actions.step(1)}>↓</button
	>
	<button
		type="button"
		aria-label="Close find"
		title="Close (Esc)"
		onclick={() => actions.close()}>×</button
	>
</div>

<style>
	.find-bar {
		/* Floating overlay, never in-flow: opening find must not push
		the column down. Upper half of the viewport (never dead
		center), over the messages. High z-index so hits reach it,
		not the text underneath. */
		position: fixed;
		top: 25%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 60;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		background: #fff;
		background: var(--bg-raised);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}
	.find-bar input[type="search"] {
		font: inherit;
		font-size: 0.85rem;
		color: inherit;
		background: none;
		border: 0;
		outline: none;
		width: 12rem;
	}
	.find-count {
		font-size: 0.75rem;
		color: #6e6e73;
		color: var(--muted);
		min-width: 3.2rem;
		text-align: right;
		white-space: nowrap;
	}
	.find-bar button {
		font: inherit;
		font-size: 0.85rem;
		border: 0;
		border-radius: 6px;
		background: none;
		cursor: pointer;
		color: inherit;
		padding: 0.1rem 0.35rem;
		line-height: 1.2;
	}
	.find-bar button:hover {
		background: rgba(120, 120, 128, 0.18);
	}
</style>
