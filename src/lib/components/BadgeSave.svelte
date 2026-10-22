<!-- Desktop: hovering an annotation badge offers a save-as-card icon
beside it. It stays while the pointer moves from the badge onto it,
fades a moment after the pointer leaves both, and drops on scroll (the
badge moves, the icon is fixed). Filled when the quote is already a
card; a click saves or unsaves. Phones save from the answer card. -->
<script lang="ts">
	interface Props {
		/** The badge under the pointer (null: none). */
		badgeId: string | null;
		saved: (id: string) => boolean;
		toggle: (id: string) => void;
	}

	let { badgeId, saved, toggle }: Props = $props();

	/** Linger after the pointer leaves the badge, so it can reach us. */
	const LINGER_MS = 350;

	let shown = $state<{ id: string; x: number; y: number } | null>(null);
	let over = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const id = badgeId;
		if (timer) clearTimeout(timer);
		timer = null;
		if (id) {
			const el = document.querySelector(`[data-ann-badge="${CSS.escape(id)}"]`);
			if (!(el instanceof HTMLElement)) return;
			const r = el.getBoundingClientRect();
			shown = { id, x: r.right + 4, y: r.top + r.height / 2 };
			return;
		}
		timer = setTimeout(() => {
			timer = null;
			if (!over) shown = null;
		}, LINGER_MS);
	});

	$effect(() => {
		const drop = () => {
			if (!over) shown = null;
		};
		window.addEventListener("scroll", drop, true);
		return () => window.removeEventListener("scroll", drop, true);
	});

	const isSaved = $derived(shown ? saved(shown.id) : false);
</script>

{#if shown}
	{@const at = shown}
	<button
		type="button"
		class="badge-save"
		class:saved={isSaved}
		style="left: {at.x}px; top: {at.y}px"
		aria-label={isSaved ? "Remove from cards" : "Save as a card"}
		title={isSaved ? "Saved as a card · click to remove" : "Save as a card"}
		onpointerenter={() => (over = true)}
		onpointerleave={() => {
			over = false;
			if (!badgeId) shown = null;
		}}
		onmousedown={(e) => {
			// Keep the selection and focus where they are.
			e.preventDefault();
			e.stopPropagation();
		}}
		onclick={(e) => {
			e.stopPropagation();
			toggle(at.id);
		}}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true"
			><path d="M4.5 2.5h7v11L8 10.8l-3.5 2.7z" /></svg
		>
	</button>
{/if}

<style>
	.badge-save {
		position: fixed;
		z-index: 25;
		transform: translateY(-50%);
		width: 1.6rem;
		height: 1.6rem;
		display: grid;
		place-items: center;
		padding: 0;
		border: 1px solid var(--line-soft);
		border-radius: 50%;
		background: var(--bg);
		color: var(--muted);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
		cursor: pointer;
		animation: save-in 0.12s ease;
	}
	.badge-save:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
	.badge-save.saved {
		color: var(--accent);
	}
	.badge-save svg {
		width: 0.9rem;
		height: 0.9rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.badge-save.saved svg {
		fill: currentColor;
	}
	@keyframes save-in {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.badge-save {
			animation: none;
		}
	}
</style>
