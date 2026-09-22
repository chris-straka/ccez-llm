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
	import type { LocalAid } from "$lib/reading";
	import type { AttachTagModel, SentTagAction } from "$lib/attachments";
	import type {
		AnnotationId,
		AnnotationMark,
		AnnotationRef
	} from "$lib/annotations";
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
		aidPreview: boolean;
		previewing: boolean;
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
		aidPreview,
		previewing,
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
</script>

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
	{:else}
		<div class:bubble={msg.role === "user"}>
			<MessageBody
				message={msg}
				{streaming}
				{sourcesWanted}
				{folded}
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
				{textOverride}
				{contentOverride}
				{aidPreview}
				preview={previewing}
				{aidKinds}
				{aidPreferred}
				onAidLoadingChange={actions.aidLoadingChange}
				onAidError={actions.aidError}
			/>
		</div>
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
	{#if (android || showButtons) && !(streaming && msg.content.trim() === "")}
		<!-- Preview renders the same row inert: the peek
		reserves the row's space (opening the chat moves
		nothing) while honoring the hover-only rhythm, so
		no peek button is ever visible or firing. The
		desktop Messages toggle removes the row outright
		(its shortcuts keep working); phones always render
		it — no shortcuts exist to cover an off state. -->
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
	/* In-place own-message edit: same right-docked footprint as the
	bubble, with a visible editing frame (the bubble shade would fight
	the code colors). The bar holds the touch path — phones have no
	Esc and no Enter-to-save. */
	article.user .msg-edit {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 0.5rem 0.75rem 0.4rem;
		width: fit-content;
		max-width: 100%;
		margin-left: auto;
		text-align: left;
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
	:global(.app[data-shell="tauri"]) article:first-of-type {
		margin-top: calc(1.75rem + 1.15rem);
	}
</style>
