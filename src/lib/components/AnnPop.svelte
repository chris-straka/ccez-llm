<!-- Annotation note editor: the create pill (Annotate) and the edit
card (a filed note), fresh or filed. On desktop it is the answer
card's sibling: the same dark bubble with a tail, just below the
quote (above only when the bottom has no room), inside the article
column, wrapping and growing downward as the note gets longer, then
scrolling. Phones keep the centered card at x/y (keyboard geometry).
The page owns the pop state (anchor, fresh flag, open/close timing)
and the draft save paths; this component owns the markup, the field,
the mic/save/delete buttons, sizing and placement, and their surfaces
(Svelte scoping binds the CSS to this markup). Draft and field
element ride bindables so the page's save/focus paths keep working. -->
<script lang="ts">
	import ActionIcon from "./ActionIcon.svelte";
	import {
		annComposerWidth,
		noteEditorWidth,
		placeNoteEditor,
		type AnchorRect,
		type AnswerPlacement,
		type NoteAnchor
	} from "$lib/annPop";

	/** Open pill state (rendered fields only). */
	export interface AnnPopState {
		id: string;
		/** Phone placement (no note anchor). */
		x: number;
		y: number;
		fresh: boolean;
		/** Desktop placement: hangs off the quote. */
		note?: NoteAnchor;
	}

	/** Page-owned pill behaviors. */
	export interface AnnPopActions {
		key: (event: KeyboardEvent) => void;
		blur: () => void;
		save: () => void;
		remove: (id: string) => void;
		mic: () => void;
	}

	interface Props {
		pop: AnnPopState;
		/** Draft text (the page seeds it on open/edit). */
		draft?: string;
		/** Field element (the page focuses it on open/edit). */
		box?: HTMLTextAreaElement | undefined;
		/** Fade-out in flight (unmounts when the ramp ends). */
		closing: boolean;
		android: boolean;
		micEnabled: boolean;
		dictating: boolean;
		/** Scroll container pinned during the mount focus. */
		scrollBox?: HTMLElement | undefined;
		actions: AnnPopActions;
	}

	let {
		pop,
		draft = $bindable(""),
		box = $bindable(undefined),
		closing,
		android,
		micEnabled,
		dictating,
		scrollBox,
		actions
	}: Props = $props();

	/** Tail depth past the card edge (the answer card's). */
	const TAIL = 9;

	let resizeField = $state<(() => void) | undefined>();
	$effect(() => {
		void draft;
		void pop.id;
		resizeField?.();
	});

	/** Measured card size (natural height: the field unscrolled). */
	let size = $state<{ w: number; h: number } | null>(null);
	/** Side picked at open: a growing note never flips mid-typing. */
	let side = $state<"below" | "above" | undefined>();
	let sideFor = "";
	/** The composer's top when it floats under the quote: the card's
	floor, like the answer card's. */
	function floorFor(anchor: AnchorRect): number {
		const vh = window.innerHeight;
		const prompt = document.querySelector(".prompt");
		const top =
			prompt instanceof HTMLElement ? prompt.getBoundingClientRect().top : null;
		return top !== null && top > anchor.bottom + 24 && top < vh ? top : vh;
	}
	const place = $derived.by((): AnswerPlacement | null => {
		const note = pop.note;
		if (!note || !size) return null;
		const gap = Math.max(3, Math.round(3 + (fontScale() - 1) * 10));
		return placeNoteEditor({
			anchor: note.anchor,
			clearTop: note.clearTop,
			column: note.column,
			cardWidth: size.w,
			cardHeight: size.h,
			floor: floorFor(note.anchor),
			gap,
			tail: TAIL,
			...(side ? { side } : {})
		});
	});
	$effect(() => {
		const p = place;
		if (!p) return;
		if (sideFor !== pop.id) {
			sideFor = pop.id;
			side = p.side;
		}
	});
	function fontScale(): number {
		const app = document.querySelector(".app");
		const raw = app
			? getComputedStyle(app).getPropertyValue("--font-scale")
			: "";
		const n = parseFloat(raw);
		return Number.isFinite(n) && n > 0 ? n : 1;
	}

	function growPill(node: HTMLTextAreaElement): { destroy(): void } {
		// The insert cursor must never yank the messages list. Phones
		// re-pin behind the mount focus too: the create/edit paths
		// focus again on tick, and a WebView pan here would snap first.
		if (android) {
			const sx = window.scrollX;
			const sy = window.scrollY;
			const st = scrollBox?.scrollTop ?? 0;
			node.focus({ preventScroll: true });
			window.scrollTo(sx, sy);
			if (scrollBox) scrollBox.scrollTop = st;
		} else {
			node.focus({ preventScroll: true });
		}
		// CSS owns height where field-sizing is supported.
		const cssOwnsHeight =
			typeof CSS !== "undefined" && CSS.supports("field-sizing: content");
		const card = node.closest<HTMLElement>(".ann-pop");
		const context = document.createElement("canvas").getContext("2d");
		let widest = 0;
		let openedId = pop.id;
		let anchorX = pop.x;
		const measureText = (style: CSSStyleDeclaration): number => {
			if (!context) return 0;
			context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
			return node.value
				.split("\n")
				.reduce(
					(width, line) => Math.max(width, context.measureText(line).width),
					0
				);
		};
		// The canvas measure can run narrower than the field's own
		// layout (font fallback, kerning): widen in half-em steps until
		// the note sits on as many lines as it has newlines, so typing
		// never wraps a line and then unwraps it. Stops at the cap,
		// where wrapping is the point.
		const unwrap = (style: CSSStyleDeclaration, cap: number): void => {
			if (!card) return;
			const fontPx = parseFloat(style.fontSize);
			const lineH = parseFloat(style.lineHeight) || fontPx * 1.5;
			const pad =
				parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
			const lines = node.value.split("\n").length;
			const prior = node.style.height;
			if (!cssOwnsHeight) node.style.height = "auto";
			for (let i = 0; i < 40 && widest < cap; i++) {
				if (node.scrollHeight - pad <= lines * lineH + 1) break;
				widest = Math.min(cap, widest + fontPx / 2);
				card.style.width = `${widest}px`;
			}
			if (!cssOwnsHeight) node.style.height = prior;
		};
		const fit = () => {
			const style = getComputedStyle(node);
			const fontPx = parseFloat(style.fontSize);
			if (openedId !== pop.id) {
				openedId = pop.id;
				widest = 0;
				anchorX = pop.x;
			}
			const note = pop.note;
			if (note && card) {
				// Desktop: the note's own width between the 18em floor
				// and the article column; placement lands from the
				// measured size (see place).
				const chromeWidth =
					card.getBoundingClientRect().width -
					node.getBoundingClientRect().width;
				const columnWidth = Math.min(
					note.column.right - note.column.left,
					window.innerWidth - 16
				);
				widest = noteEditorWidth({
					fontPx,
					columnWidth,
					contentWidth: measureText(style) + fontPx / 2,
					chromeWidth,
					previousWidth: widest
				});
				card.style.width = `${widest}px`;
				unwrap(style, Math.floor(columnWidth));
				if (!cssOwnsHeight) {
					node.style.height = "auto";
					node.style.height = `${node.scrollHeight}px`;
				}
				const h = card.offsetHeight - node.clientHeight + node.scrollHeight;
				if (!size || size.w !== widest || size.h !== h) size = { w: widest, h };
				return;
			}
			if (pop.fresh && card && context) {
				context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
				const contentWidth = node.value
					.split("\n")
					.reduce(
						(width, line) => Math.max(width, context.measureText(line).width),
						0
					);
				const chromeWidth =
					card.getBoundingClientRect().width -
					node.getBoundingClientRect().width;
				widest = annComposerWidth({
					fontPx,
					viewportWidth: window.innerWidth,
					contentWidth: contentWidth + fontPx / 2,
					chromeWidth,
					previousWidth: widest,
					android
				});
				card.style.width = `${widest}px`;
				if (!android)
					unwrap(style, Math.min(window.innerWidth - 16, 30 * fontPx));
				// Only shift left when growth would cross the screen edge.
				card.style.left = `${Math.max(8, Math.min(anchorX, window.innerWidth - widest - 8))}px`;
			} else if (card && !pop.fresh) {
				card.style.removeProperty("width");
				card.style.left = `${pop.x}px`;
			}
			if (!cssOwnsHeight) {
				node.style.height = "auto";
				node.style.height = `${Math.min(node.scrollHeight, Math.max(168, 5.6 * fontPx))}px`;
			}
		};
		resizeField = fit;
		node.addEventListener("input", fit);
		window.addEventListener("resize", fit);
		fit();
		// A grown box drops its corner radius (see .ann-pop.tall): the
		// full pill radius reads over-rounded once the field is tall.
		// Measure against one line at the current type size, including
		// padding, so large single-line notes still read as capsules.
		const mark = () => {
			const h = node.clientHeight ?? 0;
			const style = getComputedStyle(node);
			const oneLine =
				parseFloat(style.lineHeight) +
				parseFloat(style.paddingTop) +
				parseFloat(style.paddingBottom);
			card?.classList.toggle("tall", h > oneLine + 1);
		};
		mark();
		const ro =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(() => {
						fit();
						mark();
					});
		if (card && ro) ro.observe(node);
		return {
			destroy: () => {
				resizeField = undefined;
				node.removeEventListener("input", fit);
				window.removeEventListener("resize", fit);
				ro?.disconnect();
			}
		};
	}

	function fieldBlur(event: FocusEvent): void {
		// Tabbing between the card's own buttons is not
		// leaving: only a departure blur-saves (clicking
		// away saves, Escape cancels). Tab reports its
		// destination reliably in every engine, unlike a
		// WebKit button press (see onFocusOutIdle).
		const next = event.relatedTarget;
		if (next instanceof Element && next.closest(".ann-pop")) return;
		actions.blur();
	}
