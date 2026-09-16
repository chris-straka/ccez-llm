<script lang="ts">
	import { tick, untrack } from "svelte";
	// KaTeX stylesheet (fonts bundle relative to it, so math renders offline).
	import "katex/dist/katex.min.css";
	import { createAidLoadingReporter, furiganaRequestKey } from "$lib/aidLoading";
	import { detectScripts, localAidsFor, type LocalAid } from "$lib/reading";
	import { pinyinBlock, plainParagraphs } from "$lib/pinyin";
	import { dualAidHtml, furiganaHtml } from "$lib/furigana";
	import {
		renderMessage,
		renderMarkdown,
		applyPasteFolds,
		foldSegments,
		pasteFoldButton,
		highlightRendered,
		type RenderedMessage
	} from "$lib/render";
	import { mathCopyText, foldPreviewText } from "$lib/render-math";
	import { codeRunBody, runCodeBlock } from "$lib/coderun";
	import { closestFromTarget } from "$lib/events";
	import type { AttachTagModel } from "$lib/attachments";
	import type { ChatMsg, ChatMsgId } from "$lib/chat";
	import { applyMarks, annRefsFor, type AnnotationMark, type AnnotationId } from "$lib/annotations";

	interface Props {
		message: ChatMsg;
		/** True while this message's reply is still streaming in. */
		streaming: boolean;
		/** True when the user asked for sources (keeps Sources sections). */
		sourcesWanted: boolean;
		/** Whole-message fold state (owned by the parent). */
		folded: boolean;
		/**
		 * Folded-preview text override: refs-only messages preview their
		 * quotes (the stored content is just the baked block). Null keeps
		 * the content's first line.
		 */
		foldPreview?: string | null;
		/** Annotation badges to stamp onto this message's quoted spans. */
		marks?: AnnotationMark[];
		/**
		 * The one annotation (by id) whose quote also gets the yellow wash:
		 * the annotation whose comment box is currently open. Saved
		 * annotations keep their numbered badge but no wash, so finishing
		 * one clears its highlight instead of leaving it painted on.
		 */
		washId?: string | null;
		/** Badge click (opens the edit popover at the badge). */
		onBadgeClick?: (id: AnnotationId, anchor: { x: number; y: number }) => void;
		/**
		 * Toast text for chrome feedback the body owns (math/code copy
		 * outcome): the parent flashes it. Undefined stays silent.
		 */
		onToast?: (message: string) => void;
		/** Paste-fold marker click (parent replaces the message). */
		onFoldToggle?: (index: number) => void;
		/**
		 * Folded-preview click: the preview is the unfold affordance (a
		 * folded equation leaves nothing else clickable). Undefined keeps
		 * the preview inert.
		 */
		onUnfold?: () => void;
	/** Badge hover (paints the quote wash while pointed at). Null on leave. */
	onBadgeHover?: (id: string | null) => void;
		/**
		 * Per-message aid overrides: pinned or hover-peeked local aids
		 * render them (both at once on mixed messages, each on its own
		 * lines); empty renders the original (aids are per-message only).
		 */
		aidKinds?: LocalAid[] | undefined;
		/**
		 * The chat reply pill's local aid: kanji-only lines (Han, no
		 * kana) belong to it instead of defaulting to pinyin. Null
		 * keeps the script-only default.
		 */
		aidPreferred?: LocalAid | null;
		/** Reports furigana dictionary loads so the button can show it. */
		onAidLoadingChange?: (loading: boolean) => void;
		/**
		 * Furigana conversion failed (worker or dictionary): the caller
		 * releases the pin so the button falls back to the aid name instead
		 * of a "show original" with nothing applied. Carries the short
		 * failure reason for the toast — swallowed errors can't be fixed.
		 */
		onAidError?: (id: ChatMsgId, reason?: string) => void;
		/** Model-aid text replacing the message body when present. */
		textOverride?: string | null;
		/**
		 * Pre-redacted body (sent-message annotation blocks collapsed to
		 * a count pill by the parent): renders instead of the stored
		 * content, paste folds included. Never affects aid mode.
		 */
		contentOverride?: string | null;
		/**
		 * True when textOverride is a hover preview rather than a pin:
		 * render it in place with no remount, so peeking can't flash the
		 * body or shift the row out from under a stationary cursor (which
		 * left :hover paint stuck on assistant rows).
		 */
		aidPreview?: boolean;
		/**
		 * True when the whole chat is a sidebar hover preview: mount
		 * settled (no aid-swap entrance fade), so chrome over the body
		 * never visibly stirs while glancing at another chat.
		 */
		preview?: boolean;
	}

	let {
		message,
		streaming,
		sourcesWanted,
		folded,
		foldPreview = null,
		marks = [],
		washId = null,
		onBadgeClick,
		onToast,
		onFoldToggle,
		onUnfold,
		onBadgeHover,
		textOverride = null,
		contentOverride = null,
		aidPreview = false,
		preview = false,
		aidKinds = undefined,
		aidPreferred = null,
		onAidLoadingChange,
		onAidError
	}: Props = $props();

	let html = $state("");
	let bodyEl: HTMLElement | undefined = $state();
	/** Captured Code Run output per block index (re-stamped after each render). */
	let runOutputs = $state<Record<number, string>>({});
	/** Block indexes with a run in flight (stamped as Running). */
	let runningBlocks = $state<Record<number, boolean>>({});
	let rendered: RenderedMessage | null = null;
	let highlightRun = 0;
	let aidRun = 0;
	/**
	 * Key of the furigana conversion whose ruby is shown (or loading).
	 * Spurious re-runs (new marks array, new callback identity from the
	 * parent) carry the same key: they re-stamp, never reconvert, so
	 * completion's busy-false can't restart the work it just finished.
	 */
	let furiganaKey: string | null = null;
	/**
	 * Parent busy reports, deduplicated: completion must not bounce the
	 * parent when nothing changed, or its re-render restarts this effect.
	 * Callbacks go through untrack so their per-render identities never
	 * subscribe the effect either.
	 */
	const reportAidLoading = createAidLoadingReporter((loading: boolean) => {
		untrack(() => onAidLoadingChange)?.(loading);
	});
	/**
	 * Aid mode drives the swap animation key: it changes only when aids
	 * turn on/off (never per token while streaming), so each transition
	 * fades exactly once. Local kinds render independently — one, the
	 * other, or both on mixed messages.
	 */
	const aidKindList = $derived(aidKinds ?? []);
	/** Displayed text: contentOverride redacts baked annotation blocks,
	which are metadata, never prose. Paste-fold offsets still apply —
	redaction only ever trims the trailing block, so prefix offsets hold. */
	const displayBase = $derived(contentOverride ?? message.content);
	/** Aid-visible text: the baked block stripped even when unfolded for
	reading (an unfolded refs-only message shows its block, but aids
	still ignore metadata — matching the row's buttons, which key off
	the same redacted text). Model-aid text (e.g. tashkeel) composes
	with local kinds: ruby lands on the shown text, so the base follows
	the override when one is pinned. */
	const aidBase = $derived(
		annRefsFor(textOverride ?? displayBase)?.text ?? (textOverride ?? displayBase)
	);
	/** Scripts with a local aid always reserve ruby's vertical room, so
	hovering or pinning one never shoves the message down — any script
	in the text counts, not just the first, since each kind renders its
	own lines. Keyed off the aid-visible text, so hidden refs can't
	reserve room (or grow history). */
	const aidSpace = $derived(localAidsFor(detectScripts(aidBase)).length > 0);

	$effect(() => {
		// Paste folds splice before render (reading aids keep full text).
		// A redacted body renders with folds like the stored one: fold
		// ranges only ever shrink, and out-of-range folds are ignored.
		const plainBase = displayBase;
		const content = textOverride ?? applyPasteFolds(plainBase, message.pasteFolds);
		// Read synchronously so the effect re-runs when badges change.
		const items = marks;
		const wash = washId;
		const skipMarks = streaming || folded;
		// Aids render from raw text (markdown set aside); model-aid text
		// (e.g. tashkeel) arrives via textOverride and composes with
		// pinned local kinds, each rendering its own lines onto it.
		const localAids = !streaming && aidKindList.length > 0 ? aidKindList : [];
		const furigana = localAids.includes("furigana");
		const pinyin = localAids.includes("pinyin");
		// Marks apply after Svelte flushes the new HTML (see applyMarks).
		const stamp = () =>
		void tick().then(() => {
			if (!bodyEl) return;
			applyMarks(bodyEl, items, skipMarks, wash);
			stampRunOutputs();
		});
		if (pinyin && !furigana) {
			rendered = null;
			furiganaKey = null;
			reportAidLoading(false);
			// Ruby lands on visible runs only; folded-away text stays bare.
			// Aid-visible text only, so a pinned aid can't resurrect the
			// redacted refs block.
			html = foldSegments(aidBase, message.pasteFolds)
				.map((segment) =>
					segment.kind === "text"
						? plainParagraphs(pinyinBlock(segment.text, aidPreferred), segment.text)
						: pasteFoldButton(segment.index, segment.chars)
				)
				.join("");
			stamp();
			return;
		}
		if (furigana) {
			rendered = null;
			// The kinds join the key: furigana-only and dual share text
			// and folds but render differently, so switching between them
			// must reconvert, never replay the other's HTML.
			const key = furiganaRequestKey(`${[...localAids].sort().join("+")}\n${aidBase}`, message.pasteFolds);
			if (key === furiganaKey) {
				// Same conversion already shown or loading: badges may
				// have changed, so re-stamp, but never reconvert and
				// never touch parent busy state.
				stamp();
				return;
			}
			furiganaKey = key;
			reportAidLoading(true);
			const run = ++aidRun;
			const segments = foldSegments(aidBase, message.pasteFolds);
			const convert = (text: string): Promise<string> =>
				pinyin && furigana ? dualAidHtml(text, aidPreferred) : furiganaHtml(text, aidPreferred);
			void Promise.all(
				segments.map((segment) =>
					segment.kind === "text"
						? convert(segment.text)
						: Promise.resolve(pasteFoldButton(segment.index, segment.chars))
				)
			)
				.then(
					(parts) => {
						if (run !== aidRun) return;
						html = parts.join("");
						stamp();
					},
					(error: unknown) => {
						// Conversion failed: unpin via the caller. The
						// two-arg form keeps stamp() errors out of here.
						// Async reads never subscribe the effect, so the
						// callback identity is safe to touch here.
						if (run !== aidRun) return;
						console.warn("[furigana] conversion failed:", error);
						const first =
							error instanceof Error ? error.message.split("\n")[0] : String(error);
						onAidError?.(message.id, (first ?? "").slice(0, 140) || undefined);
					}
				)
				.finally(() => {
					if (run === aidRun) reportAidLoading(false);
				});
			return;
		}
		if (furiganaKey !== null) furiganaKey = null;
		reportAidLoading(false);
		aidRun++; // invalidate any in-flight furigana conversion
		// Sent tags pair against this message's attachments (Nth of a
		// kind to Nth of a kind); assistant output carries none, so an
		// echoed literal there stays plain text.
		const tagModels = (): AttachTagModel[] | undefined => {
			if (message.role !== "user" || !message.attachments?.length) return undefined;
			return message.attachments.map((att) => ({
				id: att.id,
				kind: att.kind,
				dataUrl: att.dataUrl,
				text: att.text
			}));
		};
		const snapshot: RenderedMessage =
			message.role === "assistant"
				? renderMessage(content, sourcesWanted)
				: renderMarkdown(content, tagModels());
		rendered = snapshot;
		html = snapshot.html;
		if (!streaming && snapshot.codes.length > 0) {
			const run = ++highlightRun;
			void highlightRendered(snapshot).then((enhanced) => {
				if (run !== highlightRun) return;
				html = enhanced;
				stamp();
			});
		} else {
			stamp();
		}
	});

	function badgeIdOf(target: EventTarget | null): string | null {
		return closestFromTarget(target, "[data-ann-badge]")?.dataset.annBadge ?? null;
	}

	/**
	 * Hovering a badge previews its yellow wash. Keyboard focus stays
	 * wash-free on purpose: Tab reaches the markers, never the highlights.
	 */
	/**
	 * Null washes already reported: mouseovers fire for every child
	 * under the cursor, so re-reporting null while pointed at plain
	 * text bounced the parent (and every body) for nothing — hovering
	 * near the pinyin button flickered mounted marks. Non-null ids
	 * always report: suppressing a repeat could strand a wash the
	 * parent cleared another way. Starts sent: the parent opens null.
	 */
	let hoverNullSent = true;
	function onBadgeOver(event: MouseEvent): void {
		const id = badgeIdOf(event.target);
		if (id === null) {
			if (hoverNullSent) return;
			hoverNullSent = true;
		} else hoverNullSent = false;
		onBadgeHover?.(id);
	}

	function onBadgeOut(event: MouseEvent): void {
		const to = closestFromTarget(event.relatedTarget, "[data-ann-badge]");
		if (to) return;
		if (hoverNullSent) return;
		hoverNullSent = true;
		onBadgeHover?.(null);
	}

	/** Press point for the unfold below: a drag that ends on a folded
	block selected its label — unfolding would detach the highlight
	(only true clicks unfold). Keyboard clicks carry no press point
	(detail 0) and always unfold. */
	let chromeDown: { x: number; y: number } | null = null;
	/** A live highlight inside this block owns the click: unfolding
	would detach it (label drags end selected), so clicks over a
	highlight keep selecting and only selection-free clicks unfold. */
	function blockHoldsHighlight(block: Element): boolean {
		try {
			const live = window.getSelection();
			if (!live || live.isCollapsed || live.toString() === "") return false;
			const anchor = live.anchorNode;
			const focus = live.focusNode;
			return (!!anchor && block.contains(anchor)) || (!!focus && block.contains(focus));
		} catch {
			return false;
		}
	}
	function onBodyClick(event: MouseEvent): void {
		const unfoldedDrag =
			event.detail > 0 &&
			chromeDown !== null &&
			Math.hypot(event.clientX - chromeDown.x, event.clientY - chromeDown.y) > 4;
		const badge = closestFromTarget(event.target, "[data-ann-badge]");
		if (badge) {
			const rect = badge.getBoundingClientRect();
			// Stamped from AnnotationMark ids (applyMarks); dataset erases
			// the brand, so cast it back at this boundary.
			onBadgeClick?.((badge.dataset.annBadge ?? "") as AnnotationId, {
				x: rect.left + rect.width / 2,
				y: rect.bottom
			});
			return;
		}
		const fold = closestFromTarget(event.target, "[data-paste-fold]");
		if (fold) {
			onFoldToggle?.(Number(fold.dataset.pasteFold ?? -1));
			return;
		}
		// Display math chrome: `$` flips rendered/raw, the copy icon
		// copies the TeX, and a left click on a folded block unfolds it
		// (right-click toggles the fold).
		const mathWrap = closestFromTarget(event.target, "[data-math-index]");
		if (mathWrap && rendered) {
			const index = Number(mathWrap.dataset.mathIndex ?? -1);
			const entry = rendered.maths[index];
			// Entry lookup stays: copy needs the TeX.
			if (!entry) return;
			if (closestFromTarget(event.target, ".ccez-math-tex")) {
				if (mathWrap.dataset.mathRaw === "1") mathWrap.removeAttribute("data-math-raw");
				else mathWrap.dataset.mathRaw = "1";
				return;
			}
			if (closestFromTarget(event.target, ".ccez-math-copy")) {
				if (!navigator.clipboard) onToast?.("Couldn't copy to the clipboard.");
				else
					void navigator.clipboard.writeText(mathCopyText(entry.tex)).then(
						() => onToast?.("Copied"),
						() => onToast?.("Couldn't copy to the clipboard.")
					);
				return;
			}
			if (mathWrap.classList.contains("ccez-math") && mathWrap.dataset.folded === "1") {
				// A drag ending here selected the folded label: unfolding
				// would detach that highlight (see chromeDown above).
				if (unfoldedDrag || blockHoldsHighlight(mathWrap)) return;
				mathWrap.removeAttribute("data-folded");
				return;
			}
			// Bodies never copy: rendered and raw TeX are plain
			// I-beam selection surfaces (annotatable like any text),
			// and the copy icon is the only clipboard path. Inline
			// math stays bare and copies nothing (its TeX is one
			// message-copy away).
			return;
		}
		// Headless code chrome: the pre is a native selection surface,
		// so clicks there never copy. Copy lives on the icon button
		// alone (folding rides `data-folded`, wired elsewhere). A left
		// click on a folded block unfolds it; right-click toggles.
		const codeBlock = closestFromTarget(event.target, ".ccez-code");
		if (!codeBlock || !rendered) return;
		if (codeBlock.dataset.folded === "1") {
			if (unfoldedDrag || blockHoldsHighlight(codeBlock)) return;
			codeBlock.removeAttribute("data-folded");
			return;
		}
		const copyButton = closestFromTarget(event.target, "[data-code-copy]");
		const runButton = closestFromTarget(event.target, "[data-code-run]");
		if (runButton) {
			onRunBlock(Number(runButton.dataset.codeRun ?? -1));
			return;
		}
		if (!copyButton) {
			// Plain clicks on code select normally; code is never
			// edited in place.
			return;
		}
		const index = Number(copyButton.dataset.codeCopy ?? -1);
		const entry = rendered.codes[index];
		if (!entry) return;
		if (!navigator.clipboard) onToast?.("Couldn't copy to the clipboard.");
		else
			void navigator.clipboard.writeText(entry.code).then(
				() => onToast?.("Copied"),
				() => onToast?.("Couldn't copy to the clipboard.")
			);
	}

	/**
	 * Local Code Run output stamping: captured stdout/stderr live in
	 * component state (the sanitized HTML owns the block, not Svelte),
	 * so every post-flush stamp re-attaches them after re-renders
	 * (e.g. Shiki enhancement) wipe the DOM. Text-only, never HTML.
	 */
	function stampRunOutputs(): void {
		if (!bodyEl) return;
		for (const block of bodyEl.querySelectorAll(".ccez-code")) {
			const run = block.querySelector("[data-code-run]");
			const index = Number(run?.getAttribute("data-code-run") ?? -1);
			if (Number.isNaN(index) || index < 0) continue;
			const output = runOutputs[index];
			if (runningBlocks[index] !== true && output === undefined) continue;
			if (output === "") {
				// Silent run: no tray at all (a re-run clears a stale one).
				block.querySelector(":scope > .ccez-code-output")?.remove();
				continue;
			}
			let out = block.querySelector<HTMLElement>(":scope > .ccez-code-output");
			if (!out) {
				out = document.createElement("div");
				out.className = "ccez-code-output";
				out.dataset.codeOutput = String(index);
				block.appendChild(out);
			}
			const text = output ?? "Running\u2026";
			if (out.textContent !== text) out.textContent = text;
		}
	}

	/**
	 * Run-button click (user-initiated only): executes the block
	 * locally via the backend, or stamps the disabled/no-runner
	 * reason where no shell exists. Never throws into teardown.
	 */
	function onRunBlock(index: number): void {
		const entry = rendered?.codes[index];
		if (!entry || runningBlocks[index] === true) return;
		runningBlocks[index] = true;
		stampRunOutputs();
		void runCodeBlock(entry.lang, entry.code).then((outcome) => {
			delete runningBlocks[index];
			runOutputs[index] = codeRunBody(outcome);
			stampRunOutputs();
		});
	}
