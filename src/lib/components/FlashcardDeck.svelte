<!-- Flashcards dialog: one card at a time from answered annotations
across every chat (see flashcards.ts). Front is the quote over its
context sentence; tapping or Space flips to the answer, then Again /
Got it grade it. Delete drops a card from the deck without touching
its annotation. The page owns the session, the schedule, and every
behavior; this component owns the card markup and its flip. -->
<script lang="ts">
	import {
		RELEARN_MS,
		currentCard,
		gradeCard,
		intervalLabel,
		type DeckSession,
		type ReviewSchedule
	} from "$lib/flashcards";
	import Modal from "./Modal.svelte";

	export interface FlashcardDeckActions {
		flip: () => void;
		again: () => void;
		good: () => void;
		dismiss: () => void;
		exportAnki: () => void;
		close: () => void;
	}

	interface Props {
		session: DeckSession;
		schedule: ReviewSchedule;
		/** Every live card (the done screen's export count). */
		total: number;
		/** Soonest upcoming due time, for the done screen. */
		nextDue: number | null;
		now: number;
		actions: FlashcardDeckActions;
	}

	let { session, schedule, total, nextDue, now, actions }: Props = $props();

	const card = $derived(currentCard(session));
	const left = $derived(session.queue.length - session.index);
	const goodIn = $derived(
		card ? gradeCard(schedule[card.key], "good", now).due - now : 0
	);

	function veilClick(event: MouseEvent): void {
		if (event.target !== event.currentTarget) return;
		actions.close();
	}

	/** Context with the quote picked out (first match only). */
	const contextParts = $derived.by(() => {
		if (!card?.context) return null;
		const at = card.context.indexOf(card.quote);
		if (at === -1) return { before: card.context, quote: "", after: "" };
		return {
			before: card.context.slice(0, at),
			quote: card.quote,
			after: card.context.slice(at + card.quote.length)
		};
	});
</script>

<Modal label="Flashcards" cardClass="flashcards-modal" onVeilClick={veilClick}>
	<div class="deck">
		{#if card}
			<p class="deck-count" aria-live="polite">
				{left === 1 ? "1 card left" : `${left} cards left`}
			</p>
			<button
				type="button"
				class="flashcard"
				class:flipped={session.flipped}
				aria-label={session.flipped ? "Show the front" : "Show the answer"}
				onclick={actions.flip}
			>
				{#key card.key}
					<span
						class="face front"
						aria-hidden={session.flipped}
						lang={card.lang ?? undefined}
					>
						<span class="quote" dir="auto">{card.quote}</span>
						{#if contextParts}
							<span class="context" dir="auto"
								>{contextParts.before}<mark>{contextParts.quote}</mark
								>{contextParts.after}</span
							>
						{/if}
					</span>
					<span class="face back" aria-hidden={!session.flipped}>
						<span class="answer" dir="auto">{card.answer}</span>
						{#if card.note}
							<span class="note" dir="auto">{card.note}</span>
						{/if}
					</span>
				{/key}
			</button>
			<div class="deck-actions">
				<button
					type="button"
					class="deck-delete"
					title="Remove from flashcards (the annotation stays)"
					onclick={actions.dismiss}>Delete</button
				>
				{#if session.flipped}
					<button
						type="button"
						title="Again: back in {intervalLabel(RELEARN_MS)} (1)"
						onclick={actions.again}>Again</button
					>
					<button
						type="button"
						class="deck-good"
						title="Got it: next in {intervalLabel(goodIn)} (2)"
						onclick={actions.good}>Got it</button
					>
				{:else}
					<button type="button" class="deck-good" onclick={actions.flip}
						>Show answer</button
					>
				{/if}
			</div>
		{:else}
			<div class="deck-done">
				<p class="done-title">
					{session.reviewed > 0 ? "All caught up" : "No cards due"}
				</p>
				<p class="done-sub">
					{#if total === 0}
						Answered annotations in your chats become flashcards here.
					{:else if nextDue !== null}
						Next card in {intervalLabel(nextDue - now)}.
					{:else}
						{total === 1 ? "1 card" : `${total} cards`} in the deck.
					{/if}
				</p>
				<div class="deck-actions">
					{#if total > 0}
						<button type="button" onclick={actions.exportAnki}
							>Export to Anki</button
						>
					{/if}
					<button type="button" class="deck-good" onclick={actions.close}
						>Done</button
					>
				</div>
			</div>
		{/if}
	</div>
</Modal>

<style>
	.deck {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.deck-count {
		margin: 0;
		color: var(--muted);
		font-size: 0.8rem;
		text-align: center;
		user-select: none;
		-webkit-user-select: none;
	}
	/* The card is one button; both faces stack in one grid cell so the
	box takes the taller face and the flip never changes its size. */
	.flashcard {
		display: grid;
		perspective: 60rem;
		width: 100%;
		min-height: 11rem;
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: center;
		cursor: pointer;
	}
	.face {
		grid-area: 1 / 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.7rem;
		padding: 1.4rem 1.2rem;
		border: 1px solid var(--line-soft);
		border-radius: 12px;
		background: var(--bg-raised);
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
		transition: transform 0.42s cubic-bezier(0.2, 0.7, 0.2, 1);
		animation: card-in 0.28s ease-out;
	}
	.back {
		transform: rotateY(180deg);
	}
	.flipped .front {
		transform: rotateY(-180deg);
	}
	.flipped .back {
		transform: rotateY(0deg);
	}
	@keyframes card-in {
		from {
			opacity: 0;
			translate: 0 0.5rem;
		}
	}
	.quote {
		font-size: 1.6rem;
		font-weight: 650;
		line-height: 1.25;
	}
	.context,
	.note {
		color: var(--muted);
		font-size: 0.92rem;
		line-height: 1.45;
	}
	.context mark {
		background: none;
		color: var(--ink);
		font-weight: 600;
	}
	.answer {
		font-size: 1.05rem;
		line-height: 1.5;
		white-space: pre-wrap;
	}
	.deck-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.deck-actions button {
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--line-soft);
		border-radius: 999px;
		background: none;
		color: var(--ink);
		font: inherit;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.deck-actions button:hover {
		border-color: var(--line);
	}
	.deck-actions button:focus-visible,
	.flashcard:focus-visible .face {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.deck-actions .deck-good {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
	/* Delete sits apart at the left: never next to the thumb's grade. */
	.deck-actions .deck-delete {
		margin-right: auto;
		border-color: transparent;
		color: var(--muted);
	}
	.deck-done {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem 0 0;
		text-align: center;
		user-select: none;
		-webkit-user-select: none;
	}
	.done-title {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 650;
	}
	.done-sub {
		margin: 0 0 0.8rem;
		color: var(--muted);
	}
	.deck-done .deck-actions {
		justify-content: center;
	}
	@media (prefers-reduced-motion: reduce) {
		.face {
			transition: none;
			animation: none;
		}
	}
</style>