</script>

<!-- Mousedown on the buttons keeps textarea focus: without it the
blur-save fires first and Cancel/Delete can never win the race. -->
<div
	class="ann-pop"
	class:fresh={pop.fresh}
	class:closing
	class:note={pop.note !== undefined}
	class:placed={place !== null}
	class:above={place?.side === "above"}
	style:left={`${place?.x ?? pop.x}px`}
	style:top={`${place?.y ?? pop.y}px`}
	style:--ann-max-h={place ? `${place.maxHeight}px` : null}
	style:--ann-tail-x={place ? `${place.tailX}px` : null}
	role="dialog"
	aria-label={pop.fresh ? "Annotate" : "Edit annotation"}
>
	<textarea
		rows={1}
		dir="auto"
		bind:this={box}
		bind:value={draft}
		aria-label="Annotation text. Enter or clicking away saves, Escape cancels."
		use:growPill
		onkeydown={actions.key}
		onblur={fieldBlur}></textarea>
	{#if pop.fresh}
		{#if micEnabled}
			<button
				type="button"
				class="ann-tool"
				class:recording={dictating}
				class:gone={!(dictating || draft.trim().length === 0)}
				aria-label={dictating ? "Stop dictation" : "Dictate annotation"}
				aria-pressed={dictating}
				aria-hidden={!(dictating || draft.trim().length === 0)}
				tabindex={dictating || draft.trim().length === 0 ? 0 : -1}
				title="Dictate annotation"
				onmousedown={(e) => e.preventDefault()}
				onclick={actions.mic}
			>
				<ActionIcon kind="mic" />
			</button>
		{/if}
		{#if android}
			<!-- Phones get a submit button at the pill's end: the
			software keyboard's enter key is unreliable for filing
			(desktop keeps Enter-only and the compact pill). Same
			up-arrow face as the composer's send button. -->
			<button
				type="button"
				class="ann-save ann-pill-save"
				aria-label="Save annotation"
				onmousedown={(e) => e.preventDefault()}
				onclick={actions.save}>↑</button
			>
		{/if}
	{:else}
		<div class="ann-pop-row">
			<button
				type="button"
				class="ann-tool"
				aria-label="Delete annotation"
				title="Delete annotation"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => actions.remove(pop.id)}
			>
				<ActionIcon kind="delete" />
			</button>
			<span class="ann-pop-spacer"></span>
			{#if micEnabled}
				<button
					type="button"
					class="ann-tool"
					class:recording={dictating}
					aria-label={dictating ? "Stop dictation" : "Dictate annotation"}
					aria-pressed={dictating}
					title="Dictate annotation"
					onmousedown={(e) => e.preventDefault()}
					onclick={actions.mic}
				>
					<ActionIcon kind="mic" />
				</button>
			{/if}
			<!-- No Cancel button: clicking off the card (or Escape)
			closes it — an empty draft cancels, typed text saves.
			The save is an icon twin of mic/delete (same seat, same
			size), never a text button. -->
			<button
				type="button"
				class="ann-tool"
				aria-label="Save annotation"
				title="Save annotation"
				onmousedown={(e) => e.preventDefault()}
				onclick={actions.save}
			>
				<ActionIcon kind="save" />
			</button>
		</div>
	{/if}
</div>

<style>
	/* Cursor-anchored annotation pill (ChatGPT-style): a rounded bar that
	starts as a single-line prompt and grows as you type. Enter saves,
	Shift+Enter adds a line, Escape cancels. Beats the centered-column
	group rule. */
	/* Annotation edit card: dark in both themes (same call as the
	toast) so the quoted-text mockup holds everywhere. */
	/* The pill fades in on mount and back out on close (the closing
	class waits out the ramp before the {#if} unmounts it). */
	@keyframes ann-pop-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.ann-pop {
		position: fixed;
		z-index: 60;
		/* Clip: without it, selection wash and focus paint square past
		the rounded corners on phones. Shadows paint outside, so they
		are unaffected. */
		overflow: hidden;
		/* 90% of the chat column: wide columns earn wide popups
		instead of a fixed cap (the column already widens with huge
		type, so no separate font term). The vw clamp folds into the
		min — phones never spill past the viewport edge.
		popWidth mirrors this math for centering. */
		width: min(calc(var(--chat-width, 36) * 0.9rem), calc(100vw - 1rem));
		/* Border-box: without it the padding and border stack outside
		the rem width (content-box), spilling past the viewport edge
		on phones. The responsive units only contain the card on
		every OS with this set. */
		box-sizing: border-box;
		padding: 1rem 1.1rem 0.9rem;
		border: 1px solid #545458;
		border-color: var(--line-overlay);
		border-radius: 20px;
		/* Tall boxes read over-rounded at a full pill radius, so a
		grown box (see growPill's tall flag) drops to a smaller one. */
		background: #2c2c2e;
		background: var(--bg-overlay);
		color: #f2f2f7;
		/* The spread ring is the scrim: it dims the thread while the
		box is open, so an open box never reads as page chrome. A
		shadow, not an element, so click-off still lands underneath
		and the fade carries it. */
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.65);
		box-shadow:
			0 0 0 100vmax var(--scrim),
			var(--shadow-overlay);
		animation: ann-pop-in 0.16s ease;
	}
	.ann-pop.closing {
		animation: none;
		opacity: 0;
		transition: opacity 0.16s ease;
		/* A fading card must not stay hit-testable: a badge click
		inside the 160ms window would land on the dying textarea
		instead of the badge, so the open never runs and the timer
		unmounts the focused node from under the caret. Clicks pass
		through to the badge and the normal press path morphs back. */
		pointer-events: none;
	}
	/* :global — toggled from growPill via classList (see the tall
	flag there), so the compiler can't see the use site. Covers the
	edit card and the fresh pill alike: a grown create-box drops
	out of its 999px capsule to the same smaller radius. */
	.ann-pop:global(.tall),
	.ann-pop.fresh:global(.tall) {
		border-radius: 12px;
	}
	.ann-pop textarea {
		display: block;
		width: 100%;
		/* Flooded unbroken text (pasted URLs, romaji runs) must wrap
		inside the box instead of spilling past its edge: break
		anywhere only when nothing else fits, so normal words wrap
		as before. */
		overflow-wrap: anywhere;
		/* Border-box: growPill sizes height from scrollHeight (which already
		includes padding). Content-box would double-count it and push the
		text to the top with dead space below. */
		box-sizing: border-box;
		border: 0;
		background: none;
		resize: none;
		overflow-y: auto;
		font: inherit;
		font-size: 1.05rem;
		line-height: 1.4;
		color: #f2f2f7;
		padding: 0.15rem 0;
		/* Two-line floor: the pill reads as a prompt, and the tall
		gate below trips at three lines instead of five. */
		min-height: 3rem;
		/* Four lines remain available even at very large text sizes. */
		max-height: max(168px, 5.6em);
		field-sizing: content;
	}
	.ann-pop textarea:focus {
		outline: none;
	}
	.ann-pop-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-top: 0.8rem;
	}
	.ann-pop-spacer {
		flex: 1;
	}
	.ann-tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 2.2rem;
		height: 2.2rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: #c7c7cc;
		cursor: pointer;
	}
	.ann-tool:hover {
		color: #fff;
	}
	.ann-tool.recording {
		color: #ff6b62;
		color: var(--alarm);
	}
	.ann-tool :global(.action-glyph) {
		height: 1.25rem;
	}
	.ann-save {
		flex: none;
		border: 1px solid #f2f2f7;
		border-radius: 999px;
		background: #f2f2f7;
		color: #1c1c1e;
		font: inherit;
		font-weight: 600;
		padding: 0.5rem 1.4rem;
		cursor: pointer;
		/* On the base (not :hover) so the hover animates symmetrically
		in and back out, instead of snapping one way. */
		transition:
			filter 0.15s ease,
			transform 0.15s ease;
	}
	.ann-save:hover {
		filter: brightness(1.08);
		transform: scale(1.03);
	}
	.ann-save:active {
		transform: scale(1);
	}
	/* Light theme edit card (surface and edge ride the overlay
	tokens): ink text, quiet tools, and the same system-blue primary as the send
	button. Fresh pill included — it is the same surface. */
	:global(html[data-theme="light"]) .ann-pop {
		color: #1c1c1e;
		color: var(--ink);
	}
	:global(html[data-theme="light"]) .ann-pop textarea {
		color: #1c1c1e;
		color: var(--ink);
	}
	:global(html[data-theme="light"]) .ann-pop .ann-tool {
		color: #6e6e73;
		color: var(--muted);
	}
	:global(html[data-theme="light"]) .ann-pop .ann-tool:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	:global(html[data-theme="light"]) .ann-pop .ann-tool.recording {
		color: #ff3b30;
		color: var(--alarm);
	}
	:global(html[data-theme="light"]) .ann-pop .ann-save {
		border-color: #007aff;
		border-color: var(--accent);
		background: #007aff;
		background: var(--accent);
		color: #fff;
	}
	/* The mic shows only while the note is empty (or dictating). Once
	typing starts it leaves the row entirely: kept as an invisible
	slot it padded the right edge well past the left. The box never
	narrows while typing (growPill keeps its widest width), so the
	freed room is slack, never a reflow. */
	.ann-pop .gone {
		display: none;
	}
	/* Fresh annotation: the compact pill (textarea + mic) rather than
	the edit card. Enter files it; clicking off cancels an empty draft. */
	.ann-pop.fresh {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		/* Starts compact; growPill measures the note up to 30em. */
		width: min(18em, calc(100vw - 1rem));
		/* Em padding: the pill's type scales with the popup size, and
		rem padding left big text jammed against the left edge. */
		padding: 0.45em 0.5em 0.45em 0.95em;
		border-radius: 999px;
		/* Own size track (--annpop-scale, set on .app from the
		popup-size setting): rides on top of message text, so huge
		type does not force huge popups. The fallback keeps
		standalone renders (tests, previews) at message size. */
		font-size: calc(1rem * var(--font-scale, 1) * var(--annpop-scale, 1));
	}
	.ann-pop.fresh textarea {
		flex: 1;
		min-width: 0;
		min-height: 0;
		font-size: 1em;
		padding: 0.15rem 0;
	}
	/* Thumb-sized Save target on phones (the .app ancestor stays
	global — it renders paged, unscopable). */
	:global(.app[data-android]) .ann-save {
		min-height: 2.75rem;
	}
	/* Annotation boxes read at the screen's message size on phones:
	a fixed 1rem box next to 2000% message type strands the eyes. */
	:global(.app[data-android]) .ann-pop textarea {
		font-size: calc(0.92rem * var(--font-scale, 1));
	}
	/* The desktop edit card scales with the text size like the
	creation pill does: a fixed 1rem field next to 370% type is
	unreadable. em units ride the card root, so Save and the tools
	scale with the field. The popup-size setting rides on top. */
	.ann-pop:not(.fresh) {
		font-size: calc(1rem * var(--font-scale, 1) * var(--annpop-scale, 1));
	}
	.ann-pop:not(.fresh) textarea {
		font-size: 1.05em;
	}
	/* Desktop note editor: the answer card's bubble (same surface,
	edge, radius, type and tail), hung off the quote by the placement
	above. The field grows with the note under the card's height cap
	(the room on its side, at most ~15 lines), then scrolls. No clip:
	the tail hangs outside, and the padding keeps a selection inside
	the rounded corners. Unplaced first frame stays invisible. It
	fades in (the pill's own ramp) rather than scaling out of the
	word like the answer card: the caret is live from the first
	frame, and a box moving under it reads as a jump. */
	.ann-pop.note {
		visibility: hidden;
		overflow: visible;
		display: flex;
		flex-direction: column;
		max-width: none;
		max-height: min(var(--ann-max-h, 60vh), 22em);
		padding: 0.55em 0.75em 0.55em 1em;
		border-radius: 14px;
		font-size: calc(0.92rem * var(--font-scale, 1) * var(--annpop-scale, 1));
		line-height: var(--msg-line-height, 1.5);
		animation: none;
	}
	.ann-pop.note.placed {
		visibility: visible;
		animation: ann-pop-in 0.16s ease;
	}
	.ann-pop.note.closing {
		animation: none;
	}
	.ann-pop.note.fresh {
		flex-direction: row;
		align-items: flex-end;
		gap: 0.4em;
		width: auto;
		border-radius: 14px;
		font-size: calc(0.92rem * var(--font-scale, 1) * var(--annpop-scale, 1));
	}
	.ann-pop.note:global(.tall),
	.ann-pop.note.fresh:global(.tall) {
		border-radius: 14px;
	}
	/* Tail: a rotated square sharing the card's surface and edge,
	half tucked inside so the ring runs unbroken into it. */
	.ann-pop.note::before {
		content: "";
		position: absolute;
		left: calc(var(--ann-tail-x, 24px) - 6px);
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
	.ann-pop.note.above::before {
		top: auto;
		bottom: -7px;
		border: inherit;
		border-left-color: transparent;
		border-top-color: transparent;
		border-radius: 0 0 2px 0;
	}
	.ann-pop.note textarea,
	.ann-pop.note.fresh textarea,
	.ann-pop.note:not(.fresh) textarea {
		flex: 0 1 auto;
		min-height: 0;
		max-height: none;
		font-size: 1em;
		line-height: inherit;
		padding: 0.1em 0;
	}
	.ann-pop.note.fresh textarea {
		flex: 1 1 auto;
		min-width: 0;
		max-height: calc(min(var(--ann-max-h, 60vh), 22em) - 1.1em - 2px);
	}
	/* Room for a two-line note on an edit card from the start. */
	.ann-pop.note:not(.fresh) textarea {
		min-height: 3em;
	}
	.ann-pop.note .ann-pop-row {
		flex: none;
		margin-top: 0.35em;
	}
	/* Tools scale with the card's type: buttons don't inherit font
	size on their own, so em would read the UA's 13px. */
	.ann-pop.note .ann-tool {
		font-size: inherit;
		width: 1.8em;
		height: 1.8em;
	}
	.ann-pop.note .ann-tool :global(.action-glyph) {
		width: 0.95em;
		height: 0.95em;
	}
	@media (prefers-contrast: more) {
		.ann-pop.note {
			border: 1px solid #1c1c1e;
			border-color: var(--strong);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ann-pop.note.placed {
			animation: none;
		}
	}
	/* The create pill's arrow rides round like the composer's send:
	compact pill, compact button. */
	:global(.app[data-android]) .ann-pop.fresh .ann-pill-save {
		min-height: 0;
		height: 2.2rem;
		width: 2.2rem;
		padding: 0;
		border-radius: 50%;
		font-size: 1.1rem;
		line-height: 1;
	}
</style>
