<!-- Annotation answer popover: a filed note's reply, read beside its
highlighted word. The page owns open state, the quote anchor (kept in
step with scrolls) and the fade-out timing; this component measures
itself and places itself against the anchor (placeAnswerPopover):
below the word, flipped above when only the top has room, height
capped with an inner scroll when neither side does, and a tail
pointing back at the word. The quote itself never renders here (the
highlighted word upstream is the title) — answer text renders as plain
text, never HTML, so model output can't inject markup. Lines render
as their own paragraphs; a short first line (the expression and its
meaning) reads as the note's headline. No close button and no tools
in the card: clicking off closes it (Esc too); rewording is the E key,
prompt approval the badge's plus/minus. Two buttons hang outside the
card on the side away from the word: Save (the quote as a flashcard)
and Reply (opens the field to argue with the answer). The body's
scroll position is remembered per note, so a long argument reopens
where it was left. -->
<script module lang="ts">
	/** Body scroll per note (badge id), for this session. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered.
	const scrollMemory = new Map<string, number>();
</script>

<script lang="ts">
	import { tick, untrack } from "svelte";
	import {
		placeAnswerPopover,
		type AnchorRect,
		type NoteColumn
	} from "$lib/annPop";
	import type { AnnotationFollowUp } from "$lib/annotations";
	import {
		cardWordRow,
		shortGrammar,
		WORD_PROFILES,
		wordCardDir,
		type WordCard
	} from "$lib/word-card";
	import { dictDownloads, dictPack } from "$lib/dictionary.svelte";

	interface Props {
		answer: string;
		/** Fade-out in flight (unmounts when the ramp ends). */
		closing: boolean;
		/** The annotated word's viewport rect. */
		anchor: AnchorRect;
		/** Top edge kept clear above the word (its badge). */
		clearTop: number;
		/** The quote's article column (the card stays inside it). */
		column?: NoteColumn;
		/** Pointer x of the opening press (wide quotes aim here). */
		pointX: number;
		/** Widest the card may run (px); prose caps it narrower. */
		maxWidth: number;
		/** Word-to-tail breath (px, grows with the text size). */
		gap: number;
		/** Badge whose word this note explains (pulses on open). */
		badgeId: string;
		/** The quote is saved as a card (the corner icon fills). */
		saved?: boolean;
		/** Save or unsave the quote as a card; absent hides the icon
		 * (flashcards off). */
		onToggleSave?: (() => void) | undefined;
		/** Replies argued under the answer, oldest first. */
		thread?: AnnotationFollowUp[];
		/** The one-word answer as a word card; renders in place of the
		answer's lines. */
		wordCard?: WordCard | undefined;
		/** Send a reply; resolves false when it failed (the text comes
		back to the field). Absent hides the reply field. */
		onReply?: ((text: string) => Promise<boolean>) | undefined;
		/** The annotated words (the word row drops what repeats them). */
		quote?: string;
		/** Bumped by R on desktop: opens the reply field. */
		replyRequest?: number;
		/** Phones show a Reply icon; desktop replies with R. */
		replyButton?: boolean;
	}

	let {
		answer,
		closing,
		anchor,
		clearTop,
		column,
		pointX,
		maxWidth,
		gap,
		badgeId,
		saved = false,
		onToggleSave,
		thread = [],
		wordCard,
		onReply,
		quote = "",
		replyRequest = 0,
		replyButton = false
	}: Props = $props();

	/** The split row shows when there is a split, or a base form for
	a word with none. */
	/** The word row without repeats (cardWordRow): pieces, the ghost
	article, and the facts left for pills. */
	const row = $derived(wordCard ? cardWordRow(wordCard, quote) : null);
	const cardWord = $derived(row?.parts ?? []);
	const cardReadings = $derived(cardWord.some((p) => p.reading));
	/** The stem piece, which carries the gender letter. */
	const stemAt = $derived(
		Math.max(
			0,
			cardWord.findIndex((p) => p.kind === "core")
		)
	);
	/** The card's language pack downloading right now (0 to 1). */
	const downloading = $derived.by(() => {
		const pack = wordCard?.lang ? dictPack(wordCard.lang) : null;
		return pack ? dictDownloads[pack] : undefined;
	});

	/** The reply field's text, and its height (re-measures the card
	when it changes). The field shows only after Reply is pressed,
	for the note it was pressed on. */
	let reply = $state("");
	let replyH = $state(0);
	let replyingFor = $state<string | null>(null);
	const replying = $derived(onReply !== undefined && replyingFor === badgeId);
	const fieldH = $derived(replying ? replyH : 0);
	let field: HTMLTextAreaElement | undefined = $state();
	/** The button row's height, gap included (placement keeps room
	for it outside the card). */
	let actionsH = $state(0);
	let actionsW = $state(0);

	function toggleReply(): void {
		if (replying) {
			replyingFor = null;
			return;
		}
		replyingFor = badgeId;
		void tick().then(() => field?.focus());
	}
	// R on desktop: each bump opens the reply field (the first value
	// is the page's count so far, not a press).
	let seenReplyRequest = untrack(() => replyRequest);
	$effect(() => {
		if (replyRequest === seenReplyRequest) return;
		seenReplyRequest = replyRequest;
		if (!onReply || replying) return;
		replyingFor = badgeId;
		void tick().then(() => field?.focus());
	});
	const waiting = $derived(thread.some((t) => t.a === undefined));
	const splitLines = (text: string): string[] =>
		text
			.split(/\n+/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0);

	async function sendReply(): Promise<void> {
		const text = reply.trim();
		if (!text || waiting || !onReply) return;
		reply = "";
		const ok = await onReply(text);
		if (!ok && reply === "") reply = text;
	}

	// A new reply or answer brings its turn into view: the reply's
	// top at the body's top, so a long answer reads from its start.
	// Opening a card (or switching notes) leaves the remembered spot.
	let lastTurn: string | null = null;
	$effect(() => {
		const mark = `${badgeId}/${thread.length}/${thread.at(-1)?.a === undefined}`;
		const prev = lastTurn;
		lastTurn = mark;
		if (prev === null || prev === mark || !prev.startsWith(`${badgeId}/`))
			return;
		const q = body?.querySelectorAll<HTMLElement>(".ann-thread-q");
		const turn = q?.[q.length - 1];
		if (!body || !turn) return;
		body.scrollTo({
			top: Math.max(0, turn.offsetTop - 8),
			behavior: reducedMotion() ? "auto" : "smooth"
		});
	});

	// Reopening a note restores its scroll once the card is placed
	// (before that the body isn't capped, so nothing scrolls).
	let restoredFor: string | null = null;
	$effect(() => {
		const id = badgeId;
		if (restoredFor === id || !place || !body) return;
		restoredFor = id;
		body.scrollTop = scrollMemory.get(id) ?? 0;
	});
	function rememberScroll(): void {
		if (body && restoredFor === badgeId)
			scrollMemory.set(badgeId, body.scrollTop);
	}

	/** Tail depth past the card edge: half the rotated square's diagonal. */
	const TAIL = 9;

	let card: HTMLDivElement | undefined = $state();
	let body: HTMLDivElement | undefined = $state();
	let size = $state<{ w: number; h: number } | null>(null);
	/** Card height outside the body (reply field, border): the body's
	cap leaves room for it, so the whole card keeps to the placement's
	height and never runs onto the word's badge. */
	let chromeH = $state(0);
	let vw = $state(typeof window === "undefined" ? 1024 : window.innerWidth);
	let vh = $state(typeof window === "undefined" ? 768 : window.innerHeight);

	const lines = $derived(
		answer
			.split(/\n+/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0)
	);
	/** A short first line is the gloss and reads bold as the note's
	headline, alone or with a note under it; a long one (a clause
	translated in full, an old single-paragraph answer) stays prose. */
	const headed = $derived((lines[0]?.length ?? 0) <= 90);

	/** The composer's top edge, when it floats over the thread below
	the word: the card treats it as the floor, so a bottom note
	flips above instead of landing on the input. */
	let floor = $state<number | null>(null);
	function readFloor(): void {
		const prompt = document.querySelector(".prompt");
		const top =
			prompt instanceof HTMLElement ? prompt.getBoundingClientRect().top : null;
		floor = top !== null && top > 0 && top < vh ? top : null;
	}
	$effect(() => {
		void vh;
		readFloor();
	});
	const bottomEdge = $derived(
		floor !== null && floor > anchor.bottom + 24 ? floor : vh
	);

	const place = $derived(
		size
			? placeAnswerPopover({
					anchor,
					clearTop,
					pointX,
					cardWidth: size.w,
					cardHeight: size.h,
					viewportWidth: vw,
					viewportHeight: bottomEdge,
					gap,
					tail: TAIL,
					outside: actionsH,
					...(column ? { column } : {})
				})
			: null
	);

	/** The row hangs from the card's right edge, or its left when a
	narrow card near the left edge would push it off-screen. */
	const actionsStart = $derived(
		place !== null && size !== null && place.x + size.w - actionsW < 8
	);

	function reducedMotion(): boolean {
		return (
			typeof matchMedia !== "undefined" &&
			matchMedia("(prefers-reduced-motion: reduce)").matches
		);
	}

	/** Natural size: the body's full scroll height plus the card chrome,
	so a capped card still knows how tall it wants to be. offset*
	ignores transforms, so the open scale never skews a measure. */
	function measure(): void {
		if (!card || !body) return;
		const w = card.offsetWidth;
		const h = card.offsetHeight - body.clientHeight + body.scrollHeight;
		if (!size || size.w !== w || size.h !== h) size = { w, h };
		const chrome = card.offsetHeight - body.offsetHeight;
		if (chrome !== chromeH) chromeH = chrome;
	}

	// Observe the text, never the card: the card's own height follows
	// the placement cap, and observing it would loop (measure, cap,
	// resize, measure) inside one frame. Re-runs when the lines
	// change (E rewords) so new paragraphs are observed too.
	$effect(() => {
		void lines;
		void wordCard;
		void thread.length;
		void thread.at(-1)?.a;
		void fieldH;
		if (!card || !body) return;
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		for (const child of Array.from(body.children)) ro.observe(child);
		return () => ro.disconnect();
	});

	// Open pulse: one ring in the badge's own colour spreads and fades.
	// The badge never scales: its tail grew and swung off the word it
	// points at. The ring rides over any ink outline the badge wears.
	$effect(() => {
		if (reducedMotion()) return;
		const badge = document.querySelector(`[data-ann-badge="${badgeId}"]`);
		if (!(badge instanceof HTMLElement) || typeof badge.animate !== "function")
			return;
		const style = getComputedStyle(badge);
		const ink = style.boxShadow === "none" ? "" : `${style.boxShadow}, `;
		const fill = style.backgroundColor;
		badge.animate(
			[
				{ boxShadow: `${ink}0 0 0 0 ${fill}` },
				{ boxShadow: `${ink}0 0 0 12px transparent` }
			],
			{ duration: 650, easing: "cubic-bezier(0.2, 0.6, 0.3, 1)" }
		);
	});
	// The open card's badge rides above its scrim (see .card-open in
	// app.css): undimmed, it reads as the note this card belongs to,
	// and the pulse plays at full strength.
	$effect(() => {
		const badge = document.querySelector(`[data-ann-badge="${badgeId}"]`);
		if (!(badge instanceof HTMLElement)) return;
		badge.classList.add("card-open");
		return () => badge.classList.remove("card-open");
	});

	// Smooth reposition: when the card's own size moves it (content
	// grew past a side, a flip, an x clamp), glide from the old spot
	// instead of jumping. The edge facing the word is the one that
	// must stay put: a below card keeps its top, an above card its
	// bottom (it grows upward, nothing to glide). Scroll tracking
	// moves the anchor and stays instant. Transform only, one ramp.
	let last: {
		x: number;
		edge: number;
		side: string;
		ax: number;
		ay: number;
	} | null = null;
	let openedAt = 0;
	$effect(() => {
		const p = place;
		if (!p || !card || !size) return;
		const shown = Math.min(size.h, p.maxHeight);
		const edge = p.side === "below" ? p.y : p.y + shown;
		const now = { x: p.x, edge, side: p.side, ax: anchor.left, ay: anchor.top };
		const prev = last;
		last = now;
		if (!prev) {
			openedAt = performance.now();
			return;
		}
		if (prev.ax !== now.ax || prev.ay !== now.ay) return;
		const dx = prev.x - now.x;
		// A flip glides the whole card across the word's line; a
		// same-side move glides its word-facing edge.
		const dy =
			prev.side === now.side
				? prev.edge - now.edge
				: now.side === "above"
					? prev.edge - (now.edge - shown)
					: prev.edge - shown - now.edge;
		if ((dx === 0 && dy === 0) || closing || reducedMotion()) return;
		// The open ramp owns the transform for its first frames.
		if (performance.now() - openedAt < 170) return;
		if (typeof card.animate !== "function") return;
		card.animate(
			[{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
			{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
		);
	});
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
	bind:this={card}
	class="ann-answer"
	class:closing
	class:above={place?.side === "above"}
	class:placed={place !== null}
	style:left="{place?.x ?? 0}px"
	style:top="{place?.y ?? 0}px"
	style:--ann-max-w="{maxWidth}px"
	style:--ann-max-h={place ? `${place.maxHeight}px` : "none"}
	style:--ann-tail-x="{place?.tailX ?? 24}px"
	style:--ann-chrome-h="{chromeH}px"
	role="dialog"
	aria-label="Annotation answer"
>
	<div class="ann-answer-body" bind:this={body} onscroll={rememberScroll}>
		{#if wordCard}
			<!-- Word card: the literal meaning leads. The word splits into
			its colored pieces, each labeled under it (readings above where
			the script hides the sound), with the multi-word form it belongs
			to beside them (sind … gegangen, word for word); the phrase it
			sits in and what that means close the card (older cards: Here,
			In this sentence). -->
			<div class="wc">
				<p class="ann-answer-text ann-answer-head" dir="auto">
					{wordCard.meaning}
				</p>
				{#if cardWord.length > 0 || wordCard.construction}
					<div class="wc-top">
						{#if cardWord.length > 0}
							<div class="wc-word" dir={wordCardDir(wordCard.lang)}>
								{#if row?.article}
									<!-- The article in ghost: it shows the gender without a
									pill repeating the word. -->
									<span class="wc-ghost" lang={wordCard.lang}
										>{row.article}</span
									>
								{/if}
								{#each cardWord as part, i (i)}
									<div class="wc-part k-{part.kind}">
										{#if cardReadings}
											<span class="wc-read" dir="auto"
												>{part.reading ?? ""}</span
											>
										{/if}
										<span class="wc-piece" lang={wordCard.lang}
											>{part.text}</span
										>
										{#if part.label}
											<span class="wc-label" dir="auto"
												>{part.kind === "core"
													? part.label
													: shortGrammar(part.label)}</span
											>
										{/if}
										{#if row?.gender && i === stemAt}
											<!-- The gender, where the article would name another
											form of the word (le lycéen above lycéens). -->
											<span class="wc-label wc-gender">{row.gender}</span>
										{/if}
										{#if part.note}
											<span class="wc-note" dir="auto">{part.note}</span>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
						{#if wordCard.construction}
							<div class="wc-form">
								<span class="wc-form-name" dir="auto"
									>{wordCard.construction.name}</span
								>
								<span class="wc-form-words" lang={wordCard.lang} dir="auto"
									>{wordCard.construction.words}</span
								>
								<span class="wc-form-gloss" dir="auto"
									>{wordCard.construction.gloss}</span
								>
							</div>
						{/if}
					</div>
				{/if}
				{#if row && row.facts.length > 0}
					<div class="wc-facts">
						{#each row.facts as fact, i (i)}
							<span class="wc-fact k-{fact.kind}" dir="auto">{fact.text}</span>
						{/each}
					</div>
				{/if}
				{#if wordCard.base}
					<p class="wc-line" dir="auto">{wordCard.base}</p>
				{/if}
				{#if wordCard.phrase}
					<p class="wc-line wc-phrase" dir="auto">
						<span lang={wordCard.lang}>{wordCard.phrase.words}</span>
						<span class="wc-arrow" aria-hidden="true">→</span>
						<span class="wc-said">means</span>
						{wordCard.phrase.meaning}
					</p>
				{/if}
				{#if wordCard.inSentence}
					<p class="wc-line" dir="auto">
						<span class="wc-key">In this sentence:</span>
						{wordCard.inSentence}
					</p>
				{/if}
				{#if wordCard.here}
					<p class="wc-line" dir="auto">
						<span class="wc-key">Here:</span>
						{wordCard.here}
					</p>
				{/if}
				{#if wordCard.watch}
					<p class="wc-line" dir="auto">
						<span class="wc-key wc-watch">Watch:</span>
						{wordCard.watch}
					</p>
				{/if}

				{#if wordCard.partial}
					<!-- The dictionary's instant card: the model is still
					writing the rest. -->
					<p class="ann-thread-wait" aria-label="Explaining">
						<span></span><span></span><span></span>
					</p>
				{/if}
				{#if downloading !== undefined && wordCard.lang}
					<p class="wc-key wc-download">
						Downloading the {WORD_PROFILES[wordCard.lang]?.name ?? ""} dictionary
						· {Math.round(downloading * 100)}%
					</p>
				{/if}
			</div>
		{:else}
			{#each lines as line, i (i)}
				<p
					class="ann-answer-text"
					class:ann-answer-head={headed && i === 0}
					dir="auto"
				>
					{line}
				</p>
			{/each}
		{/if}
		{#each thread as turn, t (t)}
			<!-- A reply and its answer: the learner's words set off to
			the right, the model's below in the card's own voice. -->
			<p class="ann-thread-q" dir="auto">{turn.q}</p>
			{#if turn.a}
				{#each splitLines(turn.a) as line, i (i)}
					<p class="ann-answer-text ann-thread-a" dir="auto">{line}</p>
				{/each}
			{:else}
				<p class="ann-thread-wait" aria-label="Answering">
					<span></span><span></span><span></span>
				</p>
			{/if}
		{/each}
	</div>
	{#if replying}
		<!-- Argue with the answer: Enter sends, Shift+Enter breaks the
		line. The thread stays in this card, never a second one. -->
		<form
			class="ann-reply"
			bind:clientHeight={replyH}
			onsubmit={(e) => {
				e.preventDefault();
				void sendReply();
			}}
		>
			<textarea
				bind:this={field}
				rows="1"
				dir="auto"
				placeholder={waiting ? "Answering…" : "Reply…"}
				aria-label="Reply to this answer"
				bind:value={reply}
				onkeydown={(e) => {
					if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
						e.preventDefault();
						void sendReply();
					}
				}}></textarea>
		</form>
	{/if}
	{#if onToggleSave || (onReply && replyButton)}
		<!-- Save and Reply hang outside the card, on the side away from
		the word, so they add no layout to the note. -->
		<div
			class="ann-answer-actions"
			class:start={actionsStart}
			bind:offsetHeight={actionsH}
			bind:offsetWidth={actionsW}
		>
			{#if onToggleSave}
				<button
					type="button"
					class="ann-answer-save"
					class:on={saved}
					aria-label={saved ? "Remove from cards" : "Save as a card"}
					title={saved ? "Saved as a card · click to remove" : "Save as a card"}
					onmousedown={(e) => e.preventDefault()}
					onclick={(e) => {
						e.stopPropagation();
						onToggleSave();
					}}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"
						><path d="M4.5 2.5h7v11L8 10.8l-3.5 2.7z" /></svg
					>{saved ? "Saved" : "Save"}
				</button>
			{/if}
			{#if onReply && replyButton}
				<button
					type="button"
					class="ann-answer-reply"
					class:on={replying}
					aria-pressed={replying}
					aria-label="Reply"
					onclick={(e) => {
						e.stopPropagation();
						toggleReply();
					}}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"
						><path d="M6.5 4 2.5 7.5l4 3.5M2.5 7.5h7a4 4 0 0 1 4 4v1" /></svg
					>
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* The button row hangs under the card (over it when the card sits
	above the word): right-aligned, sized off the card's text so it
	keeps pace with the text size. The padding is the gap; only the
	buttons take presses. */
	.ann-answer-actions {
		position: absolute;
		top: 100%;
		right: 0;
		display: flex;
		gap: 0.4em;
		width: max-content;
		padding-top: 0.5em;
		font-size: max(0.86rem, 0.5em);
		white-space: nowrap;
		pointer-events: none;
	}
	.ann-answer-actions.start {
		right: auto;
		left: 0;
	}
	.ann-answer.above .ann-answer-actions {
		top: auto;
		bottom: 100%;
		padding-top: 0;
		padding-bottom: 0.5em;
	}
	.ann-answer-actions button {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		min-height: 2.25rem;
		padding: 0.3em 0.85em 0.3em 0.7em;
		border: 1px solid var(--line-overlay);
		border-radius: 999px;
		background: var(--bg-overlay);
		color: var(--muted);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
		font: inherit;
		line-height: 1.2;
		cursor: pointer;
		pointer-events: auto;
		transition: color 120ms ease;
	}
	/* Reply is an icon alone (phones). */
	.ann-answer-actions .ann-answer-reply {
		padding: 0.3em 0.75em;
	}
	.ann-answer-actions button:hover,
	.ann-answer-actions button.on {
		color: var(--accent);
	}
	.ann-answer-actions svg {
		width: 1.05em;
		height: 1.05em;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.ann-answer-save.on svg {
		fill: currentColor;
	}
	@media (prefers-reduced-motion: reduce) {
		.ann-answer-actions button {
			transition: none;
		}
	}
	/* Open: scale and fade out of the word (the origin rides the tail,
	so the card grows from the word it explains). Close mirrors it. */
	@keyframes ann-answer-in {
		from {
			opacity: 0;
			transform: translateY(var(--ann-rise, -6px)) scale(0.94);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes ann-answer-out {
		from {
			opacity: 1;
			transform: none;
		}
		to {
			opacity: 0;
			transform: translateY(var(--ann-rise, -6px)) scale(0.96);
		}
	}
	.ann-answer {
		position: fixed;
		z-index: 60;
		/* Unplaced first frame (before the self-measure lands) stays
		invisible; placement lands before paint. */
		visibility: hidden;
		/* Border-box: the max width includes padding and border, so
		the card never spills past the viewport edge on phones. */
		box-sizing: border-box;
		/* Shrink to the note: short notes make a compact bubble, long
		ones wrap at a reading measure or the column cap, whichever
		is narrower. */
		width: max-content;
		max-width: min(var(--ann-max-w, 32rem), 30em);
		/* The message's type (see MessageBody's .rendered) at 1x, growing
		at 60% of its pace past that: a card floats in what room the
		window has, and at giant text the message's own size left room
		for one line. The popup-size setting rides on top. */
		font-size: calc(
			0.92rem * (1 + (var(--font-scale, 1) - 1) * 0.6) * var(--annpop-scale, 1)
		);
		line-height: var(--msg-line-height, 1.5);
		border-radius: 14px;
		/* Opaque overlay surface: any see-through let the covered
		lines ghost into the answer. */
		background: #fff;
		background: var(--bg-overlay);
		/* Hairline ring: the edgeless card dissolved into the thread
		on phones — the shadow alone didn't seat it. */
		border: 1px solid #e5e5ea;
		border-color: var(--line-overlay);
		/* Spread ring = scrim, dimming the thread while the answer
		is open (see .ann-pop). */
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		box-shadow:
			0 0 0 100vmax var(--scrim),
			var(--shadow-overlay);
		color: #1c1c1e;
		color: var(--ink);
		transform-origin: var(--ann-tail-x) 0;
		--ann-rise: -6px;
	}
	.ann-answer.placed {
		visibility: visible;
		animation: ann-answer-in 150ms cubic-bezier(0.2, 0.9, 0.3, 1.15);
	}
	.ann-answer.above {
		transform-origin: var(--ann-tail-x) 100%;
		--ann-rise: 6px;
	}
	/* Tail: a rotated square sharing the card's surface and edge,
	half tucked inside so the ring runs unbroken into it. */
	.ann-answer::before {
		content: "";
		position: absolute;
		left: calc(var(--ann-tail-x) - 6px);
		top: -7px;
		width: 12px;
		height: 12px;
		box-sizing: border-box;
		background: inherit;
		border: inherit;
		border-right-color: transparent;
		border-bottom-color: transparent;
		border-radius: 2px 0 0 0;
		transform: rotate(45deg);
	}
	.ann-answer.above::before {
		top: auto;
		bottom: -7px;
		border: inherit;
		border-left-color: transparent;
		border-top-color: transparent;
		border-radius: 0 0 2px 0;
	}
	.ann-answer-body {
		position: relative;
		box-sizing: border-box;
		max-height: calc(var(--ann-max-h, 100vh) - var(--ann-chrome-h, 0px));
		overflow-y: auto;
		overscroll-behavior: contain;
		border-radius: inherit;
		padding: 0.7em 1em 0.75em;
	}
	.ann-answer-text {
		margin: 0;
		text-wrap: pretty;
		overflow-wrap: break-word;
	}
	.ann-answer-text + .ann-answer-text {
		margin-top: 0.35em;
		/* Secondary lines (literal sense, example) step back from the
		headline without dropping to the faint muted grey. */
		color: color-mix(in srgb, currentColor 80%, transparent);
	}
	.ann-answer-head {
		font-weight: 600;
	}
	/* Word card. Each piece's kind has one hue in every language,
	mixed into the card's own surface and ink so it reads in light
	and dark themes alike. */
	.wc {
		display: flex;
		flex-direction: column;
		gap: 0.55em;
	}
	.wc .ann-answer-text {
		margin: 0;
	}
	.wc-line {
		margin: 0;
		color: color-mix(in srgb, currentColor 85%, transparent);
		overflow-wrap: break-word;
	}
	.wc-key {
		color: var(--muted);
	}
	.wc-watch {
		color: color-mix(in srgb, #e8930c 75%, var(--ink));
	}
	.wc-word {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		row-gap: 0.4em;
	}
	.wc-part {
		--hue: var(--ink);
		display: flex;
		flex-direction: column;
		align-items: stretch;
		min-width: 0;
	}
	.wc-part.k-tense,
	.wc-fact.k-tense {
		--hue: #3b82f6;
	}
	.wc-part.k-voice,
	.wc-fact.k-voice {
		--hue: #8b5cf6;
	}
	.wc-part.k-role,
	.wc-fact.k-role {
		--hue: #22a35a;
	}
	.wc-part.k-agree,
	.wc-fact.k-agree {
		--hue: #0fa89a;
	}
	.wc-part.k-derive,
	.wc-fact.k-derive {
		--hue: #e8930c;
	}
	.wc-piece {
		padding: 0.1em 0.5em;
		font-size: 1.2em;
		text-align: center;
		white-space: nowrap;
		background: color-mix(in srgb, var(--hue) 22%, var(--bg-overlay));
		color: color-mix(in srgb, var(--hue) 45%, var(--ink));
	}
	.wc-part.k-core .wc-piece {
		background: color-mix(in srgb, var(--ink) 12%, var(--bg-overlay));
		color: var(--ink);
	}
	.wc-part + .wc-part .wc-piece {
		border-inline-start: 1px solid var(--bg-overlay);
	}
	.wc-part:first-of-type .wc-piece {
		border-start-start-radius: 0.4em;
		border-end-start-radius: 0.4em;
	}
	.wc-part:last-of-type .wc-piece {
		border-start-end-radius: 0.4em;
		border-end-end-radius: 0.4em;
	}
	/* The article in ghost before the first piece, on its baseline
	and size, as quiet as the labels. */
	.wc-ghost {
		align-self: flex-start;
		padding: 0.1em 0.3em 0 0;
		font-size: 1.2em;
		line-height: inherit;
		color: color-mix(in srgb, var(--muted) 70%, transparent);
		white-space: nowrap;
	}
	.wc-read {
		min-height: 1.3em;
		padding-bottom: 0.1em;
		font-size: 0.72em;
		line-height: 1.3;
		text-align: center;
		color: var(--muted);
	}
	.wc-label {
		max-width: 10ch;
		margin: 0 auto;
		padding: 0.25em 0.2em 0;
		font-size: 0.78em;
		line-height: 1.25;
		text-align: center;
		color: color-mix(in srgb, var(--hue) 60%, var(--muted));
	}
	.wc-part.k-core .wc-label {
		color: var(--muted);
	}
	.wc-note {
		max-width: 10ch;
		margin: 0 auto;
		font-size: 0.72em;
		line-height: 1.25;
		text-align: center;
		font-style: italic;
		color: var(--muted);
	}
	/* The split and the form it belongs to sit side by side, the form
	dropping under the split where the card is too narrow. */
	.wc-top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6em 1.6em;
	}
	.wc-form {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2em;
		min-width: 0;
		text-align: center;
	}
	.wc-form-name {
		font-size: 0.82em;
		color: var(--muted);
	}
	.wc-form-gloss {
		color: color-mix(in srgb, currentColor 70%, transparent);
	}
	.wc-arrow {
		color: var(--muted);
	}
	/* Spoken by screen readers in place of the arrow. */
	.wc-said {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.wc-download {
		margin: 0;
		font-size: 0.82em;
	}
	.wc-facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35em;
	}
	.wc-fact {
		--hue: var(--ink);
		padding: 0.05em 0.6em;
		/* A full pill at one line; a fact that wraps keeps rounded
		corners instead of ballooning into an oval. */
		border-radius: 0.75em;
		font-size: 0.82em;
		background: color-mix(in srgb, var(--hue) 18%, var(--bg-overlay));
		color: color-mix(in srgb, var(--hue) 45%, var(--ink));
	}
	/* The learner's reply: set off right in the muted ink, like the
	chat's own messages, with room above it to start a new turn. */
	.ann-thread-q {
		margin: 0.8em 0 0.35em 15%;
		text-align: end;
		color: var(--muted);
		overflow-wrap: break-word;
	}
	.ann-answer-text.ann-thread-a {
		color: inherit;
	}
	.ann-thread-a + .ann-thread-a {
		margin-top: 0.35em;
	}
	/* Waiting on the model: three breathing dots. */
	.ann-thread-wait {
		display: flex;
		gap: 0.3em;
		margin: 0.2em 0 0;
		height: 1.2em;
		align-items: center;
	}
	.ann-thread-wait span {
		width: 0.35em;
		height: 0.35em;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.35;
		animation: ann-thread-dot 1.1s ease-in-out infinite;
	}
	.ann-thread-wait span:nth-child(2) {
		animation-delay: 0.15s;
	}
	.ann-thread-wait span:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes ann-thread-dot {
		50% {
			opacity: 0.9;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ann-thread-wait span {
			animation-duration: 2.2s;
		}
	}
	.ann-reply {
		margin: 0;
		padding: 0 0.7em 0.7em;
	}
	.ann-reply textarea {
		display: block;
		box-sizing: border-box;
		width: 100%;
		field-sizing: content;
		min-height: 2.2em;
		max-height: 6.5em;
		resize: none;
		margin: 0;
		padding: 0.4em 0.65em;
		border: 1px solid var(--line-soft);
		border-radius: 10px;
		background: var(--bg);
		color: inherit;
		font: inherit;
		line-height: 1.4;
	}
	.ann-reply textarea:focus {
		outline: none;
		border-color: var(--accent);
	}
	.ann-answer-head + .ann-answer-text {
		margin-top: 0.3em;
	}
	/* Stark-contrast preference: a strong edge so the card never
	dissolves into the thread. */
	@media (prefers-contrast: more) {
		.ann-answer {
			border: 1px solid #1c1c1e;
			border-color: var(--strong);
		}
	}
	.ann-answer.closing {
		animation: ann-answer-out 140ms ease-in forwards;
		pointer-events: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.ann-answer.placed {
			animation: none;
		}
		.ann-answer.closing {
			animation: none;
			opacity: 0;
		}
	}
</style>
