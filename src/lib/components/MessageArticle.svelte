<!-- Per-message article row: sent file tags, baked-annotation refs,
in-place own-message edit (or the body), inline image folds, and the
action row. The page owns every message list, all row state (fold,
refs pop/edit, wash, aids, voice), and every behavior; this component
owns the row markup and forwards page-built action groups to the
nested components (SentAttachments ×2, SentRefs, MessageBody,
MessageActions) untouched, so each child's contract still checks at
both ends. The in-place editor crosses as a `use:` action (mounts
where the text sat, like the composer's promptEl pattern). -->
<script lang="ts">
	import type { ChatMsg, ChatMsgId } from "$lib/chat";
	import {
		CEFR_LEVELS,
		SUMMARY_SIZES,
		newsLaunchImage,
		parseNewsLaunch,
		type CefrLevel
	} from "$lib/news";
	import { cefrTag } from "$lib/cefr";
	import { fade } from "svelte/transition";
	import type { LocalAid } from "$lib/reading";
	import type { AttachTagModel, SentTagAction } from "$lib/attachments";
	import type {
	AnnotationId,
	AnnotationMark
} from "$lib/annotations";
import type {
	AnnotationRef
} from "$lib/annotation-block";
	import SentAttachments, {
		type SentAttachmentsActions
	} from "./SentAttachments.svelte";
	import SentRefs, { type SentRefsActions } from "./SentRefs.svelte";
	import MessageBody from "./MessageBody.svelte";
	import MessageActions, {
		type MessageActionsActions
	} from "./MessageActions.svelte";

	/** Page-owned row behaviors (built per row; closures capture msg). */
	export interface MessageArticleActions {
		articleClick: (event: MouseEvent) => void;
		articleEnter: () => void;
		articleLeave: (event: MouseEvent) => void;
		editFocusOut: (event: FocusEvent) => void;
		/** In-place editor mount (the page's msgEditAction). */
		editAction: (node: HTMLElement) => { destroy(): void };
		/** Shared by both SentAttachments variants. */
		tags: SentAttachmentsActions;
		refs: SentRefsActions;
		setHoverBadge: (id: string | null) => void;
		badgeClick: (id: AnnotationId, anchor: { x: number; y: number }) => void;
		attachAction: (action: SentTagAction, id: string) => void;
		tagToggle: (id: string) => void;
		toast: (message: string) => void;
		foldToggle: (index: number) => void;
		unfold: () => void;
		aidLoadingChange: (loading: boolean) => void;
		aidError: (id: ChatMsgId, reason?: string) => void;
		ma: MessageActionsActions;
	}

	/** News-session controls on an opener tag (null: inert tag). */
	export interface NewsTagControls {
		busy: boolean;
		/** Re-run the session from this opener at a new level. */
		setLevel: (level: CefrLevel) => void;
	}

	interface Props {
		msg: ChatMsg;
		index: number;
		selected: boolean;
		folded: boolean;
		/** Article `.speaking` class (id match only; MA's `speaking`
		prop also covers selection speech). */
		speakingNow: boolean;
		speakingSel: boolean;
		aidLoading: boolean;
		actionsOpen: boolean;
		editing: boolean;
		sentRefs: { text: string; refs: AnnotationRef[] } | null;
		textModels: AttachTagModel[];
		imageModels: AttachTagModel[];
		ocrBusyId: string | null;
		android: boolean;
		showButtons: boolean;
		refsEditing: { messageId: ChatMsgId; n: number } | null;
		refsBlink: { messageId: ChatMsgId; n: number } | null;
		popOpen?: ChatMsgId | null;
		refsDraft?: string;
		refsBox?: HTMLInputElement | null;
		streaming: boolean;
		sourcesWanted: boolean;
		foldPreview: string | null;
		marks: AnnotationMark[] | undefined;
		washId: string | null | undefined;
		expandedTags: string[];
		textOverride: string | null;
		contentOverride: string | null;
		/** Correction diff HTML for under a user message (null when none). */
		correction: string | null;
		aidPreview: boolean;
		previewing: boolean;
		news?: NewsTagControls | null;
		aidKinds: LocalAid[] | undefined;
		aidPreferred: LocalAid | null;
		foldTitle: string;
		deleteTitle: string;
		speaking: boolean;
		speakable: boolean;
		speakLabel: string;
		aidId: string | null;
		aidModelPinned: boolean;
		aidVocalizing: boolean;
		localKinds: LocalAid[];
		pinnedKinds: LocalAid[];
		aidBusy: boolean;
		actions: MessageArticleActions;
	}

	let {
		msg,
		index,
		selected,
		folded,
		speakingNow,
		speakingSel,
		aidLoading,
		actionsOpen,
		editing,
		sentRefs,
		textModels,
		imageModels,
		ocrBusyId,
		android,
		showButtons,
		refsEditing,
		refsBlink,
		popOpen = $bindable(null),
		refsDraft = $bindable(""),
		refsBox = $bindable(null),
		streaming,
		sourcesWanted,
		foldPreview,
		marks,
		washId,
		expandedTags,
		textOverride,
		contentOverride,
		correction,
		aidPreview,
		previewing,
		news = null,
		aidKinds,
		aidPreferred,
		foldTitle,
		deleteTitle,
		speaking,
		speakable,
		speakLabel,
		aidId,
		aidModelPinned,
		aidVocalizing,
		localKinds,
		pinnedKinds,
		aidBusy,
		actions
	}: Props = $props();
	/* A news session opener reads as one tag (story, mode, level):
	its instructions are for the model, not the learner. */
	const launch = $derived(msg.role === "user" ? parseNewsLaunch(msg.content) : null);
	const launchImage = $derived(
		launch && typeof localStorage !== "undefined"
			? newsLaunchImage(localStorage, launch.title)
			: null
	);
	let launchImageBroken = $state(false);
	const shownLevel = $derived<CefrLevel>(launch?.level ?? "B2");
	const metaKey = $derived(
		launch ? `${launch.kind}|${shownLevel}|${launch.size ?? ""}|${launch.source}` : ""
	);
	/** Hide a meta dot left at the end of a line (its next item
	wrapped below): re-checks on every resize and content change. */
	function endDots(node: HTMLElement, _key: string): { update: () => void; destroy: () => void } {
		const run = (): void => {
			const items = [...node.children] as HTMLElement[];
			items.forEach((item, i) => {
				const sep = item.querySelector<HTMLElement>(":scope > .sep");
				if (!sep) return;
				sep.style.visibility = "";
				const next = items[i + 1];
				if (!next) return;
				const wrapped =
					next.getBoundingClientRect().top >= item.getBoundingClientRect().bottom - 1;
				if (wrapped) sep.style.visibility = "hidden";
			});
		};
		const ro = new ResizeObserver(run);
		ro.observe(node);
		run();
		return { update: run, destroy: () => ro.disconnect() };
	}
	let levelOpen = $state(false);
	// The level menu closes on any press outside it.
	$effect(() => {
		if (!levelOpen) return;
		const close = (): void => {
			levelOpen = false;
		};
		window.addEventListener("pointerdown", close);
		return () => window.removeEventListener("pointerdown", close);
	});
</script>

{#snippet body(override: string | null | undefined, isFolded: boolean, content: string | null | undefined)}
	<MessageBody
		message={msg}
		{streaming}
		{sourcesWanted}
		folded={isFolded}
		{foldPreview}
		marks={marks ?? []}
		washId={washId ?? null}
		onBadgeHover={actions.setHoverBadge}
		onBadgeClick={actions.badgeClick}
		onAttachAction={actions.attachAction}
		{expandedTags}
		onTagToggle={actions.tagToggle}
		onToast={actions.toast}
		onFoldToggle={actions.foldToggle}
		onUnfold={actions.unfold}
		textOverride={override ?? null}
		contentOverride={content ?? null}
		correction={launch ? null : correction}
		{aidPreview}
		preview={previewing}
		{aidKinds}
		{aidPreferred}
		onAidLoadingChange={actions.aidLoadingChange}
		onAidError={actions.aidError}
	/>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<!-- Option-click is mouse-only by design; keyboard users get the Fold button below. -->
<article
	id="msg-{index}"
	tabindex="-1"
	class:user={msg.role === "user"}
	class:assistant={msg.role === "assistant"}
	class:selected
	class:folded-msg={folded}
	class:speaking={speakingNow}
	class:speaking-sel={speakingSel}
	class:aid-loading={aidLoading}
	data-actions-open={actionsOpen}
	onclick={actions.articleClick}
	onmouseenter={actions.articleEnter}
	onmouseleave={actions.articleLeave}
>
	<!-- Sent file tags render in `SentAttachments.svelte`
	(variant "tags"); the page keeps the models (expand
	state) and the fold/copy behaviors. -->
	<SentAttachments
		variant="tags"
		models={textModels}
		attachments={msg.attachments ?? []}
		{ocrBusyId}
		actions={actions.tags}
	/>
	{#if sentRefs}
		<!-- Baked-annotation refs render in `SentRefs.svelte`;
		the page keeps the pop flag, the row-edit state (it
		focuses the box), the blink, and the behaviors. -->
		<SentRefs
			msgId={msg.id}
			role={msg.role}
			{android}
			{sentRefs}
			bind:popOpen
			editing={refsEditing}
			bind:editDraft={refsDraft}
			bind:editBox={refsBox}
			blink={refsBlink}
			actions={actions.refs}
		/>
	{/if}
	{#if editing && msg.role === "user"}
		<!-- In-place own-message edit: the editor mounts
		where the text sat and sizes to it. Commit lives on
		the row's checkmark (or Enter); focus leaving the
		box cancels back to the untouched message. -->
		<div class="msg-edit" onfocusout={actions.editFocusOut}>
			<div class="msg-edit-box" use:actions.editAction></div>
		</div>
	{:else if launch && folded}
		<!-- A news opener reads folded as one tag: the article's picture,
		the headline (a normal annotatable body at the message size),
		and the mode line. Unfolding shows what was sent. -->
		<div class="bubble news-launch" class:has-thumb={launchImage && !launchImageBroken}>
			{#if launchImage && !launchImageBroken}
				<img
					class="launch-thumb"
					src={launchImage}
					alt=""
					draggable="false"
					onerror={() => (launchImageBroken = true)}
				/>
			{:else}
				<span class="launch-icon" aria-hidden="true">{launch.kind === "talk" ? "🗣️" : "📰"}</span>
			{/if}
			<span class="launch-text">
				<span class="launch-title">{@render body(launch.title, false, null)}</span>
				<!-- Each dot rides the end of the item before it, so a wrap
				never starts a line with one; `endDots` hides a dot left at
				a line's end. -->
				<span class="launch-meta" use:endDots={metaKey}>
					<span class="meta-item"
						>{launch.kind === "talk" ? "Conversation" : "Summary"}<span
							class="sep"
							aria-hidden="true">·</span
						></span
					>
					<span class="meta-item">
						{#if news}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span class="level-wrap" onpointerdown={(e) => e.stopPropagation()}>
								<button
									type="button"
									class="launch-level"
									aria-haspopup="menu"
									aria-expanded={levelOpen}
									title="Change the level: the session restarts from here"
									onclick={(e) => {
										e.stopPropagation();
										levelOpen = !levelOpen;
									}}>{shownLevel} {cefrTag(shownLevel)} ▾</button
								>
								{#if levelOpen}
									<span class="level-menu" role="menu" transition:fade={{ duration: 120 }}>
										{#each CEFR_LEVELS as l (l.level)}
											<button
												type="button"
												role="menuitemradio"
												aria-checked={l.level === shownLevel}
												class:on={l.level === shownLevel}
												disabled={news.busy}
												onclick={(e) => {
													e.stopPropagation();
													levelOpen = false;
													if (l.level !== shownLevel) news.setLevel(l.level);
												}}><b>{l.level}</b> {l.tag}</button
											>
										{/each}
									</span>
								{/if}
							</span>
						{:else}
							<span>{shownLevel} {cefrTag(shownLevel)}</span>
						{/if}
						{#if launch.size || launch.source}<span class="sep" aria-hidden="true">·</span>{/if}
					</span>
					{#if launch.size}
						<span class="meta-item"
							>{SUMMARY_SIZES.find((sz) => sz.size === launch.size)?.label ?? ""}{#if launch.source}<span
									class="sep"
									aria-hidden="true">·</span
								>{/if}</span
						>
					{/if}
					{#if launch.source}
						<span class="meta-item meta-source">{launch.source}</span>
					{/if}
				</span>
			</span>
		</div>
	{:else if launch}
		<div class="bubble">{@render body(msg.content, false, null)}</div>
	{:else}
		<div class:bubble={msg.role === "user"}>{@render body(textOverride, folded, contentOverride)}</div>
	{/if}
	<!-- Sent image folds render in `SentAttachments.svelte`
	(variant "inline"); the page keeps the models, the OCR
	busy flag, and the fold/copy/OCR behaviors. -->
	<SentAttachments
		variant="inline"
		models={imageModels}
		attachments={msg.attachments ?? []}
		{ocrBusyId}
		actions={actions.tags}
	/>
	{#if showButtons && !(streaming && msg.content.trim() === "")}
		<!-- Preview renders the same row inert: the peek
		reserves the row's space (opening the chat moves
		nothing) while honoring the hover-only rhythm, so
		no peek button is ever visible or firing. The
		Messages toggle removes the row outright on both
		platforms (desktop shortcuts keep working). -->
		<!-- Action row renders in `MessageActions.svelte`;
		the page keeps voice/aid/selection state and every
		behavior behind computed props and actions. -->
		<MessageActions
			{msg}
			{previewing}
			{folded}
			streamingThis={streaming}
			{editing}
			{android}
			{foldTitle}
			{deleteTitle}
			{speaking}
			{speakable}
			{speakLabel}
			{aidId}
			{aidModelPinned}
			{aidVocalizing}
			{localKinds}
			{pinnedKinds}
			{aidBusy}
			actions={actions.ma}
		/>
	{/if}
</article>

<style>
	.news-launch {
		display: flex;
		/* Top-aligned: the picture sits level with the headline's
		first line, never centered against a two-line title. */
		align-items: flex-start;
		gap: 0.7rem;
		max-width: min(100%, calc(36rem * min(var(--font-scale, 1), 2))) !important;
	}
	.launch-icon {
		font-size: 1.4em;
		line-height: 1;
	}
	.launch-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}
	.launch-title {
		font-weight: 600;
	}
	.meta-item {
		display: inline-flex;
		align-items: center;
		white-space: nowrap;
	}
	/* A long outlet name may still wrap inside itself. */
	.meta-item.meta-source {
		white-space: normal;
	}
	.meta-item .sep {
		margin-left: 0.4em;
	}
	.level-wrap {
		position: relative;
	}
	.launch-level {
		border: 0;
		padding: 0.1em 0.3em;
		margin: 0 -0.2em;
		border-radius: 0.4em;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}
	.launch-level:hover,
	.launch-level[aria-expanded="true"] {
		background: #e5e5ea;
		background: var(--line-soft);
	}
	.level-menu {
		position: absolute;
		top: calc(100% + 0.3rem);
		left: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 12em;
		padding: 0.25rem;
		border: 1px solid #e5e5ea;
		border-color: var(--line-overlay);
		border-radius: 0.7rem;
		background: #fff;
		background: var(--bg-overlay);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
	}
	.level-menu button {
		display: flex;
		gap: 0.5em;
		border: 0;
		border-radius: 0.45rem;
		padding: 0.4em 0.6em;
		background: transparent;
		color: #1c1c1e;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.level-menu button:hover,
	.level-menu button.on {
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	/* The picture is the header's lead: a third of the row, as tall
	as the headline and meta beside it. Height 0 keeps it out of the
	row's sizing; min-height 100% then fills whatever the text sets. */
	.news-launch.has-thumb {
		display: grid;
		grid-template-columns: minmax(0, 34%) minmax(0, 1fr);
		width: min(100%, calc(36rem * min(var(--font-scale, 1), 2)));
	}
	.launch-thumb {
		width: 100%;
		height: 0;
		min-height: 100%;
		object-fit: cover;
		border-radius: 0.6rem;
	}
	/* Phones: a side column gets too thin, so the picture leads
	from above at full width. */
	@media (max-width: 520px) {
		.news-launch.has-thumb {
			grid-template-columns: minmax(0, 1fr);
		}
		.launch-thumb {
			height: auto;
			min-height: 0;
			aspect-ratio: 16 / 9;
		}
	}
	.launch-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		/* 0.4em each side of every dot; the level pill's wash reaches
		0.2em into that, so it always clears a dot. */
		gap: 0 0.4em;
		font-size: calc(0.75rem * var(--font-scale, 1));
		color: #6e6e73;
		color: var(--muted);
	}
	article {
		position: relative;
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
	}
	/* Two folded previews back to back (the user turn between them
	deleted) read as one folded block under the row gap alone: a
	full extra gap separates the folds. */
	/* :global on the left: every instance carries the same hash, so
	siblings match at runtime, but the compiler sees one article. */
	:global(article.folded-msg) + article.folded-msg {
		margin-top: var(--msg-gap, 0.35rem);
	}
	article {
		/* Flex items default to min-width:auto: a nowrap folded preview
		refuses to shrink and shoves the whole chat sideways (stray
		scrollbars). Zero lets the ellipsis bite instead. */
		min-width: 0;
		/* Text starts only at the message body: dragging anywhere else
		(empty space, action rows) is a plain pointer drag, never an
		I-beam selection. .rendered re-enables both below. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	/* Mid-drag containment covers the whole contained article: KaTeX
	bodies and folded labels declare their own user-select:text,
	which overrules the inline none containDragTo sets on the
	article's .rendered — without this, off-window drags wander
	into other messages' math. !important: only inline styles lose
	to it, and the attribute lives for the drag alone (mouseup
	clears it, so this is never a resting state). */
	article :global(.rendered[data-drag-none]),
	article :global(.rendered[data-drag-none] *) {
		user-select: none !important;
		-webkit-user-select: none !important;
	}
	/* A user message opens a new pair, so it carries the
	between-pair separation on top; replies hug underneath.
	The Gap size slider plus a hair, unless the button-scaling
	opt-in says otherwise (same contract as the list gap above). */
	article.user {
		margin-top: calc(var(--msg-gap, 0.35rem) + 0.1rem);
	}
	:global(main.scale-actions) article.user {
		margin-top: calc((var(--msg-gap, 0.35rem) + 0.1rem) * var(--font-scale, 1));
	}

	/* Even wrapping reads better in a chat column; one line, and
	engines without it just wrap normally. Assistant only: on short
	own messages pretty balances the lines into even halves, reshaping
	the bubble (a lone "paragraphs." gets "Japanese" pulled down to
	join it) — own text keeps its natural ragged wrap. */
	:global(.messages) article.assistant :global(.rendered) {
		text-wrap: pretty;
	}
	article.user {
		align-self: flex-end;
		/* Shrink-wrap so short prompts don't stretch into empty space.
		Beats the centered-column rule's width:100% on specificity;
		margin-right docks the right edge to the assistant column
		(centered min(100%, chat-width)), so own messages never drift
		right past AI width on narrow windows. Capped at 90% of the
		column (never the full chat width): even long own messages
		keep a left gutter, so they still read as mine next to
		full-width replies. */
		width: fit-content;
		max-width: min(90%, calc(var(--chat-width, 36) * 1rem));
		margin-right: max(
			0rem,
			calc((100% - min(100%, var(--chat-width, 36) * 1rem)) / 2)
		);
		/* No background or padding here: the bubble wraps the text only,
		so the action row below sits outside it. */
		padding: 0;
	}
	/* Own-message bubble: shrink-wraps the text (never the wider action
	row underneath) and docks hard right, so the side padding matches on
	both sides. Text stays left-aligned inside the right-docked bubble;
	long text wraps at 90% instead of going full-bleed, so a wrapped
	message keeps a visible left gutter and still reads as right-docked.
	Slightly tighter on top, where the text sat low. */
	article.user .bubble {
		background: #f1f1f4;
		background: var(--bg-wash);
		/* Radius and padding track the text size only up to 2x: past that
		the article cap stays fixed while the font keeps growing, so an
		unbounded scale domes the top corners and squeezes the text into
		a tall tower with dead gray shoulders. */
		border-radius: calc(1.75rem * min(var(--font-scale, 1), 2));
		padding: calc(0.45rem * min(var(--font-scale, 1), 2))
			calc(1rem * min(var(--font-scale, 1), 2))
			calc(0.55rem * min(var(--font-scale, 1), 2));
		text-align: left;
		width: fit-content;
		/* 100%, not 90%: the article already caps at min(100%, chat-width),
		and 90% here resolves against the shrink-wrapped article itself —
		squeezing short prompts into an early wrap with dead space left. */
		max-width: 100%;
		margin-left: auto;
	}
	/* Structured content stays left-aligned inside own messages: code
	and tables read badly right-aligned. */
	article.user :global(.rendered pre),
	article.user :global(.rendered table),
	article.user :global(.ccez-code) {
		text-align: left;
	}
	/* In-place own-message edit: invisible — the box matches the
	message it replaces (same wash, radius, padding, type), so the
	text just gains a cursor instead of moving onto a new frame.
	Full lane, not shrink-wrapped (fit-content collapses short
	drafts into a sliver): shaded messages show full-lane wash
	while editing, plain ones (see below) stay bare either way.
	The type matches the message it replaces (see .rendered in
	MessageBody) at every text size — the draft reads exactly as
	it will land. */
	article.user .msg-edit {
		background: #f1f1f4;
		background: var(--bg-wash);
		border: 0;
		border-radius: calc(1.75rem * min(var(--font-scale, 1), 2));
		padding: calc(0.45rem * min(var(--font-scale, 1), 2))
			calc(1rem * min(var(--font-scale, 1), 2))
			calc(0.55rem * min(var(--font-scale, 1), 2));
		width: 100%;
		max-width: 100%;
		box-sizing: border-box;
		margin-left: auto;
		text-align: left;
		font-size: calc(0.92rem * var(--font-scale, 1));
		line-height: 1.5;
	}
	.msg-edit-box :global(.ta-input) {
		background: none;
		line-height: 1.5;
		max-height: 16rem;
		width: 100%;
		box-sizing: border-box;
		border: 0;
		color: inherit;
		font: inherit;
		resize: none;
		outline: none;
		padding: 0;
		/* The editor stands down from manual sizing wherever the
		engine claims field-sizing support (see autogrow), so this
		rule must own the height — without it the field stays one
		row tall and only the first line shows. */
		field-sizing: content;
		overflow-y: auto;
	}
	/* In-place edit on phones: the textarea editor misses the
	prompt-scoped textarea styles, so it falls back to native chrome;
	and the desktop editing frame fights the bubble. Match the bubble
	instead (same wash, radius, padding, right dock) with a bare
	text field inside — the bar keeps the touch path (phones have no
	Esc and no Enter-to-save). */
	:global(.app[data-android]) article.user .msg-edit {
		background: var(--bg-wash);
		border: 0;
		border-radius: calc(1.75rem * min(var(--font-scale, 1), 2));
		padding: calc(0.45rem * min(var(--font-scale, 1), 2))
			calc(1rem * min(var(--font-scale, 1), 2))
			calc(0.55rem * min(var(--font-scale, 1), 2));
		width: 100%;
		box-sizing: border-box;
		/* Same type as the message it replaces (see MessageBody's
		.rendered): the bare textarea inherits this, so the draft
		reads at exactly the message size. Desktop keeps its own
		editing frame above. */
		font-size: calc(0.92rem * var(--font-scale, 1));
		line-height: 1.5;
	}
	:global(.app[data-android]) .msg-edit-box :global(.ta-input) {
		width: 100%;
		box-sizing: border-box;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		resize: none;
		outline: none;
		field-sizing: content;
		padding: 0;
	}
	article.assistant {
		/* Centered column like every message (see the column rule);
		the text itself stays left-aligned — only the alignment was
		meant to change, never the column. Assistant text packs
		tight: the list gap already separates messages, so no
		vertical padding here (desktop and touch). */
		align-self: center;
		text-align: left;
		padding-left: 0;
		padding-right: 0;
		padding-top: 0;
		padding-bottom: 0;
	}
	/* Unshaded own messages read like replies: no bubble, but the same
	right-docked flow — alignment never changes with the background.
	Shrink-wrap + auto margin docks short messages hard right (a full
	width here would strand them left with dead space on the right). */
	:global(main.plain-user) article.user .bubble {
		background: none;
		/* No bottom pad: the action row below sits as close as the
		assistant's (its margin is the whole gap). 100%, not 90%: the
		article already caps at min(100%, chat-width), and 90% here
		resolves against the shrink-wrapped article itself — same early
		wrap the shaded bubble's rule calls out. */
		padding: 0.5rem 0 0;
		text-align: left;
		width: fit-content;
		max-width: 100%;
		margin-left: auto;
	}
	/* Plain-mode edit: bare like the message — no wash, no frame,
	only the cursor says editing. */
	:global(main.plain-user) article.user .msg-edit {
		background: none;
		padding: 0.5rem 0 0;
	}
	/* Own-message ink: main[data-own-ink] selects the hue, the token
	resolves per theme ("off" has no rule — plain ink). Applies in
	plain and bubble modes alike; code tokens, badges, and links keep
	their explicit colors. Fallback hex first per docs/design/colors.md. */
	:global(main[data-own-ink="pink"]) article.user .bubble {
		color: #be185d;
		color: var(--own-pink);
	}
	:global(main[data-own-ink="blue"]) article.user .bubble {
		color: #1d4ed8;
		color: var(--own-blue);
	}
	:global(main[data-own-ink="green"]) article.user .bubble {
		color: #15803d;
		color: var(--own-green);
	}
	:global(main[data-own-ink="amber"]) article.user .bubble {
		color: #b45309;
		color: var(--own-amber);
	}
	:global(main[data-own-ink="purple"]) article.user .bubble {
		color: #7e22ce;
		color: var(--own-purple);
	}
	:global(main[data-own-ink="white"]) article.user .bubble {
		color: #1c1c1e;
		color: var(--own-white);
	}
	/* Tinted ink reaches the edit box too (it replaces the bubble,
	so it inherits nothing from it): the draft reads in the same
	hue it will land in. Fallback hex first per docs/design/colors.md. */
	:global(main[data-own-ink="pink"]) article.user .msg-edit {
		color: #be185d;
		color: var(--own-pink);
	}
	:global(main[data-own-ink="blue"]) article.user .msg-edit {
		color: #1d4ed8;
		color: var(--own-blue);
	}
	:global(main[data-own-ink="green"]) article.user .msg-edit {
		color: #15803d;
		color: var(--own-green);
	}
	:global(main[data-own-ink="amber"]) article.user .msg-edit {
		color: #b45309;
		color: var(--own-amber);
	}
	:global(main[data-own-ink="purple"]) article.user .msg-edit {
		color: #7e22ce;
		color: var(--own-purple);
	}
	:global(main[data-own-ink="white"]) article.user .msg-edit {
		color: #1c1c1e;
		color: var(--own-white);
	}
	article.selected {
		outline: 2px solid #3a3a3c;
		outline-color: var(--focus);
		outline-offset: 2px;
	}
	/* Palette jumps land DOM focus on the article itself (tabindex -1
	for programmatic focus only, never in the Tab order): .selected
	carries the keyboard indicator, so focus adds no second ring. */
	article:focus {
		outline: none;
	}
	article.selected:focus {
		outline: 2px solid #3a3a3c;
		outline-color: var(--focus);
		outline-offset: 2px;
	}
	/* Hover-only button modes keep the actions row in the layout
	(invisible via opacity), so the article ring would box the buttons'
	empty floor too. The article ring goes quiet there and the text body
	carries the selected indicator instead. */
	:global(main.hover-user) article.user.selected,
	:global(main.hover-user) article.user.selected:focus,
	:global(main.hover-assistant) article.assistant.selected,
	:global(main.hover-assistant) article.assistant.selected:focus {
		outline-color: transparent;
	}
	:global(main.hover-user) article.user.selected .bubble,
	:global(main.hover-assistant) article.assistant.selected :global(.rendered) {
		outline: 2px solid #3a3a3c;
		outline-color: var(--focus);
		outline-offset: 6px;
		border-radius: 8px;
	}
	/* Holding Option arms message click actions (fold/unfold): the
	pointer says clickable where the I-beam says selectable. */
	:global(main.alt) article,
	:global(main.alt) article * {
		cursor: pointer;
	}
	/* …tinted amber on the message a speak-aloud selection came from,
	restored automatically when speech ends. */
	article.speaking-sel ::selection {
		background: rgba(245, 158, 11, 0.45);
	}
	/* Hide-messages mode (touch option): bodies and baked quote blocks
	stay hidden until their message is tapped open; the open row shows
	text and buttons for 3s. Later than the hover rules so it wins ties;
	the open-row attr outranks them outright. */
	:global(main.hide-messages) article :global(.rendered),
	:global(main.hide-messages) article :global(.ann-refs) {
		display: none;
	}
	:global(main.hide-messages)
		article[data-actions-open="true"]
		:global(.rendered),
	:global(main.hide-messages)
		article[data-actions-open="true"]
		:global(.ann-refs) {
		display: block;
	}
	/* No bubble, no bubble padding: the text's right edge lands on the
	row's right edge, so the last button never hangs past short text.
	(The 1rem side pad only makes sense with a visible bubble behind
	it; without one it strands the text a full pad left of its own
	buttons.) */
	:global(.app[data-android]) :global(main.plain-user) article.user .bubble {
		padding: 0.25rem 0 0;
	}
	/* My-message background OFF on phones: the edit box carries no
	background either (it mirrors the plain text, not the bubble).
	Desktop keeps its editing frame above. */
	:global(.app[data-android]) :global(main.plain-user) article.user .msg-edit {
		background: none;
	}
	/* Below the full-bleed text size, assistant messages shrink-wrap
	to their text like own bubbles instead of running the full
	column — short replies read at the same width on both sides,
	while long ones still fill to the cap. At the full-bleed size
	and past it the column goes wide so huge text stays readable. */
	:global(.app[data-android]):not([data-fullbleed]) article.assistant {
		width: fit-content;
		/* Shrink-wrapped phone replies left-dock: a centered stub
		reads as a status line, not a message. Desktop keeps the
		centered column (see article.assistant). */
		align-self: flex-start;
	}
	/* A folded assistant message spans the column instead of
	shrink-wrapping: the capped preview floated mid-screen rather
	than starting where the message text starts. */
	:global(.app[data-android]):not([data-fullbleed])
		article.assistant.folded-msg {
		width: auto;
		align-self: stretch;
	}
	/* Full-bleed keeps the article full width while the bubble stays
	shrink-wrapped: short notes dock hard right (a full-width own
	column reads left-anchored like a reply) and long ones still
	fill to the cap. */
	:global(.app[data-android][data-fullbleed]) article.user {
		width: 100%;
	}
	/* Shared column width (article, hero, sending status): the hero
	and the status keep their global pairing paged; the article
	keeps its own here. */
	article {
		align-self: center;
		width: 100%;
		max-width: min(100%, calc(var(--chat-width, 36) * 1rem));
		box-sizing: border-box;
	}
	/* Only the very first message stands off the top: one strip-height
	of margin clears the invisible drag strip at scroll zero, so the
	first line is clickable as well as visible. Everything after it
	bleeds edge to edge (see .messages padding). */
	article:first-of-type {
		margin-top: 1.75rem;
	}
	/* The button-scaling opt-in is on by default, and its user-margin
	rule outranks the offset above (extra main class), parking the
	first message back under the strip. This twin reasserts the
	fixed-chrome clearance after it: same specificity, later wins.
	The strip never scales, so the offset stays fixed too. */
	:global(main.scale-actions) article:first-of-type {
		margin-top: 1.75rem;
	}
	/* The shell's strip is taller by that same padding: the first
	message stands off the full height there. */
	:global(.app[data-titlebar="overlay"]) article:first-of-type {
		margin-top: calc(1.75rem + 1.15rem);
	}
</style>