</script>

{#if folded}
	<button
		type="button"
		class="folded-preview"
		aria-label="Unfold this message"
		title="Unfold this message"
		onclick={() => onUnfold?.()}
	>{foldPreviewText(message.content, foldPreview)}</button>
{:else}
	<!-- Delegated in-block code copy buttons live inside the sanitized HTML. -->
	<!-- The key swaps only for pinned model-aid text: previews and local
	ruby render in place (readings fading in) so hovering never flashes
	the body or moves the row. -->
	{#key textOverride && !aidPreview ? "model" : "plain"}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_mouse_events_have_key_events -->
		<!-- Badge wash is hover-only by decision (see onBadgeOver): Tab reaches markers, never highlights. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- html is DOMPurify-sanitized in render.ts -->
		<div class="rendered" class:aid-swap={!preview} class:aid-space={aidSpace} bind:this={bodyEl} onmousedown={(e) => (chromeDown = { x: e.clientX, y: e.clientY })} onclick={onBodyClick} onmouseover={onBadgeOver} onmouseout={onBadgeOut}>{@html html}</div>
	{/key}
{/if}

<style>
	.rendered {
		word-break: break-word;
		font-size: calc(0.92rem * var(--font-scale, 1));
		line-height: 1.5;
		/* The one selectable surface in the article (see article's
		user-select: none): I-beam lives here and only here. */
		user-select: text;
		-webkit-user-select: text;
		cursor: text;
	}
	.folded-preview {
		display: block;
		background: none;
		border: 0;
		padding: 0;
		font-family: inherit;
		color: #6e6e73;
		font-size: 0.85rem;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	/* Injected paste-fold marker (sanitized HTML): inline bold text in
	accent blue, never a pill — still a button, so it clicks to expand. */
	.rendered :global(button.paste-fold) {
		font: inherit;
		font-weight: 700;
		color: #007aff;
		color: var(--accent);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
	}
	/* Aid swaps fade the incoming body in, and fresh readings fade in
	where they land: the model key remounts on tashkeel flips, while
	local ruby renders in place so the base text never flashes. */
	@keyframes aid-swap {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.rendered.aid-swap {
		animation: aid-swap 0.18s ease;
	}
	/* Ruby's vertical room is always reserved where a local aid exists,
	so previewing or pinning it never reflows the message — but only on
	blocks that can actually carry ruby (marked cjk at render, including
	list items now that aids keep list structure). An English paragraph
	in a mixed message keeps its normal leading, so its selection
	highlight hugs the text instead of spanning the ruby void above.
	WebKit sizes in-flow ruby annotations by glyphs (no line-height
	trick contains them), so the reservation itself must cover base
	plus annotation: 2.7 swallows the measured overhang with headroom
	for other stacks. */
	.rendered.aid-space :global(p.cjk),
	.rendered.aid-space :global(li.cjk) {
		line-height: 2.7;
		/* pretty rebalances CJK lines short and uneven across
		paragraphs (kinsoku + ruby spans confuse it): fill the column
		with plain wrapping like before. */
		text-wrap: auto;
	}
	.rendered.aid-space :global(p.cjk) {
		/* Tall lines swallow the base 0.4em gap, so CJK paragraphs get
		a fuller break plus the standard 1em first-line indent (字下げ):
		three paragraphs read as three even before ruby loads. */
		margin: 0.9em 0;
		text-indent: 1em;
	}
	.rendered.aid-space :global(p.cjk:last-child) {
		/* The break belongs between paragraphs, not between the last
		line and the action row (outranks the rule above). */
		margin-bottom: 0;
	}
	/* The native selection callout stays enabled over message text:
	Apple gives apps no way to extend it, so our Annotate button
	floats above the highlight while the system bubble (Copy /
	Translate) keeps its below slot. Selection itself is unaffected:
	handles, drags, and JS ranges all still work. */
	/* Reading base: inline span, breaking between tokens exactly like
	unannotated text in every engine (native ruby reserves the
	annotation's width per base — and WebKit ignores out-of-flow
	positioning on rt entirely — pushing characters down a line).
	Relative only as the positioning context for its reading. */
	.rendered :global(.frb) {
		position: relative;
		/* Atomic: a multi-kanji base must never fragment across a line
		break — an absolutely positioned reading centers against the
		fragmented box and lands shifted right of its kanji. Whole
		tokens wrap to the next line instead. */
		white-space: nowrap;
	}
	/* Readings are overlay, never layout: absolutely positioned above
	the base, centered, painting into the aid-space leading reserved
	on cjk paragraphs — vertical rhythm unchanged, breaking matches
	plain text exactly, and quote extraction strips them as before. */
	.rendered :global(.frt) {
		position: absolute;
		bottom: 100%;
		left: 50%;
		transform: translateX(-50%);
		/* Optical: readings sit right of their kanji, so pull back
		(absolute, never layout). */
		margin-left: -3px;
		white-space: nowrap;
		font-size: 0.62em;
		line-height: 1.2;
		color: #6e6e73;
		color: var(--muted);
		pointer-events: none;
	}
	/* Entrance fade everywhere except iOS, where it breaks the reveal
	(visible flicker/shift). .app carries data-ios, outside this
	component, hence the leading :global. */
	:global(.app:not([data-ios])) .rendered :global(.frt) {
		animation: frt-in 0.18s ease;
	}
	/* Per-platform nudge: kana bearings differ per OS font (Hiragino
	on iOS needs a stronger pull than desktop). Scoped so each
	platform keeps its own tuned value — Android gets its line here
	once it's eyeballed on-device. */
	:global(.app[data-ios]) .rendered :global(.frt) {
		margin-left: -9px;
	}
	/* Same leftward pull on Android (eyeballed on-device to match
	iOS). data-android is also set on iPhones (any phone), so iOS
	is excluded — it keeps its own line above. */
	:global(.app[data-android]:not([data-ios])) .rendered :global(.frt) {
		margin-left: -9px;
	}
	/* Same pull on macOS desktop: its kana also renders in Hiragino
	with the same left bearing. Calibrated in-browser at 16–48px
	base: the natural offset is exactly 0.5x the base size right,
	so the pull rides `em` (.frt is 0.62em: -0.8em ≈ -0.5x base) and
	stays centered at any font scale — a fixed px value undershoots
	huge type and overshoots small type. data-mac is also set on
	iPads in desktop mode — iOS keeps its own line above. */
	:global(.app[data-mac]:not([data-ios])) .rendered :global(.frt) {
		margin-left: -0.8em;
	}
	@keyframes frt-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.rendered :global(p) {
		margin: 0.4em 0;
	}
	.rendered :global(p:first-child) {
		margin-top: 0;
	}
	.rendered :global(p:last-child) {
		margin-bottom: 0;
	}
	.rendered :global(pre) {
		background: #f1f1f4;
		background: var(--bg-wash);
		border-radius: 8px;
		padding: 0.6rem 0.8rem;
		overflow-x: auto;
		font-size: 0.82rem;
		line-height: 1.45;
	}
	.rendered :global(pre),
	.rendered :global(code) {
		font-family:
			"Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}
	.rendered :global(:not(pre) > code) {
		background: #f1f1f4;
		background: var(--bg-wash);
		border-radius: 5px;
		padding: 0.05rem 0.3rem;
		font-size: 0.85em;
	}
	.rendered :global(table) {
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	.rendered :global(th),
	.rendered :global(td) {
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		padding: 0.25rem 0.6rem;
	}
	/* Quoted passages are reading material (translations, cited
	text), not metadata: body ink, with the bar as the quote signal.
	Muting them washed out long passages on light theme. */
	.rendered :global(blockquote) {
		margin: 0.4em 0;
		padding-left: 0.7rem;
		border-left: 3px solid #8e8e93;
		border-color: var(--line-hover);
		color: #1c1c1e;
		color: var(--ink);
	}
	.rendered :global(.ccez-code code) {
		cursor: text;
	}
	.rendered :global(.ccez-code) {
		position: relative;
		margin: 0.5em 0;
		border: 1px solid #e5e5ea;
		border-radius: 8px;
		overflow: hidden;
		/* Hug the code instead of filling the column: short snippets
		read as blocks, long lines still scroll inside the pre. */
		width: fit-content;
		max-width: 100%;
		min-width: min(12rem, 100%);
	}
	/* Headless code chrome: the pre is a native selection surface
	(I-beam, selectable text, never copy-on-click). Copy lives on the
	icon button alone — ghosted like the message-button copy control,
	pinned top-right inside the block. */
	.rendered :global(.ccez-code-copy) {
		position: absolute;
		top: 0.3rem;
		right: 0.3rem;
		display: inline-flex;
		align-items: center;
		border: 0;
		background: none;
		padding: 0.15rem;
		line-height: 0;
		color: #6e6e73;
		color: var(--muted);
		cursor: pointer;
	}
	.rendered :global(.ccez-code-copy:hover) {
		color: #1c1c1e;
		color: var(--ink);
	}
	.rendered :global(.ccez-code-copy .action-glyph),
	.rendered :global(.ccez-code-run .action-glyph) {
		height: 1rem;
		width: 1rem;
	}
	/* Code Run: play-icon button pinned top-right beside copy (top-left
	stays a clean selection surface for drag-selects), plus the
	captured-output tray under the pre. */
	.rendered :global(.ccez-code-run) {
		position: absolute;
		top: 0.3rem;
		right: 1.7rem;
		display: inline-flex;
		align-items: center;
		border: 0;
		background: none;
		padding: 0.15rem;
		line-height: 0;
		color: #6e6e73;
		color: var(--muted);
		cursor: pointer;
	}
	.rendered :global(.ccez-code-run:hover) {
		color: #1c1c1e;
		color: var(--ink);
	}
	.rendered :global(.ccez-code-output) {
		border-top: 1px solid #e5e5ea;
		background: #f7f7f8;
		padding: 0.4rem 0.6rem;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.75rem;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 16rem;
		overflow: auto;
	}
	.rendered :global(.ccez-code pre) {
		margin: 0;
		border-radius: 0;
		background: #fff;
		/* Right gutter clears the run + copy icons pinned top-right,
		so code never slides underneath them. */
		padding: 0.4rem 3.4rem 0.4rem 0.6rem;
		cursor: text;
		user-select: text;
		-webkit-user-select: text;
	}
	/* Folded code swaps the pre for its collapsed label
	(`python · 13 LOC`), so the fold still reads as code. */
	.rendered :global(.ccez-code-foldedlabel) {
		display: none;
		padding: 0.4rem 0.6rem;
		background: #fff;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.75rem;
		color: #6e6e73;
		white-space: nowrap;
		/* Folded labels are chrome, not content: quoting
		`python · N LOC` annotates nothing, and a badge stamped on
		the label orphans on unfold — so labels never select
		(clicks still unfold), and picks start in the unfolded
		body instead. */
		user-select: none;
		-webkit-user-select: none;
	}
	/* Folded code is label-only: no 12rem floor, so no dead space
	sits right of the LOC. The whole folded block is one affordance
	(left-click unfolds), so it reads pointer, not the I-beam. */
	.rendered :global(.ccez-code[data-folded="1"]) {
		min-width: 0;
		cursor: pointer;
	}
	.rendered :global(.ccez-code[data-folded="1"] pre) {
		display: none;
	}
	.rendered :global(.ccez-code[data-folded="1"] .ccez-code-foldedlabel) {
		display: block;
	}
	/* Folded code is label-only: the copy and Run buttons belong to
	the body, so they hide with the pre instead of floating over the
	collapsed label. */
	.rendered :global(.ccez-code[data-folded="1"] .ccez-code-copy),
	.rendered :global(.ccez-code[data-folded="1"] .ccez-code-run) {
		display: none;
	}
	/* LaTeX math (main chat only): display blocks carry copy + `$`
	chrome, fold into a `latex · N LOC` label, and clicking the body
	copies the TeX with its delimiters. Inline math renders bare. */
	.rendered :global(.ccez-math) {
		position: relative;
		margin: 0.5em 0;
		border: 1px solid #e5e5ea;
		border-radius: 8px;
		overflow: hidden;
		width: fit-content;
		max-width: 100%;
		min-width: min(12rem, 100%);
	}
	/* Folded math is label-only: no 12rem floor and no buttons, so no
	dead space sits right of the LOC. Same single affordance as
	folded code: pointer, not the I-beam. */
	.rendered :global(.ccez-math[data-folded="1"]) {
		min-width: 0;
		cursor: pointer;
	}
	.rendered :global(.ccez-math-copy),
	.rendered :global(.ccez-math-tex) {
		position: absolute;
		top: 0.3rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* One shared box: the copy glyph brings its own 1rem height
		while `$` is bare text, so equal height (not line-height
		games — a zero line box collapses the button and the glyph
		overflows upward) is what centers them on each other. Exact
		equal widths too, so the centered pair below is truly centered. */
		height: 1.3rem;
		width: 1.3rem;
		box-sizing: border-box;
		border: 0;
		background: none;
		padding: 0.15rem;
		line-height: 1;
		color: #6e6e73;
		color: var(--muted);
		cursor: pointer;
	}
	/* Top-centered pair: chrome position never depends on the
	equation's width, so buttons sit still across renders instead
	of riding the block's right edge. */
	.rendered :global(.ccez-math-copy) {
		left: calc(50% + 0.2rem);
		line-height: 0;
	}
	/* Upright `$`: italic skewed the mark off the copy icon. */
	.rendered :global(.ccez-math-tex) {
		right: calc(50% + 0.2rem);
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.85rem;
		font-style: normal;
	}
	/* Chrome buttons never join a text selection: dragging across a
	block would otherwise bake `$` and icon-button text into the
	highlight and the quote. Clicks still work — this only opts out
	of selection. */
	.rendered :global(.ccez-math-tex),
	.rendered :global(.ccez-math-copy),
	.rendered :global(.ccez-code-copy),
	.rendered :global(.ccez-code-run) {
		user-select: none;
		-webkit-user-select: none;
	}
	.rendered :global(.ccez-math-copy:hover),
	.rendered :global(.ccez-math-tex:hover) {
		color: #1c1c1e;
		color: var(--ink);
	}
	.rendered :global(.ccez-math-copy .action-glyph) {
		height: 1rem;
		width: 1rem;
	}
	.rendered :global(.ccez-math-foldedlabel) {
		display: none;
		padding: 0.4rem 0.6rem;
		background: #fff;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.75rem;
		color: #6e6e73;
		white-space: nowrap;
		/* Same as code above: folded labels are chrome, never
		selectable text (clicks unfold; picks start unfolded). */
		user-select: none;
		-webkit-user-select: none;
	}
	.rendered :global(.ccez-math[data-folded="1"] .ccez-math-foldedlabel) {
		display: block;
	}
	.rendered :global(.ccez-math[data-folded="1"] .ccez-math-body),
	.rendered :global(.ccez-math[data-folded="1"] .ccez-math-raw),
	.rendered :global(.ccez-math[data-folded="1"] .ccez-math-copy),
	.rendered :global(.ccez-math[data-folded="1"] .ccez-math-tex) {
		display: none;
	}
	.rendered :global(.ccez-math-body) {
		/* Top room clears the centered `$` + copy pair, so equations
		never slide underneath them — and no right gutter, so the
		block's width is the equation's own. */
		padding: 2.2rem 0.8rem 0.6rem;
		background: #fff;
		overflow-x: auto;
		cursor: text;
		user-select: text;
		-webkit-user-select: text;
	}
	/* Raw source view (`$` toggle): the rendered body hides and the
	TeX shows as selectable text. */
	.rendered :global(.ccez-math-raw) {
		display: none;
		margin: 0;
		/* Same top room as the body: the chrome pair stays put when
		`$` flips rendered to source. */
		padding: 2.2rem 0.8rem 0.6rem;
		background: #fff;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.8rem;
		white-space: pre-wrap;
		word-break: break-word;
		cursor: text;
		user-select: text;
		-webkit-user-select: text;
	}
	.rendered :global(.ccez-math[data-math-raw="1"] .ccez-math-body) {
		display: none;
	}
	.rendered :global(.ccez-math[data-math-raw="1"] .ccez-math-raw) {
		display: block;
	}
	/* Folded wins over the raw-source view: folding a `$`-toggled
	block leaves the label only, like any other fold (the raw-view
	rule above would otherwise out-order the fold). */
	.rendered :global(.ccez-math[data-folded="1"][data-math-raw="1"] .ccez-math-raw) {
		display: none;
	}
	/* Inline math renders bare — no bar mid-sentence — so the line
	keeps its rhythm; KaTeX inherits the message color and scale. */
	.rendered :global(.ccez-math-inline) {
		display: inline-flex;
		align-items: baseline;
		border: 1px solid #e5e5ea;
		border-radius: 6px;
		padding: 0 0.3rem;
		background: #fff;
	}
	.rendered :global(.ccez-math-inline .ccez-math-body) {
		padding: 0;
		background: none;
		overflow: visible;
		cursor: text;
	}
	/* KaTeX inherits the theme ink and is never colorized: a second
	math palette would fight the theme and hurt readability, so
	equations follow the message color in both themes for free. */
	.rendered :global(.ccez-math .katex),
	.rendered :global(.ccez-math-inline .katex) {
		color: inherit;
	}
	.rendered :global(mark.ccez-ann) {
		background: #fff3b0;
		border-radius: 3px;
		/* Annotated text reads interactive (the badge above it opens
		the edit); clicks still select normally. */
		cursor: pointer;
		/* 1px of visual bleed each side, paid back with negative margin
		so the wash never reflows the line when it appears. */
		padding: 0 1px;
		margin: 0 -1px;
		color: inherit;
	}
	/* The pale wash turns to mud in dark mode (and swallows the
	selection tint stacked on annotated CJK): a translucent amber
	keeps annotated text readable in both themes. */
	:global(html[data-theme="dark"]) .rendered :global(mark.ccez-ann) {
		background: rgba(245, 158, 11, 0.3);
	}
	/* Sent-jump destination flash: the same draft yellow, so arriving
	from history reads exactly like arriving from a draft. Plain DOM
	(not the Highlight API) so it renders in every engine; the caller
	wraps and unwraps it around the blink. */
	.rendered :global(mark.ccez-ann-flash) {
		background: #fff3b0;
		border-radius: 3px;
		padding: 0 1px;
		margin: 0 -1px;
		color: inherit;
	}
	:global(html[data-theme="dark"]) .rendered :global(mark.ccez-ann-flash) {
		background: rgba(245, 158, 11, 0.3);
	}
	/* The wash mounts/unmounts imperatively (applyMarks), so a plain
	transition has nothing to run between: fade-in plays on mount for
	newly arrived washes only, and fade-out plays on .leaving marks
	that applyMarks unwraps after WASH_FADE_MS. */
	@keyframes ann-wash-in {
		from {
			background-color: transparent;
		}
		to {
			background-color: #fff3b0;
		}
	}
	.rendered :global(mark.ccez-ann.fresh) {
		animation: ann-wash-in 0.12s ease;
	}
	@keyframes ann-wash-in-dark {
		from {
			background-color: transparent;
		}
		to {
			background-color: rgba(245, 158, 11, 0.3);
		}
	}
	:global(html[data-theme="dark"]) .rendered :global(mark.ccez-ann.fresh) {
		animation-name: ann-wash-in-dark;
	}
	@keyframes ann-wash-out {
		from {
			background-color: #fff3b0;
		}
		to {
			background-color: transparent;
		}
	}
	.rendered :global(mark.ccez-ann.leaving) {
		animation: ann-wash-out 0.18s ease forwards;
	}
	@keyframes ann-wash-out-dark {
		from {
			background-color: rgba(245, 158, 11, 0.3);
		}
		to {
			background-color: transparent;
		}
	}
	:global(html[data-theme="dark"]) .rendered :global(mark.ccez-ann.leaving) {
		animation-name: ann-wash-out-dark;
	}
	/* Custom Highlight API wash (see annHighlights.paintAnnotationWash):
	paints the same yellow over untouched DOM where CSS.highlights is
	supported, so future stamps can skip mark-DOM wrapping. The mark
	path above stays the live fallback. */
	.rendered::highlight(ccez-ann) {
		background-color: #fff3b0;
		color: inherit;
	}
	:global(html[data-theme="dark"]) .rendered::highlight(ccez-ann) {
		background-color: rgba(245, 158, 11, 0.3);
	}
	/* Sent-jump flash (see annHighlights.paintJumpWash): same yellow as
	the badge wash, so arriving from history reads like arriving from
	a draft. Separate highlight name — never the badge's own. */
	.rendered::highlight(ccez-ann-jump) {
		background-color: #fff3b0;
		color: inherit;
	}
	:global(html[data-theme="dark"]) .rendered::highlight(ccez-ann-jump) {
		background-color: rgba(245, 158, 11, 0.3);
	}
	/* Ruby base text paints the selection tint explicitly: without
	this some phone WebViews leave ruby-annotated CJK highlights
	invisible (the readings themselves stay unselectable by design). */
	.rendered :global(ruby::selection) {
		background: var(--sel-tint);
	}
	/* Reading-aid text is overlay, not content: never selectable,
	so it stays out of selections and selection-copies. */
	.rendered :global(.frt) {
		user-select: none;
		-webkit-user-select: none;
	}
	/* Pinyin rides native ruby instead of overlay spans: the engine
	expands each base to fit its own annotation exactly, so space
	appears only where a reading overflows its Hanzi — neighbors never
	collide and fitting readings cost nothing. (Furigana keeps overlay
	spans: kana readings fit their bases, and overlay keeps them out of
	layout and selection entirely.) */
	.rendered :global(ruby) {
		ruby-align: center;
	}
	.rendered :global(rt) {
		font-size: 0.62em;
		/* Zero strut: the annotation's line box contributes nothing, so
		no engine grows the line for it — glyphs paint into the
		aid-space leading reserved above. No entrance fade: it read as
		flicker on reveal. (iOS 26.5 sizes the annotation by glyphs past
		the zero strut and clears the reservation by ~1px anyway — the
		iOS override below fits it back. Pinning then moves nothing.) */
		line-height: 0;
		color: #6e6e73;
		color: var(--muted);
		/* Keeps readings out of drag-select copies on engines that
		honor it (Chromium); the Copy button reads message source, so
		it never sees readings either way. */
		user-select: none;
		-webkit-user-select: none;
	}
	/* Per-platform fit: iOS WebKit sizes in-flow ruby annotations by
	glyphs, and at 0.62em their extents clear the 2.7 aid-space strut
	by ~1px — pinning grows the line and drops the base, the buttons,
	and everything below (measured +1px block / +1px base on iPhone
	WebKit 26.5, zero on desktop). 0.6em fits the tallest stacks
	(nǚ lǜ zhuāng chuāng) with the rightward spread untouched;
	desktop and Android keep 0.62 (Android gets its line here once
	it's eyeballed on-device). */
	:global(.app[data-ios]) .rendered :global(rt) {
		font-size: 0.6em;
	}
	/* Badge anchors ride on the quote's last character (or its wash
	mark): unstyled inline wrappers, so stamping never reflows text. */
	.rendered :global(.ccez-ann-anchor) {
		position: relative;
	}
	/* Numbered badges float above-right of their quote, overlaying ruby
	readings instead of shoving them: zero layout in every mode. */
	.rendered :global(button.ccez-ann-badge) {
		position: absolute;
		bottom: 100%;
		left: 100%;
		transform: translate(-40%, 10%);
		/* Below the composer card (z-30): scrolled-under badges take
		no hits — the chrome owns those pixels. The edit card (z-60)
		and refs popover (z-40) still open above everything, so a
		covered badge is one scroll away from clickable. */
		z-index: 20;
		user-select: none;
		-webkit-user-select: none;
		/* Dampened text-size tracking (≈30% of the message scale, so a
		600% reading size makes a ~2.5× badge, never a 6× one): rem
		units keep it absolute, never compounding the message size. */
		min-width: calc(1.15rem * (1 + (var(--font-scale, 1) - 1) * 0.3));
		height: calc(1.15rem * (1 + (var(--font-scale, 1) - 1) * 0.3));
		padding: 0 0.25rem;
		border: 0;
		border-radius: 999px;
		background: #007aff;
		background: var(--accent);
		color: #fff;
		color: var(--accent-ink);
		font-size: calc(0.7rem * (1 + (var(--font-scale, 1) - 1) * 0.3));
		font-weight: 700;
		line-height: calc(1.15rem * (1 + (var(--font-scale, 1) - 1) * 0.3));
		text-align: center;
		white-space: nowrap;
		cursor: pointer;
	}
	/* Speech-bubble tail: a slash leaning down-left toward the quote
	it annotates — tip at the bottom-left corner, wide top tucked 5px
	under the badge (same color, so the join can never gap — the circle
	curves away at the sides, which is why the tail seats left of
	center instead of off the rim). Clicks land on the button, so the
	open still works. */
	.rendered :global(button.ccez-ann-badge::after) {
		content: "";
		position: absolute;
		top: calc(100% - 5px);
		left: 14%;
		width: 0.5rem;
		height: 0.72rem;
		background: inherit;
		clip-path: polygon(38% 0, 100% 0, 0 100%);
	}
	/* Newly stamped badges fade in; re-stamps skip the class so steady
	marks never flicker on re-render. */
	@keyframes ann-badge-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.rendered :global(button.ccez-ann-badge.fresh) {
		animation: ann-badge-in 0.2s ease;
	}
	/* Shiki emits light colors inline + dark variants as CSS variables. */
	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it.
	Keyframes can't sit behind a selector, so the dark wash variants
	are renamed and picked up by the animation-name overrides below. */
	:global(html[data-theme="dark"]) .rendered :global(mark.ccez-ann) {
		background: #5c4d00;
	}
	@keyframes ann-wash-in-dark {
		from {
			background-color: transparent;
		}
		to {
			background-color: #5c4d00;
		}
	}
	@keyframes ann-wash-out-dark {
		from {
			background-color: #5c4d00;
		}
		to {
			background-color: transparent;
		}
	}
	:global(html[data-theme="dark"]) .rendered :global(mark.ccez-ann.fresh) {
		animation-name: ann-wash-in-dark;
	}
	:global(html[data-theme="dark"]) .rendered :global(mark.ccez-ann.leaving) {
		animation-name: ann-wash-out-dark;
	}
	:global(html[data-theme="dark"]) .folded-preview {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .rendered :global(pre) {
		background: #1c1c1e;
	}
	:global(html[data-theme="dark"]) .rendered :global(th),
	:global(html[data-theme="dark"]) .rendered :global(td) {
		border-color: #48484a;
	}
	:global(html[data-theme="dark"]) .rendered :global(blockquote) {
		border-color: #636366;
		border-color: var(--line-hover);
		color: #f2f2f7;
		color: var(--ink);
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code) {
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code-copy) {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code-copy:hover) {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code-run) {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code-run:hover) {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code-output) {
		border-color: #38383a;
		background: #101013;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-math),
	:global(html[data-theme="dark"]) .rendered :global(.ccez-math-inline) {
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-math-body),
	:global(html[data-theme="dark"]) .rendered :global(.ccez-math-inline) {
		background: #101013;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-math-copy),
	:global(html[data-theme="dark"]) .rendered :global(.ccez-math-tex) {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-math-copy:hover),
	:global(html[data-theme="dark"]) .rendered :global(.ccez-math-tex:hover) {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-math-foldedlabel),
	:global(html[data-theme="dark"]) .rendered :global(.ccez-math-raw) {
		background: #101013;
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code pre) {
		background: #101013;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code-foldedlabel) {
		background: #101013;
		color: #98989f;
	}
	/* Inline code pills: the light background has no dark twin, so
	filenames read white-on-white without this. */
	:global(html[data-theme="dark"]) .rendered :global(:not(pre) > code) {
		background: #2c2c2e;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .rendered :global(.shiki),
	:global(html[data-theme="dark"]) .rendered :global(.shiki span) {
		color: var(--shiki-dark) !important;
		background-color: var(--shiki-dark-bg) !important;
		font-style: var(--shiki-dark-font-style) !important;
		font-weight: var(--shiki-dark-font-weight) !important;
		text-decoration: var(--shiki-dark-text-decoration) !important;
	}
</style>
