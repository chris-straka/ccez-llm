<!-- Sending status line: tool-fetch phase or waiting-for-reply,
under the last message. The page owns send/fetch state and the
labels; this component owns the status markup and its surfaces.
The column-width rule stays paged-global (shared with article and
the empty state); the colored dots ride the shared global .tdots
pulse (ink on aid buttons, accent/sky/green here). -->
<script lang="ts">
	export interface Props {
		/** Null renders nothing (replied, idle, or errored). */
		phase: "fetch" | "waiting" | null;
		elapsed: number;
		waitingLabel: string;
		/** Pointer over the status: it stands for the pending reply
		(the delete keys reach a reply that has not landed). */
		onenter?: () => void;
		onleave?: () => void;
	}

	let { phase, elapsed, waitingLabel, onenter, onleave }: Props = $props();
</script>

{#if phase === "fetch"}
	<!-- Tool-fetch phase: the turn went quiet pulling a page
	(even after chatter printed, when Thinking already retired).
	The elapsed count keeps running, so a long fetch reads as
	working, never stalled. -->
	<p
		class="sending"
		role="status"
		aria-label="Fetching a page"
		onmouseenter={onenter}
		onmouseleave={onleave}
	>
		<span class="sending-chip"
			>Fetching<span class="tdots" aria-hidden="true"
				><span>.</span><span>.</span><span>.</span></span
			>{#if elapsed > 0}<span class="sending-elapsed" aria-hidden="true"
					>· {elapsed}s</span
				>{/if}</span
		>
	</p>
{:else if phase === "waiting"}
	<p
		class="sending"
		role="status"
		aria-label="Waiting for a reply"
		onmouseenter={onenter}
		onmouseleave={onleave}
	>
		<span class="sending-chip"
			>{waitingLabel}<span class="tdots" aria-hidden="true"
				><span>.</span><span>.</span><span>.</span></span
			>{#if elapsed > 0}<span class="sending-elapsed" aria-hidden="true"
					>· {elapsed}s</span
				>{/if}</span
		>
	</p>
{/if}

<style>
	.sending {
		color: #6e6e73;
		color: var(--muted);
		/* Status reading text: tracks the text-size setting like messages. */
		font-size: calc(0.85rem * var(--font-scale, 1));
		/* Breathing room, explicit (never UA margins): the status
		stands off the last message above and the composer below. */
		margin: 0.9rem 0 1.1rem;
	}
	/* The wait reads as plain status text — no backplate. The three
	dots carry the color instead: accent blue, then the thinking
	sky/green tokens (per-theme, so no dark override block). Scoped
	here: bare .tdots stays ink-colored on aid buttons. */
	.sending-chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35em;
	}
	.sending .tdots span:nth-child(1) {
		color: var(--accent);
	}
	.sending .tdots span:nth-child(2) {
		color: #5ac8fa;
		color: var(--thinking-2);
	}
	.sending .tdots span:nth-child(3) {
		color: #34c759;
		color: var(--thinking-3);
	}
	.sending-elapsed {
		font-variant-numeric: tabular-nums;
	}
	/* The count stays out of the way until asked: hovering the chip
	fades it in, leaving fades it back out. Touch clients have no
	hover, so it always shows there. (Opacity only — the text keeps
	its place and still ticks.) */
	.sending-chip .sending-elapsed {
		opacity: 0;
		transition: opacity 0.25s ease;
	}
	.sending-chip:hover .sending-elapsed {
		opacity: 0.8;
	}
	@media (hover: none) {
		.sending-chip .sending-elapsed {
			opacity: 0.8;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sending-chip .sending-elapsed {
			transition: none;
		}
	}
</style>
