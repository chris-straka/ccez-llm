<script lang="ts">
	import { flushSync, onMount, tick } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";

	// Document theme tokens + print sheet (REFACTOR §6): global CSS
	// lives in src/app.css, imported here (single route).
	import "../app.css";
	import {
		createChatState,
		formatTokens,
		activeChat,
		newChat,
		selectChat,
		setChatReplyLang,
		swapReplyLang,
		chatVoiceReadback,
		setChatVoice,
		deleteChat,
		planChatStep,
		clampChatIndex,
		messageIndexFromId,
		deleteMessage,
		stageMessage,
		branchFrom,
		dismissFailedAssistant,
		truncateToMessage,
		editMessageContent,
		resendLast,
		tokenTotal,
		tokenSplit,
		waypoints,
		sendMessage,
		setPasteFold,
		isSending,
		hasReplyStarted,
		markReplyStarted,
		hasFetchActive,
		beginNativeSend,
		beginNativeResend,
		settleNativeSend,
		resolveSendCompletion,
		type PasteFold,
		type Chat,
		type ChatMsg,
		type ChatId,
		type ChatMsgId
	} from "$lib/chat";
	import {
		loadSettings,
		saveSettings,
		effectiveSystemPrompt,
		activeThinkingSupport,
		activeThinkingId,
		resolveTheme,
		systemLocale,
		CHAT_WIDTH_DEFAULT,
		stepFontScale,
		stepChatWidth,
		MESSAGE_GAP_DEFAULT,
		effectiveChatWidth,
		FULLBLEED_FONT_SCALE,
		PROMPT_IDLE_ALWAYS,
		PROMPT_IDLE_NEVER,
		type AppSettings
	} from "$lib/settings";
	import { cycleThinkingId } from "$lib/providers/thinking";
	import {
		LANGUAGE_MENUS,
		QUICK_LANG_CODES,
		langMenuAnchorFor,
		quickKeyFor,
		replyLanguageFor,
		switchToastFor,
		thinkingLabelFor,
		type LangMenuAnchor,
		type LanguageMenu,
		type ReplyLanguage
	} from "$lib/languages";
	import {
		listProviders,
		createProvider,
		getProviderDef,
		providerKeyMissing,
		type ProviderId
	} from "$lib/providers/registry";
	import { offlineTarget, onlineRestore } from "$lib/offline";
	import { MockProvider, mockProviderEnabled } from "$lib/providers/mock";
	import {
		isOnDeviceProvider,
		onDeviceNotReadyCopy,
		onDeviceStatus
	} from "$lib/ondevice/bridge";
	import { OnDeviceChatProvider } from "$lib/ondevice/provider";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { listen, type UnlistenFn } from "@tauri-apps/api/event";
	import {
		PROMPT_PLACEHOLDER,
		SCROLL_PLACEHOLDER,
		ANDROID_PROMPT_PLACEHOLDER,
		ANDROID_SCROLL_PLACEHOLDER,
		sendPasteFolds,
		bakeEditedMessage,
		caretAfterPaste,
		mergeFolds,
		type PromptEditor,
		type PromptEditorOptions,
		type SubmitKind
	} from "$lib/editor";
	import { createTextareaEditor } from "$lib/textarea-editor";
	import { errorMessage } from "$lib/errors";
	import {
		SCROLLKEY_LINE_PX,
		SCROLLKEY_SKIP_PX,
		ggArmed,
		halfPageDy,
		holdGlideVelocity,
		holdIsTap,
		indexAtViewportLine,
		viewCursorLine,
		isEscapeHold,
		keyFocusesEmptyPrompt,
		messageEdgeScrollTop,
		nearBottom,
		resolveSidebarSpaceEnter,
		scaleScrollPx,
		STICK_PX,
		scrollHoldVelocity,
		stepScrollTop,
		unselectedScrollIntent
	} from "$lib/scrollkeys";
	import {
		hydrateSecrets,
		migrateLegacySecret,
		persistSecrets,
		tauriBackendAvailable,
		withBlankedKeys
	} from "$lib/secrets";
	import {
		canEditMessage,
		toggleAidKinds,
		toggleSingleAid
	} from "$lib/message-actions";
	import type { ChatProvider } from "$lib/providers/types";
	import Toasts from "$lib/components/Toasts.svelte";
	import SelMenu from "$lib/components/SelMenu.svelte";
	import Attachments from "$lib/components/Attachments.svelte";
	import Readings from "$lib/components/Readings.svelte";
	import ChatSwitcher from "$lib/components/ChatSwitcher.svelte";
	import ShortcutsModal from "$lib/components/ShortcutsModal.svelte";
	import SearchPalette from "$lib/components/SearchPalette.svelte";
	import InspectOverlay from "$lib/components/InspectOverlay.svelte";
	import AnnPop from "$lib/components/AnnPop.svelte";
	import AnnAnswer from "$lib/components/AnnAnswer.svelte";
	import Sidebar from "$lib/components/Sidebar.svelte";
	import ThreadView from "$lib/components/ThreadView.svelte";
	import LangMenus from "$lib/components/LangMenus.svelte";
	import StudySheet from "$lib/components/StudySheet.svelte";
	import SettingsDrawer from "$lib/components/SettingsDrawer.svelte";
	import FindBar from "$lib/components/FindBar.svelte";
	import Composer from "$lib/components/Composer.svelte";
	import Waypoints from "$lib/components/Waypoints.svelte";
	import { plainBody, sourcesAsked, messageCopyText } from "$lib/render";
	import {
		clearNotice,
		emptyNotices,
		flashNotice,
		showNotice,
		toastTimeoutFor,
		errorToastTimeoutFor,
		VOICE_TIMEOUT_MS
	} from "$lib/notices";
	import {
		FILE_MARKER,
		IMAGE_MARKER,
		fileMarkerInsert,
		fileToAttachment,
		stripAttachmentMarkers,
		imageMarkerInsert,
		attachmentImageBlobsAt,
		clipboardPngBlob,
		countMarkers,
		countPastedTags,
		isPastedTextAttachment,
		makePastedTextAttachment,
		pastedMarkerInsert,
		spliceSendText,
		syncTagRemovals,
		stripPastedMarkers,
		sentTagModelsFor,
		toggleTagKey,
		type Attachment,
		type AttachmentKind,
		type AttachTagModel,
		type SentTagAction
	} from "$lib/attachments";
	import {
		duplicateAnnotationId,
		editAnnotationComment,
		deleteAnnotation,
		clearAnnotations,
		withAnnotations,
		quoteFragmentText,
		equationBodyOf,
		equationBodyRange,
		trimParagraphTerminator,
		newAnnotationId,
		quoteRange,
		rangesExcludingReadings,
		wrapRangeExcludingBadges,
		unwrapMark,
		invalidateWashPaint,
		findQuotedMessage,
		annRefsFor,
		lockSelectionToMessage,
		quoteTextNodes,
		occurrenceAtPosition,
		snapSelectionToWordEdges,
		selMenuPlacement,
		readingPanelPlacement,
		menuYAbovePanel,
		clampPanelCenterX,
		highlightSteady,
		panelCenterMoved,
		lineStartOffset,
		clampDragAnchorToFocusLine,
		loadDraftAnnotations,
		saveDraftAnnotations,
		buildMarksFor,
		aidedTextForMsg,
		commitRefsEdit,
		planClearSentRefs,
		promptAnnLookup,
		seedAnnotationsFromRefs,
		annotationCopyText,
		filePendingAnnotation,
		promptAnnWashIdFor,
		paragraphForQuote,
		clampMenuDrag,
		annEditCommitToast,
		type Annotation,
		type AnnotationId,
		type AnnotationMark
	} from "$lib/annotations";
	import {
		ANN_FLASH_NAME,
		clearAnnotationWash,
		flashFadeSchedule,
		highlightsSupported,
		paintAnnotationWash,
		prefersReducedMotion
	} from "$lib/annHighlights";
	import { badgeHover } from "$lib/hoverWash";
	import { startBlink, startHighlightFade, startMarkFade } from "$lib/blink";
	import { createRefMemo } from "$lib/aidLoading";
	import {
		scopeMessagesTransition,
		switchChatWithTransition
	} from "$lib/viewTransitions";
	/* decomposeTree + onKunLine render in `InspectOverlay.svelte`. */
	import {
		getInspectData,
		inspectLangFor,
		isHanChar,
		shouldShowInspect,
		clampStrokeStep
	} from "$lib/inspect";
	import {
		correctSelMenuX,
		selMenuIdleDecision,
		selMenuWidthEstimate
	} from "$lib/selSlices";
	import {
		joinSlicesWithBlocks,
		scopeSlices,
		selectionSlices,
		shrinkPanelToContent,
		spanRect,
		tintSelectionSpans,
		unwrapFuriganaTint
	} from "$lib/selTint";
	import {
		applyTurnFile,
		dismissNativeTurn,
		markTurnInterrupted,
		nativeRouteFor,
		errorTurnFile,
		pollNativeTurn,
		releaseNativeTurn,
		resumableKilledTurn,
		scanNativeTurns,
		seenNativeTurn,
		startNativeTurn,
		turnHistory,
		type NativeTurnConfig,
		type NativeTurnFile,
		type NativeTurnOwnership,
		type TurnId,
		type TurnDoneEvent,
		type TurnFetchEvent,
		type TurnTokenEvent
	} from "$lib/turns";
	import { pinyinRuby } from "$lib/pinyin";
	import { furiganaHtml } from "$lib/furigana";
	import { fetchStrokePaths } from "$lib/kanjivg";
	import {
		isAndroidUserAgent,
		isIOSUserAgent,
		canWindowDrag,
		isCoarsePointer,
		isTouchTablet,
		currentPlatform,
		micButtonsShown,
		altKeyLabel,
		edgeSwipeTarget,
		contentSwipeTarget,
		messageFoldSwipe,
		pinchZoomStep,
		twoFingerSwipeDir,
		twoFingerSlideDir,
		threeFingerSwipeDir,
		switcherVeilStep,
		isThreeFingerTap,
		nextTapCount,
		multiTapOwnsRelease,
		visibleProviderIds,
		stepCyclicId,
		touchPastSlop,
		androidMajorFromUA,
		osConfirmsClipboard,
		type TapSequence,
		type FlickZone,
		type EdgePanel,
		type FingerTrack
	} from "$lib/platform";
	/* Shortcut row data renders in `ShortcutsModal.svelte`
	(imports `$lib/shortcuts` there). */
	import {
		chromeChord,
		commandChord,
		deleteChatScope,
		inspectStepAction,
		keyFacts,
		messageKeyAction,
		modalScrollAction,
		pastesKeyAction,
		promptIdleKeyAction,
		sendKeyAction,
		summonHideAction,
		quickLangIndexForKey,
		scrollEnterAction,
		scrollModeAction,
		unselectedScrollAction,
		shortcutsFilterBlocksKey,
		sidebarListAction,
		spaceKeyAction,
		enterKeyAction
	} from "$lib/keybindings";
	import {
		describeActiveElement,
		describeFocusTarget,
		focusLog
	} from "$lib/focusDebug";
	import {
		closestFromTarget,
		consumeEvent,
		isClickControlTarget,
		isEditableTarget,
		isFieldTarget,
		isFilterTarget,
		isFindBarTarget,
		isIdleOwnedTarget,
		isInspectFieldTarget,
		isChatRowTarget,
		isInteractiveTarget,
		isMathTarget,
		isPromptEditorTarget,
		isPromptTarget,
		isScrollEnterOwnedTarget,
		isSidebarTarget,
		isSpaceInteractiveTarget,
		isTapOverlayTarget,
		mouseupKeepsSelection,
		isAnnotationUiTarget,
		middleDragGesture
	} from "$lib/events";
	import {
		aidDisplayText,
		offeredLocalAids,
		preferredLocalAid,
		wordAtNodeOffset,
		sentenceBounds,
		paragraphBounds,
		extractWordAt,
		hanOverlayLangFor,
		runModelAid,
		annotationAnswer,
		aidTargetLines,
		selectAidInput,
		spliceAidResult,
		messageAidKinds,
		readingsOnly,
		annotatedRunsWithOffsets,
		sliceRunsForQuote,
		speechKanaForQuote,
		quoteStartForContext,
		wordBoundsAt,
		groupRuns,
		type GroupedRun,
		type LocalAid,
		type HanOverlayLang
	} from "$lib/reading";
	import { isFuriganaCached } from "$lib/furigana";
	import { fieldSelectionLive, reportOsMenu } from "$lib/promptmenu";
	import {
		buildSearchDocs,
		collectSearchAnnotations,
		findMessageIndices,
		type SearchHit
	} from "$lib/chatSearch";
	import { chatLabel, filterSidebarChats, sideTip } from "$lib/sidebar";
	import { emptyFind, stepFindCursor, type FindState } from "$lib/find";
	import { emptyPalette, type PaletteState } from "$lib/palette";
	import {
		annPopBlurAction,
		annPopCancelKind,
		annPopSaveKind,
		annPopWidth,
		pillWashId,
		placeAnnCard,
		placeAnnComposer
	} from "$lib/annPop";
	import {
		idleTapAction,
		shouldHideForAlways,
		shouldIdleHide
	} from "$lib/idle";
	import {
		submitAction,
		sendAction,
		composerLocked,
		editMessageAction,
		commitEditTarget
	} from "$lib/submit";
	import {
		emptyViewport,
		rectInClear,
		clearLandingDelta,
		editViewDelta,
		type ViewportState
	} from "$lib/viewport";
	import { ChatSearchStore, createSearchWorker } from "$lib/chatSearchStore";

	import { isPermissionDismissal } from "$lib/intake";
	import { consumeLaunchFiles, splitLaunchFiles } from "$lib/launchFiles";
	import {
		copyExportText,
		downloadMarkdownFile,
		exportChatMarkdown,
		exportSuccessToast,
		exportFailureToast,
		fileSaveAccessAvailable
	} from "$lib/chatExport";
	import { nativeSaveMarkdown } from "$lib/nativeExport";
	import {
		isKeyboardOpen,
		kbFreshOpen,
		keyboardOverlapPx,
		pinArmStart,
		settlePin
	} from "$lib/viewportReflow";
	import {
		isPromptIdle,
		stageOwnedByOverlay,
		pointInRect,
		sendHoldArmed,
		columnBounds,
		gutterSide,
		rowWorkRunning,
		messageActionsTapAllowed,
		promptParkedFor
	} from "$lib/chrome";
	import {
		speakText,
		speakMultilingual,
		speechText,
		latinFallback,
		speechAttemptable,
		messageSpeakableFor,
		isMessageSpeaking,
		speakTitleFor,
		appendDictation,
		dictationInsert,
		micUnavailableMessage,
		startSpeechError,
		effectiveSpeechLang,
		stopSpeaking,
		micAvailable,
		dictateOnce,
		type SpeakCallbacks
	} from "$lib/voice";
	import {
		speakNative,
		speakNativeMulti,
		stopNative,
		friendlyNativeError,
		nativeTtsSupported,
		quoteLangFor,
		quoteLangForContext,
		sentenceForQuote,
		sentenceLangsFor,
		currentKeyboardInputSource
	} from "$lib/nativeTts";
	import { startNativeDictation } from "$lib/nativeDictate";
	import {
		acquireStudyWakeLock,
		clearStudyBadge,
		dismissReplyNotificationAsync,
		drainPendingExternalAsync,
		ensureReplyNotificationPermissionAsync,
		hapticBeatAsync,
		notifyReplyDoneAsync,
		releaseStudyWakeLock,
		setStudyBadge,
		vibrateTick,
		type WakeLockRelease
	} from "$lib/studyMedia";
	import {
		recognizeImageText,
		recognizeFallbackText,
		detectFallbackScript,
		ocrFallbackLangs,
		ocrLangsKey,
		keepBestRecognition,
		ocrRetryHint,
		visionSupports,
		OCR_RETRY_BELOW,
		friendlyOcrError,
		friendlyFallbackError,
		ocrSupported
	} from "$lib/nativeOcr";
	import { voiceLocaleForInputSource } from "$lib/keyboardLang";
	import { joinExternalDraft, routeExternalText } from "$lib/externalText";
	import {
		listenDeepLinks,
		isSummonHotkey,
		studySheetMarkdown,
		sheetTitle,
		shareStudySheet,
		shareOutcomeToast,
		printStudySheet,
		desktopSleepBlock,
		desktopSleepUnblock,
		exportStudySheet
	} from "$lib/desktop";

	let chatState = $state(createChatState());
	let settings = $state(loadSettings());
	// The chat list always starts closed — a persisted open state never
	// survives a start or refresh.
	settings.sidebarCollapsed = true;
	// Voice readback always starts off for the same reason: every launch
	// begins quiet, no matter what it was left on.
	settings.voice = false;

	// Settings save themselves: every change persists (debounced), with
	// secrets mirrored to the Keychain in the Tauri shell. No Save button.
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let skipFirstSave = true;
	$effect(() => {
		const snapshot = $state.snapshot(settings);
		if (skipFirstSave) {
			skipFirstSave = false;
			return;
		}
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			// The top-of-effect snapshot (a synchronous settings read, so
			// the effect subscribes) freezes the debounced save.
			saveSettingsNow(snapshot);
		}, 400);
		return () => {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
		};
	});

	if (tauriBackendAvailable()) {
		// Pull Keychain keys into memory before the first send; no-op in browsers.
		void hydrateSecrets(settings);
	}
	let editor: PromptEditor | null = $state(null);
	let promptEl: HTMLElement | undefined = $state();
	let settingsEl: HTMLElement | undefined = $state();
	let scrollBox: HTMLElement | undefined = $state();
	/** App root (pinned to the visual height while the phone keyboard is up). */
	let appEl: HTMLElement | undefined = $state();
	/** Scroll/viewport values (REFACTOR §6): one grouped object, so
	scroll effects stop sharing subscription accidents with unrelated
	domains. The element and the wiring stay here. */
	let viewport = $state<ViewportState>(emptyViewport());
	/** Scrollbar thumb shows while a scroll is in flight, then fades.
	The stop hold is short (120ms): momentum scrolls land events in
	tight bursts, so anything longer just delays the fadeout. */
	/** Filed scroll positions, one per chat: switching back lands
	where you left instead of at the top. Session memory only —
	never persisted (reloads boot at the fresh-box top like today).
	Previews never file: mid-peek the box shows another chat. */
	const chatScrollTops = new SvelteMap<ChatId, number>();
	/** File the active chat's scroll position (see chatScrollTops). */
	function saveChatScroll(): void {
		if (previewChatId !== null || !scrollBox) return;
		chatScrollTops.set(chatState.activeChatId, scrollBox.scrollTop);
	}
	function noteScrolling(): void {
		// The menu tracks its highlight through scrolls (trackSelMenu
		// repositions it) instead of dismissing: on phones the native
		// selection and its OS menu stay up across scrolls, so ours
		// must too. Only a collapsed selection dismisses the menu.
		if (!androidUI || (window.getSelection()?.toString() ?? "") === "")
			selMenu = null;
		/* The phone language sheet is fitted to its open-frame geometry:
		a thread scroll invalidates the fit, so it closes instead of
		floating mis-anchored. Desktop keeps its in-flow list. */
		if (androidUI && openLangMenu) openLangMenu = null;
		saveChatScroll();
		if (scrollBox) viewport.stick = nearBottom(scrollBox);
		scrollBox?.classList.add("scrolling");
		window.clearTimeout(viewport.idleTimer);
		viewport.idleTimer = window.setTimeout(() => {
			scrollBox?.classList.remove("scrolling");
			updateWpPos();
		}, 120);
	}
	let focusMode: "edit" | "scroll" = $state("edit");
	/**
	 * Whether scroll mode started in the prompt: only then does Ctrl+G
	 * hop back to a focused, type-ready composer. Entering from a
	 * deactivated prompt (Ctrl+G at the view, search/find landings)
	 * stays out — there is nothing to hop back to.
	 */
	let scrollFromPrompt = false;
	let selectedIdx = $state(-1);
	let hoveredIdx = $state(-1);
	/**
	 * Latest window pointer point (keyboard speech chords read the
	 * word/sentence/paragraph under it): a plain cell the global
	 * mousemove listener stores into, never reactive state.
	 */
	let lastHoverClient: { x: number; y: number } | null = null;
	/**
	 * Last hover-index change: hovering another message empties a live
	 * selection on WebKit (engine, no press), so a selectionchange that
	 * lands right after a hover change restores instead of dismissing
	 * (see the dismiss below). Programmatic clears arrive with a stale
	 * hover and keep dismissing.
	 */
	let lastHoverChangeAt = 0;
	let missingKey = $state(false);
	/** Provider id already toasted for a missing key (one toast per episode). */
	let keyToastFor: string | null = null;
	/** Message ids already toasted for send errors (Android shows no inline error). */
	const errorToasted = new SvelteSet<ChatMsgId>();
	/** Native turns in flight (Android shell): turn id → owning chat
	and the placeholder the runner fills. Survives nothing — a killed
	page rebuilds ownership from the turn files on boot instead. */
	const nativeTurns = new SvelteMap<
		TurnId,
		{ chatId: ChatId; replyId: ChatMsgId }
	>();
	/** Streamed text per native turn (a retry recompute clears its own). */
	const nativeText = new SvelteMap<TurnId, string>();
	/** Chats with a native page fetch in flight: the Fetching chip reads
	this alongside the TypeScript provider's flag, so both engines drive
	one indicator. */
	const nativeFetching = new SvelteSet<ChatId>();
	/** Chats with a native turn in flight: the Thinking chip and the
	submit gate read this — native turns never raise the TypeScript
	sending flag, so without it a backgrounded-then-revisited reply
	would show neither dots nor a dead send button. */
	const liveNative = new SvelteSet<ChatId>();
	/** Shared ownership bundle for releaseNativeTurn: same map
	identity, so the deletes stay reactive. */
	const nativeOwn: NativeTurnOwnership = {
		turns: nativeTurns,
		texts: nativeText,
		fetching: nativeFetching,
		live: liveNative
	};
	/**
	 * Android reports errors as toasts, never inline chrome: a phone
	 * column has no room for a persistent banner, and a font-scaled
	 * error span blows the action row apart. Toasts auto-dismiss, so
	 * the "set an API key" notice goes away on its own too.
	 */
	$effect(() => {
		if (!androidUI) return;
		// Never from inside Settings: switching to a keyless-less
		// provider mid-panel must not toast before the key can be
		// entered — closing the panel still keyless reminds once.
		if ((!missingKey && !noKeyLock) || settingsOpen) {
			if (!missingKey && !noKeyLock) keyToastFor = null;
			return;
		}
		const id = settings.activeProviderId;
		if (keyToastFor === id) return;
		keyToastFor = id;
		flashErrorToast("No API key — open Settings to add one");
	});
	$effect(() => {
		if (!androidUI) return;
		const live = new Set(viewChat.messages.map((m) => m.id));
		for (const id of errorToasted) if (!live.has(id)) errorToasted.delete(id);
		for (const m of viewChat.messages) {
			if (m.error && !errorToasted.has(m.id)) {
				errorToasted.add(m.id);
				// On-device failures explain themselves in Settings
				// (status note under the pill, with native detail);
				// the generic toast adds nothing.
				if (!isOnDeviceProvider(settings.activeProviderId))
					flashErrorToast(m.error);
			}
		}
	});
	let attachments = $state<Attachment[]>([]);
	/** In-flight attachment reads (counter: multi-file drops overlap).
	While nonzero the paperclip dims and reports progress. */
	let attachBusy = $state(0);
	let foldedIds = new SvelteSet<string>();
	/**
	 * Draft annotations for the active chat, restored from storage on
	 * launch: unsent quotes survive a restart (sending still bakes and
	 * clears, switching chats still starts clean — the save below
	 * records the empty list either way).
	 */
	let annotations = $state<Annotation[]>(
		loadDraftAnnotations(chatState.activeChatId)
	);
	$effect(() => {
		saveDraftAnnotations(
			chatState.activeChatId,
			annotations,
			chatState.chats.map((c) => c.id)
		);
	});
	/**
	 * Search index stays fresh: any chat/message/draft change re-indexes
	 * (debounced) into the Worker + IndexedDB snapshot. The synchronous
	 * reads subscribe the effect; the schedule call is the debounced
	 * side effect.
	 */
	$effect(() => {
		const fingerprint = chatState.chats
			.map(
				(c) =>
					`${c.id}:${c.messages.length}:${c.messages.map((m) => m.content.length).join(",")}`
			)
			.join("|");
		const draftCount = annotations.length;
		void fingerprint;
		void draftCount;
		scheduleSearchIndex();
	});
	/**
	 * Annotation being composed (comment pill open, not yet submitted):
	 * held out of `annotations` so no badge stamps and no count moves
	 * until submit. The id is minted up front so the wash and the pill
	 * already address the annotation it will become.
	 */
	let pendingAnn = $state<Annotation | null>(null);
	/** Annotations with a model answer in flight (the remodel):
	badges read blue until the answer lands, orange after. Memory-only
	like the request itself — answers persist on the annotation, the
	waiting flag does not survive a reload. */
	let annAnswering = new SvelteSet<AnnotationId>();
	let reviewOpen = $state(false);
	/** Focus refs: after a control unmounts mid-touch, focus must
	land on a live node inside .ann-wrap — never on a dying button
	(focus drops to <body> and strands the keyboard). */
	let annPill: HTMLButtonElement | null = $state(null);
	let editBox: HTMLTextAreaElement | null = $state(null);
	function focusPill(): void {
		annPill?.focus({ preventScroll: true });
	}
	/** Waypoint menu pinned open (hover/focus reveal it without pinning). */
	let wpOpen = $state(false);
	let wpWrap: HTMLElement | undefined = $state();
	/** 1-based position of the nearest waypoint at/above the viewport top
	(feeds the touch pill and the sheet's current-item highlight). */
	let wpPos = $state(1);
	function updateWpPos(): void {
		const box = scrollBox;
		if (!box || points.length === 0) {
			wpPos = 1;
			return;
		}
		const top = box.scrollTop;
		let n = 0;
		for (let k = 0; k < points.length; k++) {
			const el = box.querySelector<HTMLElement>(`#msg-${points[k]}`);
			if (el && el.offsetTop - top <= 120) n = k + 1;
			else break;
		}
		wpPos = Math.max(1, n);
	}
	/** Pinned menu dismisses on outside press: the trigger hides while
	the panel is up, so there is nothing left to toggle it shut. */
	$effect(() => {
		if (!wpOpen) return;
		const onDown = (e: PointerEvent) => {
			if (!(e.target instanceof Element) || !e.target.closest(".wp-wrap")) {
				wpOpen = false;
			}
		};
		window.addEventListener("pointerdown", onDown);
		return () => window.removeEventListener("pointerdown", onDown);
	});
	// The settings panel owns the pointer while open: unmounting the
	// rail above drops hover, and this closes a pinned menu with it.
	$effect(() => {
		if (settingsOpen) wpOpen = false;
	});
	// The menu opens at the middle option, not the top: it scrolls
	// into view without stealing focus (keyboard users tab in from
	// the top as before; a focus move would also pin the menu
	// against hover-outside dismissal).
	$effect(() => {
		if (!wpOpen) return;
		void tick().then(() => {
			if (!wpOpen) return;
			const items = wpWrap?.querySelectorAll(
				'.wp-menu button[role="menuitem"]'
			);
			const mid = items?.item(Math.floor(((items.length ?? 1) - 1) / 2));
			if (!(mid instanceof HTMLElement)) return;
			mid.scrollIntoView({ block: "nearest" });
		});
	});
	// The pill's position tracks the chat itself (new messages, chat
	// switches), not just scrolls: the synchronous reads subscribe the
	// effect, and the DOM re-read settles after paint, when article
	// boxes are final.
	$effect(() => {
		const total = points.length + viewChat.messages.length;
		requestAnimationFrame(() => {
			if (total === 0) wpPos = 1;
			else updateWpPos();
		});
	});
	/**
	 * Ticks stay invisible until the pointer comes near the stack (64px):
	 * cheap window mousemove, rAF-throttled, class toggled outside
	 * reactivity so chat never re-renders for pointer travel.
	 */
	$effect(() => {
		const el = wpWrap;
		if (!el || typeof window.matchMedia !== "function") return;
		if (window.matchMedia("(hover: none)").matches) return;
		const R = 64;
		let raf = 0;
		let near = false;
		const set = (v: boolean) => {
			if (v === near) return;
			near = v;
			el.classList.toggle("wp-near", v);
		};
		const onMove = (e: MouseEvent) => {
			if (raf) return;
			const x = e.clientX;
			const y = e.clientY;
			raf = window.requestAnimationFrame(() => {
				raf = 0;
				const r = el.getBoundingClientRect();
				set(
					x >= r.left - R &&
						x <= r.right + R &&
						y >= r.top - R &&
						y <= r.bottom + R
				);
			});
		};
		const onLeave = () => {
			if (raf) {
				window.cancelAnimationFrame(raf);
				raf = 0;
			}
			set(false);
		};
		// Hover-reveal also opens mid-list (the pinned-open effect only
		// covers wpOpen): a fresh hover lands on the middle option, while
		// a user-placed scroll and keyboard browsing are left alone.
		const midOnEnter = () => {
			const menuEl = el.querySelector(".wp-menu");
			if (!(menuEl instanceof HTMLElement) || menuEl.scrollTop > 0) return;
			if (menuEl.contains(document.activeElement)) return;
			const items = menuEl.querySelectorAll('button[role="menuitem"]');
			const mid = items.item(Math.floor((items.length - 1) / 2));
			if (mid instanceof HTMLElement) mid.scrollIntoView({ block: "nearest" });
		};
		el.addEventListener("mouseenter", midOnEnter);
		window.addEventListener("mousemove", onMove, { passive: true });
		document.documentElement.addEventListener("mouseleave", onLeave);
		return () => {
			el.removeEventListener("mouseenter", midOnEnter);
			window.removeEventListener("mousemove", onMove);
			document.documentElement.removeEventListener("mouseleave", onLeave);
			if (raf) window.cancelAnimationFrame(raf);
		};
	});
	/** Keyboard cursor over the sidebar chat list (-1 = follow mouse). */
	let sideIdx = -1;
	/** Sidebar chat-list filter text (mobile swipe opens the list on it). */
	let sideSearch = $state("");
	/** Sidebar search input (tapping it focuses with the keyboard up). */
	let sideSearchEl: HTMLInputElement | undefined = $state();
	/** Last lone "g" timestamp (gg hops to the top of history). */
	let lastGAt = 0;
	/**
	 * Escape keydown timestamp for the exit-fullscreen chord: F while
	 * Escape is held exits fullscreen (Escape alone never does). 0
	 * when no press is held.
	 */
	let escDownAt = 0;
	/**
	 * Command palette (Ctrl+P / Cmd+P): full-text search across chats
	 * and annotations. Null when closed.
	 */
	let palette = $state<PaletteState>(emptyPalette());
	let searchInputEl: HTMLInputElement | undefined = $state();
	let searchResultsEl: HTMLElement | undefined = $state();
	/** Search documents snapshot (Worker + IndexedDB, in-memory fallback). */
	let searchStore: ChatSearchStore | null = null;
	let searchIndexTimer: ReturnType<typeof setTimeout> | null = null;
	let searchQueryTimer: ReturnType<typeof setTimeout> | null = null;
	let editingId: AnnotationId | null = $state(null);
	let editDraft = $state("");
	/**
	 * Mobile in-prompt annotation edit: the composer holds the comment
	 * (the transplanted popover textbox can't reliably summon the
	 * phone keyboard), the send arrow files it, tapping out cancels.
	 * Desktop never sets this — popover and review textarea stay. The
	 * stash restores the drafted chat text on file and on cancel.
	 */
	let promptAnnEdit: { id: string } | { pending: true } | null = $state(null);
	let promptAnnStash = $state("");
	/**
	 * Click-toggled overlays (desktop has no hover-open anywhere):
	 * the sent-refs card opens per message (one at a time), the
	 * composer review rides reviewOpen. Pills are plain disclosure
	 * buttons — Enter/Space toggle like a click.
	 */
	let refsPopOpen: ChatMsgId | null = $state(null);
	/**
	 * Previous-menu row under note edit (desktop only — phones have no
	 * row pencil): message plus ref number, null when browsing. One
	 * card opens at a time (see refsPopOpen), so one edit slots in.
	 */
	let refsEditing: { messageId: ChatMsgId; n: number } | null = $state(null);
	let refsEditDraft = $state("");
	let refsEditBox: HTMLInputElement | null = $state(null);
	/** Destination mark-flash timer: re-jumps restart it, expiry
	releases the highlight (self-clearing — no chat-switch hook to
	forget). Jumps flash marks only, never layered with a Highlight
	wash twin. */
	let stopJumpFlash: (() => void) | null = null;
	/** Sent-row blink: the pressed row flashes like a draft row (same
	phases), so the press reads even where the highlight wash can't
	paint. Keyed by message + number, not id — baked refs have none. */
	let refsBlink: { messageId: ChatMsgId; n: number } | null = $state(null);
	let stopRefsBlink: (() => void) | null = null;
	/** Own message under in-place edit (null when no edit is open).
	Enter saves + resends; Alt+Enter saves without resending; Esc cancels. */
	let editingMsgId: ChatMsgId | null = $state(null);
	/** In-place editor handle (null unless an own-message edit is mounted). */
	let msgEditor: PromptEditor | null = null;
	/** Seed text for the in-place editor (prose plus image-marker lines). */
	let editingSeed = $state("");
	/** Attachments of the message under edit (the composer's own stay untouched). */
	let editingAttachments = $state<Attachment[]>([]);
	/** Last reconciled marker counts inside the in-place editor (images, files, pastes). */
	let editingPrevMarkers = 0;
	let editingPrevFileMarkers = 0;
	let editingPrevPasted = 0;
	/** Programmatic inline edits must not reconcile against themselves. */
	let editingMarkerMuted = false;
	let highlightAnnId: AnnotationId | null = $state(null);
	/** Badge currently hovered (paints its quote wash as a preview). */
	let hoverBadgeId: string | null = $state(null);
	/** Cursor-anchored annotation pill (ChatGPT-style). Null when closed. */
	let annPop = $state<{
		id: string;
		x: number;
		y: number;
		fresh: boolean;
	} | null>(null);
	/** Answer popup (the remodel): open answer read in context. Null
	when closed; the card self-heals (renders nothing) if its
	annotation is deleted or sent while open. */
	let answerPop = $state<{
		id: AnnotationId;
		x: number;
		y: number;
		w: number;
	} | null>(null);
	/** Last badge a mousedown press opened (or toggled): its trailing
	click re-fire is the same gesture, never a new one. Plain field —
	only the handlers below touch it, never the template. */
	let lastBadgePress: { id: AnnotationId; at: number } | null = null;
	/** Pill fade-out in flight (unmounts when the ramp ends). */
	let annPopClosing = $state(false);
	let annPopTimer: ReturnType<typeof setTimeout> | null = null;
	let annDraft = $state("");
	let annPopBox: HTMLTextAreaElement | undefined = $state();
	/**
	 * The Enter that saves an annotation must never double as a send.
	 * Any pointer press in between proves a distinct gesture, so it
	 * clears the window (see the pointerdown listener below): without
	 * this, a fast file-then-send (or its e2e) lands inside the 500ms
	 * window and the send is silently eaten.
	 */
	let sendGuardUntil = 0;
	/**
	 * Last pointerdown inside the composer (any button, field, or floor),
	 * as a timestamp. WebKit (the Tauri shell) doesn't move focus to
	 * buttons on press, so the editor blurs to nowhere (relatedTarget
	 * null) instead of onto the button — see onFocusOutIdle, which
	 * reads this to tell a still-in-flight control press from a real
	 * departure. Plain timestamp, never state: no render may hinge on it.
	 */
	let promptPressAt = 0;
	let selMenu = $state<{
		x: number;
		y: number;
		/** Highlight rect (viewport px): centers the create box when narrow. */
		left: number;
		w: number;
		quote: string;
		/** Containing paragraph text: the single-char guess reads it for kana. */
		context: string;
		messageId: ChatMsgId;
		/** Live range at summon time: menu hover puts the highlight
		back when WebKit empties it (no DOM change, so still valid). */
		range: Range | null;
	} | null>(null);
	/**
	 * Selection readings overlay: right-clicking a highlight that
	 * contains Han shows readings for just the highlight. The
	 * Japanese side renders one panel per back-to-back kanji group:
	 * furigana only, colors cycling continuously across the
	 * highlight — never kanji, never kana. A lone single-run popup
	 * renders plain. The selected kanji glow in their popup color
	 * in the document (unwrapped on dismiss). Pinyin stays one flat
	 * string. Read-only
	 * and pointer-transparent, so nothing disturbs the highlight —
	 * and the highlight clearing dismisses everything at once via
	 * selectionchange below.
	 */
	let selPinyin = $state<{
		x: number;
		y: number;
		above: boolean;
		quote: string;
		messageId: ChatMsgId;
		html: string;
	} | null>(null);
	/** One furigana panel: a single back-to-back kanji group's
	readings, anchored to that group's screen rect. `plain` is the
	lone single-run highlight: with nothing to disambiguate it
	renders in ink with no document tint. */
	interface FuriganaPanel {
		x: number;
		y: number;
		above: boolean;
		quote: string;
		messageId: ChatMsgId;
		runs: GroupedRun[];
		plain: boolean;
	}
	let selFurigana = $state<FuriganaPanel[] | null>(null);
	/** Drop every selection overlay at once: the flat panel, the
	furigana panels, and the document tint. Every dismiss site below
	uses this — a bare selPinyin clear would strand tinted kanji. */
	function dismissSelPanels(): void {
		selPinyin = null;
		selFurigana = null;
		unwrapFuriganaTint();
	}
	/**
	 * An unanswered selection menu never lingers (clicking away still
	 * dismisses instantly). Desktop gives a 6s idle window, and any
	 * pointer activity inside it re-arms: an aimer steering toward
	 * Annotate must never race the dismiss. Touch holds it while the
	 * highlight is live instead (no hover there): a thumb takes
	 * longer to reach than a cursor.
	 */
	const SEL_MENU_IDLE_MS = 6000;
	let selMenuTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * True while the pointer hovers the selection menu: the auto-dismiss
	 * timer stands down, so moving the mouse from the highlight to the
	 * Annotate button never cancels it. Leaving re-arms the timer.
	 */
	let selMenuHover = $state(false);
	$effect(() => {
		if (!selMenu) {
			selMenuHover = false;
			return;
		}
		if (selMenuHover) return;
		if (selMenuTimer) clearTimeout(selMenuTimer);
		// Phones: the dock tracks the native bubble — while a highlight
		// is live the bubble is up, so hold the dock past the timer
		// (like a held press holds the action row). Collapsing the
		// selection still clears it at once via selectionchange below.
		const arm = (): void => {
			selMenuTimer = setTimeout(
				() => {
					selMenuTimer = null;
					// Engaged hands hold the menu: pointer activity (stamped
					// by the shared activity listener) inside the window
					// re-arms instead of dismissing.
					if (
						selMenuIdleDecision({
							android: androidUI,
							selectionLive:
								(window.getSelection()?.toString() ?? "") !== "",
							hover: selMenuHover,
							lastInputAt,
							now: Date.now(),
							idleMs: SEL_MENU_IDLE_MS
						}) === "rearm"
					) {
						arm();
						return;
					}
					selMenu = null;
				},
				androidUI ? 4500 : SEL_MENU_IDLE_MS
			);
		};
		arm();
		return () => {
			if (selMenuTimer) {
				clearTimeout(selMenuTimer);
				selMenuTimer = null;
			}
		};
	});
	/**
	 * Right-edge truth: the placement estimate can't know the real
	 * button widths (fonts, zoom), so after paint pull the menu back
	 * on screen by its measured width. One-shot per placement — the
	 * corrected x never re-triggers it.
	 */
	$effect(() => {
		const menu = selMenu;
		const el = selMenuEl;
		if (!menu || !el) return;
		// Phones ride the selection's middle by measured width (the
		// placement estimate is deliberately wide), clamped on screen;
		// desktop pulls the estimate back on screen. Settled values
		// never re-trigger this.
		const x = correctSelMenuX(
			menu,
			el.offsetWidth,
			window.innerWidth,
			androidUI && !iosUI
		);
		if (x !== null) selMenu = { ...menu, x };
	});
	/**
	 * Last press that began inside the selection menu: whatever
	 * selection churn follows belongs to the menu (button taps collapse
	 * the highlight on release), so the selectionchange auto-dismiss
	 * below stands down for it. Annotate runs off the stored quote.
	 */
	let menuPressAt = 0;
	function noteMenuPress(): void {
		menuPressAt = Date.now();
	}
	/**
	 * Selection-menu open stamp: the rescue in the selectionchange
	 * auto-dismiss below puts the stored range back while NEITHER a
	 * press/key NOR a programmatic clear landed since the menu
	 * opened. lastPressAt covers pointerdown AND keydown, and the
	 * summoning drag's own press predates the open — so the rescue
	 * fires exactly for press-less engine clears (the pointer
	 * cruising other messages, the menu's own shadow), while
	 * click-away, new drags, arrow-collapses, and Escape all stamp
	 * newer and keep dismissing. Same-millisecond ties read as the
	 * summoning gesture, never as a newer press.
	 */
	let selMenuOpenedAt = 0;
	/** Last clearSelection() call: programmatic clears dismiss, engine
	hover-clears rescue (see above). Every caller also drops the menu,
	so this is belt-and-braces for future paths. */
	let lastProgrammaticClearAt = 0;
	/** The floating menu element: its measured width pulls the
	estimated x back on screen (see the effect below). */
	let selMenuEl: HTMLElement | null = $state(null);
	/**
	 * Swap-vs-press discrimination for the selectionchange
	 * auto-dismiss below. Message bodies swap their HTML under a live
	 * highlight (Shiki late-enhance, aid rebuilds, stream chunks):
	 * WebKit fires selectionchange for the collapse this causes
	 * (Chromium stays silent), and the collapsed-attached shape reads
	 * exactly like a genuine clear. A MutationObserver stamps every
	 * structural/text swap; presses stamp separately. A collapse newer
	 * than the last press is the swap's, so the menu stands on its
	 * stored quote — genuine clears always arrive on a press (pointer
	 * travel and hovers stamp nothing) and still dismiss.
	 */
	let lastBodySwapAt = 0;
	let lastPressAt = 0;
	let swapObserverOn = false;
	function ensureSwapObserver(): void {
		if (swapObserverOn) return;
		const root = document.querySelector(".messages");
		if (!root) return;
		swapObserverOn = true;
		const observer = new MutationObserver(() => {
			lastBodySwapAt = Date.now();
		});
		observer.observe(root, {
			childList: true,
			subtree: true,
			characterData: true
		});
	}
	$effect(() => {
		// Boot shell stand-down: the static loading token in app.html
		// paints with the first frame on cold start; the live app
		// replaces it now (long before, on warm starts).
		document.getElementById("boot-shell")?.remove();
		ensureSwapObserver();
		const stampPress = (): void => {
			lastPressAt = Date.now();
		};
		// Foreground return: the user sees the finished reply, so its
		// ping and badge stand down instead of lingering in the shade.
		// Native turns reconcile here too — files finished while
		// suspended render now, dead ones mark interrupted.
		const onVisible = (): void => {
			if (document.visibilityState !== "visible") {
				// Leaving with a live native turn: one quiet tick that
				// the reply keeps working — the shade notice itself is
				// silent by design. Honors the haptics toggle.
				if (nativeTurns.size > 0) {
					void hapticBeatAsync("tap", {
						enabled: settings.hapticsEnabled,
						shell: tauriBackendAvailable()
					});
				}
				return;
			}
			clearStudyBadge();
			void dismissReplyNotificationAsync({
				shell: tauriBackendAvailable()
			});
			void reconcileNativeTurns();
		};
		// Native turn events (Android shell): token stream, fetch phase,
		// retry resets, and completion. Suspension-safe by design —
		// anything missed lands through the return/boot scan instead.
		const turnUnlistens: UnlistenFn[] = [];
		if (tauriBackendAvailable()) {
			void listen<TurnTokenEvent>("turn-token", (event) =>
				onNativeToken(event.payload)
			).then((off) => turnUnlistens.push(off));
			void listen<TurnFetchEvent>("turn-fetch", (event) =>
				onNativeFetch(event.payload)
			).then((off) => turnUnlistens.push(off));
			void listen<TurnTokenEvent>("turn-retry", (event) =>
				onNativeRetry(event.payload)
			).then((off) => turnUnlistens.push(off));
			void listen<TurnDoneEvent>("turn-done", (event) => {
				void onNativeDone(event.payload);
			}).then((off) => turnUnlistens.push(off));
		}
		window.addEventListener("pointerdown", stampPress, { passive: true });
		window.addEventListener("keydown", stampPress);
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("touchstart", trackAnnTouchStart, {
			passive: true
		});
		window.addEventListener("touchmove", trackAnnTouchMove, {
			passive: true
		});
		// Fresh boot after a kill never fires visibilitychange (it
		// starts visible), so reconcile on mount too — a turn that
		// died with the process restarts here (dots again, reply
		// completes) instead of stranding its placeholder.
		void reconcileNativeTurns();
		return () => {
			window.removeEventListener("pointerdown", stampPress);
			window.removeEventListener("keydown", stampPress);
			document.removeEventListener("visibilitychange", onVisible);
			for (const off of turnUnlistens.splice(0)) {
				try {
					off();
				} catch {
					// Already unlistened; shutdown is best-effort.
				}
			}
			window.removeEventListener("touchstart", trackAnnTouchStart);
			window.removeEventListener("touchmove", trackAnnTouchMove);
		};
	});
	/**
	 * Scroll-stroke tracking for the annotation pill: a scroll blurs
	 * its textbox exactly like a tap-away does, but only a real
	 * tap-away (which also dismisses the phone keyboard) may cancel
	 * or save — scrolling around keeps the draft as left.
	 */
	let annTouchStart: { x: number; y: number } | null = null;
	let lastAnnScrollAt = 0;
	function trackAnnTouchStart(event: TouchEvent): void {
		const t = event.changedTouches[0];
		annTouchStart = t ? { x: t.clientX, y: t.clientY } : null;
	}
	function trackAnnTouchMove(event: TouchEvent): void {
		const t = event.changedTouches[0];
		const s = annTouchStart;
		if (!t || !s) return;
		if (touchPastSlop(s.x, s.y, t.clientX, t.clientY, 12)) {
			lastAnnScrollAt = Date.now();
		}
	}
	let menuBtnTouchStart: { x: number; y: number } | null = null;
	/** Selection-menu drag: touch anchor plus the menu spot it
	started from; a drag past the tap slop moves the menu instead of
	tapping (the button drift guard below eats the post-drag tap). */
	let selMenuDrag: { mx: number; my: number; x0: number; y0: number } | null =
		null;
	/** A menu drag is in flight: programmatic hops glide, but the
	finger's own stroke must stay 1:1 (see .sel-menu transition). */
	let selMenuDragging = $state(false);
	let menuDragSuppressAt = 0;
	function menuDragStart(event: TouchEvent): void {
		const t = event.changedTouches[0];
		if (!t || !selMenu) return;
		selMenuDrag = { mx: t.clientX, my: t.clientY, x0: selMenu.x, y0: selMenu.y };
		selMenuDragging = true;
	}
	function menuDragMove(event: TouchEvent): void {
		const drag = selMenuDrag;
		const t = event.changedTouches[0];
		if (!drag || !t || !selMenu) return;
		const dx = t.clientX - drag.mx;
		const dy = t.clientY - drag.my;
		if (!touchPastSlop(drag.mx, drag.my, t.clientX, t.clientY, 12)) return;
		menuDragSuppressAt = Date.now();
		const at = clampMenuDrag(
			drag.x0 + dx,
			drag.y0 + dy,
			window.innerWidth,
			window.innerHeight
		);
		selMenu = { ...selMenu, x: at.x, y: at.y };
	}
	function menuDragEnd(): void {
		selMenuDrag = null;
		selMenuDragging = false;
	}
	function noteMenuBtnTouch(event: TouchEvent): void {
		const t = event.changedTouches[0];
		menuBtnTouchStart = t ? { x: t.clientX, y: t.clientY } : null;
		menuPressAt = Date.now();
	}
	/**
	 * Touch activation for menu buttons: a tap that starts near a
	 * selection handle is swallowed as a handle nudge (the handle
	 * blinks, no click ever arrives), so waiting for onclick strands
	 * the button. Run off touchend instead; preventDefault eats the
	 * compat mouse sequence. Mouse and keyboard keep onclick.
	 */
	function menuBtnTouch(event: TouchEvent, run: () => void): void {
		// A menu drag just ended here: the button's own drift guard
		// already ate the tap, and this eats any synthesized sequel.
		if (Date.now() - menuDragSuppressAt < 750) return;
		const t = event.changedTouches[0];
		const start = menuBtnTouchStart;
		menuBtnTouchStart = null;
		menuPressAt = Date.now();
		if (!t || !start) return;
		if (touchPastSlop(start.x, start.y, t.clientX, t.clientY, 14)) return;
		event.preventDefault();
		run();
	}
	function annotateTouch(event: TouchEvent): void {
		menuBtnTouch(event, annotate);
	}
	function speakTouch(event: TouchEvent): void {
		menuBtnTouch(event, () => void speakSelection());
	}
	function copyTouch(event: TouchEvent): void {
		menuBtnTouch(event, () => void copySelection());
	}
	/** Selection Speak: read the highlight aloud, showing CJK readings
	in the popup above it — pinyin in Chinese text, furigana in
	Japanese. Speech always runs; the popup is a silent extra. On
	phones the menu rises above the popup (see
	liftSelMenuAboveReadings) so Annotate stays one tap away. */
	async function speakSelection(): Promise<void> {
		if (!selMenu) return;
		const menu = selMenu;
		buzzTap();
		// Japanese kanji speak their sentence reading, never the raw
		// fragment (right-click parity): になる美 alone converts to
		// になるうつくしい — the bare quote would read 美 as ビ with
		// no sentence to correct it. showSelectionFurigana also shows
		// the popup, so this path skips popupSelectionReadings.
		const probe = sentenceForQuote(menu.context, menu.quote) ?? menu.context;
		if (
			[...menu.quote].some((ch) => isHanChar(ch)) &&
			hanOverlayLangFor(probe) === "ja"
		) {
			const kana = await showSelectionFurigana({
				quote: menu.quote,
				messageId: menu.messageId
			});
			void speakQuote(kana ?? menu.quote, menu.messageId, true, menu.context);
			if (androidUI) liftSelMenuAboveReadings();
			return;
		}
		void popupSelectionReadings(
			menu.quote,
			menu.messageId,
			menu.context
		).then(() => {
			if (androidUI) liftSelMenuAboveReadings();
		});
		void speakQuote(menu.quote, menu.messageId, true, menu.context);
	}
	/**
	 * Rise the selection menu above the readings panels a speak tap
	 * just opened — Chinese pinyin or Japanese furigana (every panel
	 * shares .sel-pinyin; furigana renders one per kanji group). The
	 * panels hang over the highlight's top edge, so the menu's old
	 * spot would cover them. Measures every above-panel live and
	 * clears the topmost; only ever moves up (no headroom above the
	 * top panel, or every popup falling below for lack of it, keeps
	 * the menu where placeSelMenu put it). The hop glides (see
	 * .sel-menu transition); a drag in flight stays 1:1.
	 */
	function liftSelMenuAboveReadings(): void {
		if (!androidUI || !selMenu) return;
		if (!selPinyin?.above && !selFurigana?.some((panel) => panel.above))
			return;
		requestAnimationFrame(() => {
			const tops: number[] = [];
			document.querySelectorAll(".sel-pinyin.above").forEach((el) => {
				if (el instanceof HTMLElement)
					tops.push(el.getBoundingClientRect().top);
			});
			const menu = selMenuEl;
			const current = selMenu;
			if (!(menu instanceof HTMLElement) || !current || tops.length === 0)
				return;
			const mr = menu.getBoundingClientRect();
			if (mr.width === 0 || mr.height === 0) return;
			const y = menuYAbovePanel(Math.min(...tops), mr.height);
			if (y < current.y) selMenu = { ...current, y };
		});
	}
	/** Dock the readings overlay centered on the highlight span
	(pure math in readingPanelPlacement): above with headroom, else
	below — on phones the menu rises above an above-panel instead
	of owning the above slot (see liftSelMenuAboveReadings).
	Centering rides CSS translateX so panel width — and font size —
	never matters: the style left IS the highlight's center
	(rect.left would park the panel half its width too far left).
	A frame later the true width clamps it exactly into the
	viewport. The above branch anchors on the highlight's top edge
	the same way, so tall readings never need measuring. */
	function panelXY(rect: {
		left: number;
		top: number;
		bottom: number;
		width: number;
		height: number;
	}): {
		x: number;
		y: number;
		above: boolean;
	} {
		return readingPanelPlacement({
			rect,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight
		});
	}
	/** Nudge every readings panel back inside by its true width
	(the placement pass only knows the highlight center): same
	correction placeSelPinyin runs for the flat panel, mapped by
	order — at settle the nodes ARE the panels in order (the flat
	panel is null while groups are up, and vice versa). A
	mismatch skips instead of shuffling panels. */
	function correctPanelWidths(
		current: { x: number; y: number }[],
		apply: (xs: number[]) => void
	): void {
		requestAnimationFrame(() => {
			const nodes = [...document.querySelectorAll(".sel-pinyin")];
			if (nodes.length !== current.length) return;
			let moved = false;
			const xs = current.map((panel, i) => {
				const node = nodes[i];
				if (!(node instanceof HTMLElement)) return panel.x;
				// Narrow scrunched glass to its longest line first:
				// the clamp below then guards text, not empty slab.
				const w = shrinkPanelToContent(node);
				if (w === 0) return panel.x;
				const x = clampPanelCenterX(panel.x, w, window.innerWidth);
				if (panelCenterMoved(x, panel.x)) moved = true;
				return x;
			});
			if (moved) apply(xs);
		});
	}
	function placeSelPinyin(
		quoted: { quote: string; messageId: ChatMsgId },
		html: string
	): void {
		const live = window.getSelection();
		const rect = live?.rangeCount
			? live.getRangeAt(0).getBoundingClientRect()
			: null;
		if (!rect) return;
		selPinyin = {
			...panelXY(rect),
			quote: quoted.quote,
			messageId: quoted.messageId,
			html
		};
		requestAnimationFrame(() => {
			const node = document.querySelector(".sel-pinyin");
			const current = window.getSelection();
			const now = current?.rangeCount
				? current.getRangeAt(0).getBoundingClientRect()
				: null;
			if (!node || !now || !selPinyin) return;
			// Same highlight still live (not scrolled or changed)?
			if (!highlightSteady(now, rect)) return;
			const w = shrinkPanelToContent(node);
			const x = clampPanelCenterX(
				now.left + now.width / 2,
				w,
				window.innerWidth
			);
			if (panelCenterMoved(x, selPinyin.x)) selPinyin = { ...selPinyin, x };
		});
	}
	/**
	 * Japanese side of the overlay: furigana for just the highlight,
	 * converted from the whole sentence (worker) so readings match
	 * the context — an isolated kanji converts to its default, not
	 * its sentence reading. One panel per back-to-back kanji group,
	 * furigana only, anchored to its group; the selected kanji glow
	 * in their popup color. Returns the highlight's kana (readings +
	 * kana in order) for speech, or null when nothing showed. The
	 * pending mark lands at once — the dictionary load behind a cold
	 * worker takes seconds, and a silent wait reads as a dead click.
	 * Stale right-clicks never fill it: a moved-on highlight drops
	 * the result instead of showing it.
	 */
	async function showSelectionFurigana(quoted: {
		quote: string;
		messageId: ChatMsgId;
	}): Promise<string | null> {
		dismissSelPanels();
		placeSelPinyin(quoted, "…");
		const live = currentQuote();
		const context =
			live && live.messageId === quoted.messageId && live.quote === quoted.quote
				? live.context
				: quoted.quote;
		// Convert the sentence, slice the highlight: isolated text
		// misreads (生 alone is せい, in 生まれる it is う).
		const sentence = sentenceForQuote(context, quoted.quote) ?? quoted.quote;
		let html: string;
		try {
			html = await furiganaHtml(sentence, "furigana");
		} catch {
			html = "";
		}
		const now = currentQuote();
		if (
			!now ||
			now.messageId !== quoted.messageId ||
			now.quote !== quoted.quote
		)
			return null;
		const sentRuns = annotatedRunsWithOffsets(html);
		if (!sentRuns) {
			if (selPinyin?.quote === quoted.quote) selPinyin = null;
			return null;
		}
		const plain = sentRuns.map((run) => run.text).join("");
		// Slice the selected instance, not the first: a repeated word
		// (夜 picked from 夜間…夜) reads its own span's tokens, like
		// speech does. Unresolvable keeps the historical first match.
		let qStart: number | null = null;
		try {
			const liveSel = window.getSelection();
			const anchor =
				liveSel?.anchorNode instanceof Element
					? liveSel.anchorNode
					: liveSel?.anchorNode?.parentElement;
			const block = anchor?.closest("p, li");
			if (block && liveSel && liveSel.rangeCount > 0) {
				const range = liveSel.getRangeAt(0);
				const at = caretOffsetInBlock(
					block,
					range.startContainer,
					range.startOffset
				);
				const blockText = block.textContent ?? "";
				qStart = quoteStartForContext(
					plain,
					quoted.quote,
					blockText.slice(Math.max(0, at - 24), at)
				);
			}
		} catch {
			// Document moved under the highlight: first match below.
		}
		const sliced = sliceRunsForQuote(sentRuns, plain, quoted.quote, qStart);
		if (!sliced) {
			if (selPinyin?.quote === quoted.quote) selPinyin = null;
			return null;
		}
		const grouped = groupRuns(sliced);
		if (grouped.length === 0) {
			if (selPinyin?.quote === quoted.quote) selPinyin = null;
			return null;
		}
		// Anchor each group to its own screen span and tint the
		// document kanji; a failed walk keeps the single highlight
		// rect for every panel rather than stranding the popup.
		const selection = window.getSelection();
		const range =
			selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		const highlightRect = range?.getBoundingClientRect() ?? null;
		const slices = range ? selectionSlices(range) : null;
		// The live range can carry whitespace the trimmed quote
		// drops (drag handles): locate the quote inside the walked
		// text and shift spans onto it, or fall back to the single
		// highlight rect.
		const walkText = slices
			? slices
					.map((s) => (s.node.textContent ?? "").slice(s.start, s.end))
					.join("")
			: "";
		const qi = slices ? walkText.indexOf(quoted.quote) : -1;
		const exact = slices !== null && qi >= 0;
		const byGroup: GroupedRun[][] = [];
		for (const run of grouped) {
			const list = byGroup[run.group];
			if (list) list.push(run);
			else byGroup[run.group] = [run];
		}
		const panels: FuriganaPanel[] = [];
		const tintSpans: { start: number; end: number; color: number }[] = [];
		// Lone single-run highlight: one popup, one reading, nothing
		// to disambiguate — it renders plain with no document tint.
		const solo = grouped.length === 1;
		for (const runs of byGroup) {
			if (!runs) continue;
			const start = Math.min(...runs.map((run) => run.start)) + qi;
			const end = Math.max(...runs.map((run) => run.end)) + qi;
			const rect = exact ? spanRect(slices ?? [], start, end) : null;
			const anchor = rect ?? highlightRect;
			if (!anchor) {
				dismissSelPanels();
				return null;
			}
			panels.push({
				...panelXY(anchor),
				quote: quoted.quote,
				messageId: quoted.messageId,
				runs,
				plain: solo
			});
			if (solo) continue;
			for (const run of runs) {
				tintSpans.push({
					start: run.start + qi,
					end: run.end + qi,
					color: run.color
				});
			}
		}
		if (exact && slices && !solo) tintSelectionSpans(slices, tintSpans);
		selPinyin = null;
		selFurigana = panels;
		// True-width pass: placement only knows highlight centers,
		// so a wide panel near the right edge hangs off-screen —
		// nudge each back inside without collapsing them onto one x.
		correctPanelWidths(panels, (xs) => {
			if (selFurigana !== panels) return;
			selFurigana = panels.map((panel, i) => ({
				...panel,
				x: xs[i] ?? panel.x
			}));
		});
		// Speech says exactly the highlight: slice readings joined,
		// shedding an all-kana tail when the highlight ends inside a
		// run (心地 from 心地よい speaks ここち), never crossing a
		// run boundary (味覚が speaks みかく, no particle). Popup
		// ruby and tints stay on the highlight itself.
		return speechKanaForQuote(sentRuns, plain, quoted.quote, qStart);
	}
	/**
	 * Readings for a highlight in the popup by the selection (see
	 * speakSelection): sync pinyin, worker furigana. Long readings
	 * stay off the popup; a moved-on highlight drops the async
	 * result instead of showing it.
	 */
	async function popupSelectionReadings(
		quote: string,
		messageId: ChatMsgId,
		context: string
	): Promise<void> {
		const probe = sentenceForQuote(context, quote) ?? context;
		if (hanOverlayLangFor(probe) !== "ja") {
			if (!offeredLocalAids(quote, activeReplyCode).includes("pinyin")) return;
			const readings = readingsOnly(pinyinRuby(quote), " ", "rt");
			if (readings && readings.length <= 140)
				placeSelPinyin({ quote, messageId }, readings);
			return;
		}
		await showSelectionFurigana({ quote, messageId });
	}
	/** Selection Copy: the quote to the clipboard with a light tick.
	The native menu is suppressed on Android, so this replaces its
	Copy entry. */
	async function copySelection(): Promise<void> {
		const quote = selMenu?.quote ?? "";
		if (quote === "") return;
		buzzTap();
		if (!navigator.clipboard) {
			flashErrorToast("Couldn't copy to the clipboard.");
			return;
		}
		try {
			await navigator.clipboard.writeText(quote);
			flashCopyToast("Copied");
		} catch {
			flashErrorToast("Couldn't copy to the clipboard.");
		}
	}
	function inspectTouch(event: TouchEvent): void {
		menuBtnTouch(event, openInspect);
	}
	let vocalized = $state<Record<string, string>>({});
	let vocalizing = new SvelteSet<string>();
	/** Aid runs clicked mid-flight that must pin on completion. */
	let pendingPin = new SvelteSet<string>();
	/** Messages whose aid is pinned on (model-aid text or local ruby). */
	let aidPin = new SvelteSet<string>();
	/**
	 * Local aids pinned per message (model pins set no kinds). Each kind
	 * renders only its own lines, so furigana and pinyin pin
	 * independently and both stay up together on mixed messages. Model
	 * aids (tashkeel) compose with them instead of replacing them.
	 */
	let aidKindPin = new SvelteMap<string, LocalAid[]>();
	/** Messages with the model aid (tashkeel) pinned: its vocalized
	text shows while pinned local kinds render onto it. */
	let aidModelPin = new SvelteSet<string>();
	/** Pinned local kinds for a message (never a live reference). */
	function pinnedKinds(id: string): LocalAid[] {
		return aidKindPin.get(id) ?? [];
	}
	/** Messages whose local aid (furigana dictionary) is loading right now. */
	let aidBusy = new SvelteSet<string>();
	/** Message currently hover-previewing its aid (null when none). */
	let aidPeek = $state<{ id: string; kind?: LocalAid } | null>(null);
	/**
	 * Peek lock: clicking swaps the button under a stationary cursor, and the
	 * browser re-fires mouseenter for the swap — without this, unpinning
	 * would instantly re-preview. Cleared by a genuine mouse leave, so the
	 * next enter is a real hover and may peek a loaded aid.
	 */
	let aidNoPeek = new SvelteSet<string>();
	/**
	 * Local aids clicked at least once, per message and kind. The first
	 * hover of an aid button is color-only; only after that kind was
	 * clicked (pinned) may its hovers preview the readings — pinning
	 * furigana must never unlock pinyin's hover.
	 */
	let aidSeen = new SvelteSet<string>();
	/** Preview-unlock key for one message's local-aid kind. */
	function aidSeenKey(id: string, kind: LocalAid): string {
		return `${id}:${kind}`;
	}
	/** Unified notice queue: inline/banner/voice/toast replace the five one-off flags. */
	let notices = $state(emptyNotices());
	let speakingId: string | null = $state(null);
	/** Message a speak-aloud selection came from (tints its selection). */
	let speakingSelection: string | null = $state(null);
	/** Screen wake lock held while read-aloud/TTS plays (study sessions). */
	let studyWakeLock: WakeLockRelease | null = null;
	/** Release the read-aloud wake lock (stop, natural end, teardown). */
	function releaseStudyWake(): void {
		releaseStudyWakeLock(studyWakeLock);
		studyWakeLock = null;
	}
	let canMic = $state(false);
	let dictating = $state(false);
	/** Transient top toast (copy confirmations, readings, saved notes).
	Rendering and tap/copy behavior live in `Toasts.svelte`; the page
	keeps these flash wrappers for its call sites. */
	/** Tap action armed on the current toast generation (reply-ready
	navigation): bound into `Toasts`, which runs it instead of
	copying. The generation pins the lifetime — an expired toast
	never fires a stale action. */
	let toastAction = $state<{ seq: number; run: () => void } | null>(null);
	function flashToast(message: string, action?: () => void): void {
		flashNotice(notices, "toast", message, toastTimeoutFor(message));
		toastAction = action ? { seq: notices.toast.seq, run: action } : null;
	}
	function dismissToast(): void {
		clearNotice(notices, "toast");
	}
	/** Transient top error toast: action failures (send errors, export,
	attach, mic) render in the red pairing, themed both ways. */
	function flashErrorToast(message: string): void {
		flashNotice(
			notices,
			"errorToast",
			message,
			errorToastTimeoutFor(message)
		);
	}
	let stopDictation: (() => void) | null = null;
	let openLangMenu: LanguageMenu["id"] | null = $state(null);
	/* Phone sheet anchor: the open list escapes the thread scroller
	(fixed, centered on the screen) because inside .messages
	anything past its box clips — Europe's 20-item list read as
	five languages cut by a rectangle. Null on desktop, which
	keeps the in-flow upward list. top:50% plus translateY centers
	the shrink-wrapped sheet (see .lang-list-fixed). */
	let langMenuAnchor: LangMenuAnchor | null = $state(null);
	function toggleLangMenu(id: LanguageMenu["id"], btn: HTMLElement): void {
		// Family open/close ticks on phones (buzzTap self-gates to
		// Android and honors the haptics toggle).
		buzzTap();
		if (openLangMenu === id) {
			openLangMenu = null;
			return;
		}
		openLangMenu = id;
		if (!androidUI) {
			langMenuAnchor = null;
			return;
		}
		const r = btn.getBoundingClientRect();
		const composerTop =
			promptEl?.getBoundingClientRect().top ?? window.innerHeight;
		// Smart anchor geometry lives in languages (pure, tested);
		// only the DOM reads stay here.
		const menu = LANGUAGE_MENUS.find((m) => m.id === id);
		langMenuAnchor = langMenuAnchorFor({
			btnLeft: r.left,
			btnBottom: r.bottom,
			composerTop,
			viewportWidth: window.innerWidth,
			itemCount: menu?.languages.length ?? 8
		});
	}
	$effect(() => {
		if (!openLangMenu) langMenuAnchor = null;
	});
	/* A fitted box goes stale on any geometry change (rotation,
	keyboard glide): phones close it instead of wearing a
	mis-anchored sheet. Desktop keeps its in-flow list. */
	$effect(() => {
		if (!androidUI || !openLangMenu) return;
		const close = (): void => {
			openLangMenu = null;
		};
		window.addEventListener("resize", close);
		return () => window.removeEventListener("resize", close);
	});
	const activeReplyCode = $derived(
		chatState.chats.find((c) => c.id === chatState.activeChatId)?.replyLang ??
			null
	);
	const activeReplyLang = $derived(
		activeReplyCode ? replyLanguageFor(activeReplyCode) : null
	);
	let settingsOpen = $state(false);
	/**
	 * Opening/closing settings shifts layout under a stationary cursor,
	 * leaving a stale pointer behind (browsers refresh the cursor on
	 * mousemove, not on our width transition). A one-frame
	 * pointer-events pulse forces a re-hit-test so the cursor matches
	 * whatever is actually underneath now.
	 */
	function pulseCursor(): void {
		const root = document.documentElement;
		root.style.pointerEvents = "none";
		let restored = false;
		const restore = (): void => {
			if (restored) return;
			restored = true;
			root.style.pointerEvents = "";
		};
		// rAF owns the restore (one painted frame); the timeout is a
		// backstop for surfaces that never produce one (headless test
		// shells), where a stuck none would eat every later click.
		requestAnimationFrame(() => restore());
		setTimeout(restore, 100);
	}
	let shortcutsOpen = $state(false);
	/** Filter text for the shortcuts modal (⌘F focuses it while open). */
	let shortcutQuery = $state("");
	let shortcutInputEl: HTMLInputElement | null = $state(null);

	/** Open the shortcuts modal with a fresh filter. */
	function openShortcuts(): void {
		shortcutQuery = "";
		shortcutsOpen = true;
	}
	/**
	 * Inspect overlay: the single Han character under review, or null
	 * when closed. Same modal-veil/modal pattern as the shortcuts
	 * overlay. Set from openInspect (selection menu), cleared by Esc,
	 * backdrop click, or the × button.
	 */
	let inspectChar = $state<string | null>(null);
	/**
	 * Reading locale for the Inspect overlay: kana present reads as
	 * Japanese, else Chinese — the same rule as `ttsLangFor`.
	 * Han-only text is genuinely ambiguous, so the overlay offers a
	 * small JP/中文 toggle that writes this state.
	 */
	let inspectLang = $state<HanOverlayLang>("zh");
	/** Current stroke step (1-based, manual only — never autoplay). */
	let inspectStroke = $state(1);
	const inspectData = $derived(
		inspectChar ? getInspectData(inspectChar) : null
	);
	/** KanjiVG stroke paths for the open character (null until loaded). */
	let inspectStrokes = $state<string[] | null>(null);
	$effect(() => {
		const ch = inspectChar;
		inspectStroke = 1;
		inspectStrokes = null;
		if (!ch) return;
		let live = true;
		void fetchStrokePaths(ch).then((paths) => {
			if (!live || inspectChar !== ch) return;
			if (paths && paths.length > 0) inspectStrokes = paths;
		});
		return () => {
			live = false;
		};
	});
	/** Step the stroke preview, clamped to 1..total (never wraps). */
	function stepInspect(delta: number): void {
		const total = inspectStrokes?.length ?? inspectData?.strokeCount ?? 1;
		inspectStroke = clampStrokeStep(inspectStroke, delta, total);
	}
	/**
	 * Hold-to-repeat on the stepper arrows: a tap steps once via
	 * click, holding past the beat keeps stepping every tick (brisk:
	 * strokes are many, taps are for singles). The release click
	 * after a hold is swallowed so it never double-steps; a close
	 * mid-hold stops the chain.
	 */
	let strokeHoldTimer: ReturnType<typeof setTimeout> | null = null;
	let strokeHeld = false;
	const STROKE_HOLD_BEAT_MS = 280;
	const STROKE_HOLD_TICK_MS = 85;
	function startStrokeHold(delta: 1 | -1): void {
		strokeHeld = false;
		stopStrokeHold();
		const tick = (): void => {
			if (!inspectChar || !inspectStrokes?.length) {
				strokeHoldTimer = null;
				return;
			}
			strokeHeld = true;
			stepInspect(delta);
			strokeHoldTimer = setTimeout(tick, STROKE_HOLD_TICK_MS);
		};
		strokeHoldTimer = setTimeout(tick, STROKE_HOLD_BEAT_MS);
	}
	function stopStrokeHold(): void {
		if (strokeHoldTimer) {
			clearTimeout(strokeHoldTimer);
			strokeHoldTimer = null;
		}
	}
	function strokeStep(delta: 1 | -1): void {
		if (strokeHeld) {
			strokeHeld = false;
			return;
		}
		stepInspect(delta);
	}
	/** Open the Inspect overlay for the live selection (single Han char only). */
	function openInspect(): void {
		if (!selMenu) return;
		const quote = selMenu.quote.trim();
		if (!shouldShowInspect(quote, settings.inspectEnabled)) return;
		// One delegated tick for every open path (dock, menu, key):
		// Android-only and toggle-gated inside, so desktop stays silent.
		buzzTap();
		inspectChar = quote;
		inspectLang = inspectLangFor(quote, selMenu.context);
		clearSelection();
		selMenu = null;
	}
	/**
	 * Android (phone) UI: the shortcuts modal shows touch gestures
	 * instead of key chords, and edge swipes open the chats list
	 * (settings opens from the sidebar button or a two-finger swipe
	 * left). Set once on mount from the user agent — never reactive,
	 * never persisted.
	 */
	let androidUI = $state(false);
	/**
	 * iOS subset of the phone UI: Apple gives apps no way to add items
	 * to the system selection menu (Android's floating toolbar API has
	 * no iOS equivalent), so our Annotate button floats above the
	 * highlight while Apple's own bubble keeps its below slot.
	 */
	let iosUI = $state(false);

	/**
	 * Touch copy drops key-chord parentheticals: no Option key, no
	 * hover, no right-click on a phone (it backs out of the app).
	 */
	function tip(desktop: string, mobile: string): string {
		return androidUI ? mobile : desktop;
	}
	/**
	 * Modifier labels for the shortcuts modal and tooltips: macOS shows
	 * the ⌘/⌥/⇧ glyphs, Windows/Linux show Ctrl/Alt/Shift. The key
	 * handlers accept both metaKey and ctrlKey (altKey either way), so
	 * whichever label shows names a combo the handler takes. Mac-first
	 * default: set properly on mount from navigator (see below).
	 */
	let isMac = $state(true);
	const altm = $derived(altKeyLabel(isMac));
	/** Composer hints: touch wording on phones, shortcut wording elsewhere. */
	function promptPlaceholder(): string {
		return androidUI ? ANDROID_PROMPT_PLACEHOLDER : PROMPT_PLACEHOLDER;
	}
	function scrollPlaceholder(): string {
		return androidUI ? ANDROID_SCROLL_PLACEHOLDER : SCROLL_PLACEHOLDER;
	}
	let hasText = $state(false);
	let altHeld = $state(false);
	// Quiet to send: while a reply streams, the lib drops every send
	// and stage — but only after doSend/stage already emptied the
	// composer. Gating here keeps the button dead AND the draft intact,
	// so Enter during Thinking is a no-op instead of a lost message.
	// Native turns count too (liveNative — they never raise isSending).
	// Per-chat lock: a reply streaming in another chat never deadens
	// this composer's send — only this chat's own stream gates it.
	const canSubmit = $derived(
		!isSending(chatState) &&
			!liveNative.has(chatState.activeChatId) &&
			(hasText || attachments.length > 0 || annotations.length > 0)
	);
	/** No-key lock lives below, next to `useMock` (it reads it). */

	function toggleSidebar(): void {
		settings.sidebarCollapsed = !settings.sidebarCollapsed;
		// One overlay at a time: the switcher yields to the list.
		if (!settings.sidebarCollapsed) chatSwitcherOpen = false;
		persistSettings();
		// Touch draws one sidebar at a time: an opening chats list
		// dismisses the settings panel (and vice versa below).
		if (!settings.sidebarCollapsed && androidUI && settingsOpen)
			settingsOpen = false;
	}
	// Phones: an opening chats list dismisses the keyboard — peeking
	// at threads must not keep composer focus, and closing the list
	// must not hand it back (nothing refocuses on close, and picks
	// deliberately stay unfocused too). Desktop keeps its keyed
	// flows (Enter lands in the prompt; hands are on keys there).
	$effect(() => {
		if (!androidUI || settings.sidebarCollapsed) return;
		if (document.activeElement instanceof HTMLElement)
			document.activeElement.blur();
	});

	/** Sidebar chat list filtered by the sidebar search box (see $lib/sidebar). */
	function sideVisibleChats(): (typeof chatState.chats)[number][] {
		return filterSidebarChats(chatState.chats, sideSearch);
	}

	/** Focus the sidebar search box (tap path: keyboard comes up). */
	function focusSideSearch(): void {
		sideSearchEl?.focus();
	}

	/**
	 * Full-text search palette (Ctrl+P / Cmd+P): ranks chats, messages,
	 * and annotation drafts through the index Worker (IndexedDB
	 * snapshot, in-memory fallback where either is unavailable).
	 */
	function ensureSearchStore(): ChatSearchStore {
		if (!searchStore) {
			let factory: (() => Worker) | undefined;
			try {
				factory = createSearchWorker;
				// Probe first: constructing here throws in runtimes
				// without Workers, and the store falls back silently.
				const probe = factory();
				probe.terminate();
			} catch {
				factory = undefined;
			}
			searchStore = new ChatSearchStore(factory);
			void searchStore.restore();
		}
		return searchStore;
	}

	function currentSearchDocs(): Parameters<typeof buildSearchDocs>[0] {
		return chatState.chats.map((c) => ({
			id: c.id,
			createdAt: c.createdAt,
			messages: c.messages.map((m) => ({ id: m.id, content: m.content }))
		}));
	}

	function scheduleSearchIndex(): void {
		if (searchIndexTimer) clearTimeout(searchIndexTimer);
		searchIndexTimer = setTimeout(() => {
			searchIndexTimer = null;
			try {
				// Live drafts for the open chat, stored for the rest
				// (pure collection in chatSearch).
				const anns = collectSearchAnnotations(
					chatState.chats,
					chatState.activeChatId,
					annotations,
					loadDraftAnnotations
				);
				void ensureSearchStore()
					.index(buildSearchDocs(currentSearchDocs(), anns))
					.then(() => {
						// The palette may have queried before this snapshot
						// landed (fast typists beat the 500ms debounce): an
						// open query re-runs against the fresh snapshot.
						if (palette.open && palette.query.trim()) runSearchQuery();
					});
			} catch {
				// Search never breaks the chat: stale snapshot stays live.
			}
		}, 500);
	}

	function openSearch(): void {
		palette.open = true;
		palette.cursor = 0;
		scheduleSearchIndex();
		requestAnimationFrame(() => searchInputEl?.focus());
	}

	function closeSearch(): void {
		// Field-by-field on purpose: closing preserves the cursor
		// (reopen resets it), exactly like the scattered `$state` did.
		palette.open = false;
		palette.query = "";
		palette.hits = [];
		palette.busy = false;
		if (searchQueryTimer) {
			clearTimeout(searchQueryTimer);
			searchQueryTimer = null;
		}
		editor?.focus();
	}

	$effect(() => {
		// Desktop Cmd+scroll rides the app's text size in 0.1 steps
		// (the browser's own page zoom would blur the shell and fight
		// the layout; phones pinch instead, so this stays desktop).
		// Non-passive: swallowing the gesture must also swallow the
		// browser zoom it would otherwise trigger.
		const onZoomWheel = (event: WheelEvent): void => {
			if (androidUI || !event.metaKey) return;
			event.preventDefault();
			// Rides adjustFontScale so the wheel toasts the new size
			// like pinch/keyboard steps do (the toast re-arms per tick,
			// so a held scroll reads live, then dismisses on idle).
			adjustFontScale(event.deltaY < 0 ? 0.1 : -0.1);
		};
		window.addEventListener("wheel", onZoomWheel, { passive: false });
		return () => {
			window.removeEventListener("wheel", onZoomWheel);
		};
	});

	function runSearchQuery(): void {
		if (searchQueryTimer) clearTimeout(searchQueryTimer);
		const query = palette.query;
		if (!query.trim()) {
			palette.hits = [];
			palette.busy = false;
			return;
		}
		palette.busy = true;
		searchQueryTimer = setTimeout(() => {
			searchQueryTimer = null;
			void ensureSearchStore()
				.query(query, 30)
				.then((hits) => {
					palette.hits = hits;
					palette.cursor = 0;
					palette.busy = false;
				})
				.catch(() => {
					palette.hits = [];
					palette.busy = false;
				});
		}, 120);
	}

	/** Chat switching wrapped in a View Transition where supported
	 * (instant cut elsewhere) — identical end state either way. */
	function transitionToChat(id: Parameters<typeof selectChat>[1]): void {
		const from = chatState.activeChatId;
		dismissSelPanels();
		const mutate = (): void => {
			// File the leaving chat's scroll first (a no-op mid-peek,
			// where the box shows another chat), then clear the hover
			// preview inside the transition, never before it: clearing
			// first renders the old chat for a frame (and the
			// view-transition snapshot catches it), so picking a
			// previewed row flashes back before landing.
			saveChatScroll();
			previewChatId = null;
			// Draft annotations belong to one chat: file the leaving
			// chat's away, then restore the entering chat's. Doing both
			// inside the transition keeps the autosave effect (which
			// also keys on activeChatId) from ever filing one chat's
			// drafts under another's id.
			saveDraftAnnotations(
				from,
				annotations,
				chatState.chats.map((c) => c.id)
			);
			selectChat(chatState, id);
			annotations = loadDraftAnnotations(id);
			restoreChatScroll(id);
		};
		// Re-entering the live chat (preview-as-you-go already landed
		// here, or Enter on the active row): identical end state, so
		// skip the crossfade — it only flashes settled content.
		// Cycling inside the open phone switcher cuts the same way:
		// the crossfade paints above the dimming veil, so the new
		// text would flash bright before dimming back down.
		if (id === from || chatSwitcherOpen) {
			mutate();
			return;
		}
		// Leaving for another chat stops the voice: the readout
		// belongs to the old chat, and a new chat never inherits it.
		stopVoice();
		// The snapshot scope lives only around the transition (see
		// scopeMessagesTransition): a standing name would trap the
		// annotation badges under the header strip's hit-testing. The
		// release rides `ready`, not `finished` — the animation phase
		// can stall on slow frames while the trap stays live.
		const unscope = scopeMessagesTransition(scrollBox ?? null);
		void switchChatWithTransition(mutate, unscope);
	}

	// Every chat switch lands the box: chats with a filed scroll
	// position (see saveChatScroll) return where you left, and chats
	// with nothing filed start at the top like today. Streaming chats
	// always follow the reply bottom. Search-hit jumps register their
	// own scroll after this, so they still win. Runs inside the
	// switch mutation (flushed first): a frame callback lands too
	// late — the transition swaps content after it.
	function restoreChatScroll(id: ChatId): void {
		if (isSending(chatState, id)) return;
		const saved = chatScrollTops.get(id);
		flushSync();
		if (!scrollBox || chatState.activeChatId !== id) return;
		// Instant: the column eases programmatic jumps, and a smooth
		// restore retargets (or dies) across the switch transition.
		scrollBox.scrollTo({ top: saved ?? 0, behavior: "instant" });
	}

	/** Jump to a palette hit: its chat, scrolled to its message. */
	function enterSearchHit(hit: SearchHit): void {
		const chat = chatState.chats.find((c) => c.id === hit.doc.chatId);
		if (!chat) return;
		transitionToChat(chat.id);
		palette.open = false;
		palette.query = "";
		palette.hits = [];
		if (hit.doc.msgId) {
			const index = chat.messages.findIndex((m) => m.id === hit.doc.msgId);
			if (index >= 0) {
				// The jump lands silently: the message scrolls into view
				// and takes DOM focus (Tab still walks message order),
				// but nothing is selected — edit mode owns j/k from here
				// so they glide instead of walking from a cursor. (No
				// enterEditMode: focus stays on the message, not the
				// composer.)
				focusMode = "edit";
				selectedIdx = -1;
				requestAnimationFrame(() => {
					const el = document.getElementById(`msg-${index}`);
					el?.scrollIntoView({ block: "center", behavior: "smooth" });
					el?.focus({ preventScroll: true });
				});
				return;
			}
		}
		editor?.focus();
	}

	function moveSearchCursor(delta: 1 | -1): void {
		if (palette.hits.length === 0) return;
		palette.cursor = stepFindCursor(
			palette.hits.length,
			palette.cursor,
			delta
		);
	}

	/**
	 * DOM focus follows the palette highlight: the highlighted option
	 * becomes the focused element, so Tab/Shift-Tab continue from the
	 * highlighted result and screen readers track the cursor.
	 */
	function focusSearchHit(cursor: number): void {
		searchResultsEl
			?.querySelectorAll<HTMLButtonElement>(".search-hit")
			[cursor]?.focus();
	}

	/**
	 * In-chat find (Cmd/Ctrl+F): message-level cycling browser-style.
	 * Matches come from findMessageIndices over the visible chat's
	 * plain text; each stop selects + centers its message. DOM focus
	 * stays in the find field while cycling (the scroll-mode arrow
	 * branch stands down inside .find-bar — see inFind below).
	 */
	let find = $state<FindState>(emptyFind());
	let findInputEl: HTMLInputElement | undefined = $state();
	function currentFindHits(): number[] {
		return find.open
			? findMessageIndices(
					viewChat.messages.map((m) => m.content),
					find.query
				)
			: [];
	}
	function landFindHit(): void {
		const index = currentFindHits()[find.cursor];
		if (index === undefined) return;
		enterScrollMode();
		selectedIdx = index;
		requestAnimationFrame(() => {
			document
				.getElementById(`msg-${index}`)
				?.scrollIntoView({ block: "center", behavior: "smooth" });
		});
	}
	function stepFind(delta: 1 | -1): void {
		const hits = currentFindHits();
		if (hits.length === 0) return;
		find.cursor = stepFindCursor(hits.length, find.cursor, delta);
		landFindHit();
	}
	function openFind(): void {
		find.open = true;
		find.cursor = 0;
		requestAnimationFrame(() => {
			findInputEl?.focus();
			findInputEl?.select();
		});
	}
	function closeFind(): void {
		find = emptyFind();
		// The bar's cursor dies with it. landFindHit parked scroll mode
		// on a hit, but composer focus flips mode to edit on the way in
		// (see onFocusIn), so a stale selectedIdx would only strand the
		// next scroll entry on a ghost message. Clear it outright —
		// single hit or several, Enter, Esc, or repeat Cmd+F.
		focusMode = "edit";
		selectedIdx = -1;
		editor?.focus();
	}

	/**
	 * Export one sidebar chat as Markdown: File System Access picker
	 * where available, native save dialog in the shell, download blob
	 * fallback otherwise. A dismissed picker stays silent.
	 */
	async function exportOneChat(target: Chat): Promise<void> {
		// The Android shell webview sinkholes blob downloads, so its
		// fallback copies the markdown instead of dead-clicking an
		// anchor. Browsers keep the file download (verified on the
		// mobile emulation path).
		const shellPhone = androidUI && tauriBackendAvailable();
		try {
			const picker = fileSaveAccessAvailable()
				? (window.showSaveFilePicker?.bind(window) ?? null)
				: null;
			const how = await exportChatMarkdown(target, {
				picker,
				native: (filename, text) => nativeSaveMarkdown(filename, text),
				download: shellPhone
					? (text) => copyExportText(text)
					: downloadMarkdownFile
			});
			flashToast(exportSuccessToast(how, shellPhone));
		} catch (error) {
			// A clipboard denial on the shell phone arrives as
			// NotAllowedError: unlike a dismissed save picker, a dead
			// copy button must say so instead of staying silent.
			const message = exportFailureToast(
				isPermissionDismissal(error),
				shellPhone
			);
			if (message !== null) flashErrorToast(message);
		}
	}

	/**
	 * Open the settings panel, dismissing the chats list on touch.
	 * Swipe openers pass silent: the stroke itself is the feedback,
	 * so only button/menu/keyboard openings tick.
	 */
	function openSettingsPanel(silent = false): void {
		// Openings tick medium (first): distinct from the light ticks
		// of folds and steps and the triple thump of deletes.
		if (androidUI && !silent) {
			void hapticBeatAsync("first", {
				enabled: settings.hapticsEnabled,
				shell: tauriBackendAvailable()
			});
		}
		// One overlay at a time: the switcher yields to settings.
		chatSwitcherOpen = false;
		settingsOpen = true;
		if (androidUI && !settings.sidebarCollapsed) {
			settings.sidebarCollapsed = true;
			persistSettings();
		}
	}

	/** Toggle the settings panel with the same one-sidebar rule. */
	function toggleSettingsPanel(): void {
		if (settingsOpen) settingsOpen = false;
		else openSettingsPanel();
	}

	/**
	 * Whether the user picked their own idle timeout: captured once at
	 * startup, before the autosave effect can backfill defaults into
	 * storage (any settings change persists the whole object, so a
	 * later read cannot tell default from deliberate). Phones default
	 * to never hiding until the user chooses a timeout.
	 * (Mirrors the private storage key in settings.ts.)
	 */
	const idleTimeoutCustomized: boolean = (() => {
		try {
			const raw =
				window.localStorage.getItem("ccez-llm-settings-v1") ??
				window.localStorage.getItem("ccez-studio-settings-v1");
			if (!raw) return false;
			return (
				typeof (JSON.parse(raw) as { promptIdleSec?: unknown })
					.promptIdleSec === "number"
			);
		} catch {
			return false;
		}
	})();
	/**
	 * Idle-hide for the main prompt: any mouse, keyboard, touch, or
	 * wheel input stamps lastInputAt (delaying the hide); a 500ms
	 * ticker hides it (a short settle-down plus fade) once the
	 * effective timeout elapses with no input. The prompt is a
	 * floating card over a full-bleed column, so hiding and restoring
	 * move no messages and clip no text.
	 * Restoring is keys-only on desktop: only the i / Enter / Space
	 * keys (see promptIdleKeyAction, wired at the top of onKey) bring the
	 * prompt back — clicks never summon it, so selecting,
	 * double-clicking, and dismissing highlights leave it hidden.
	 * Phones keep tap-to-summon (no keyboard for i). Pointer travel,
	 * wheel, control clicks, and other keys merely re-arm the timer.
	 * The timeout and mobile reads subscribe the effect, so a
	 * settings change or the phone detection landing re-arms the
	 * ticker. An empty chat never hides; every other thread obeys
	 * the timeout however short (summoning stays one keypress away).
	 */
	let lastInputAt = $state(Date.now());
	/**
	 * Boot parks hidden under always-hide when the synchronously loaded
	 * chat already has messages: starting visible would flash the
	 * composer for a frame before the late-seed effect hides it
	 * (async loads keep today's hide-on-arrival).
	 */
	let bootParked =
		settings.promptIdleSec === PROMPT_IDLE_ALWAYS &&
		(activeChat(chatState)?.messages.length ?? 0) > 0;
	let promptIdle = $state(bootParked);
	/** Any activity delays the hide; restoring is allowlisted below. */
	function stampInput(): void {
		lastInputAt = Date.now();
	}
	/** Allowlisted restore: show the hidden prompt again. */
	function restorePrompt(): void {
		focusLog("restore-prompt", {
			active: describeActiveElement(),
			wasIdle: promptIdle
		});
		stampInput();
		promptIdle = false;
	}
	/**
	 * Parked composer: idle-hidden OR a sidebar owns the stage (chats
	 * list or settings). Parking is visual only — promptIdle keeps its
	 * own state, so closing the sidebar returns exactly the prior
	 * idle state instead of summoning a hidden prompt.
	 */
	function promptParked(): boolean {
		// Phones never park for drawers: the chats list and settings
		// are overlays above the composer (z 55+ over 30), so hiding
		// it under them only slid the thread and flickered the card.
		// Only a real idle timeout parks. Desktop keeps drawer parking.
		return promptParkedFor(
			androidUI,
			promptIdle,
			settingsOpen,
			settings.sidebarCollapsed
		);
	}
	/**
	 * Always-hide park: hide unless focus is (or is heading) inside
	 * the composer, with the same empty-chat guard as the timed path.
	 * Takes the focus destination explicitly because during focusout
	 * the active element is already gone (relatedTarget reads where
	 * focus is heading; null when it leaves the window).
	 */
	function hideForAlways(next: EventTarget | null): void {
		if (
			!shouldHideForAlways({
				alwaysMode: settings.promptIdleSec === PROMPT_IDLE_ALWAYS,
				inPrompt: isPromptTarget(next),
				emptyChat: viewChat.messages.length === 0
			})
		)
			return;
		promptIdle = true;
		focusLog("hide-for-always", {
			next: describeFocusTarget(next),
			active: describeActiveElement()
		});
	}
	/**
	 * Idle-prompt key decisions live in `promptIdleKeyAction`
	 * (`src/lib/keybindings.ts`): bare i / Enter / Space restore the
	 * hidden prompt, blind keystrokes into the hidden composer die
	 * silently (typing blind would strand text in an invisible box
	 * and drop focus when the hidden subtree restyles). Anything with
	 * a modifier (copy/paste/undo chords), IME, and control keys
	 * (Tab, arrows, Escape) keeps its behavior; other keys merely
	 * re-arm the hide timer via the stamp listener.
	 */
	$effect(() => {
		const setting = settings.promptIdleSec;
		// Phones never idle-hide (see the mount migration above): the
		// prompt is a permanent fixture, like other chat apps.
		const idleSec = !androidUI ? setting : 0;
		const on = (): void => stampInput();
		// A pointer press is a distinct gesture from the filing Enter,
		// so it ends the anti-double-send window (see sendGuardUntil).
		const onDown = (): void => {
			sendGuardUntil = 0;
		};
		// Press point for the drag-vs-click read in onIdleClick: a
		// press that traveled is a selection drag, never a restore.
		// idleDownControl remembers a press that STARTED on a control:
		// a mid-press re-render (toast, Shiki) can swap the node under
		// the cursor, retargeting the click to an ancestor — the press
		// is still a control press, never a restore.
		let idleDown: { x: number; y: number } | null = null;
		let idleDownControl = false;
		// Whether the prompt was visible when the press started: a press
		// that begins visible is the dismissing gesture (its blur hides),
		// so its click must not restore — only a press that starts
		// hidden summons.
		let idleDownVisible = false;
		let idleDownHadSel = false;
		const onIdleDown = (event: PointerEvent): void => {
			const downTarget = event.target instanceof Element ? event.target : null;
			if (event.button === 0) {
				// Stamp composer presses for onFocusOutIdle's WebKit
				// guard (see promptPressAt): a press inside the composer
				// whose focusout lands nowhere is still in flight.
				if (downTarget?.closest(".prompt")) promptPressAt = Date.now();
			}
			idleDown =
				event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
			// Summonable only from a fully shown prompt: a press that
			// starts idle-hidden OR sidebar-parked (e.g. the click that
			// dismisses a sidebar) never restores on its click.
			idleDownVisible = event.button === 0 && !promptParked();
			// A press that starts on a live highlight is its dismissal —
			// the click that clears it must not summon the prompt.
			idleDownHadSel =
				event.button === 0 && (window.getSelection()?.toString() ?? "") !== "";
			idleDownControl = event.button === 0 && isClickControlTarget(downTarget);
		};
		/**
		 * Desktop clicks never restore the hidden prompt — summoning
		 * is keys-only (bare i / Enter / Space) — so selecting,
		 * double-clicking, and dismissing text never flash it. iOS
		 * keeps tap-to-summon (no keyboard to press i on, no swipe
		 * gestures there); Android summons with swipe-up instead, so
		 * taps keep native behavior and buttons never fire behind a
		 * summoned prompt. The visible floor tap stays for all: with
		 * the prompt already up, tapping its floor lands the caret.
		 */
		const onIdleClick = (event: MouseEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			if (!promptIdle) {
				// Visible already: a tap on the prompt floor itself still
				// lands the caret (an unfocused-but-visible composer is
				// routine in always-hide mode). Controls keep their guard
				// inside focusPromptFloor; everywhere else ignores clicks.
				if (target?.closest(".prompt")) focusPromptFloor(event);
				return;
			}
			// Hidden on desktop: no click summons, full stop. Hidden on
			// Android: swipe up summons, taps stay native.
			if (!androidUI || !iosUI) return;
			if (event.button !== 0) return;
			const down = idleDown;
			const downControl = idleDownControl;
			const downVisible = idleDownVisible;
			const downHadSel = idleDownHadSel;
			idleDown = null;
			idleDownControl = false;
			idleDownVisible = false;
			idleDownHadSel = false;
			// Press-guard order lives in idleTapAction: a press that
			// traveled is a selection drag; a press that started on a
			// control, a live highlight, or while visible is their
			// dismissal, never a summon.
			const tap = idleTapAction({
				downControl,
				downVisible,
				downHadSel,
				traveled:
					down !== null &&
					Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6,
				inMath: isMathTarget(target),
				inClickControl: isClickControlTarget(target),
				inOverlay: isTapOverlayTarget(target)
			});
			if (tap === null) return;
			restorePrompt();
			// Controls act where they land, never summon (see the
			// press guard above); an overlay owns focus, so a summon
			// behind one restores without landing.
			if (tap === "summon-quiet") return;
			// Same deferred landing as the key path: the composer is
			// only focusable once the visibility flip flushes.
			const floorEvent = event;
			void tick().then(() => focusPromptFloor(floorEvent));
		};
		/**
		 * Always-hide mode (slider bottom tick): the prompt is visible
		 * exactly while the composer holds focus. Focus landing in the
		 * composer restores; focus leaving it hides (see hideForAlways
		 * at component scope).
		 */
		const onFocusInIdle = (event: FocusEvent): void => {
			if (settings.promptIdleSec !== PROMPT_IDLE_ALWAYS) return;
			if (!closestFromTarget(event.target, ".prompt .ta-input")) return;
			focusLog("focusin-idle", {
				target: describeFocusTarget(event.target),
				active: describeActiveElement()
			});
			restorePrompt();
		};
		const onFocusOutIdle = (event: FocusEvent): void => {
			// A press that started inside the composer is still in
			// flight when its focusout lands with nowhere to go
			// (null/body): WebKit never focuses the button being
			// pressed, so this fires where Chromium reports the button
			// itself. Parking here would hide the composer and eat the
			// press's click behind pointer-events:none — the button
			// (or pill review toggle) never runs. Skip the hide; the
			// idle ticker re-parks a genuinely unfocused composer
			// within half a second, so an over-skip self-heals.
			// A focusout from a detaching or freshly inert node
			// (sidebar collapse inerting its focused row, modal
			// teardown) is removal, not intent to leave: hiding on it
			// strands keyboard flows that already called enterEditMode.
			// Click-away and tab-out targets stay attached and outside
			// inert roots, so those hides are untouched.
			if (event.target instanceof Element) {
				if (!document.contains(event.target)) return;
				if (event.target.closest("[inert]")) return;
			}
			const next: EventTarget | null = event.relatedTarget ?? null;
			focusLog("focusout-idle", {
				target: describeFocusTarget(event.target),
				next: describeFocusTarget(next),
				active: describeActiveElement(),
				promptIdle,
				pressAgeMs: Date.now() - promptPressAt
			});
			if (
				(next === null || next === document.body) &&
				Date.now() - promptPressAt < 1500
			) {
				return;
			}
			hideForAlways(next);
		};
		window.addEventListener("pointermove", on, { passive: true });
		window.addEventListener("focusin", onFocusInIdle);
		window.addEventListener("focusout", onFocusOutIdle);
		window.addEventListener("pointerdown", on, { passive: true });
		window.addEventListener("pointerdown", onIdleDown, { passive: true });
		window.addEventListener("pointerdown", onDown);
		// Find-bar outside dismiss: any press outside the bar closes it.
		// Prompt-summon safety is structural on desktop (clicks never
		// summon — keys-only restore); the phone tap path keeps its
		// own press guards below.
		const onFindOutside = (event: PointerEvent): void => {
			if (!find.open) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(".find-bar")) return;
			find.open = false;
		};
		window.addEventListener("pointerdown", onFindOutside, { passive: true });
		// Filed-annotations card dismiss: a press outside the card's
		// own wrap closes it (capture, so the press never also acts
		// behind the card). Presses on the pill or inside the card
		// are the toggle and its buttons — never a dismissal.
		const onRefsOutside = (event: PointerEvent): void => {
			if (!refsPopOpen) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(".ann-refs")) return;
			refsPopOpen = null;
		};
		window.addEventListener("pointerdown", onRefsOutside, { capture: true });
		// History tag popup dismiss: a press outside any tag wrap
		// closes every open popup (capture, so the press never also
		// acts behind the popup). Presses on a tag or inside its
		// popup are the toggle and its buttons — never a dismissal.
		const onSentTagOutside = (event: PointerEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(".sent-wrap")) return;
			if (expandedTags.length > 0) expandedTags = [];
		};
		window.addEventListener("pointerdown", onSentTagOutside, { capture: true });
		window.addEventListener("keydown", on);
		window.addEventListener("wheel", on, { passive: true });
		window.addEventListener("touchstart", on, { passive: true });
		window.addEventListener("click", onIdleClick);
		window.addEventListener("offline", handleOffline);
		window.addEventListener("online", handleOnline);
		// Boot already offline (plane, dead wifi): park on Gemma now
		// instead of showing a dead cloud provider.
		if (typeof navigator !== "undefined" && !navigator.onLine) handleOffline();
		const timer = window.setInterval(() => {
			if (!isPromptIdle(lastInputAt, Date.now(), idleSec)) return;
			if (
				!shouldIdleHide({
					emptyChat: viewChat.messages.length === 0,
					alreadyIdle: promptIdle
				})
			)
				return;
			promptIdle = true;
		}, 500);
		return () => {
			window.removeEventListener("pointermove", on);
			window.removeEventListener("focusin", onFocusInIdle);
			window.removeEventListener("focusout", onFocusOutIdle);
			window.removeEventListener("pointerdown", on);
			window.removeEventListener("pointerdown", onIdleDown);
			window.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointerdown", onFindOutside);
			window.removeEventListener("pointerdown", onRefsOutside, {
				capture: true
			});
			window.removeEventListener("pointerdown", onSentTagOutside, {
				capture: true
			});
			window.removeEventListener("keydown", on);
			window.removeEventListener("wheel", on);
			window.removeEventListener("touchstart", on);
			window.removeEventListener("click", onIdleClick);
			window.removeEventListener("offline", handleOffline);
			window.removeEventListener("online", handleOnline);
			window.clearInterval(timer);
		};
	});
	/**
	 * Late seeds re-evaluate the always-hide park: the mount pass can
	 * run before the chat loads (an empty guard skips the hide), so
	 * message arrival parks an unfocused composer instead of leaving
	 * it stranded visible. The mirror case: arriving at an empty
	 * chat with the flag set (parked on a previous thread) clears it,
	 * or the composer stays stranded hidden where it must compose.
	 */
	$effect(() => {
		void viewChat.messages.length;
		if (!previewing && viewChat.messages.length === 0) {
			promptIdle = false;
			return;
		}
		hideForAlways(document.activeElement);
	});
	/**
	 * Tail clearance for the floating composer: in-scroller padding
	 * keeps the last line above the card in every scroll position (a
	 * static guess can't track a growing draft, scroll-padding only
	 * steers programmatic scrolls), while the thread runs full-height
	 * behind the frosted card so mid-thread text bleeds through.
	 * Main-level padding covers only the in-flow attachment strip,
	 * preview, and error, which live outside the scroller. The extra
	 * 54px also clears short last messages' badges, which float
	 * above their quote and would otherwise park under the card,
	 * unclickable. The reserve NEVER collapses while parked:
	 * collapsing reclaimed the room but the summon then covered the
	 * tail (or yanked it upward on re-stick) — both read as the
	 * composer hiding text. Composes with the Android safe-area
	 * inset instead of clobbering it.
	 */
	// Last applied tail clearance in px (-1 until the first sync, and
	// component-scoped so effect re-runs never reset the edge: only
	// genuine GROWTH (a lengthening draft) re-sticks, so boot, park,
	// summon, and scroll restores keep whatever position they landed.
	let lastClearPx = -1;
	// Last written reserve values: the observer watches the card and
	// the box it writes to, so an unconditional write on every fire
	// feeds its own notifications (the "ResizeObserver loop" console
	// error). Identical values write nothing — the loop starves.
	let lastBoxPad = "";
	let lastMainPad = "";
	let lastSbw = "";
	let lastTrayBottom = "";
	$effect(() => {
		// Tracked so attaching/removing re-runs the reserve past the
		// ResizeObserver (the tray is absolute now: it resizes nothing,
		// so no notification would ever fire for it).
		void attachments.length;
		void notices.inline.message;
		const card = promptEl?.closest<HTMLElement>(".prompt") ?? null;
		const box = scrollBox;
		const mainEl = box?.closest<HTMLElement>("main") ?? null;
		if (!card || !box || !mainEl) return;
		const sync = (): void => {
			const cardH = Math.ceil(card.getBoundingClientRect().height);
			const cardBottom =
				Number.parseFloat(window.getComputedStyle(card).bottom) || 0;
			const clearPx = cardH + 54;
			// The tray floats over the thread (absolute, transparent),
			// so the thread runs full-height behind and beside it: the
			// tail clearance covers the tray too, and the tray docks a
			// fixed margin above the card (tracking draft growth via
			// the measured height) instead of riding the reserve high.
			const tray = mainEl.querySelector<HTMLElement>(":scope > .attachments");
			const trayH = tray ? Math.ceil(tray.getBoundingClientRect().height) : 0;
			const trayGap = trayH > 0 ? 8 : 0;
			// Thread clearance lives INSIDE the scroller: the thread
			// runs full-height behind the solid card, and the tail
			// still lands above it at the bottom. Empty chats keep
			// none: no tail to protect, hero owns the space.
			const emptyChat = viewChat.messages.length === 0;
			const boxPad = emptyChat ? "0px" : `${clearPx + trayH + trayGap}px`;
			if (boxPad !== lastBoxPad) {
				box.style.paddingBottom = boxPad;
				lastBoxPad = boxPad;
			}
			if (tray && trayH > 0) {
				const trayBottom = `${cardBottom + cardH + trayGap}px`;
				if (trayBottom !== lastTrayBottom) {
					tray.style.bottom = trayBottom;
					lastTrayBottom = trayBottom;
				}
			} else {
				// The tray remounts fresh on every attach cycle with no
				// inline bottom (the CSS carries none): forget the last
				// write while it is gone, or a remount at the same
				// composer height reads as "unchanged" and the tray
				// parks at the top.
				lastTrayBottom = "";
			}
			// The error stays in main flow after the scroller:
			// main-level padding lifts it above the card while
			// rendered (the absolute tray needs no lift).
			// Binary, so park/summon (transform-only, layout kept)
			// never move anything. Empty chats keep today's floor.
			const chromeOpen =
				mainEl.querySelector(":scope > .attach-error") !== null;
			const mainPad =
				emptyChat || chromeOpen
					? `calc(${clearPx}px + env(safe-area-inset-bottom, 0px))`
					: `env(safe-area-inset-bottom, 0px)`;
			if (mainPad !== lastMainPad) {
				mainEl.style.paddingBottom = mainPad;
				lastMainPad = mainPad;
			}
			// Scrollbar gutter the messages reserve (classic thin bar,
			// zero with overlay scrollbars): the floating card centers in
			// the full column, so it rides this much right of the
			// articles without compensation (see --sbw on .prompt). Set
			// on main, not the card: the attachment tray is the card's
			// sibling and shares the same centering math.
			const sbw = `${Math.max(0, box.offsetWidth - box.clientWidth)}px`;
			if (sbw !== lastSbw) {
				mainEl.style.setProperty("--sbw", sbw);
				lastSbw = sbw;
			}
			// A lengthening draft grows the reserve under the card:
			// when stuck to the bottom, re-stick past it or the tail
			// slides under the solid card as you type. Stuckness reads
			// off the live gap, discounted by this growth: the stick
			// flag goes stale when no scroll event ever fired (fresh
			// load parked at the top), and trusting it yanks a
			// mid-thread reader to the end on the first keystroke. Park,
			// summon, and restores never change the reserve, so they
			// never move the thread; touch holds never move either;
			// phones keep their bottom-anchored card.
			if (
				!androidUI &&
				lastClearPx >= 0 &&
				clearPx > lastClearPx &&
				!viewport.holding &&
				box.scrollHeight - box.scrollTop - box.clientHeight <=
					STICK_PX + (clearPx - lastClearPx)
			) {
				box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
			}
			lastClearPx = clearPx;
		};
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(card);
		ro.observe(box);
		return () => ro.disconnect();
	});
	/**
	 * Parking drops the caret: a sidebar opening with focus still
	 * in the composer would type behind the panel. Focus already in
	 * the sidebar (or anywhere outside the prompt) stays put, and
	 * closing returns the prior idle state untouched.
	 */
	$effect(() => {
		// Phones keep the composer mounted under open drawers, but an
		// open drawer still drops the caret (typing behind the panel,
		// keyboard over the drawer). Desktop blurs via promptParked.
		const drawerOpen =
			androidUI && (settingsOpen || !settings.sidebarCollapsed);
		if (!promptParked() && !drawerOpen) return;
		const active = document.activeElement;
		if (active instanceof HTMLElement && active.closest(".prompt"))
			editor?.blur();
	});
	/**
	 * Sleep prevention during speech/streaming (desktop shell only):
	 * one backend claim stays live while a voice reads
	 * (`speakingId`) or a reply streams (`chatState.sending`). The
	 * bridge refcounts, so overlap never unblocks early; a stale
	 * resolve after stop releases instead of holding. Outside the
	 * shell the call resolves null — never a toast, never a throw.
	 */
	let sleepClaim: number | null = null;
	let sleepWanted = false;
	$effect(() => {
		const active = speakingId !== null || chatState.sending;
		if (active) {
			sleepWanted = true;
			void desktopSleepBlock("Ccez Studio speech or reply streaming").then(
				(id) => {
					if (id === null) return;
					if (sleepWanted) sleepClaim = id;
					else void desktopSleepUnblock(id);
				}
			);
		} else {
			sleepWanted = false;
			if (sleepClaim !== null) {
				const id = sleepClaim;
				sleepClaim = null;
				void desktopSleepUnblock(id);
			}
		}
	});
	/** UI text scale in 10% steps (50–800% everywhere). */
	function adjustFontScale(delta: number, quiet = false): void {
		const next = stepFontScale(settings.fontScale, delta);
		if (next === settings.fontScale) return;
		settings.fontScale = next;
		persistSettings();
		// Pinch zoom toasts once on release (see the touchend below),
		// not per step — a held pinch would strobe the toast.
		if (!quiet) flashToast(`Text size ${Math.round(next * 100)}%`);
	}
	/** Chat-column width in 2rem steps (desktop only — phones fix it
	at 46rem). Shift siblings of the text-size chords, above. */
	function adjustChatWidth(delta: number): void {
		if (androidUI) return;
		const current = settings.chatWidth ?? CHAT_WIDTH_DEFAULT;
		const next = stepChatWidth(current, delta);
		if (next === current) {
			flashToast(`Chat width ${current} rem (limit)`);
			return;
		}
		settings.chatWidth = next;
		persistSettings();
		flashToast(`Chat width ${next} rem`);
	}

	/** Pointer-down spot for click-off-to-close (select-drags must not count). */
	let mainDown: { x: number; y: number } | null = null;
	function noteMainDown(event: PointerEvent): void {
		mainDown = { x: event.screenX, y: event.screenY };
	}
	/**
	 * Clicking into the main chat closes the sidebars: the settings
	 * panel and the chats list both collapse, so the click lands on a
	 * full-width conversation. Controls tagged data-settings-toggle
	 * manage the panel themselves and are skipped; drags (text
	 * selection) are not plain clicks.
	 */
	function closeSettingsFromMain(event: MouseEvent): void {
		if (!settingsOpen && settings.sidebarCollapsed) return;
		const down = mainDown;
		mainDown = null;
		if (down && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5)
			return;
		if (settingsOpen) {
			if (
				event.target instanceof Element &&
				event.target.closest("[data-settings-toggle]")
			) {
				return;
			}
			settingsOpen = false;
		}
		if (!settings.sidebarCollapsed) {
			settings.sidebarCollapsed = true;
			persistSettings();
		}
		// The dismissing click means "back to the chat": when the prompt
		// is already shown, land the caret in it — a visible-but-unfocused
		// composer strands keyboard users (Space/i/Enter restore a hidden
		// one, but nothing re-focuses a shown one). Focus only, never a
		// mode flip: scroll mode survives the round trip. Controls keep
		// their own clicks via the shared idle-press guard below —
		// never a forked copy of its selector. Drags were filtered
		// above, and a hidden prompt stays keys-only. The unpark
		// flushes async, so land after the tick — a sync focus would
		// hit the still-parked composer and no-op.
		if (isClickControlTarget(event.target)) return;
		if (promptIdle) return;
		// Phones never land the caret on dismiss: the tap means "back
		// to the chat", and focusing pops the keyboard over it. Desktop
		// keeps the caret landing for keyboard users.
		if (!androidUI) void tick().then(() => editor?.focus());
	}

	/**
	 * Resolved color scheme on <html>: "system" mirrors the OS live
	 * (the listener re-runs the effect's cleanup on mode change, so
	 * only system subscribes), pins hold regardless. The dark CSS
	 * gates on this attribute — never on media queries — so one rule
	 * set serves all three modes.
	 */
	$effect(() => {
		const mode = settings.theme;
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = (): void => {
			document.documentElement.dataset.theme = resolveTheme(
				mode,
				query.matches
			);
		};
		apply();
		if (mode === "system") query.addEventListener("change", apply);
		return () => query.removeEventListener("change", apply);
	});

	/**
	 * Hide-messages mode (touch): every body stays hidden until its
	 * message is tapped — the open one shows text and buttons, then
	 * closes itself after 3s. Tapping controls never toggles.
	 */
	let shownActionsId: ChatMsgId | null = $state(null);
	/** Phone only: the second tap of a message double-tap pins the just
	revealed row open — without this its click would toggle it shut
	(the tap word-selects natively). Stamped in the touchend below,
	consumed by the click's toggle path. */
	let msgDoubleTapPin: { id: ChatMsgId; at: number } | null = null;
	/**
	 * Chat switcher overlay (phones): a two-finger hold on the main
	 * chat opens it; swipes inside cycle chats, tapping away closes.
	 */
	let chatSwitcherOpen = $state(false);
	/** Last open stamp: the opening tap's own compat click lands on
	the veil right after touchend and must not close it straight back.
	State (not a plain stamp) because the switcher reads it during
	render — it flips together with the open flag below. */
	let switcherOpenedAt = $state(0);
	function openChatSwitcher(): void {
		chatSwitcherOpen = true;
		switcherOpenedAt = Date.now();
		void hapticBeatAsync("first", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
	}
	function closeChatSwitcher(): void {
		if (!chatSwitcherOpen) return;
		chatSwitcherOpen = false;
		void hapticBeatAsync("send", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
	}
	/**
	 * Cycle from inside the switcher (stays open across steps) with
	 * wrap-around: past either end loops to the far chat instead of
	 * minting or sticking. A lone chat falls through to the plain
	 * step (past-newest still mints).
	 */
	function stepSwitcher(direction: 1 | -1): void {
		const ids = chatState.chats.map((c) => c.id);
		const at = ids.indexOf(chatState.activeChatId);
		const wrapped =
			at >= 0 && ids.length > 0
				? (ids[(at + direction + ids.length) % ids.length] ?? null)
				: null;
		if (wrapped !== null && wrapped !== chatState.activeChatId)
			transitionToChat(wrapped);
		else stepChat(direction, false);
		void hapticBeatAsync("send", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
	}
	let shownActionsTimer: ReturnType<typeof setTimeout> | null = null;
	/** (Re)arm the 3s auto-dismiss for one reveal. */
	function armActionsTimer(id: ChatMsgId): void {
		if (shownActionsTimer) clearTimeout(shownActionsTimer);
		shownActionsTimer = setTimeout(() => {
			if (shownActionsId !== id) {
				shownActionsTimer = null;
				return;
			}
			// A loading aid (tashkeel run, furigana conversion) or
			// running audio owns the row like a held press: closing
			// now would strand the spinner with no buttons, or the
			// stop button out of reach mid-utterance. Re-arm and let
			// a later tick close it after the work lands.
			if (rowWorkRunning(id, aidBusy, vocalizing, speakingId, speakingSelection)) {
				armActionsTimer(id);
				return;
			}
			shownActionsId = null;
			shownActionsTimer = null;
		}, 3000);
	}
	/** A press inside an open row owns it: tap-and-hold must not watch
	its button vanish on the usual timer. Release re-arms it. */
	function holdActionsOpen(): void {
		if (shownActionsTimer) clearTimeout(shownActionsTimer);
		shownActionsTimer = null;
	}
	function releaseActionsHold(): void {
		if (shownActionsId === null) return;
		armActionsTimer(shownActionsId);
	}
	function toggleMessageActions(id: ChatMsgId, event: MouseEvent): void {
		// Phones always render the row (no master off-switch), so taps
		// always toggle there; desktop honors the Messages checkbox.
		if (
			!messageActionsTapAllowed(
				androidUI,
				settings.showMessageButtons,
				settings.hideMessages,
				settings.hideButtons
			)
		)
			return;
		if (
			closestFromTarget(
				event.target,
				"button, a, input, textarea, select, summary"
			)
		)
			return;
		// Tapping a folded message unfolds it: its row is hidden, so no
		// fold button exists to press. Android only — desktop hovers the
		// row back into view.
		if (androidUI && foldedIds.has(id)) {
			shownActionsId = null;
			toggleFold(id);
			return;
		}
		if (shownActionsTimer) clearTimeout(shownActionsTimer);
		shownActionsTimer = null;
		if (shownActionsId === id) {
			// The second tap of a message double-tap word-selects
			// instead of toggling shut (see the touchend below):
			// re-arm, never close. Desktop has no pin, so its toggle
			// rhythm is untouched.
			if (msgDoubleTapPin?.id === id && Date.now() - msgDoubleTapPin.at < 500) {
				armActionsTimer(id);
				return;
			}
			shownActionsId = null;
			return;
		}
		shownActionsId = id;
		// No haptic on a single reveal tap: a reveal is a quiet UI
		// affordance, not a sent action. Double-tap keeps its own
		// beat (the message-end jump); the send paths keep theirs.
		// The tap can land mid-frame with keyboard or viewport churn:
		// settle a re-measure after paint (same settle the send paths
		// use) so the composer can't strand at zero height, and the
		// extra paint invalidates a stale tile the fade left behind
		// on phone GPUs.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => editor?.remeasure())
		);
		armActionsTimer(id);
	}
	/** Focus a sidebar chat button by list position (clamped). */
	function focusSideChat(index: number): void {
		const items = [
			...document.querySelectorAll<HTMLElement>("aside ul li button.side-chat")
		];
		const clamped = clampChatIndex(index, items.length);
		if (clamped === null) return;
		sideIdx = clamped;
		const el = items[sideIdx];
		if (!el) return;
		el.focus();
		el.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}

	/**
	 * Opening lands keyboard users on the current chat (renders async),
	 * so j/k starts there instead of the top. Falls back to the top
	 * row when a search filter hides the active chat.
	 */
	function focusActiveSideChat(): void {
		const at = sideVisibleChats().findIndex(
			(c) => c.id === chatState.activeChatId
		);
		requestAnimationFrame(() => focusSideChat(at < 0 ? 0 : at));
	}

	/**
	 * Step through chats with the sidebar closed: +1 goes down (newer,
	 * toward the bottom of the stack), -1 goes up (older). Past the
	 * newest end, a chat with messages mints one fresh chat below it —
	 * never a second while it is still empty, so repeats can't pile up
	 * blanks.
	 */
	function stepChat(direction: 1 | -1, focus = true): void {
		const chats = chatState.chats;
		const step = planChatStep(chats, chatState.activeChatId, direction);
		if (step.kind === "none") return;
		if (step.kind === "stay") {
			// Touch steps never take focus: landing in the prompt
			// would pop the keyboard on every swipe. Keyboard steps
			// keep the old path.
			if (focus) enterEditMode();
			return;
		}
		if (step.kind === "mint") {
			// File the leaving chat's drafts away first: resetDraftExtras
			// empties `annotations`, and the autosave effect would then
			// persist the empty list under the old id (draft restore
			// on return would come back blank).
			saveDraftAnnotations(
				chatState.activeChatId,
				annotations,
				chats.map((c) => c.id)
			);
			resetDraftExtras();
			// Minting switches without a transition, so the preview
			// clears here (transitionToChat covers its own path).
			// File first: returning to the abandoned chat later must
			// still land where it was left.
			saveChatScroll();
			previewChatId = null;
			newChat(chatState);
			scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
			// Minting brings you home (see doNewChat): an open
			// sidebar would park the prompt we are landing in.
			settings.sidebarCollapsed = true;
			persistSettings();
			if (focus) enterEditMode();
			void hapticBeatAsync("send", {
				enabled: settings.hapticsEnabled,
				shell: tauriBackendAvailable()
			});
			restartStepSlide(direction);
			return;
		}
		if (step.kind !== "goto") return;
		sideIdx = step.index;
		void hapticBeatAsync("send", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
		transitionToChat(step.id);
		// Landing is the switch effect's job (filed position, else
		// top): a smooth top-scroll here would fight the restore.
		if (focus) enterEditMode();
		restartStepSlide(direction);
	}

	/**
	 * Chat-step slide (touch swipes): the incoming chat glides in from
	 * the swipe side instead of jumping. Null-then-frame restarts the
	 * keyframes even for same-direction repeats; the animationend
	 * handler clears the class. Phone-only via the classes below —
	 * desktop steps instant.
	 */
	let chatStepDir: 1 | -1 | null = $state(null);
	function restartStepSlide(direction: 1 | -1): void {
		chatStepDir = null;
		requestAnimationFrame(() => {
			chatStepDir = direction;
		});
	}

	/** Enter the cursor chat from the keyboard, close the list, and land in its prompt. */
	function enterSideChat(): void {
		const chats = chatState.chats;
		const at = clampChatIndex(sideIdx, chats.length);
		if (at === null) return;
		const item = chats[at];
		if (!item) return;
		sideIdx = chats.indexOf(item);
		transitionToChat(item.id);
		settings.sidebarCollapsed = true;
		persistSettings();
		enterEditMode();
	}

	/**
	 * Delete key on a focused sidebar chat: drop it and land on the chat
	 * below (deleteChat slides there, or mints a blank when the list
	 * empties). The list re-renders async, so clamp the cursor now and
	 * focus the laid-out row on the next frame.
	 */
	function deleteSideChat(): void {
		const chats = chatState.chats;
		const at = clampChatIndex(sideIdx, chats.length);
		if (at === null) return;
		const item = chats[at];
		if (!item) return;
		dropChat(item.id);
		sideIdx = clampChatIndex(at, chatState.chats.length) ?? -1;
		requestAnimationFrame(() => focusSideChat(sideIdx));
	}

	/** Unsent composer extras quote one chat's messages — never carry over. */
	function resetDraftExtras(): void {
		annotations = [];
		reviewOpen = false;
		editingId = null;
		editDraft = "";
		editingMsgId = null;
		editingAttachments = [];
		editor?.setPlaceholder(promptPlaceholder());
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		annDraft = "";
		attachments = [];
		expandedPastes = [];
		// Pills are gone: their tags go too, or a stale marker would
		// reconcile away the next chat's first image.
		markerSyncMuted = true;
		try {
			if (editor) {
				const doc = editor.getText();
				if (
					countMarkers(doc) > 0 ||
					countMarkers(doc, FILE_MARKER) > 0 ||
					countPastedTags(doc) > 0
				) {
					editor.setText(stripPastedMarkers(stripAttachmentMarkers(doc)));
				}
			}
			prevMarkerCount = 0;
			prevFileMarkerCount = 0;
			prevPastedCount = 0;
		} finally {
			markerSyncMuted = false;
		}
		selMenu = null;
	}

	function doNewChat(): void {
		// A fresh chat opens medium (first), like settings.
		if (androidUI) {
			void hapticBeatAsync("first", {
				enabled: settings.hapticsEnabled,
				shell: tauriBackendAvailable()
			});
		}
		// File the abandoned chat's scroll before the fresh chat
		// resets the box: returning later lands where it was left.
		saveChatScroll();
		previewChatId = null;
		stopVoice();
		dismissSelPanels();
		// File the leaving chat's drafts away before resetDraftExtras
		// empties them — otherwise the autosave effect files the empty
		// list under the old chat's id and return-restore comes back
		// blank (same ordering as transitionToChat's save-before-load).
		saveDraftAnnotations(
			chatState.activeChatId,
			annotations,
			chatState.chats.map((c) => c.id)
		);
		resetDraftExtras();
		newChat(chatState);
		scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
		// A minted chat always shows its composer: focusing a hidden
		// bar focuses nothing (and the hidden restyle drops focus). An
		// open sidebar parks the prompt, so minting also brings you
		// home: the list closes like a row-pick.
		// Phones stay unfocused: auto-focus pops the keyboard over the
		// composer instead of pushing it up. Tap in when ready.
		settings.sidebarCollapsed = true;
		persistSettings();
		if (!androidUI) enterEditMode();
		else restorePrompt();
		// Every caller is an explicit user action (button, menu,
		// deep link, chord) — never the auto-mint — so this never
		// fires uninvited.
		flashToast("Chat created");
	}

	const useMock = mockProviderEnabled();
	/** Dev servers (and `tauri dev`) wear the red-dot tab logo. */
	const devBuild = import.meta.env.DEV === true;
	/**
	 * No-key lock: a keyed provider with a blank stored key locks the
	 * composer (no typing, locked hint) instead of accepting a draft
	 * into a doomed turn. Mock and keyless (on-device) never lock.
	 */
	const noKeyLock = $derived(
		composerLocked({
			mock: useMock,
			keyless:
				getProviderDef(settings.activeProviderId, settings.customProviders)
					.keyless === true ||
				isOnDeviceProvider(settings.activeProviderId),
			apiKey: settings.providers[settings.activeProviderId]?.apiKey ?? ""
		})
	);
	let wasLocked = false;
	$effect(() => {
		editor?.setDisabled(noKeyLock);
		// Locking wipes the live composer text (a provider switch must
		// not strand a dead draft over the locked hint); unlocking
		// restores the default hint. Nothing persists text drafts, so
		// nothing needs saving here.
		if (noKeyLock && !wasLocked) editor?.clear();
		if (noKeyLock)
			editor?.setPlaceholder("Set an API key in Settings to chat");
		else editor?.setPlaceholder(promptPlaceholder());
		wasLocked = noKeyLock;
	});
	const chat = $derived(activeChat(chatState));
	/**
	 * Hover preview: the sidebar row under the cursor shows its chat in
	 * the main column until the hover leaves. The composer, annotations,
	 * and active chat never switch — the preview is read-only (its
	 * action row and selection menu stay off) so every hovered index
	 * still addresses the real chat.
	 */
	let previewChatId: ChatId | null = $state(null);
	/**
	 * Sidebar hover preview yields to a live highlight: swapping the
	 * main column to another chat would pull the selection's nodes out
	 * from under it (killing the highlight mid-drag) and unmount the
	 * summoned menu via the preview gate. A deliberate highlight beats
	 * a passing glance — the hover previews again once it clears.
	 */
	function previewHover(id: ChatId): void {
		if (selMenu) return;
		if ((window.getSelection()?.toString() ?? "") !== "") return;
		// The preview renders its own inert copy of the empty chrome
		// below, so a live-open language list must not linger over it.
		openLangMenu = null;
		// File first: the peek swaps the box (whose empty-container
		// transient clamps to the top), and the leaving position must
		// survive both the peek and picking the peeked row.
		saveChatScroll();
		previewChatId = id;
	}

	/** End a hover preview, putting the box back where the active chat
	was left: the swap transient clamps to the top, and that clamp
	must neither file as the chat's position nor strand the box. */
	function endPreview(): void {
		if (previewChatId === null) return;
		previewChatId = null;
		const saved = chatScrollTops.get(chatState.activeChatId);
		if (saved === undefined || !scrollBox) return;
		flushSync();
		if (previewChatId === null && scrollBox)
			scrollBox.scrollTo({ top: saved, behavior: "instant" });
	}
	const previewChat = $derived(
		previewChatId && previewChatId !== chatState.activeChatId
			? (chatState.chats.find((c) => c.id === previewChatId) ?? null)
			: null
	);
	const viewChat = $derived(previewChat ?? chat);
	const previewing = $derived(previewChat !== null);
	const total = $derived(tokenTotal(chatState));
	const split = $derived(tokenSplit(chatState));
	const points = $derived(waypoints(chatState));
	const sourcesWanted = $derived(
		sourcesAsked(
			chat.messages.filter((m) => m.role === "user").map((m) => m.content)
		)
	);

	/** Prompt text minus pasted-image marker lines (images travel as attachments). */
	function composerText(): string {
		return stripAttachmentMarkers(editor?.getText() ?? "").trim();
	}


	/**
	 * Attachment/OCR failure: inline under the composer on desktop, a
	 * toast on Android (the composer sits behind the keyboard there, so
	 * inline errors go unseen).
	 */
	function failAttach(message: string): void {
		showNotice(notices, "inline", message);
		if (androidUI) flashErrorToast(message);
	}

	/**
	 * Intake for dropped/picked/pasted files: every file that survives
	 * becomes an attachment and earns its composer tag (`[Pasted
	 * image]` / `[Pasted Attachment]`, caret after each tag's space),
	 * mirroring the pill. Resolves with the added kinds in order for
	 * tag insertion.
	 */
	async function addFiles(files: File[]): Promise<AttachmentKind[]> {
		clearNotice(notices, "inline");
		const added: AttachmentKind[] = [];
		for (const file of files) {
			attachBusy += 1;
			try {
				const att = await fileToAttachment(file);
				attachments = [...attachments, att];
				added.push(att.kind);
			} catch (error) {
				failAttach(error instanceof Error ? error.message : String(error));
			} finally {
				attachBusy -= 1;
			}
		}
		return added;
	}

	function onImagesPasted(files: File[]): void {
		void addFiles(files).then((kinds) => insertAttachmentMarkers(kinds));
	}

	/**
	 * Over-threshold clipboard text (both editors): the text becomes a
	 * pasted-text attachment and earns its positional `[Pasted N chars]`
	 * tag at the caret, mirroring the file/image flow.
	 */
	function onLongTextPasted(text: string): void {
		if (!editor) return;
		const att = makePastedTextAttachment(text);
		attachments = [...attachments, att];
		markerSyncMuted = true;
		try {
			editor.insertText(
				pastedMarkerFor(editor, att.text?.length ?? text.length)
			);
			syncMarkerCounts();
		} finally {
			markerSyncMuted = false;
		}
	}

	/** Re-anchor all three tag counts to the live draft (after programmatic edits). */
	function syncMarkerCounts(): void {
		if (!editor) return;
		const doc = editor.getText();
		prevMarkerCount = countMarkers(doc);
		prevFileMarkerCount = countMarkers(doc, FILE_MARKER);
		prevPastedCount = countPastedTags(doc);
	}

	/* Tag → attachment reconciliation lives in $lib/attachments. */

	/**
	 * Marker text for one fresh attachment: right after a collapsed
	 * paste the tag rides the same line, one space apart (caret one
	 * space past the tag) — anywhere else the usual prefix applies.
	 */
	function attachmentMarkerFor(ed: PromptEditor, kind: AttachmentKind): string {
		const doc = ed.getText();
		const afterPaste = caretAfterPaste(ed.getPastes(), ed.selectionHead());
		return kind === "image"
			? imageMarkerInsert(doc, afterPaste)
			: fileMarkerInsert(doc, afterPaste);
	}

	/** One tag per fresh attachment, caret after each tag's space. */
	function insertAttachmentMarkers(kinds: AttachmentKind[]): void {
		if (!editor || kinds.length === 0) return;
		markerSyncMuted = true;
		try {
			for (const kind of kinds) {
				editor.insertText(attachmentMarkerFor(editor, kind));
			}
			syncMarkerCounts();
		} finally {
			markerSyncMuted = false;
		}
	}

	/**
	 * Marker text for one fresh pasted-text attachment: same caret
	 * contract as file/image tags (see attachmentMarkerFor).
	 */
	function pastedMarkerFor(ed: PromptEditor, chars: number): string {
		const doc = ed.getText();
		const afterPaste = caretAfterPaste(ed.getPastes(), ed.selectionHead());
		return pastedMarkerInsert(doc, chars, afterPaste);
	}

	/**
	 * Attachment pill <-> tag two-way removal (images and files).
	 * Nth tag pairs with the Nth attachment of its kind, both ways.
	 * Pill → tag: dropping the pill removes its own marker tag from
	 * the draft (prose typed beside it survives). Tag → pill lives in
	 * `promptOptions().onDocChange`: deleted occurrences carry their
	 * document-order indexes, so the matching attachments go with
	 * them (position-less paths fall back to newest-first).
	 * `markerSyncMuted` bridges the two (programmatic edits must not
	 * reconcile against themselves); the `prev*Count` pair is the last
	 * reconciled state.
	 */
	let markerSyncMuted = false;
	let prevMarkerCount = 0;
	let prevFileMarkerCount = 0;
	let prevPastedCount = 0;

	/**
	 * Clipboard supplier for composer tag copy/cut: the image
	 * attachments at these document-order indexes as clipboard-safe
	 * PNG blobs (Chromium writes PNG only — see clipboardPngBlob). Nth
	 * tag pairs with the Nth attachment, so a middle cut carries its
	 * own pictures. The list read runs synchronously at call time so
	 * a cut's own deletion can't race it.
	 */
	function copyImageTagBlobs(
		list: Attachment[],
		indexes: number[]
	): Promise<Blob[]> {
		return attachmentImageBlobsAt(list, indexes).then((blobs) =>
			Promise.all(blobs.map((blob) => clipboardPngBlob(blob)))
		);
	}

	/**
	 * Attachment-card copy (icon-only, reusing the message-button copy
	 * glyph): text attachments copy their inlined text; images copy the
	 * image bytes (ClipboardItem) so a paste lands the picture, not a
	 * data URL. Toasts read "Copied" like every other copy path.
	 */
	function copyAttachment(att: Attachment): void {
		if (att.kind === "text" && att.text !== null) {
			copyPlain(att.text, "Copied");
			return;
		}
		if (att.kind === "image" && att.dataUrl) {
			const failed = "Couldn't copy to the clipboard.";
			if (!navigator.clipboard?.write) {
				flashErrorToast(failed);
				return;
			}
			void (async () => {
				try {
					const blob = await (await fetch(att.dataUrl as string)).blob();
					await navigator.clipboard.write([
						new ClipboardItem({ [blob.type || "image/jpeg"]: blob })
					]);
					flashToast("Copied");
				} catch {
					flashErrorToast(failed);
				}
			})();
			return;
		}
		flashToast("Nothing to copy yet.");
	}

	/**
	 * Preview models for the leftovers strip: one per attachment with
	 * no literal left in the message text (literals rebuild inline
	 * instead, so each file shows exactly once).
	 */
	function sentTagModels(msg: ChatMsg, base: string): AttachTagModel[] {
		return sentTagModelsFor(msg.attachments ?? [], base, msg.id, expandedTags);
	}

	// Tray drag-to-scroll (mouse only; touch scrolls natively): with
	// many cards the strip overflows, so a press-drag pans it. Past a
	// small slop the gesture owns the click — the capture gate below
	// swallows it, so a drag ending on OCR or X never fires either.
	let stripDragX = 0;
	let stripDragLeft = 0;
	let stripDragArmed = false;
	let stripDragMoved = false;
	let stripDragging = $state(false);
	function stripDragStart(event: PointerEvent): void {
		if (!event.isPrimary || event.pointerType === "touch" || event.button !== 0)
			return;
		const ul = event.currentTarget;
		if (!(ul instanceof HTMLElement)) return;
		stripDragX = event.clientX;
		stripDragLeft = ul.scrollLeft;
		stripDragArmed = true;
		stripDragMoved = false;
		// Native image drag would fight the pan: claim the gesture.
		event.preventDefault();
	}
	function stripDragMove(event: PointerEvent): void {
		if (!stripDragArmed) return;
		const ul = event.currentTarget;
		if (!(ul instanceof HTMLElement)) return;
		const dx = event.clientX - stripDragX;
		if (!stripDragMoved && Math.abs(dx) < 6) return;
		stripDragMoved = true;
		stripDragging = true;
		// Capture only once the gesture is really a pan: capturing on
		// press would retarget pointerup to the row, and plain clicks
		// on the card buttons would never reach them.
		try {
			ul.setPointerCapture(event.pointerId);
		} catch {
			// Pointer already gone (cancel raced us): the pan still
			// applied above, and pointerup has nothing to retarget.
		}
		ul.scrollLeft = stripDragLeft - dx;
	}
	function stripDragEnd(event: Event): void {
		stripDragging = false;
		stripDragArmed = false;
		// A cancel fires no click, so only it resets here: pointerup
		// leaves the flag for the gate below (keyboard clicks need no
		// pointerdown, so a stale flag must never survive one).
		if (event.type === "pointercancel" || event.type === "cancel")
			stripDragMoved = false;
	}
	function stripClickGate(event: MouseEvent): void {
		if (!stripDragMoved) return;
		stripDragMoved = false;
		event.stopPropagation();
		event.preventDefault();
	}
	/**
	 * Pill X: drop the pill plus its own tag, and any
	 * attachment-scoped error with it. The pill's index among its
	 * kind (Nth pill pairs with the Nth tag) picks the tag — never
	 * the first of its kind, so deleting the first of two images
	 * keeps the second's preview. Pasted-text pills drop their own
	 * `[Pasted N chars]` tag the same way.
	 */
	function removeAttachment(id: string): void {
		const at = attachments.findIndex((a) => a.id === id);
		if (at < 0) return;
		const removed = attachments[at];
		if (!removed) return;
		attachments = attachments.filter((a) => a.id !== id);
		expandedPastes = expandedPastes.filter((k) => k !== id);
		clearNotice(notices, "inline");
		if (editor) {
			markerSyncMuted = true;
			try {
				// Minimal cut, never a full rewrite: a rewrite drops the
				// paste-marker decorations and unfolds the draft's folds.
				if (isPastedTextAttachment(removed)) {
					const pastedIndex = attachments
						.slice(0, at)
						.filter(isPastedTextAttachment).length;
					editor.excisePastedAt(pastedIndex);
				} else {
					// File pills count file drops only (pasted-text pills
					// share kind "text" but own no FILE_MARKER tag).
					const kindIndex =
						removed.kind === "image"
							? attachments.slice(0, at).filter((a) => a.kind === "image")
									.length
							: attachments
									.slice(0, at)
									.filter(
										(a) => a.kind === "text" && !isPastedTextAttachment(a)
									).length;
					editor.exciseMarkerAt(
						removed.kind === "image" ? IMAGE_MARKER : FILE_MARKER,
						kindIndex
					);
				}
				syncMarkerCounts();
			} finally {
				markerSyncMuted = false;
			}
		}
	}

	/** Expanded pasted-text pills (excerpt ↔ full text), ephemeral UI state. */
	let expandedPastes = $state<string[]>([]);

	/** Pasted-text pill excerpt toggle (independent across pills). */
	function togglePastedExpand(id: string): void {
		expandedPastes = expandedPastes.includes(id)
			? expandedPastes.filter((k) => k !== id)
			: [...expandedPastes, id];
	}

	/**
	 * On-device OCR for one attached image (macOS Vision bridge): the
	 * recognized text is inserted into the composer as selectable text,
	 * so it flows into the existing pinyin/furigana pipeline when sent.
	 * Outside the Mac shell the bridge rejects and the friendly error
	 * lands in the notice queue's inline slot — never a throw into UI teardown.
	 */
	let ocrBusyId: string | null = $state(null);

	async function recognizeAttachment(att: Attachment): Promise<void> {
		if (ocrBusyId !== null || att.kind !== "image" || !att.dataUrl) return;
		// Native first (macOS Vision, Windows WinRT, Linux system
		// Tesseract); anywhere else the WASM fallback runs in-client
		// (one download, cached offline after).
		const native = await ocrSupported();
		// Vision ships no model for some scripts (Devanagari, Hebrew,
		// Greek, … — probe-verified on-device): those skip the doomed
		// native pass and read through the WASM fallback's matching
		// traineddata instead of English-shaped fragments.
		const fallbackLangs =
			!native || !visionSupports(activeReplyCode)
				? ocrFallbackLangs(activeReplyCode)
				: null;
		ocrBusyId = att.id;
		clearNotice(notices, "inline");
		try {
			// No language hint: the backend's learner default covers
			// English + CJK scripts. Passing the Latin TTS fallback
			// here restricted Vision to English, so Chinese paragraphs
			// missed entirely and surfaced as red errors. The WASM
			// fallback takes the reply's traineddata instead.
			let result = fallbackLangs
				? await recognizeFallbackText(att.dataUrl, fallbackLangs)
				: await recognizeImageText(att.dataUrl, null);
			// A weak native pass may be the wrong script (Cyrillic under
			// the CJK-led default comes back as fragments): one
			// reply-led retry, keep the better pass. Retry errors
			// never sink the first observation.
			if (!fallbackLangs && result.confidence < OCR_RETRY_BELOW) {
				try {
					const retry = await recognizeImageText(
						att.dataUrl,
						ocrRetryHint(activeReplyCode)
					);
					result = keepBestRecognition(result, retry);
				} catch {
					// First pass stands.
				}
			}
			// A weak fallback pass is usually the wrong script: the
			// reply language picks the models, not the image, so an
			// English-led pass on a Japanese paragraph scores low.
			// Detect the image's own script and retry once with its
			// traineddata; detection can never sink the first pass.
			if (fallbackLangs && result.confidence < OCR_RETRY_BELOW) {
				try {
					const detected = await detectFallbackScript(att.dataUrl);
					const retryLangs = detected?.langs;
					if (
						retryLangs &&
						ocrLangsKey(retryLangs) !== ocrLangsKey(fallbackLangs)
					) {
						const retry = await recognizeFallbackText(att.dataUrl, retryLangs);
						result = keepBestRecognition(result, retry);
					}
				} catch {
					// First pass stands.
				}
			}
			const text = result.text.trim();
			if (!text) {
				// A miss is routine feedback (wrong crop, handwriting),
				// not a composer-blocking fault: toast, never the inline
				// slot, so nothing red lingers over the next draft.
				flashErrorToast("No text found in this image.");
			} else {
				// Same-line landing like the image tag: trailing space,
				// never a newline — the caret stays beside the text so
				// the next keystroke continues it instead of opening a
				// fresh line below.
				editor?.insertText(`${text} `);
				flashToast("Recognized text inserted");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failAttach(
				fallbackLangs
					? friendlyFallbackError(message)
					: friendlyOcrError(message)
			);
		} finally {
			ocrBusyId = null;
		}
	}

	/** Delegated history-tag popup action: the inline card's
	 * Copy/OCR buttons carry data attributes (raw `{@html}` holds no
	 * Svelte handlers). Missing attachments stay silent — a card can
	 * outlive its message's files across a restore.
	 */
	function sentTagAction(action: SentTagAction, id: string): void {
		const stored =
			activeChat(chatState)?.messages.flatMap((m) => m.attachments ?? []) ?? [];
		const att = stored.find((a) => a.id === id);
		if (!att) return;
		if (action === "ocr") void recognizeAttachment(att);
		else copyAttachment(att);
	}

	/** Expanded history attachment tags (fold-open), ephemeral UI state
	 * keyed `${message.id}:${attachment.id}` — collapsed by default on
	 * every mount, unlike paste folds which persist open on the message.
	 */
	let expandedTags = $state<string[]>([]);

	/** History tag fold toggle (see toggleTagKey): replace the key
	list, never mutate. */
	function toggleSentTag(msg: ChatMsg, attId: string): void {
		expandedTags = toggleTagKey(expandedTags, msg.id, attId);
	}

	function toggleFold(id: ChatMsgId): void {
		// A message under in-place edit never folds: the edit box
		// lives where the text sat, and folding it away would strand
		// the draft (keyboard, alt-click, and button share this gate).
		if (editingMsgId === id) return;
		if (androidUI) {
			void hapticBeatAsync("tap", {
				enabled: settings.hapticsEnabled,
				shell: tauriBackendAvailable()
			});
		}
		// Anchor the message in place: collapsing its height reflows
		// the thread and the browser lands it mid-screen, so pin the
		// scroll offset across the render instead of scrolling anywhere.
		const index = viewChat.messages.findIndex((m) => m.id === id);
		const article = index >= 0 ? document.querySelector(`#msg-${index}`) : null;
		const top =
			article instanceof HTMLElement
				? article.getBoundingClientRect().top
				: null;
		if (foldedIds.has(id)) foldedIds.delete(id);
		else foldedIds.add(id);
		if (top !== null && scrollBox instanceof HTMLElement) {
			flushSync();
			const now = index >= 0 ? document.querySelector(`#msg-${index}`) : null;
			if (now instanceof HTMLElement) {
				scrollBox.scrollTop += now.getBoundingClientRect().top - top;
			}
		}
	}

	/** Light UI tick (phones): button taps with no visible
	confirmation of their own. Gated by the haptics toggle. */
	function buzzTap(): void {
		if (!androidUI) return;
		void hapticBeatAsync("tap", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
	}
	/** Stern denial buzz (phones): refused actions. */
	function buzzNo(): void {
		if (!androidUI) return;
		void hapticBeatAsync("no", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
	}
	/** Copy confirmation without doubling the OS: Android 13+ shows
	its own system "Copied" overlay on every write, so our toast
	stands down there; older Android, iOS, and desktop keep ours
	(the clipboard gives no visible confirmation of its own). */
	function flashCopyToast(note: string): void {
		if (osConfirmsClipboard(androidMajorFromUA(navigator.userAgent)))
			return;
		flashToast(note);
	}

	function copyPlain(text: string, note: string): void {
		// Every copy button ticks: the clipboard gives no visible
		// confirmation of its own.
		buzzTap();
		const failed = "Couldn't copy to the clipboard.";
		if (!navigator.clipboard) {
			flashErrorToast(failed);
			return;
		}
		void navigator.clipboard.writeText(text).then(
			() => flashCopyToast(note),
			() => flashErrorToast(failed)
		);
	}

	function copyText(content: string, role: string): void {
		copyPlain(messageCopyText(content, role, sourcesWanted), "Copied");
	}

	/** Copy one annotation (either overlay): quote plus comment, no numbers. */
	function copyAnnotation(quote: string, comment: string): void {
		copyPlain(annotationCopyText(quote, comment), "Copied");
	}

	/**
	 * Cut the hovered message: the clipboard write must land first —
	 * deleting up front would strand the text when copying fails.
	 */
	function cutHoverMessage(index: number): void {
		const target = chat.messages[index];
		if (!target) return;
		const text = plainBody(target.content, target.role, sourcesWanted);
		const done = navigator.clipboard?.writeText(text);
		if (done === undefined) {
			flashErrorToast("Couldn't copy to the clipboard.");
			return;
		}
		void done.then(
			() => {
				stopAudioForMessage(target.id);
				deleteMessage(chatState, index);
				flashCopyToast("Cut to clipboard");
			},
			() => flashErrorToast("Couldn't copy to the clipboard.")
		);
	}

	/** Article element owning a DOM node, or null outside messages. */
	function articleOf(node: Node | null): Element | null {
		const element = node instanceof Element ? node : node?.parentElement;
		return element?.closest('article[id^="msg-"]') ?? null;
	}

	/** Message id owning the selection anchor, or null outside messages. */
	function selectedMessageId(selection: Selection): ChatMsgId | null {
		const article = articleOf(selection.anchorNode);
		if (!article) return null;
		const index = messageIndexFromId(article.id, chat.messages.length);
		if (index === null) return null;
		return chat.messages[index]?.id ?? null;
	}

	/** Viewed-message index under a tap point (multi-finger deletes):
	articles carry msg-{index} ids; anything else is not a message. */
	function messageIndexAtPoint(
		clientX: number,
		clientY: number
	): number | null {
		const target = document.elementFromPoint(clientX, clientY);
		const article = target ? articleOf(target) : null;
		if (!(article instanceof HTMLElement)) return null;
		return messageIndexFromId(article.id, viewChat.messages.length);
	}

	/** Two-finger double-tap: land the tapped message's end above the
	composer dock (prompt plus the message's own buttons row, which
	sits below its text) — the old single-finger pair's math, moved
	here so single taps keep native word select. Empty space jumps
	the thread bottom instead. */
	function scrollMessageEndIntoView(clientX: number, clientY: number): void {
		const tapEl = document.elementFromPoint(clientX, clientY);
		const art = tapEl ? articleOf(tapEl) : null;
		const dockReserve =
			(document.querySelector(".prompt")?.getBoundingClientRect().height ?? 0) +
			48;
		if (art instanceof HTMLElement && scrollBox) {
			const area = scrollBox.getBoundingClientRect();
			const dy =
				art.getBoundingClientRect().bottom - (area.bottom - dockReserve);
			if (dy > 0) scrollBox.scrollBy({ top: dy, behavior: "smooth" });
		} else if (scrollBox) {
			scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
		}
		// Quiet-tick gate (Android-only, honors the haptic toggle):
		// a jump is a UI affordance, not a sent action.
		buzzTap();
	}

	/** Prose block owning a tap point's text (rendered message only),
	with the caret range at the point. Null outside message text. */
	function textBlockAtPoint(
		clientX: number,
		clientY: number
	): { block: Element; range: Range } | null {
		if (typeof document.caretRangeFromPoint !== "function") return null;
		let range: Range | null;
		try {
			range = document.caretRangeFromPoint(clientX, clientY);
		} catch {
			return null;
		}
		const node = range?.startContainer;
		if (!range || !node) return null;
		const element = node instanceof Element ? node : node.parentElement;
		const rendered = element?.closest(".messages .rendered") ?? null;
		if (!(rendered instanceof Element)) return null;
		const block =
			element?.closest("p, li, pre, td, blockquote, h1, h2, h3, h4, div") ??
			null;
		if (!(block instanceof Element) || !rendered.contains(block))
			return rendered ? { block: rendered, range } : null;
		return { block, range };
	}

	/** Caret offset of (node, offset) within the block's text. */
	function caretOffsetInBlock(
		block: Element,
		node: Node,
		offset: number
	): number {
		let at = 0;
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
		let current = walker.nextNode();
		while (current) {
			if (current === node)
				return at + Math.min(offset, current.textContent?.length ?? 0);
			at += current.textContent?.length ?? 0;
			current = walker.nextNode();
		}
		return at;
	}

	/** (node, sub-offset) owning a block-text offset. */
	function nodeAtBlockOffset(
		block: Element,
		offset: number
	): { node: Node; offset: number } | null {
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
		let at = 0;
		let current = walker.nextNode();
		let last: Node | null = null;
		let lastLength = 0;
		while (current) {
			const length = current.textContent?.length ?? 0;
			if (offset <= at + length) return { node: current, offset: offset - at };
			at += length;
			last = current;
			lastLength = length;
			current = walker.nextNode();
		}
		return last ? { node: last, offset: lastLength } : null;
	}

	/** Triple-tap: select the sentence around the tap point. False
	keeps native behavior (the override never fires blind). */
	function selectSentenceAtPoint(clientX: number, clientY: number): boolean {
		const found = textBlockAtPoint(clientX, clientY);
		const selection = window.getSelection();
		if (!found || !selection) return false;
		const text = found.block.textContent ?? "";
		const caret = caretOffsetInBlock(
			found.block,
			found.range.startContainer,
			found.range.startOffset
		);
		const [start, end] = sentenceBounds(text, caret);
		if (end <= start) return false;
		const anchor = nodeAtBlockOffset(found.block, start);
		const focus = nodeAtBlockOffset(found.block, end);
		if (!anchor || !focus) return false;
		try {
			selection.setBaseAndExtent(
				anchor.node,
				anchor.offset,
				focus.node,
				focus.offset
			);
		} catch {
			return false;
		}
		return !selection.isCollapsed;
	}

	/** Double-tap: select the word around the tap point. The native
	double-tap gesture never fires for touch here (`touch-action:
	manipulation` on html/body eats it — verified on-device: the pair
	produces one empty selectionchange), so the run takes the word
	itself (Segmenter bounds, CJK-aware) instead of leaving the pair
	to the OS. Mouse double-click is unaffected. False keeps native
	behavior. */
	function selectWordAtPoint(clientX: number, clientY: number): boolean {
		const found = textBlockAtPoint(clientX, clientY);
		const selection = window.getSelection();
		if (!found || !selection) return false;
		const text = found.block.textContent ?? "";
		const caret = caretOffsetInBlock(
			found.block,
			found.range.startContainer,
			found.range.startOffset
		);
		const span = wordBoundsAt(text, caret);
		if (!span) return false;
		const anchor = nodeAtBlockOffset(found.block, span[0]);
		const focus = nodeAtBlockOffset(found.block, span[1]);
		if (!anchor || !focus) return false;
		try {
			selection.setBaseAndExtent(
				anchor.node,
				anchor.offset,
				focus.node,
				focus.offset
			);
		} catch {
			return false;
		}
		return !selection.isCollapsed;
	}

	/** Quadruple-tap: select the whole paragraph block. */
	function selectParagraphAtPoint(clientX: number, clientY: number): boolean {
		const found = textBlockAtPoint(clientX, clientY);
		const selection = window.getSelection();
		if (!found || !selection) return false;
		try {
			const range = document.createRange();
			range.selectNodeContents(found.block);
			selection.removeAllRanges();
			selection.addRange(range);
		} catch {
			return false;
		}
		return !selection.isCollapsed;
	}

	function currentQuote(): {
		quote: string;
		context: string;
		messageId: ChatMsgId;
	} | null {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return null;
		const inRendered =
			selection.anchorNode instanceof Element
				? selection.anchorNode
				: selection.anchorNode?.parentElement;
		if (!inRendered?.closest(".rendered")) return null;
		// Math picks normalize to the whole equation: a partial glyph
		// pick quotes a shard that never re-matches, so when both ends
		// sit in one equation the range expands over its body first.
		const anchorBody = equationBodyOf(selection.anchorNode);
		if (anchorBody && equationBodyOf(selection.focusNode) === anchorBody) {
			try {
				const whole = equationBodyRange(anchorBody);
				if (!whole) return null;
				selection.removeAllRanges();
				selection.addRange(whole);
			} catch {
				// A disturbed range keeps the partial pick below.
			}
		}
		// Clone the range and drop badge buttons and ruby readings:
		// selecting across an existing annotation would otherwise bake
		// its number into the new quote ("Kyoto1 in two sentences"),
		// and ruby would bake its readings in with the base text.
		const frag = selection.getRangeAt(0).cloneContents();
		const quote = quoteFragmentText(frag);
		if (!quote) return null;
		const messageId = selectedMessageId(selection);
		if (!messageId) return null;
		// The paragraph holding the highlight: a lone Han char can
		// never carry kana itself, so Inspect guesses its locale from
		// this text instead. Ruby readings ride along in textContent,
		// but furigana only annotates Japanese lines, so the guess
		// still points the right way.
		const anchorEl =
			selection.anchorNode instanceof Element
				? selection.anchorNode
				: selection.anchorNode?.parentElement;
		const context = (anchorEl?.closest("p, li")?.textContent ?? "").slice(
			0,
			2000
		);
		return { quote, context, messageId };
	}

	function onSelectEnd(event: MouseEvent, cursorX?: number): void {
		if (event.altKey) return; // Option-click folds; never a menu.
		const live = window.getSelection();
		// Picks rooted in the annotation UI (review card, pill) are
		// never annotatable: skip the message locks and snaps so the
		// native pick stays exactly as drawn (stays copyable), and
		// summon nothing.
		const anchorEl =
			live?.anchorNode instanceof Element
				? live.anchorNode
				: live?.anchorNode?.parentElement;
		if (anchorEl && isAnnotationUiTarget(anchorEl)) return;
		// Selections never span messages: a drag crossing into another
		// article trims back to the anchor message's edge first.
		if (live) lockSelectionToMessage(live, articleOf);
		// Multi-click picks grab the block terminator newline,
		// painting the line beneath the highlight (the quote trims it
		// anyway): drop it before the menu reads the quote. A word
		// pick with no trailing newline passes through untouched, so
		// double-click stays safe. Deliberate drags into the next
		// line keep theirs.
		if (event.detail >= 2 && live && live.rangeCount > 0) {
			try {
				trimParagraphTerminator(live.getRangeAt(0));
			} catch {
				// Cosmetic: the untrimmed pick still summons.
			}
		}
		// The create marker never splits a word in half: boundaries cut
		// mid-word snap out to the word's edges before the menu reads
		// the quote (CJK has no word characters, so it never snaps).
		if (live) snapSelectionToWordEdges(live);
		placeSelMenu(cursorX, event.clientY);
	}

	function placeSelMenu(cursorX?: number, cursorY?: number): void {
		ensureSwapObserver();
		// Never summon off preview content: the main column is showing
		// another chat, so the quote would pair with the active chat's
		// message id and Annotate would anchor garbage. The hover gate
		// (previewHover) normally prevents reaching here mid-preview.
		if (previewing) {
			selMenu = null;
			return;
		}
		const found = currentQuote();
		if (!found) {
			selMenu = null;
			return;
		}
		const live = window.getSelection();
		const rect = live?.rangeCount
			? live.getRangeAt(0).getBoundingClientRect()
			: null;
		if (!rect) {
			selMenu = null;
			return;
		}
		// A release in another article than the highlight (the drag
		// crossed messages) would dock the menu to the stray cursor,
		// stranding Annotate on a message with no highlight: fall back
		// to the highlight's own rect so the menu stays on the quoted
		// message. Releases outside any article keep the cursor (the
		// gap below a message still docks near the pointer).
		let atX = cursorX;
		let atY = cursorY;
		if (atX !== undefined && atY !== undefined && live && live.rangeCount > 0) {
			const at = document.elementFromPoint(atX, atY);
			const quoteArticle = articleOf(live.anchorNode);
			if (
				quoteArticle &&
				at &&
				articleOf(at) &&
				articleOf(at) !== quoteArticle
			) {
				atX = undefined;
				atY = undefined;
			}
		}
		// The live range, so menu hover can put the highlight back:
		// WebKit empties the document selection when the pointer moves
		// onto the floating menu (no DOM change, no press). Nothing
		// mutates in that path, so these nodes stay valid.
		const stored =
			live && live.rangeCount > 0 ? live.getRangeAt(0).cloneRange() : null;
		const { x, y } = selMenuPlacement({
			cursorX: atX,
			cursorY: atY,
			rectLeft: rect.left,
			rectTop: rect.top,
			rectBottom: rect.bottom,
			rectWidth: rect.width,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
			androidUI,
			iosUI,
			menuWidth: selMenuWidthEstimate(
				found.quote,
				androidUI,
				settings.inspectEnabled
			)
		});
		// The rescue in the selectionchange auto-dismiss restores the
		// stored range while nothing newer landed (see selMenuOpenedAt).
		selMenuOpenedAt = Date.now();
		selMenu = {
			x,
			y,
			left: rect.left,
			w: rect.width,
			quote: found.quote,
			context: found.context,
			messageId: found.messageId,
			range: stored
		};
		// No prompt summon: the menu floats viewport-fixed on every
		// platform now (the old phone dock needed the composer shown).
	}

	/**
	 * Menu hover enter: WebKit empties the document selection when the
	 * pointer moves onto the floating menu (no DOM change, no press —
	 * Chromium keeps it), so put the stored live range back and the
	 * highlight survives the trip to Annotate. Nothing mutated, so the
	 * stored nodes are still valid; never stomps a non-empty selection,
	 * and one restore per enter is enough (the engine clears once).
	 */
	function enterSelMenu(): void {
		selMenuHover = true;
		const range = selMenu?.range;
		if (!range) return;
		const live = window.getSelection();
		if (!live || live.toString() !== "") return;
		try {
			if (
				!document.contains(range.startContainer) ||
				!document.contains(range.endContainer)
			)
				return;
			live.removeAllRanges();
			live.addRange(range);
		} catch {
			// Cosmetic: the menu stands on its stored quote regardless.
		}
	}

	function clearSelection(): void {
		lastProgrammaticClearAt = Date.now();
		window.getSelection()?.removeAllRanges();
	}

	/**
	 * Which repeat of a quote the live selection starts in: resolves the
	 * range start against the message's rendered text nodes and counts
	 * the stripped occurrence holding it. Never throws — selection APIs
	 * disagree across engines, and anything odd keeps 0 (first match).
	 */
	function occurrenceFromSelection(
		messageId: ChatMsgId,
		quote: string
	): number {
		try {
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return 0;
			const range = selection.getRangeAt(0);
			let node: Node | null = range.startContainer;
			let offset = range.startOffset;
			// Whole-node starts (triple-click paragraphs) resolve to
			// their first text: the occurrence holding the span's start.
			if (!(node instanceof Text)) {
				const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
				const firstText = walker.nextNode();
				if (!(firstText instanceof Text)) return 0;
				node = firstText;
				offset = 0;
			}
			const index = chat.messages.findIndex((m) => m.id === messageId);
			if (index === -1) return 0;
			const root = document.querySelector(`article#msg-${index} .rendered`);
			if (!(root instanceof HTMLElement)) return 0;
			const nodes = quoteTextNodes(root);
			const nodeIndex = node instanceof Text ? nodes.indexOf(node) : -1;
			if (nodeIndex === -1) return 0;
			return occurrenceAtPosition(
				nodes.map((n) => n.textContent ?? ""),
				quote,
				nodeIndex,
				offset
			);
		} catch {
			return 0;
		}
	}

	/** Annotate at the cursor: the comment pill opens where the selection
	was — never down in the composer. Enter saves, Escape cancels. The
	annotation stays pending (no badge, no count) until submit. */
	function annotate(initialComment: string = ""): void {
		if (!selMenu) return;
		if (!selMenu.quote.trim()) {
			clearSelection();
			selMenu = null;
			return;
		}
		// Starting over submits whatever is being composed first: typed
		// comments are never silently dropped.
		if (pendingAnn) commitPending();
		// An in-prompt note edit owns the composer: filing it first
		// hands the draft back before the new annotation takes over.
		if (promptAnnEdit) commitPromptAnnEdit();
		const quote = selMenu.quote.trim();
		// Repeats disambiguate here, from the live selection: the
		// last "c" in "ccc" records occurrence 2, so its badge
		// lands where the highlight was. Anything unresolvable
		// keeps 0 (first match, the old behavior).
		const at = occurrenceFromSelection(selMenu.messageId, quote);
		// A quote picked from vocalized (tashkeel) text locates against
		// that text only: its badge shows while the aid is on, never on
		// the bare form.
		const aidScope = aidModelPin.has(selMenu.messageId)
			? ("tashkeel" as const)
			: undefined;
		// Same span twice would stack two badges on one anchor (and
		// hovering them oscillates): open the review on the existing
		// one instead of filing a twin.
		const dupe = duplicateAnnotationId(
			annotations,
			selMenu.messageId,
			quote,
			at,
			aidScope
		);
		if (dupe) {
			clearSelection();
			selMenu = null;
			highlightAnnId = dupe;
			reviewOpen = true;
			flashToast("Already annotated");
			return;
		}
		const pending: Annotation = {
			id: newAnnotationId(),
			messageId: selMenu.messageId,
			quote,
			comment: "",
			at,
			...(aidScope ? { aidScope } : {})
		};
		pendingAnn = pending;
		// Voice readback on: the filed quote reads itself back out.
		if (voiceOn()) void speakQuote(quote, selMenu.messageId, true, selMenu.context);
		clearSelection();
		// Phones file the comment in the composer, never the
		// transplanted pill (its textbox can't reliably summon the
		// phone keyboard — see editAnnotationInPrompt). Desktop
		// falls through to the popover below.
		if (androidUI) {
			selMenu = null;
			highlightAnnId = pending.id;
			editAnnotationInPrompt({ pending: true }, initialComment);
			if (settings.hapticsEnabled) vibrateTick(6);
			return;
		}
		const width = popWidth(true);
		// The comment box sits a breath below the Annotate menu's
		// anchor: sharing selMenu.y leaves it floating high above tall
		// CJK lines. Narrow highlights center the box over themselves;
		// wide ones keep the end-of-selection placement. The Annotate
		// button itself never moves (stays at the cursor end).
		// Phone: the keyboard eats the lower screen, so the composer
		// pins high and centered instead of at the selection — it is
		// never covered, wherever the quote sits.
		const { x, y } = placeAnnComposer({
			android: androidUI,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
			width,
			menuX: selMenu.x,
			menuY: selMenu.y,
			highlightLeft: selMenu.left,
			highlightWidth: selMenu.w
		});
		selMenu = null;
		highlightAnnId = pending.id;
		annDraft = initialComment;
		settleAnnPop();
		annPop = { id: pending.id, x, y, fresh: true };
		// The pill mounts async: land the caret once it flushes, or
		// phone users get a comment box with no keyboard (and desktop
		// users an extra click). Focus-only — selection is already filed.
		// Phones re-pin the scroll behind the focus: some WebViews pan
		// on textbox focus despite preventScroll, snapping the thread.
		if (androidUI) {
			const sx = window.scrollX;
			const sy = window.scrollY;
			const box = scrollBox;
			const st = box?.scrollTop ?? 0;
			void tick().then(() => {
				annPopBox?.focus({ preventScroll: true });
				window.scrollTo(sx, sy);
				if (box) box.scrollTop = st;
			});
		} else {
			void tick().then(() => annPopBox?.focus({ preventScroll: true }));
		}
		if (settings.hapticsEnabled) vibrateTick(6);
	}

	/** Paragraph holding a quote, for the answer request's context. */
	function answerContextFor(messageId: ChatMsgId, quote: string): string {
		const msg = chatState.chats
			.flatMap((c) => c.messages)
			.find((m) => m.id === messageId);
		return paragraphForQuote(msg ? aidDisplayText(msg.content) : "", quote);
	}

	/** Fire one annotation's separate model request (the remodel):
	never linked to the main prompt or history — later questions file
	while earlier ones are still waiting. Failures banner (toast on
	phones) and leave the badge neutral; the question keeps its note. */
	async function askAnnotation(ann: Annotation): Promise<void> {
		annAnswering.add(ann.id);
		try {
			const provider = await resolveProviderActive();
			if (!provider) {
				const message = "Set an API key first — open Settings.";
				showNotice(notices, "banner", message);
				if (androidUI) flashErrorToast(message);
				return;
			}
			clearNotice(notices, "banner");
			const answer = await annotationAnswer(provider, {
				quote: ann.quote,
				question: ann.comment,
				context: answerContextFor(ann.messageId, ann.quote)
			});
			annotations = annotations.map((a) =>
				a.id === ann.id ? { ...a, answer } : a
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showNotice(notices, "banner", message);
			if (androidUI) flashErrorToast(message);
		} finally {
			annAnswering.delete(ann.id);
		}
	}

	/** Submit the annotation being composed (Enter or Save). The id is
	kept from composition so wash, pill, and badge address one thing.
	Filing also fires the answer request (the remodel). */
	function commitPending(): void {
		const filed = filePendingAnnotation(annotations, pendingAnn, annDraft);
		if (!filed) return;
		annotations = filed;
		const id = pendingAnn?.id;
		pendingAnn = null;
		if (id) {
			const ann = annotations.find((a) => a.id === id);
			if (ann) void askAnnotation(ann);
		}
	}

	/** Fade the pill out, then unmount it. Data writes stay synchronous
	in the caller — only the unmount (and its highlight) waits out the ramp. */
	function hideAnnPop(): void {
		if (!annPop || annPopClosing) return;
		annPopClosing = true;
		if (annPopTimer) clearTimeout(annPopTimer);
		annPopTimer = setTimeout(() => {
			annPopTimer = null;
			annPop = null;
			annPopClosing = false;
			// The highlight lives only while a textbox is open.
			highlightAnnId = null;
		}, 160);
	}

	/** Opening (or teardown) cancels a fade-out in flight. */
	function settleAnnPop(): void {
		if (annPopTimer) clearTimeout(annPopTimer);
		annPopTimer = null;
		annPopClosing = false;
	}

	function saveAnnPop(fromEnter = false): void {
		if (!annPop || annPopClosing) return;
		stopPillMic();
		// The pop id decides (see annPopSaveKind): a pop still
		// addressing its pending annotation commits it, otherwise the
		// saved comment of the existing one is edited.
		if (annPopSaveKind(annPop.id, pendingAnn?.id ?? null) === "commit-pending")
			commitPending();
		else annotations = editAnnotationComment(annotations, annPop.id, annDraft);
		hideAnnPop();
		// Only the Enter key needs the anti-double-send guard: a click-away
		// save involves no Enter that could leak into a send.
		if (fromEnter) sendGuardUntil = Date.now() + 500;
		editor?.focus();
	}

	/** Clicking off the pill: an empty draft cancels (no ghost empty
	annotations), a typed draft still saves — typed comments are never
	silently dropped. Enter with no text is the way to file an empty one. */
	function blurAnnPop(): void {
		if (!annPop || annPopClosing) return;
		// A scroll stroke just blurred the box: keep the draft open
		// for the return tap instead of canceling or filing it.
		if (Date.now() - lastAnnScrollAt < 800) return;
		if (annPopBlurAction(annDraft) === "cancel") cancelAnnPop();
		else saveAnnPop();
	}

	function cancelAnnPop(): void {
		if (!annPop || annPopClosing) return;
		const { id, fresh } = annPop;
		stopPillMic();
		hideAnnPop();
		// Cancel means "as it was" (see annPopCancelKind): a
		// never-submitted pending never existed; a fresh annotation
		// goes no matter what was typed; an existing one keeps its
		// saved comment (nothing is written until Save).
		const cancelKind = annPopCancelKind(id, fresh, pendingAnn?.id ?? null);
		if (cancelKind === "drop-pending") pendingAnn = null;
		else if (cancelKind === "delete-fresh")
			annotations = deleteAnnotation(annotations, id);
		editor?.focus();
	}

	function annPopKey(event: KeyboardEvent): void {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			saveAnnPop(true);
		} else if (event.key === "Escape") {
			event.preventDefault();
			cancelAnnPop();
		}
	}

	/** Auto-grow action for the annotation pill. Focuses on open so Enter
	saves immediately without a click. */
	/* Pill grow/focus action renders in `AnnPop.svelte` (moved with
	the field it sizes). */

	/** Annotation popover width (see $lib/annPop): card and creation
	pill alike, clamped to fit narrow phones, scaling with font
	size up to 32rem (19rem base for the fresh pill). */
	function popWidth(fresh: boolean): number {
		return annPopWidth({
			fresh,
			android: androidUI,
			fontScale: settings.fontScale,
			viewportWidth: window.innerWidth
		});
	}

	/**
	 * Badge click edits in the floating card on desktop, in the
	 * composer on phones (see editAnnotationInPrompt): the saved
	 * comment loads as the draft, Enter or the arrow files it back,
	 * tapping out cancels. Re-pressing the editing badge cancels too.
	 */
	function openBadge(
		id: AnnotationId,
		anchor?: { x: number; y: number },
		forEdit = false
	): void {
		// Re-pressing the open badge closes it, like cancel: the edit
		// menu toggles instead of reopening under the cursor.
		if (annPop && !annPopClosing && annPop.id === id) {
			cancelAnnPop();
			return;
		}
		const current = annotations.find((a) => a.id === id);
		if (!current) return;
		// A ready answer opens in its own popup (the remodel): the note
		// still edits from the review dock. Re-press toggles it shut;
		// an open pill for the same note settles first through the
		// proper cancel path so typed text is never dropped. The
		// review pencil passes forEdit: it is the edit path, so a
		// ready answer must not hijack it.
		if (current.answer && !forEdit) {
			if (answerPop?.id === id) {
				answerPop = null;
				return;
			}
			if (annPop && !annPopClosing && annPop.id === id) cancelAnnPop();
			if (
				promptAnnEdit &&
				!("pending" in promptAnnEdit) &&
				promptAnnEdit.id === id
			)
				cancelPromptAnnEdit();
			const anchorAt = anchor ?? {
				x: window.innerWidth / 2,
				y: window.innerHeight / 2
			};
			const width = popWidth(false);
			const placed = placeAnnCard({
				anchorX: anchorAt.x,
				anchorY: anchorAt.y,
				width,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight
			});
			answerPop = { id, x: placed.x, y: placed.y, w: width };
			return;
		}
		// Phones edit in the composer, never the card: the transplanted
		// textbox can't reliably summon the phone keyboard — see
		// editAnnotationInPrompt. Re-pressing the editing badge cancels
		// back out (toggle). Desktop keeps the floating edit menu.
		if (
			promptAnnEdit &&
			!("pending" in promptAnnEdit) &&
			promptAnnEdit.id === id
		) {
			cancelPromptAnnEdit();
			return;
		}
		stopPillMic();
		editingId = null;
		highlightAnnId = id;
		if (androidUI) {
			// Marker taps start the note empty (the quote's wash shows
			// what is being rewritten): typing then files through the
			// arrow, like a fresh annotation. Review-pencil edits keep
			// loading the saved comment — see editAnnotationInPrompt.
			editAnnotationInPrompt({ id }, "");
			return;
		}
		annDraft = current.comment;
		settleAnnPop();
		const anchorAt = anchor ?? {
			x: window.innerWidth / 2,
			y: window.innerHeight / 2
		};
		const width = popWidth(false);
		const { x, y } = placeAnnCard({
			anchorX: anchorAt.x,
			anchorY: anchorAt.y,
			width,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight
		});
		annPop = { id, x, y, fresh: false };
		// The box can morph from a still-fading fresh pill (same
		// element, no remount, so growPill's mount focus never fires):
		// land the caret explicitly, like the create path does.
		void tick().then(() => annPopBox?.focus({ preventScroll: true }));
	}

	/**
	 * Delegated badge click (MessageBody): the keyboard path, plus the
	 * trailing click of a press gesture. A press's own click re-fire —
	 * same badge within the tap window — is the gesture just handled,
	 * not a re-press: running the toggle would shut the menu the press
	 * opened (the iOS tap bug). Anything else toggles as before.
	 */
	function openBadgeClick(
		id: AnnotationId,
		anchor: { x: number; y: number }
	): void {
		if (
			lastBadgePress &&
			lastBadgePress.id === id &&
			Date.now() - lastBadgePress.at < 800
		)
			return;
		openBadge(id, anchor);
	}

	/** File the answer into the next prompt (the remodel): blank-line
	joined onto the draft, then the composer takes focus. */
	function addAnswerToPrompt(id: AnnotationId): void {
		const current = annotations.find((a) => a.id === id);
		if (!current?.answer) return;
		editor?.setText(joinExternalDraft(editor?.getText() ?? "", current.answer));
		editor?.focus();
		answerPop = null;
	}

	function saveEdit(id: string): void {
		annotations = editAnnotationComment(annotations, id, editDraft);
		editingId = null;
		highlightAnnId = null;
		// The Save button unmounts with the edit box: park focus on the
		// pill or the overlay drops on touch (see focus refs above).
		focusPill();
	}

	function removeAnnotation(id: string): void {
		// Annotation deletes thump like message deletes (the shared
		// triple-beat contract: call sites carry no haptic of their own).
		if (androidUI) {
			void hapticBeatAsync("done", {
				enabled: settings.hapticsEnabled,
				shell: tauriBackendAvailable()
			});
		}
		annotations = deleteAnnotation(annotations, id);
		if (editingId === id) editingId = null;
		if (highlightAnnId === id) highlightAnnId = null;
		if (annPop?.id === id) {
			settleAnnPop();
			annPop = null;
		}
		if (
			promptAnnEdit &&
			!("pending" in promptAnnEdit) &&
			promptAnnEdit.id === id
		) {
			exitPromptAnnEdit();
		}
	}

	/**
	 * Move an annotation comment into the composer (every phone edit —
	 * the transplanted textboxes can't reliably summon keyboards or
	 * hold focus; desktop edits at the mark instead, see
	 * editAnnotationAtMark): the pending annotation files
	 * on the arrow, a saved one's comment rewrites. The review
	 * closes so the composer owns the screen; the wash keeps the
	 * quote visible.
	 */
	/**
	 * Wash id for an in-prompt note edit (phones): the composer owns
	 * the screen while editing, so the quote washes like any draft —
	 * a pending filing washes its preview, a saved note its quote.
	 * Without this the comment box floats over an unmarked thread.
	 */
	function promptAnnWashId(): string | null {
		return promptAnnWashIdFor(promptAnnEdit, pendingAnn?.id ?? null);
	}
	function editAnnotationInPrompt(
		target: { id: string } | { pending: true },
		comment: string
	): void {
		// A fresh popover open underneath files first: typed comments
		// are never silently dropped (same rule as annotate()).
		if (pendingAnn && !("pending" in target)) commitPending();
		settleAnnPop();
		annPop = null;
		promptAnnStash = editor?.getText() ?? "";
		promptAnnEdit = target;
		reviewOpen = false;
		editor?.setText(comment);
		// A saved note being revised says so; a fresh filing asks.
		editor?.setPlaceholder(
			"pending" in target ? "Add an annotation" : "Edit annotation"
		);
		editor?.caretToEnd();
		// Phones scroll the quote into the upper clear area first (the
		// keyboard plus composer own the bottom): no manual scroll is
		// needed to see the highlighted text, so the scroll gesture
		// never cancels the edit out from under the typing.
		if (androidUI) {
			const lookup = promptAnnLookup(target, pendingAnn, annotations);
			if (lookup) {
				// Land the quote only after the focus growth settles:
				// measuring against the small at-rest card strands the
				// smooth scroll mid-flight when the card grows and the
				// keyboard opens (top-of-screen flash). A re-tap
				// retargets: the stale timer no-ops on the new edit.
				const landed = promptAnnEdit;
				setTimeout(() => {
					if (promptAnnEdit !== landed) return;
					scrollQuoteIntoEditView(lookup.messageId, lookup.quote, lookup.at);
				}, 350);
			}
		}
		// Best-effort: the opening tap's canceled gesture can block
		// the summon on some WebViews, but a plain tap on the
		// composer always works — it summons for chat typing today.
		void tick().then(() => editor?.focus());
	}

	/**
	 * Scroll a quote into the upper clear area for in-prompt note
	 * edits (phones): the keyboard plus composer own the bottom, so
	 * the only visible space while typing is at the top. Lands the
	 * quote a fifth down the visible chat; already-visible quotes
	 * never move.
	 */
	function scrollQuoteIntoEditView(
		messageId: ChatMsgId,
		quote: string,
		at: number
	): void {
		if (!scrollBox) return;
		const index = viewChat.messages.findIndex((m) => m.id === messageId);
		if (index < 0) return;
		const article = document.querySelector(`#msg-${index}`);
		const root = article?.querySelector(".rendered") ?? article;
		if (!(root instanceof HTMLElement)) return;
		let range: Range | null;
		try {
			range = quoteRange(root, quote, at);
		} catch {
			return;
		}
		if (!range) return;
		const area = scrollBox.getBoundingClientRect();
		const appEl = document.querySelector(".app");
		const kb = appEl
			? Number.parseFloat(
					getComputedStyle(appEl).getPropertyValue("--kb-height")
				) || 0
			: 0;
		const promptH =
			document.querySelector(".prompt")?.getBoundingClientRect().height ?? 0;
		const visibleBottom = area.bottom - promptH - kb;
		if (visibleBottom <= area.top) return;
		const dy = editViewDelta(
			range.getBoundingClientRect().top,
			area.top,
			visibleBottom
		);
		if (dy !== null) scrollBox.scrollBy({ top: dy, behavior: "smooth" });
	}

	/** Send-arrow commit for an in-prompt note edit (see doSend). */
	function commitPromptAnnEdit(): void {
		const target = promptAnnEdit;
		if (!target) return;
		void hapticBeatAsync("send", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
		const comment = editor?.getText() ?? "";
		const pending = "pending" in target;
		if (pending) {
			const filed = filePendingAnnotation(annotations, pendingAnn, comment);
			if (filed) annotations = filed;
			const id = pendingAnn?.id;
			pendingAnn = null;
			if (id) {
				const ann = annotations.find((a) => a.id === id);
				if (ann) void askAnnotation(ann);
			}
		} else {
			annotations = editAnnotationComment(annotations, target.id, comment);
		}
		highlightAnnId = null;
		// Pending filings save for the first time; a saved note's
		// comment rewrites — the toast names which happened (a bare
		// "Note saved" never said). Plain on every platform: no draft
		// vocabulary, the note files straight from the composer.
		exitPromptAnnEdit();
		flashToast(annEditCommitToast(pending));
		void tick().then(() => editor?.focus());
	}

	/** Tapping out drops an in-prompt note edit: a pending filing
	never existed, a saved note keeps its stored comment (typing only
	lived in the composer — nothing writes until the arrow). */
	function cancelPromptAnnEdit(): void {
		if (!promptAnnEdit) return;
		if ("pending" in promptAnnEdit) pendingAnn = null;
		highlightAnnId = null;
		exitPromptAnnEdit();
	}

	/** Leave in-prompt edit mode and give the composer back its
	drafted chat text and placeholder. Focus stays where it is (the
	commit path re-focuses explicitly; a tap-out cancel must not
	steal it back). */
	function exitPromptAnnEdit(): void {
		promptAnnEdit = null;
		editor?.setText(promptAnnStash);
		promptAnnStash = "";
		editor?.setPlaceholder(promptPlaceholder());
	}

	/**
	 * Quote tap lands on the annotation's marker: the message scrolls
	 * into view and its yellow wash holds, then fades out (hover
	 * previews own the wash again after). Only quote taps
	 * navigate — notes, buttons, and fields never do.
	 */
	/**
	 * Quote-tap jumps to the mark — and only the quote taps: the note
	 * stays selectable text, buttons keep their clicks, and the row's
	 * dead space navigates nowhere. A drag-select ending here is a pick
	 * (the click still fires), so only collapsed selections navigate.
	 * The review closes so the landing clears the composer dock.
	 */
	function reviewQuoteClick(ann: {
		id: AnnotationId;
		messageId: ChatMsgId;
	}): void {
		if (!window.getSelection()?.isCollapsed) return;
		reviewOpen = false;
		gotoAnnotation(ann);
	}

	function gotoAnnotation(ann: {
		id: AnnotationId;
		messageId: ChatMsgId;
	}): void {
		const index = viewChat.messages.findIndex((m) => m.id === ann.messageId);
		if (index < 0) {
			flashErrorToast("Annotation no longer exists");
			return;
		}
		highlightAnnId = ann.id;
		// Scroll the mark itself, clear of the composer dock: an
		// already-clear mark never moves (like nearest), but a covered
		// one lands in the open instead of stranding behind the dock
		// (nearest's down-landing trap). Fall back to the message when
		// the badge is somehow missing.
		const badge = document.querySelector(`[data-ann-badge="${ann.id}"]`);
		if (badge instanceof HTMLElement)
			scrollRectIntoClear(badge.getBoundingClientRect());
		else {
			document
				.querySelector(`#msg-${index}`)
				?.scrollIntoView({ block: "center", behavior: "smooth" });
		}
		// The quote flashes once like a sent jump (one registry
		// flash; the jump clears the hover wash first, so no twin
		// layers under it): the badge
		// scroll lands the eye nearby, the flash lands it on the
		// words. Every paint re-locates against the repeat it was
		// filed from.
		const current = annotations.find((a) => a.id === ann.id);
		if (current) {
			const quote = current.quote;
			const at = current.at ?? 0;
			const locate = (): Range | null => {
				const article = document.querySelector(`#msg-${index}`);
				const root = article?.querySelector(".rendered") ?? article;
				return root instanceof HTMLElement ? quoteRange(root, quote, at) : null;
			};
			flashJumpMark(locate);
		}
	}

	/**
	 * Land a located rect where it stays visible: inside the chat
	 * column, above the composer dock (prompt plus the open review).
	 * Already-clear rects never move; covered ones settle at a third
	 * of the clear height so the quote reads with context around it.
	 */
	function scrollRectIntoClear(rect: DOMRect): void {
		const scroller = document.querySelector(".messages");
		if (!(scroller instanceof HTMLElement)) return;
		const area = scroller.getBoundingClientRect();
		const prompt =
			document.querySelector(".prompt")?.getBoundingClientRect().height ?? 0;
		const review = reviewOpen
			? (document.querySelector(".ann-wrap .review")?.getBoundingClientRect()
					.height ?? 0)
			: 0;
		const dock = prompt + review + 16;
		if (rectInClearView(rect, area, dock)) return;
		scroller.scrollBy({
			top: clearLandingDelta(rect.top, area.top, area.height, dock),
			behavior: "smooth"
		});
	}

	/** True when a rect already reads in the clear viewport (same geometry
	as the scroll landing above): the jump flash gates on this, so its
	hold only burns once the eye can land on it. */
	function rectInClearView(
		rect: DOMRect,
		area?: DOMRect,
		dock?: number
	): boolean {
		const scroller = document.querySelector(".messages");
		if (!(scroller instanceof HTMLElement)) return true;
		const box = area ?? scroller.getBoundingClientRect();
		const prompt =
			document.querySelector(".prompt")?.getBoundingClientRect().height ?? 0;
		const review = reviewOpen
			? (document.querySelector(".ann-wrap .review")?.getBoundingClientRect()
					.height ?? 0)
			: 0;
		const clear = dock ?? prompt + review + 16;
		return rectInClear(rect.top, rect.bottom, box.top, box.bottom, clear);
	}

	/**
	 * Previous-annotations quote press: only the quote text navigates
	 * (see reviewQuoteClick) — the note stays selectable, buttons keep
	 * their clicks, dead space navigates nowhere. A drag-select ending
	 * here is a pick, so only collapsed selections navigate. The jump
	 * lands on the quoted message with a flash when it still holds the
	 * quote, or on the sending message when the quote is gone.
	 */
	function refsQuoteClick(
		messageId: ChatMsgId,
		quote: string,
		n: number
	): void {
		// A row edit owns its row: quote taps must not yank the chat
		// out from under the caret.
		if (refsEditing) return;
		if (!window.getSelection()?.isCollapsed) return;
		blinkRefsRow(messageId, n);
		gotoSentRef(messageId, quote);
	}

	/** Flash the pressed sent row twice, then release it (a re-press
	restarts the schedule; expiry clears itself). Same 700/350 phases
	as the quote flash below. */
	function blinkRefsRow(messageId: ChatMsgId, n: number): void {
		stopRefsBlink?.();
		stopRefsBlink = null;
		const key = { messageId, n };
		refsBlink = key;
		stopRefsBlink = startBlink(
			() => {
				refsBlink = key;
				return true;
			},
			() => {
				refsBlink = null;
			}
		);
	}

	function gotoSentRef(messageId: ChatMsgId, quote: string): void {
		const live = annotations.find(
			(a) => a.messageId === messageId && a.quote === quote
		);
		if (live) {
			gotoAnnotation({ id: live.id, messageId });
			return;
		}
		// The quote lives in the message it was taken from: jump there
		// with a flash, not to the message that sent it.
		const quotedId = findQuotedMessage(viewChat.messages, messageId, quote);
		if (quotedId) {
			jumpToQuotedText(quotedId, quote);
			return;
		}
		// Edited away everywhere: fall back to the sender, as before.
		const index = viewChat.messages.findIndex((m) => m.id === messageId);
		if (index < 0) {
			flashErrorToast("Annotation no longer exists");
			return;
		}
		document
			.querySelector(`#msg-${index}`)
			?.scrollIntoView({ block: "center", behavior: "smooth" });
	}

	/**
	 * Sent-annotation landing: locate the quote in its owner's rendered
	 * text, land it clear of the dock, and flash the quote once
	 * through the Highlight registry (the jump clears the hover wash
	 * first, so no twin layers under it). A folded message
	 * hides its text from the locator: land on the message itself
	 * instead.
	 */
	function jumpToQuotedText(messageId: ChatMsgId, quote: string): void {
		const index = viewChat.messages.findIndex((m) => m.id === messageId);
		const locate = (): Range | null => {
			const article =
				index >= 0 ? document.querySelector(`#msg-${index}`) : null;
			const root = article?.querySelector(".rendered") ?? article;
			return root instanceof HTMLElement ? quoteRange(root, quote) : null;
		};
		const range = locate();
		if (range) {
			scrollRectIntoClear(range.getBoundingClientRect());
			flashJumpMark(locate);
		} else if (index >= 0) {
			const article = document.querySelector(`#msg-${index}`);
			if (article instanceof HTMLElement) {
				article.scrollIntoView({ block: "center", behavior: "smooth" });
			}
		}
	}

	/** Unwrap every destination flash mark (re-jump pre-clear and
	expiry share it; a re-render that already dropped them no-ops). */
	function clearJumpMarks(): void {
		try {
			document
				.querySelectorAll("mark.ccez-ann-flash")
				.forEach((m) => unwrapMark(m as HTMLElement));
		} catch {
			// Cosmetic: never break the jump.
		}
	}

	/** Jump flash entry: the hold only burns once the quote reads in
	the clear viewport. A far jump paints at once when already clear;
	otherwise the paint waits for scroll settle (same re-arm pattern
	as the edit card), capped so a stalled scroll still lands. A
	re-jump cancels the wait through the shared stopper. */
	function flashJumpMark(locate: () => Range | null): void {
		stopJumpFlash?.();
		stopJumpFlash = null;
		const first = locate();
		if (!first || rectInClearView(first.getBoundingClientRect())) {
			flashJumpMarkNow(locate);
			return;
		}
		let done = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const finish = (): void => {
			if (done) return;
			done = true;
			if (timer !== null) clearTimeout(timer);
			window.removeEventListener("scroll", onScroll, true);
			flashJumpMarkNow(locate);
		};
		const onScroll = (): void => {
			if (done) return;
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(finish, 150);
		};
		window.addEventListener("scroll", onScroll, true);
		timer = setTimeout(finish, 2000);
		stopJumpFlash = () => {
			done = true;
			if (timer !== null) clearTimeout(timer);
			window.removeEventListener("scroll", onScroll, true);
			stopJumpFlash = null;
		};
	}

	/** Flash the destination quote in draft yellow, hold it, then
	fade it out through the flash grades (a re-jump restarts the
	schedule; expiry clears itself). The flash paints through the
	Highlight registry: zero DOM nodes move, so the mid-quote badge
	anchor never shifts and text never reflows — the whole point of
	leaving DOM marks behind. The DOM path below runs in the shell
	(whose overlay ignores registry writes between forced repaints)
	and where the Highlight API is missing. Every paint re-locates: a chat
	re-render mid-scroll (scroll-driven state swaps the text nodes)
	detaches the old range, and repainting the same dead range
	would fade nothing. A failed re-locate clears rather than
	abandoning: the quote is gone, so nothing must linger. Yellow
	must never stick. */
	function flashJumpMarkNow(locate: () => Range | null): void {
		stopJumpFlash?.();
		stopJumpFlash = null;
		clearJumpMarks();
		// One landing, one highlight: a hover wash alive under the
		// cursor (the jump scrolled the message beneath it) would
		// twin the flash with offset edges. Route the clear through
		// the shared machine so a later re-hover still reports.
		badgeHover((id: string | null) => (hoverBadgeId = id), null);
		// Registry fade everywhere but the shell: its overlay only
		// repaints on forced frames, so grades never show there.
		if (highlightsSupported() && !tauriBackendAvailable()) {
			clearAnnotationWash(ANN_FLASH_NAME);
			for (const grade of flashFadeSchedule()) clearAnnotationWash(grade);
			let root: HTMLElement | null = null;
			const rootOf = (range: Range): HTMLElement | null => {
				const el =
					range.startContainer instanceof Element
						? range.startContainer
						: range.startContainer.parentElement;
				const found = el?.closest(".rendered") ?? null;
				return found instanceof HTMLElement ? found : null;
			};
			const paintFresh = (): boolean => {
				const range = locate();
				if (!range) return false;
				root = rootOf(range);
				return paintAnnotationWash(
					rangesExcludingReadings(range),
					ANN_FLASH_NAME
				);
			};
			const nudgeLiveRoot = (): void => {
				// Resolve the root fresh: a re-render mid-scroll
				// (scroll-driven state swaps the text nodes) can
				// detach the root captured at paint time, and
				// nudging a detached tree repaints nothing — the
				// flash pixels stick. Fall back to the capture.
				const live = locate();
				const target = (live ? rootOf(live) : null) ?? root;
				if (target) invalidateWashPaint(target);
			};
			const release = (): void => {
				clearAnnotationWash(ANN_FLASH_NAME);
				for (const grade of flashFadeSchedule()) clearAnnotationWash(grade);
				nudgeLiveRoot();
			};
			if (!paintFresh()) return;
			// Reduced motion keeps the old blink-off; everyone else
			// gets hold-then-fade, never an instant vanish.
			if (prefersReducedMotion()) {
				stopJumpFlash = startBlink(paintFresh, release, { phases: 2 });
				return;
			}
			stopJumpFlash = startHighlightFade({
				locate,
				paint: (range, name) => {
					paintAnnotationWash(rangesExcludingReadings(range), name);
				},
				clear: (name) => clearAnnotationWash(name),
				full: ANN_FLASH_NAME,
				grades: flashFadeSchedule(),
				holdMs: 700,
				stepMs: 50,
				// The shell may not repaint on a registry write
				// alone, so intermediate grades would never show
				// and the landing would snap off instead of
				// fading — force each step to display.
				onStep: nudgeLiveRoot,
				onDone: release
			});
			return;
		}
		// DOM fade for the shell (and engines without Highlights):
		// the shell's highlight overlay ignores registry writes
		// between forced repaints, so graded registry fades show
		// only their hold and snap off — real marks with a plain
		// CSS fade display on every engine. Badge carve-out: a
		// whole-range extract would drag the mid-quote anchor
		// into the mark and back out, shaking the marker.
		const range = locate();
		if (!range) return;
		const parts = wrapRangeExcludingBadges(range, "ccez-ann-flash");
		if (parts.length === 0) return;
		stopJumpFlash = startMarkFade({
			marks: parts,
			holdMs: 700,
			fadeMs: prefersReducedMotion() ? 0 : 250,
			onDone: clearJumpMarks
		});
	}

	/**
	 * Pencil edit at the mark (new-overlay rows, desktop): jump to the
	 * quote, then open the same floating edit card a badge tap summons
	 * — one edit UI on desktop. Phones keep the composer path (the
	 * transplanted textbox can't reliably summon the phone keyboard —
	 * see editAnnotationInPrompt).
	 */
	function editAnnotationAtMark(id: AnnotationId): void {
		const current = annotations.find((a) => a.id === id);
		if (!current) {
			flashErrorToast("Annotation no longer exists");
			return;
		}
		if (androidUI) {
			editAnnotationInPrompt({ id }, current.comment);
			return;
		}
		gotoAnnotation({ id, messageId: current.messageId });
		openEditCardAtSettledBadge(id, true);
	}

	/**
	 * Open the desktop edit card once the jump's scroll settles. The
	 * card is fixed-position, so anchoring mid-scroll strands it away
	 * from the quote: scroll events re-arm a short settle timer, and
	 * an already-visible mark (no scroll at all) opens on a near tick.
	 */
	function openEditCardAtSettledBadge(id: AnnotationId, forEdit = false): void {
		let done = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const onScroll = (): void => {
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(finish, 150);
		};
		const finish = (): void => {
			if (done) return;
			done = true;
			if (timer !== null) clearTimeout(timer);
			window.removeEventListener("scroll", onScroll, true);
			const badge = document.querySelector(`[data-ann-badge="${id}"]`);
			const rect =
				badge instanceof HTMLElement ? badge.getBoundingClientRect() : null;
			openBadge(
				id,
				rect ? { x: rect.left + rect.width / 2, y: rect.bottom } : undefined,
				forEdit
			);
		};
		window.addEventListener("scroll", onScroll, true);
		timer = setTimeout(finish, 80);
	}

	/**
	 * Previous-menu pencil (desktop): the row swaps its note for a
	 * single-line field — the card's rows stay one line, so the editor
	 * is an <input>, never a textarea (Enter saves, Escape cancels via
	 * the global dismiss below; newlines would break the baked block
	 * shape the render parses back).
	 */
	function startRefsEdit(
		messageId: ChatMsgId,
		ref: { n: number; comment: string }
	): void {
		refsEditing = { messageId, n: ref.n };
		refsEditDraft = ref.comment;
		void tick().then(() => {
			refsEditBox?.focus();
			refsEditBox?.select();
		});
	}

	/**
	 * Focus back on a row's pencil after the edit unmounts: the save
	 * (and the cancel) re-renders the row, so the opening button is a
	 * fresh node — focusing it synchronously strands on the detached
	 * one. The data hook finds the remounted row.
	 */
	function parkRefsEditFocus(n: number): void {
		void tick().then(() => {
			const pencil = document.querySelector(
				`.ann-refs-pop [data-refs-pencil="${n}"]`
			);
			if (pencil instanceof HTMLElement) pencil.focus();
		});
	}

	/**
	 * Row-edit commit: rebake the message with the one comment swapped
	 * (see rewriteAnnotationComment) — history rewrites in place, like
	 * an own-message edit, with no resend. An unparseable block reads
	 * as gone; an untouched draft writes nothing.
	 */
	function saveRefsEdit(): void {
		const editing = refsEditing;
		refsEditing = null;
		if (!editing) return;
		const msg = viewChat.messages.find((m) => m.id === editing.messageId);
		const commit = commitRefsEdit(
			msg?.content ?? null,
			editing.n,
			refsEditDraft
		);
		if (commit.kind === "gone") flashErrorToast("Annotation no longer exists");
		else if (commit.kind === "rewrote")
			editMessageContent(chatState, editing.messageId, commit.content);
		refsEditDraft = "";
		parkRefsEditFocus(editing.n);
	}

	/** Row-edit cancel: the stored comment stands, focus parks back on
	the pencil that opened the field. */
	function cancelRefsEdit(): void {
		if (!refsEditing) return;
		const n = refsEditing.n;
		refsEditing = null;
		refsEditDraft = "";
		parkRefsEditFocus(n);
	}

	/**
	 * Sent-card Clear-all: strip the baked block, keeping the bare
	 * prompt (see clearBakedAnnotations). A refs-only message clears
	 * to nothing — delete it instead of keeping an empty one. Own
	 * messages only: baked blocks ride the outgoing prompt.
	 */
	function clearSentRefs(messageId: ChatMsgId): void {
		const index = viewChat.messages.findIndex((m) => m.id === messageId);
		if (index < 0) return;
		const msg = viewChat.messages[index];
		if (!msg) return;
		const plan = planClearSentRefs(msg.role, msg.content);
		if (plan.kind === "skip") return;
		if (plan.kind === "gone") {
			flashErrorToast("Annotation no longer exists");
			return;
		}
		refsPopOpen = null;
		if (plan.kind === "delete") {
			stopAudioForMessage(msg.id);
			deleteMessage(chatState, index);
		} else editMessageContent(chatState, messageId, plan.bare);
		flashToast("Sent annotations cleared");
	}

	function clearAllAnnotations(): void {
		annotations = clearAnnotations();
		pendingAnn = null;
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
		// An in-prompt edit dies with the list: hand the composer
		// back its drafted chat text instead of stranding the note.
		if (promptAnnEdit) exitPromptAnnEdit();
		// Clearing everything thumps like a delete (done): the same
		// unmistakable triple against single-tap ticks.
		void hapticBeatAsync("done", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
	}

	/**
	 * Badge arrays by message, memoized by content: the render effect
	 * subscribes to the array identity, so a freshly built array per
	 * render would re-run every message body on any parent change.
	 */
	const memoMarks = createRefMemo<AnnotationMark>(
		(m) =>
			`${m.id}:${m.number}:${m.quote}:${m.at ?? 0}:${m.preview === true ? "preview" : "saved"}:${m.aidScope ?? ""}:${m.answer ?? ""}`
	);
	function marksFor(messageId: ChatMsgId): AnnotationMark[] {
		return memoMarks(
			messageId,
			buildMarksFor(
				annotations,
				messageId,
				aidModelPin.has(messageId),
				pendingAnn,
				annAnswering
			)
		);
	}

	/** Pinned or hover-peeked model-aid text for a message (tashkeel). */
	function aidedTextFor(msg: ChatMsg): string | null {
		return aidedTextForMsg(msg.id, aidPeek?.id ?? null, vocalized, aidModelPin);
	}

	/**
	 * Local-aid overrides: pinned kinds render (each on its own lines),
	 * plus a hover-peeked kind previewed alongside them; empty renders
	 * the original (aids are per-message only). Kinds the message no
	 * longer offers (edited text) filter out instead of lingering.
	 * Offer computation lives in `offeredLocalAids` (`src/lib/reading.ts`,
	 * shared by hotkeys, render, and vocalize); the display-text rule in
	 * `aidDisplayText` beside it.
	 */
	/**
	 * Aid-kind arrays by message, memoized like the badge arrays: the
	 * body effect subscribes to the array identity, so a fresh array
	 * per parent render (any hover near an aid button) rebuilt every
	 * body and re-stamped its badges — flickering text with several
	 * marks mounted. Same content returns the same reference.
	 */
	const memoAids = createRefMemo<LocalAid>((kind) => kind);
	function localAidsOverrideFor(msg: ChatMsg): LocalAid[] {
		return memoAids(
			msg.id,
			messageAidKinds(
				msg.content,
				activeReplyCode,
				aidPeek?.id === msg.id ? (aidPeek.kind ?? null) : null,
				pinnedKinds(msg.id)
			)
		);
	}

	/**
	 * Hover in: preview a local aid, but only when it is already here
	 * (cached furigana, kind clicked before). Pinyin never previews on
	 * hover — its swap looped show/hide forever, so it is click-to-show
	 * only — and the model aid (tashkeel) never previews either:
	 * hovering its button must neither show nor remove the vocalized
	 * text. Fetching happens on click alone — hovering must never
	 * spend a model call or start furigana's dictionary load (that work
	 * now runs in a worker, but the rule stands: hover previews, click
	 * fetches). The swap lock wins over everything: right after a click
	 * the button under a stationary cursor is new, not hovered.
	 */
	function peekAid(msg: ChatMsg, kind?: LocalAid): void {
		// A live selection menu owns the highlight: hover previews swap
		// the body HTML, which collapses the selection (and strands the
		// menu) mid-slide toward Annotate. Previews resume on close.
		if (selMenu) return;
		if (aidNoPeek.has(msg.id)) return;
		// Pinyin previews on click alone, never hover: after its
		// readings render, the button under a stationary cursor is
		// a new node, and hover-out/in around the swap looped
		// show/hide forever. Pinyin hovers stay color-only.
		if (kind === "pinyin") return;
		// First hover is color-only: previews start after that kind's
		// first click (pin), never a sibling kind's.
		if (kind === undefined || !aidSeen.has(aidSeenKey(msg.id, kind))) return;
		if (kind === "furigana" && !isFuriganaCached(aidDisplayText(msg.content))) {
			return;
		}
		// Hover is color-only by decision (Sep 2026): readings render
		// on click (pin) alone, never on hover — so the preview is
		// never assigned here and aidPeek stays null. The guards above
		// and every clear site stay as-is (harmless no-ops), documenting
		// the retired preview path without touching render logic.
		return;
	}

	/**
	 * Hover out: drop the preview and release the swap lock, so the next
	 * enter counts as a genuine hover.
	 */
	function unpeekAid(msg: ChatMsg): void {
		// Frozen with peek above: clearing mid-menu would swap the body
		// back and take the highlight with it.
		if (selMenu) return;
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.delete(msg.id);
	}

	/** Track a message's local-aid load without notifying on no-ops. */
	function setAidBusy(id: ChatMsgId, loading: boolean): void {
		if (loading) {
			if (!aidBusy.has(id)) aidBusy.add(id);
		} else if (aidBusy.has(id)) {
			aidBusy.delete(id);
		}
	}

	/** Click on a local-aid button: pin its kind (others stay as pinned). */
	function pinLocalAid(msg: ChatMsg, kind: LocalAid): void {
		const kinds = pinnedKinds(msg.id);
		if (!kinds.includes(kind)) aidKindPin.set(msg.id, [...kinds, kind]);
		aidPin.add(msg.id);
		// A model run still in flight must not steal the pin back when
		// it lands: the local click is the latest intent.
		pendingPin.delete(msg.id);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
		aidSeen.add(aidSeenKey(msg.id, kind));
	}

	/** Per-kind "show original": unpin one kind, keep the other pinned
	(and a pinned model aid showing). */
	function unpinLocalAid(msg: ChatMsg, kind: LocalAid): void {
		const kinds = pinnedKinds(msg.id).filter((pinned) => pinned !== kind);
		if (kinds.length === 0) {
			aidKindPin.delete(msg.id);
			if (!aidModelPin.has(msg.id)) aidPin.delete(msg.id);
		} else aidKindPin.set(msg.id, kinds);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
	}

	/**
	 * Mouse users: leaving drops focus from the message's buttons, so a
	 * hover-only row hides instead of sticking on focus-within after a
	 * click. Keyboard focus never fires mouseleave, so tabbing through
	 * the row is unaffected.
	 */
	function releaseRowFocus(event: MouseEvent): void {
		const row = event.currentTarget;
		const active = document.activeElement;
		if (
			row instanceof HTMLElement &&
			active instanceof HTMLElement &&
			row.contains(active)
		) {
			active.blur();
		}
	}

	/**
	 * Pointer leaves the whole message: drop the hover index, any stale
	 * aid preview for it, and focus inside it. The aid swap remounts the
	 * body, which can move the actions row out from under a stationary
	 * cursor — then row-level mouseleave never fires, and without this
	 * the row stuck visible on :focus-within with a stale preview.
	 */
	function onArticleLeave(event: MouseEvent, msg: ChatMsg, i: number): void {
		if (hoveredIdx === i) {
			hoveredIdx = -1;
			lastHoverChangeAt = Date.now();
		}
		if (aidPeek?.id === msg.id) aidPeek = null;
		// The pointer genuinely left: release the swap lock with it.
		aidNoPeek.delete(msg.id);
		hoverBadgeId = null;
		releaseRowFocus(event);
	}

	/** Model "show original": drop the vocalized text, keep any pinned
	local kinds up on their own lines. */
	function unpinModelAid(msg: ChatMsg): void {
		aidModelPin.delete(msg.id);
		if (pinnedKinds(msg.id).length === 0) aidPin.delete(msg.id);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
	}

	/**
	 * Aid load failed (furigana worker or dictionary): only the furigana
	 * conversion reports failure (pinyin renders synchronously), so drop
	 * just that kind — a pinned pinyin stays up. The last kind out
	 * releases the pin, falling back to the aid name instead of a "show
	 * original" with nothing applied. Only an explicit pin earns a toast.
	 */
	function aidFailed(id: ChatMsgId, reason?: string): void {
		const kinds = pinnedKinds(id);
		const had = kinds.includes("furigana");
		const kept = kinds.filter((kind) => kind !== "furigana");
		if (kept.length === 0) {
			aidKindPin.delete(id);
			if (!aidModelPin.has(id)) aidPin.delete(id);
		} else aidKindPin.set(id, kept);
		if (aidPeek?.id === id) aidPeek = null;
		// The reason ships in the toast: a bare failure gives nothing to
		// report back when it only reproduces on a phone.
		if (had)
			flashErrorToast(
				reason
					? `Couldn't load the readings for this message (${reason}).`
					: "Couldn't load the readings for this message."
			);
	}

	async function runModelAidFor(
		msg: ChatMsg,
		aidId: string,
		pin: boolean
	): Promise<void> {
		if (vocalized[msg.id] !== undefined) {
			if (pin) {
				aidPin.add(msg.id);
				// Compose, never replace: pinned local kinds stay up
				// on their own lines.
				aidModelPin.add(msg.id);
				if (aidPeek?.id === msg.id) aidPeek = null;
				aidNoPeek.add(msg.id);
			}
			return;
		}
		if (vocalizing.has(msg.id)) {
			if (pin) pendingPin.add(msg.id);
			return;
		}
		const provider = await resolveProviderActive();
		if (!provider) {
			const message = "Set an API key first — open Settings.";
			showNotice(notices, "banner", message);
			if (androidUI) flashErrorToast(message);
			return;
		}
		clearNotice(notices, "banner");
		vocalizing.add(msg.id);
		try {
			// Multilingual messages vocalize Arabic lines only: the rest
			// never crosses to the model (faster, cheaper), and the
			// result splices back so other scripts stay byte-identical.
			// A shape mismatch falls back to the whole-text replace.
			const full = aidDisplayText(msg.content);
			const targets = aidTargetLines(full);
			const { input, partial } = selectAidInput(full, targets);
			const text = await runModelAid(provider, aidId, input);
			const spliced = partial ? spliceAidResult(full, targets, text) : null;
			vocalized = { ...vocalized, [msg.id]: spliced ?? text };
			const wantPin = pin || pendingPin.has(msg.id);
			pendingPin.delete(msg.id);
			// Compose, never replace: a local pin placed mid-flight (or
			// before) keeps its kinds; the run still caches either way.
			if (wantPin) {
				aidPin.add(msg.id);
				aidModelPin.add(msg.id);
				if (aidPeek?.id === msg.id) aidPeek = null;
				aidNoPeek.add(msg.id);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showNotice(notices, "banner", message);
			if (androidUI) flashErrorToast(message);
		} finally {
			vocalizing.delete(msg.id);
		}
	}

	function resetVoice(): void {
		speakingId = null;
		speakingSelection = null;
		releaseStudyWake();
	}

	function stopVoice(): void {
		stopSpeaking();
		stopNative();
		resetVoice();
	}

	/** Deleting the message that's playing stops its audio — a reply
	must not keep talking over its own grave. Selection speech stops
	with its source message too. */
	function stopAudioForMessage(id: ChatMsgId): void {
		if (isMessageSpeaking(id, speakingId, speakingSelection)) stopVoice();
	}

	/** Paste-fold toggle: replace the message (never mutate in place). */
	function togglePasteFold(msg: ChatMsg, index: number): void {
		setPasteFold(
			chatState,
			msg.id,
			index,
			!(msg.pasteFolds?.[index]?.open ?? false)
		);
	}

	/** The error banner clears itself like the toast: a failed read
	shouldn't lecture from the bottom of the screen forever. */
	function setVoiceError(message: string | null): void {
		if (message === null) {
			clearNotice(notices, "voice");
			return;
		}
		flashNotice(notices, "voice", message, VOICE_TIMEOUT_MS);
		if (androidUI) flashErrorToast(message);
	}

	/**
	 * Bumped when the voice inventory arrives: getVoices() returns []
	 * until the engine loads (notably slow in phone WebViews), and every
	 * speak gate reads through webVoices, so the bump re-renders them
	 * from disabled to live.
	 */
	let webVoiceVersion = $state(0);
	/** Installed web voices (best-effort: [] reads as "unknown"). */
	function webVoices(): Array<{ lang: string }> {
		// Reactive subscription to the inventory bump (never negative).
		if (webVoiceVersion < 0) return [];
		try {
			if (typeof speechSynthesis === "undefined") return [];
			return speechSynthesis.getVoices();
		} catch {
			return [];
		}
	}

	/** Speak-button state per message (a playing message always offers Stop). */
	function messageSpeakable(msg: ChatMsg): boolean {
		return messageSpeakableFor(
			settings.voiceEngine,
			msg.content,
			settings.voiceLang,
			webVoices()
		);
	}

	function startSpeech(
		id: string,
		text: string,
		lang: string | ((sentence: string) => string),
		quiet = false
	): void {
		stopSpeaking();
		stopNative();
		setVoiceError(null);
		speakingId = id;
		// Study sessions: keep the screen on while the utterance plays.
		// A stale acquire resolving after stop/end releases immediately
		// instead of holding the lock (see resetVoice).
		void acquireStudyWakeLock().then((lock) => {
			if (!lock) return;
			if (speakingId === id) {
				releaseStudyWake();
				studyWakeLock = lock;
			} else {
				lock.release();
			}
		});
		const useNative = settings.voiceEngine === "native";
		const speakWeb = (cb: SpeakCallbacks): boolean =>
			typeof lang === "function"
				? speakMultilingual(text, lang, cb)
				: speakText(text, lang, cb);
		const speakNat = (cb: SpeakCallbacks): boolean =>
			typeof lang === "function"
				? speakNativeMulti(text, lang, cb, settings.nativeVoiceId)
				: speakNative(text, lang, cb, settings.nativeVoiceId);
		let fellBack = false;
		const callbacks: SpeakCallbacks = {
			onEnd: resetVoice,
			onError: (message) => {
				if (useNative && !fellBack) {
					// The bridge failed: say why, then read this utterance
					// with web voices rather than leaving silence (quiet
					// background readbacks skip the notice, not the retry).
					fellBack = true;
					if (!quiet)
						setVoiceError(
							`${friendlyNativeError(message)} Falling back to web voices.`
						);
					const ok = speakWeb({
						onEnd: resetVoice,
						onError: (webMessage) => {
							if (!quiet) setVoiceError(webMessage);
							resetVoice();
						}
					});
					if (!ok) resetVoice();
					return;
				}
				if (!quiet)
					setVoiceError(useNative ? friendlyNativeError(message) : message);
				resetVoice();
			}
		};
		const ok = useNative ? speakNat(callbacks) : speakWeb(callbacks);
		if (!ok) {
			resetVoice();
			// An empty inventory means no TTS engine/data on the device
			// (check the OS text-to-speech settings); voices present but
			// throwing is a different fault. Say which (see
			// startSpeechError); quiet readbacks stay silent throughout.
			const banner = startSpeechError({
				quiet,
				useNative,
				inventoryEmpty: webVoices().length === 0
			});
			if (banner !== null) setVoiceError(banner);
		}
	}

	async function speakReply(msg: ChatMsg, quiet = false): Promise<void> {
		const text = speechText(msg.content);
		if (!text) return;
		const fallback = latinFallback(settings.voiceLang);
		const voices = webVoices();
		if (!messageSpeakableFor(settings.voiceEngine, msg.content, fallback, voices)) {
			if (!quiet) setVoiceError("No voice for this language.");
			return;
		}
		const stripped = text.replace(/```[\s\S]*?```/g, " ");
		// Whole-message voice seeds the Latin sentences; each one then
		// resolves its own language, so four languages read in four
		// voices (see sentenceLangsFor).
		const seed = await quoteLangFor(stripped, fallback);
		startSpeech(
			msg.id,
			text,
			await sentenceLangsFor(
				stripped,
				seed,
				voices,
				latinFallback(settings.voiceLang)
			),
			quiet
		);
	}

	/** Speak-button label. */
	function speakTitle(msg: ChatMsg): string {
		return speakTitleFor(messageSpeaking(msg));
	}

	/** This message owns the live utterance: a whole-reply readback
	or a right-click quote pick from it. The speak button reads as
	stop either way. */
	function messageSpeaking(msg: ChatMsg): boolean {
		return isMessageSpeaking(msg.id, speakingId, speakingSelection);
	}

	function maybeSpeakReply(inChat = chat): void {
		if (!chatVoiceReadback(inChat, settings.voice)) return;
		// Pinned to the chat that was sent from: completing while the
		// user looks elsewhere must not read back some other chat's
		// last message.
		const last = inChat.messages[inChat.messages.length - 1];
		if (last?.role === "assistant" && !last.error && last.content.trim()) {
			// Background readback stays silent throughout: no banner for
			// something the user never asked to hear, including a runtime
			// failure after an attemptable-looking voice.
			const voices = webVoices();
			if (
				!messageSpeakableFor(
					settings.voiceEngine,
					last.content,
					settings.voiceLang,
					voices
				)
			)
				return;
			void speakReply(last, true);
		}
	}

	/**
	 * Backgrounded reply ping (study sessions): when a reply
	 * finishes while the window is hidden/backgrounded, a
	 * permission-gated notification + badge carries its head. Silent
	 * when focused, silent for failures.
	 */
	function maybeNotifyReplyDone(msg: ChatMsg | undefined): void {
		if (!settings.replyNotifications) return;
		if (!msg || msg.role !== "assistant" || msg.error) return;
		const body = msg.content.trim();
		if (!body) return;
		// Shell goes native (Android WebView has no Notification ctor);
		// the async ping still fires when the reply lands backgrounded.
		void notifyReplyDoneAsync("Reply finished", body, {
			shell: tauriBackendAvailable()
		}).then((pinged) => {
			if (pinged) setStudyBadge(1);
		});
	}

	/**
	 * Effective readback for the visible chat: its own override when
	 * set, else the global default (off at every launch). Reactive —
	 * switching chats re-renders the toggle with that chat's state.
	 */
	function voiceOn(): boolean {
		return chatVoiceReadback(chat, settings.voice);
	}

	function setVoiceEnabled(on: boolean): void {
		// Per-chat setting: the toggle writes this chat's override
		// (persisted with the chats), never the global default — other
		// chats keep theirs.
		setChatVoice(chatState, chatState.activeChatId, on);
		if (!on) stopVoice();
	}

	function toggleVoice(): void {
		// Global stop, always in reach: message audio keeps playing
		// after its row fades (or the user scrolls away from it), and
		// on phones there is no other stop in view. Tapping mid-speech
		// stills the utterance AND switches readback off: a green
		// toggle that just stopped talking would lie about the state.
		if (speakingId !== null) {
			stopVoice();
			setVoiceEnabled(false);
			return;
		}
		setVoiceEnabled(!voiceOn());
	}

	/** Raw speech-recognition errors translated into something actionable. */
	// Mic errors arrive already translated (friendlyMicError in $lib/voice,
	// mapped inside dictateOnce) — callers toast the message directly.

	/**
	 * Speak the word/sentence/paragraph under a window point (the
	 * Shift+W/S/P chords): the point resolves to a text node, the
	 * node's article to its message, and the slice walk to the offset
	 * in the rendered text — bounds come from the visible words, so
	 * washes and speech agree. The paragraph routes the voice (a
	 * kanji word alone would read Chinese inside Japanese text).
	 * Off-text points buzz denial; languageless messages stay silent
	 * like the Shift+R path.
	 */
	function speakUnitAtPoint(
		clientX: number,
		clientY: number,
		unit: "word" | "sentence" | "paragraph"
	): void {
		let range: Range | null = null;
		try {
			if (typeof document.caretRangeFromPoint === "function")
				range = document.caretRangeFromPoint(clientX, clientY);
		} catch {
			range = null;
		}
		const node = range?.startContainer ?? null;
		const holder =
			node instanceof Text
				? (node.parentElement?.closest(".rendered") ?? null)
				: null;
		const article = holder?.closest('article[id^="msg-"]') ?? null;
		const msg =
			article && holder
				? viewChat.messages[Number(article.id.slice(4))]
				: undefined;
		if (!msg || !holder || !messageSpeakable(msg)) return;
		const slices = scopeSlices(holder);
		const hit = slices.find((s) => s.node === node);
		if (!hit || !node) {
			buzzNo();
			return;
		}
		// Block-aware flatten: a blank line separates rendered
		// blocks so paragraph/sentence speech stops at the visible
		// paragraph instead of fusing adjacent blocks.
		const { full, at } = joinSlicesWithBlocks(
			slices,
			holder,
			hit,
			range?.startOffset ?? 0
		);
		const [paraStart, paraEnd] = paragraphBounds(full, at);
		const paragraph = full.slice(paraStart, paraEnd);
		let quote: string;
		if (unit === "word") quote = extractWordAt(full, at);
		else if (unit === "sentence") {
			const [s, e] = sentenceBounds(full, at);
			quote = full.slice(s, e);
		} else quote = paragraph;
		if (!quote.trim()) {
			buzzNo();
			return;
		}
		void speakQuote(quote, msg.id, false, paragraph);
	}

	/**
	 * Highlight-to-speak: only what was selected, only when asked. The quote
	 * keeps its own language (script detection, then Apple's recognizer for
	 * Latin scripts), so a French highlight gets a French voice even when
	 * the message around it is English.
	 */
	async function speakQuote(
		quote: string,
		messageId: ChatMsgId,
		keepMenu = false,
		context: string = quote
	): Promise<void> {
		// The highlight stays: hearing the quote shouldn't clear the
		// selection it came from. Touch auto-read keeps the menu too,
		// so Annotate stays one tap away after listening.
		// Route off the surrounding paragraph, not the bare quote: two
		// kanji identify nothing on their own (Han reads Chinese by
		// default), so a kanji-only highlight inside Japanese text
		// reads Japanese — the quote alone would read Chinese.
		const sentence = sentenceForQuote(context, quote);
		const probe = sentence ?? context;
		const voices = webVoices();
		const lang = effectiveSpeechLang(
			await quoteLangForContext(
				probe,
				context,
				latinFallback(settings.voiceLang)
			),
			voices
		);
		if (!speechAttemptable(settings.voiceEngine, lang, voices)) {
			selMenu = null;
			setVoiceError("No voice for this language.");
			return;
		}
		if (!keepMenu) selMenu = null;
		speakingSelection = messageId;
		// The surrounding voice seeds; each Latin sentence in the
		// highlight still resolves its own language (see
		// sentenceLangsFor), so a mixed highlight reads each part
		// correctly and a kanji-only one keeps its context voice.
		startSpeech(
			"selection",
			quote,
			await sentenceLangsFor(
				quote,
				lang,
				voices,
				latinFallback(settings.voiceLang),
				// Seed Latin identification from the whole message: the
				// highlight alone can start mid-sentence, too short to
				// identify, while its message holds whole sentences.
				context
			)
		);
	}

	/** Pill-mic dictation into the annotation comment box. */
	let pillDictating = $state(false);
	let stopPillDictation: (() => void) | null = null;
	function stopPillMic(): void {
		stopPillDictation?.();
		stopPillDictation = null;
		pillDictating = false;
	}
	/**
	 * Native-first dictation: the OS recognizer where one exists
	 * (Android/macOS/Windows shell), web SpeechRecognition otherwise.
	 * Resolves a stop function, or null when neither path can listen
	 * (the caller toasts). Native hard errors (denied, busy) surface
	 * directly and skip the web attempt.
	 */
	let micStarting = false;
	async function dictateNativeFirst(
		onResult: (transcript: string) => void,
		onError: (message: string) => void
	): Promise<(() => void) | null> {
		micStarting = true;
		try {
			const outcome = await startNativeDictation(
				latinFallback(settings.voiceLang),
				{
					onFinal: onResult,
					onError
				}
			);
			if (outcome.kind === "started") return outcome.stop;
			if (outcome.kind === "error") {
				onError(outcome.message);
				return null;
			}
		} catch {
			// Bridge blew up mid-start; the web path gets its chance below.
		} finally {
			micStarting = false;
		}
		return dictateOnce(latinFallback(settings.voiceLang), onResult, onError);
	}
	async function togglePillMic(): Promise<void> {
		if (micStarting) return;
		if (stopPillDictation) {
			stopPillMic();
			return;
		}
		dismissToast();
		const stop = await dictateNativeFirst(
			(transcript) => {
				annDraft = appendDictation(annDraft, transcript);
				stopPillMic();
			},
			(message) => {
				flashErrorToast(message);
				stopPillMic();
			}
		);
		if (!stop) {
			flashErrorToast(micUnavailableMessage(tauriBackendAvailable()));
			return;
		}
		stopPillDictation = stop;
		pillDictating = true;
	}

	async function toggleMic(): Promise<void> {
		if (micStarting) return;
		if (dictating) {
			stopDictation?.();
			stopDictation = null;
			dictating = false;
			return;
		}
		dismissToast();
		const stop = await dictateNativeFirst(
			(transcript) => {
				editor?.insertText(dictationInsert(transcript));
				dictating = false;
				stopDictation = null;
			},
			(message) => {
				flashErrorToast(message);
				dictating = false;
				stopDictation = null;
			}
		);
		if (!stop) {
			flashErrorToast(micUnavailableMessage(tauriBackendAvailable()));
			return;
		}
		stopDictation = stop;
		dictating = true;
	}

	/**
	 * Immediate settings save. Keys mirror to secret storage first, then
	 * the shell persists blanks (the browser keeps working as before).
	 * Every save path must use this: a bare saveSettings(settings) would
	 * write live in-memory keys to disk next to the Keychain copy.
	 */
	function saveSettingsNow(source?: AppSettings): void {
		const snapshot = source ?? $state.snapshot(settings);
		void (async () => {
			await persistSecrets(snapshot);
			saveSettings(
				tauriBackendAvailable() ? withBlankedKeys(snapshot) : snapshot
			);
		})();
	}

	function persistSettings() {
		saveSettingsNow();
	}

	/**
	 * Offline fallback parking: the drop parks a cloud provider on the
	 * on-device Gemma option; the reconnect restores only what the drop
	 * parked. Not rendered state — the provider switch re-renders itself.
	 */
	let offlineParkedFrom: ProviderId | null = null;

	function handleOffline(): void {
		const target = offlineTarget(settings.activeProviderId);
		if (!target) return;
		offlineParkedFrom = settings.activeProviderId;
		settings.activeProviderId = target;
		persistSettings();
	}

	function handleOnline(): void {
		const restore = onlineRestore(offlineParkedFrom, settings.activeProviderId);
		offlineParkedFrom = null;
		if (!restore) return;
		settings.activeProviderId = restore;
		persistSettings();
	}

	function resolveProvider(): ChatProvider | null {
		if (useMock) return new MockProvider();
		// On-device Gemini Nano: keyless, conf-free, Gemma pill only —
		// failures throw the seam's short copy, never a reroute.
		if (isOnDeviceProvider(settings.activeProviderId))
			return new OnDeviceChatProvider();
		const conf = settings.providers[settings.activeProviderId];
		// Keyless on-device endpoints carry no key by design.
		const keyless =
			getProviderDef(settings.activeProviderId, settings.customProviders)
				.keyless === true;
		if (!conf) return null;
		if (providerKeyMissing(conf.apiKey, keyless)) return null;
		return createProvider(
			settings.activeProviderId,
			{ ...conf, mobile: androidUI },
			settings.customProviders
		);
	}

	/**
	 * resolveProvider plus one legacy migration attempt: when the active
	 * provider's key is blank, a pre-bundle per-provider item may still
	 * hold it — read that single item, fold it into the bundle, and
	 * re-resolve before concluding the key is missing. The launch path
	 * never does this fan-out; it fires only here, in the user's send
	 * context, at most once per legacy key.
	 */
	async function resolveProviderActive(): Promise<ChatProvider | null> {
		const direct = resolveProvider();
		if (direct) return direct;
		if (await migrateLegacySecret(settings, settings.activeProviderId)) {
			return resolveProvider();
		}
		return null;
	}

	/**
	 * On-device send gate: a not-ready local model refuses before the
	 * composer clears, with the probe's own copy (downloading vs
	 * missing vs unsupported) in the banner slot — never a sent turn
	 * that fails without thinking. Cloud providers pass straight
	 * through. True when the send is refused (caller returns, draft
	 * intact).
	 */
	async function blockUnreadyOnDevice(): Promise<boolean> {
		if (!isOnDeviceProvider(settings.activeProviderId)) return false;
		const status = await onDeviceStatus();
		if (status.state === "ready") return false;
		const message = onDeviceNotReadyCopy(status);
		showNotice(notices, "banner", message);
		if (androidUI) flashErrorToast(message);
		return true;
	}

	/** Seconds since the viewed chat started sending (the Thinking
	chip counts the wait up). No cleanup return on purpose: token
	updates may re-run this watcher mid-send, and tearing the
	interval down there would stall the count — the branches below
	own it for both send paths, so neither doSend nor resend
	touches it. */
	let sendElapsed = $state(0);
	let sendTick: ReturnType<typeof setInterval> | null = null;
	let wasSending = false;
	$effect(() => {
		// Native turns never raise the TS sending flag, so a detached
		// turn counts the wait up on its own liveness instead.
		const sending =
			isSending(chatState, viewChat.id) ||
			nativeFetching.has(viewChat.id) ||
			liveNative.has(viewChat.id);
		if (sending && !wasSending) {
			wasSending = true;
			sendElapsed = 0;
			const t0 = Date.now();
			if (sendTick !== null) clearInterval(sendTick);
			sendTick = setInterval(() => {
				sendElapsed = Math.floor((Date.now() - t0) / 1000);
			}, 1000);
		} else if (!sending && wasSending) {
			wasSending = false;
			if (sendTick !== null) {
				clearInterval(sendTick);
				sendTick = null;
			}
		}
	});

	/** Shared send tail (fresh sends, resends, native completions):
	resolve the origin chat's last message, thump or ping, follow the
	stream, read back, notify, and settle the composer. Reads pin to
	the origin id, never the live chat. A deleted origin skips the
	readback (there is nothing left to read aloud). */
	function afterSend(originId: ChatId): void {
		const { sent, stillHere } = resolveSendCompletion(
			chatState,
			originId,
			chat.id
		);
		if (sent?.role === "assistant" && !sent.error) {
			// Same-chat only: the new chat must not thump for the old
			// one's reply (a genuinely missed finish is the background
			// ping's job).
			if (stillHere) {
				void hapticBeatAsync("done", {
					enabled: settings.hapticsEnabled,
					shell: tauriBackendAvailable()
				});
			} else if (androidUI) {
				// Other-chat landing on phones: tick plus a tappable
				// toast — a reply must not finish silently in a thread
				// the user left. Tapping opens the origin chat.
				buzzTap();
				flashToast("Reply ready — tap to open", () =>
					transitionToChat(originId)
				);
			}
		}
		// Follow the stream only while its chat is open — and only a
		// stuck reader: a finished reply must not yank a mid-thread
		// reader back to the end. After a switch the new chat keeps
		// its own scroll position.
		if (stillHere && stuckToBottom()) scrollToBottom();
		const origin = chatState.chats.find((c) => c.id === originId);
		if (origin) maybeSpeakReply(origin);
		maybeNotifyReplyDone(sent);
		// The reply's layout churn (hero unmount, list growth, keyboard
		// transitions on phones) can strand the emptied composer's cached
		// line boxes at zero height: settle a re-measure after paint, like
		// the mount path does, so it holds one line without a keystroke.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => editor?.remeasure())
		);
	}

	/** Native route decision (Android shell, network text turns).
	Returns the provider config for the native runner, or null when
	the TypeScript engine stays on (including keyless: the provider
	resolution below raises missing-key with the draft intact, same
	as any TypeScript send). */
	function nativeRoute(outgoing: Attachment[]): NativeTurnConfig | null {
		return nativeRouteFor(
			{
				androidUI,
				shell: tauriBackendAvailable(),
				mock: useMock,
				onDevice: isOnDeviceProvider(settings.activeProviderId)
			},
			outgoing,
			settings
		);
	}

	/** Start one native turn for an already-opened placeholder. */
	async function startNativeTurnFor(
		chatId: ChatId,
		replyId: ChatMsgId,
		config: NativeTurnConfig,
		system: string,
		history: Array<{ role: string; content: string }>
	): Promise<void> {
		const turnId = crypto.randomUUID() as TurnId;
		nativeTurns.set(turnId, { chatId, replyId });
		nativeText.set(turnId, "");
		liveNative.add(chatId);
		try {
			await startNativeTurn({
				turn_id: turnId,
				chat_id: chatId,
				message_id: replyId,
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				model: config.model,
				extraBody: config.extraBody,
				system,
				messages: history
			});
		} catch {
			// The spawn itself failed: settle locally as a failed turn
			// so the existing Retry UI applies (same shape as any
			// provider error, never a wedged send).
			releaseNativeTurn(nativeOwn, turnId, chatId);
			applyTurnFile(chatState, {
				turn_id: turnId,
				chat_id: chatId,
				message_id: replyId,
				status: "error",
				content: "",
				error: "Couldn't start the reply.",
				finished_at: Math.floor(Date.now() / 1000)
			});
			settleNativeSend(chatState, chatId);
			afterSend(chatId);
		}
	}

	/** Native fresh send (Android): same preamble contract as the
	TypeScript path — baked text, kept attachments, folds — then the
	turn detaches and this returns. Tokens, fetch phase, retries, and
	completion land via the turn listeners below. */
	async function doNativeSend(opts: {
		baked: string;
		kept: Attachment[];
		folds: PasteFold[];
		pastedFolds: PasteFold[];
		config: NativeTurnConfig;
		system: string;
	}): Promise<void> {
		// Before the append below (see stuckToBottom).
		const stuck = stuckToBottom();
		const opened = beginNativeSend(chatState, opts.baked, {
			attachments: opts.kept,
			pasteFolds: mergeFolds(opts.folds, opts.pastedFolds)
		});
		// A duplicate send racing in: the first one owns the chat.
		if (!opened) return;
		const target = chatState.chats.find((c) => c.id === opened.chatId);
		const history = turnHistory(
			(target?.messages ?? []).filter((m) => m.id !== opened.replyId)
		);
		if (stuck) scrollAfterRender();
		await startNativeTurnFor(
			opened.chatId,
			opened.replyId,
			opts.config,
			opts.system,
			history
		);
	}

	/** Live-token event: accumulate per turn and swap the placeholder
	content wholesale (never mutate in place — same discipline as the
	TypeScript stream). Unknown turns (settled by a scan while
	suspended) only dismiss. */
	function onNativeToken({ turn_id, token }: TurnTokenEvent): void {
		const owned = nativeTurns.get(turn_id);
		if (!owned) return;
		const target = chatState.chats.find((c) => c.id === owned.chatId);
		if (!target) return;
		const full = (nativeText.get(turn_id) ?? "") + token;
		nativeText.set(turn_id, full);
		if (!hasReplyStarted(chatState, owned.chatId)) {
			markReplyStarted(chatState, owned.chatId);
			if (chatState.activeChatId === owned.chatId) {
				void hapticBeatAsync("first", {
					enabled: settings.hapticsEnabled,
					shell: tauriBackendAvailable()
				});
			}
		}
		target.messages = target.messages.map((m) =>
			m.id === owned.replyId ? { ...m, content: full } : m
		);
	}

	/** Fetch-phase event: the Fetching chip reads `nativeFetching`
	alongside the TypeScript flag, so both engines drive one indicator. */
	function onNativeFetch({ turn_id, phase }: TurnFetchEvent): void {
		const owned = nativeTurns.get(turn_id);
		if (!owned) return;
		if (phase === "start") nativeFetching.add(owned.chatId);
		else nativeFetching.delete(owned.chatId);
	}

	/** Retry event: the runner recomputes from scratch, so the
	accumulator (and its placeholder) clears — the final content still
	heals everything at completion. */
	function onNativeRetry({ turn_id }: TurnTokenEvent): void {
		const owned = nativeTurns.get(turn_id);
		if (!owned) return;
		nativeText.set(turn_id, "");
		const target = chatState.chats.find((c) => c.id === owned.chatId);
		if (!target) return;
		target.messages = target.messages.map((m) =>
			m.id === owned.replyId ? { ...m, content: "" } : m
		);
	}

	/** Completion event: poll the file, render, settle, and run the
	shared tail — but only while the turn still owns its chat. A scan
	that settled first releases ownership, so a late event only
	dismisses the file instead of double-rendering. */
	async function onNativeDone({ turn_id }: TurnDoneEvent): Promise<void> {
		const owned = nativeTurns.get(turn_id);
		if (!owned) {
			try {
				await dismissNativeTurn(turn_id);
			} catch {
				// Already gone: scans dismiss what they settle.
			}
			return;
		}
		releaseNativeTurn(nativeOwn, turn_id, owned.chatId);
		let file: NativeTurnFile;
		try {
			file = await pollNativeTurn(turn_id);
		} catch {
			file = errorTurnFile(turn_id, owned.chatId, owned.replyId);
		}
		const outcome = applyTurnFile(chatState, file);
		settleNativeSend(chatState, owned.chatId);
		// A visible page marks the turn seen, which stands down the
		// runner's background ping; backgrounded pages never call it.
		// Either way a ping for a reply rendering in front of the user
		// is always wrong (grace-expiry races), so it dies here too.
		if (document.visibilityState === "visible") {
			try {
				await seenNativeTurn(turn_id);
			} catch {
				// A stray ping beats a lost reply.
			}
			void dismissReplyNotificationAsync({
				shell: tauriBackendAvailable()
			});
		}
		try {
			await dismissNativeTurn(turn_id);
		} catch {
			// Scans dismiss what they settle; late events find nothing.
		}
		if (outcome === "applied") afterSend(owned.chatId);
	}

	/** Restart a turn whose process died mid-flight: the request the
	provider API never held gets re-sent onto its own placeholder, so
	the user returns to thinking dots and a completed reply — never
	Retry. Strict shape (clean assistant placeholder still last,
	chat idle, key resolves), otherwise false and the caller falls
	back to interrupted. A resumed-then-killed turn resumes again on
	the next return; each restart owns a fresh turn id, so nothing
	loops inside one session. */
	async function resumeKilledTurn(file: NativeTurnFile): Promise<boolean> {
		if (!resumableKilledTurn(chatState, file)) return false;
		const target = chatState.chats.find((c) => c.id === file.chat_id);
		const last = target?.messages[target.messages.length - 1];
		const prev = target?.messages[(target?.messages.length ?? 0) - 2];
		if (!target || !last || !prev || prev.role !== "user") return false;
		// Same route as a manual Retry (last user message's own
		// attachments decide images); a missing key keeps the draft
		// instead of erroring.
		const config = nativeRoute(prev.attachments ?? []);
		if (!config) return false;
		const history = turnHistory(
			target.messages.filter((m) => m.id !== last.id)
		);
		chatState.sendingChatIds = [...chatState.sendingChatIds, target.id];
		chatState.sending = true;
		chatState.sendingChatId = target.id;
		if (stuckToBottom()) scrollAfterRender();
		await startNativeTurnFor(
			target.id,
			last.id,
			config,
			effectiveSystemPrompt(settings, activeReplyCode),
			history
		);
		return true;
	}

	/** Foreground-return and boot reconciliation: every turn file the
	live listeners don't own gets rendered (finished), resumed
	(streaming with no live owner — a dead process — restarts, so the
	user returns to dots, never Retry), or dismissed (placeholder
	gone). Resume can fail (no key, chat busy): only then does the
	interrupted copy apply. Tail effects run only for chats that were
	actually waiting, so a boot scan never thumps for old news. */
	async function reconcileNativeTurns(): Promise<void> {
		if (!tauriBackendAvailable()) return;
		let files: NativeTurnFile[];
		try {
			files = await scanNativeTurns();
		} catch {
			return;
		}
		for (const file of files) {
			// Live turns stream through their listeners; the scan only
			// covers what suspension (or death) took off the event path.
			if (file.status === "streaming" && nativeTurns.has(file.turn_id)) {
				continue;
			}
			releaseNativeTurn(nativeOwn, file.turn_id, file.chat_id);
			const wasLive = isSending(chatState, file.chat_id);
			if (file.status === "streaming") {
				// A dead process never strands the user on Retry: the
				// turn restarts onto its own placeholder (dots again),
				// and a late completion heals everything. Only a
				// resume the page cannot rebuild falls back to
				// interrupted.
				if (await resumeKilledTurn(file)) {
					// Ownership moved to the new turn; the stale file
					// still dismisses below.
				} else if (markTurnInterrupted(chatState, file)) {
					settleNativeSend(chatState, file.chat_id);
					if (wasLive) afterSend(file.chat_id);
				}
			} else {
				if (applyTurnFile(chatState, file) === "applied") {
					settleNativeSend(chatState, file.chat_id);
					if (wasLive) afterSend(file.chat_id);
				}
			}
			try {
				await dismissNativeTurn(file.turn_id);
			} catch {
				// A done event settling the same file first already did.
			}
		}
	}

	async function doSend() {
		// Mobile in-prompt note edit owns the send arrow: file the
		// comment instead of sending a chat (see commitPromptAnnEdit).
		if (promptAnnEdit) {
			commitPromptAnnEdit();
			return;
		}
		// First step lives in sendAction (pinned in submit.test.ts);
		// the preamble and both continuations stay here as effects.
		const action = sendAction({ canSubmit, editing: editingMsgId !== null });
		if (action === "ignore") return;
		// Haptic tap on send (silenced by the haptics toggle; native
		// haptics in the shell, Web vibrator in the preview).
		void hapticBeatAsync("send", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
		clearStudyBadge();
		// No permission ask from the send gesture: tapping send must
		// never raise anything notification-shaped. The startup ask
		// (same gating) is the only prompt, so a later backgrounded
		// long reply may still notify once granted there.
		if (action === "commit-edit") {
			// Saving an edit rewrites the message in place, never
			// resends — and the composer text below still sends as a
			// fresh message. If the edited message vanished mid-edit,
			// reset the placeholder, then send fresh either way.
			if (!commitMessageEdit()) editor?.setPlaceholder(promptPlaceholder());
		}
		// Native route (Android shell, network text turns): decided
		// before the provider resolves and the composer clears, so the
		// native path never touches the Keychain (its key rides the
		// turn request instead) and a missing key keeps the draft.
		const nativeConfig = nativeRoute(attachments);
		const nativeSystem = nativeConfig
			? effectiveSystemPrompt(
					settings,
					activeReplyCode,
					!isOnDeviceProvider(settings.activeProviderId)
				)
			: "";
		// The local model either answers or refuses here: no send into
		// a missing/downloading Nano, and the draft stays for a retry.
		if (!nativeConfig && (await blockUnreadyOnDevice())) return;
		const provider = nativeConfig ? null : await resolveProviderActive();
		if (!provider && !nativeConfig) {
			missingKey = true;
			return;
		}
		missingKey = false;
		focusMode = "edit";
		stopVoice();
		// Paste folds ride the send: same text composerText would give,
		// plus collapsed-paste spans mapped into it (covers image-marker
		// stripping and trim exactly — see sendPasteFolds).
		const { text, folds } = sendPasteFolds(
			editor?.getText() ?? "",
			editor?.getPastes() ?? []
		);
		const outgoing = attachments;
		const outgoingAnnotations = annotations;
		// The prompt empties the moment the message goes out — not when the
		// (possibly long) reply finishes streaming in. The annotation pill
		// and count go with it: the block is already baked into the sent
		// message, so nothing waits on the reply. Attachment pills clear
		// with it (`outgoing` already captured them for the send).
		editor?.clear();
		attachments = [];
		expandedPastes = [];
		annotations = [];
		pendingAnn = null;
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		// Origin chat object (stable by reference): the post-send reads
		// below must not follow a chat switch mid-stream.
		const sentFrom = chat;
		// sendMessage appends the user message (plus the thinking
		// placeholder) synchronously; the scroll waits a tick for the
		// render, or it measures the old height and lands short.
		// Image literals ride the stored text (the tag reads as message
		// text, paired back to its attachment by kind order); the
		// provider payload strips them again in apiContent. Pasted-text
		// pills splice back inline at their tags (kept attachments ride
		// along; pasted ones are already prose).
		const { stored, kept, pastedFolds } = spliceSendText(text, outgoing);
		const baked = withAnnotations(stored, outgoingAnnotations);
		// Native turns detach here and complete via turn-done (or the
		// return/boot scan); the shared tail runs at completion, not here.
		if (nativeConfig) {
			await doNativeSend({
				baked,
				kept,
				folds,
				pastedFolds,
				config: nativeConfig,
				system: nativeSystem
			});
			return;
		}
		// Unreachable with a live provider (null returns above), but the
		// narrowing keeps the call below honest without an assertion.
		if (!provider) {
			missingKey = true;
			return;
		}
		// Before the append below (see stuckToBottom): the provider
		// await above is real time, so snapshot here, not earlier.
		const stuck = stuckToBottom();
		const sending = sendMessage(
			chatState,
			provider,
			effectiveSystemPrompt(
				settings,
				activeReplyCode,
				!isOnDeviceProvider(settings.activeProviderId)
			),
			baked,
			{
				attachments: kept,
				thinking: activeThinkingId(settings),
				pasteFolds: mergeFolds(folds, pastedFolds),
				// Haptic rumble as the reply starts arriving — only while
				// its chat is still open. A mid-stream switch must not
				// rumble the new chat for the old one's reply.
				onFirstToken: () => {
					if (chat.id !== sentFrom.id) return;
					void hapticBeatAsync("first", {
						enabled: settings.hapticsEnabled,
						shell: tauriBackendAvailable()
					});
				}
			}
		);
		if (stuck) scrollAfterRender();
		await sending;
		// Keep drafts when the reply failed so nothing silently drops.
		// Filed (or staged) annotations survive the landing: the
		// send-time reset above already dropped the baked pills, so
		// nothing resets here — later work belongs to the user.
		afterSend(sentFrom.id);
	}

	async function resend() {
		stopVoice();
		// A resend is a send too: same tap, rumble, and thump as doSend.
		void hapticBeatAsync("send", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
		// Native resends (Android): Retry buttons land here after
		// dismissing the failed reply, so the retried turn survives the
		// background exactly like a fresh one. Guards mirror the fresh
		// send; the last user message's own attachments decide images.
		const lastResend = chat.messages[chat.messages.length - 1];
		const resendConfig = nativeRoute(lastResend?.attachments ?? []);
		if (resendConfig) {
			missingKey = false;
			// Before the append below (see stuckToBottom).
			const stuck = stuckToBottom();
			const reopened = beginNativeResend(chatState);
			// Non-user-last (or a racing send): resendLast no-ops the
			// same way, so return silently here too.
			if (!reopened) return;
			const resendTarget = chatState.chats.find(
				(c) => c.id === reopened.chatId
			);
			const resendHistory = turnHistory(
				(resendTarget?.messages ?? []).filter(
					(m) => m.id !== reopened.replyId
				)
			);
			if (stuck) scrollAfterRender();
			await startNativeTurnFor(
				reopened.chatId,
				reopened.replyId,
				resendConfig,
				effectiveSystemPrompt(settings, activeReplyCode),
				resendHistory
			);
			return;
		}
		// TypeScript resends resolve the provider (Keychain on first
		// use); the native branch above never gets here.
		if (await blockUnreadyOnDevice()) return;
		const provider = await resolveProviderActive();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		const resentFrom = chat;
		await resendLast(
			chatState,
			provider,
			effectiveSystemPrompt(settings, activeReplyCode),
			{
				thinking: activeThinkingId(settings),
				onFirstToken: () => {
					if (chat.id !== resentFrom.id) return;
					void hapticBeatAsync("first", {
						enabled: settings.hapticsEnabled,
						shell: tauriBackendAvailable()
					});
				}
			}
		);
		// Same origin-chat discipline as a fresh send: the live
		// `chat` may point at a new thread by now.
		afterSend(resentFrom.id);
	}

	/** The tall composer dwarfs a one-line draft: taps on its empty
	floor focus the editor instead of dying on the container. Buttons,
	fields, and the annotation review keep their own clicks. */
	function focusPromptFloor(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target : null;
		// Locked taps explain instead of focusing (the disabled field
		// takes no focus and pops no keyboard) — except on controls
		// with their own behavior, which keep it.
		if (noKeyLock && !target?.closest("button, input, select, a, .ann-wrap")) {
			const message = "Set an API key first — open Settings.";
			showNotice(notices, "banner", message);
			if (androidUI) flashErrorToast(message);
			return;
		}
		if (target?.closest("button, input, textarea, select, a, .ann-wrap"))
			return;
		editor?.focus();
	}

	function onSubmit(kind: SubmitKind) {
		// Guards live in submitAction (guard order pinned in
		// submit.test.ts); the always-hide blur and both bodies stay
		// here as effects.
		const action = submitAction({
			annPopOpen: annPop !== null && !annPopClosing,
			canSubmit,
			sendGuardTripped: Date.now() < sendGuardUntil,
			kind
		});
		if (action === "ignore") {
			// A send attempted while this chat's reply streams buzzes
			// denial (annotations or not — nothing goes out mid-thought).
			// Empty Enter stays silent, like before.
			if (
				isSending(chatState) &&
				(hasText || attachments.length > 0 || annotations.length > 0)
			) {
				buzzNo();
			}
			return;
		}
		// Always-hide mode: sending yields focus, so the prompt hides
		// behind the reply (the focusout below does the hiding; this
		// just drops the caret).
		if (settings.promptIdleSec === PROMPT_IDLE_ALWAYS) editor?.blur();
		if (action === "stage") {
			// ⌥+Enter: most recent message, no reply; the next submit
			// carries the full history in order. Before the append
			// below (see stuckToBottom).
			const stuck = stuckToBottom();
			const { stored: staged, kept: stagedKept } = spliceSendText(
				composerText(),
				attachments
			);
			stageMessage(chatState, staged, stagedKept);
			attachments = [];
			expandedPastes = [];
			editor?.clear();
			if (stuck) scrollAfterRender();
			return;
		}
		void doSend();
	}

	function retryFailed() {
		dismissFailedAssistant(chatState);
		void resend();
	}

	function rerunFrom(index: number) {
		truncateToMessage(chatState, index);
		void resend();
	}

	/** Row branch (touch): chat.ts forks, the tick plus toast live
	here — call sites carry no haptic of their own (see dropChat). */
	function branchHere(index: number): void {
		branchFrom(chatState, index);
		if (!androidUI) return;
		buzzTap();
		flashToast("Branched");
	}

	/** Row message delete (touch): chat.ts deletes, the tick lives
	here. Keyboard and cut paths keep their own silence. */
	function dropMessage(index: number): void {
		const doomed = chat.messages[index];
		if (doomed) stopAudioForMessage(doomed.id);
		deleteMessage(chatState, index);
		if (!androidUI) return;
		buzzTap();
	}

	/** Inspect card (touch): every button ticks through one delegated
	gate instead of a tick per button. */
	function buzzInspectTap(event: TouchEvent): void {
		if (event.target instanceof Element && event.target.closest("button"))
			buzzTap();
	}

	/**
	 * Pencil (or E) on an own message: open it for in-place editing
	 * where it sits (a second press toggles back off). The baked
	 * annotation block is provider context, not edit text, so only the
	 * prose seeds the editor; its refs come back as pending annotations
	 * so saving re-bakes the same context. Attachments ride along on
	 * their own state — the composer's draft stays untouched. No-op
	 * mid-send.
	 */
	function editMessage(index: number) {
		// Target gates live in editMessageAction (pinned in
		// submit.test.ts); refs seeding and the edit effects stay here.
		const editAction = editMessageAction(chat.messages, index, {
			sending: chatState.sending,
			editingId: editingMsgId
		});
		if (editAction === "ignore-sending" || editAction === "ignore-not-user")
			return;
		if (editAction === "toggle-off") {
			cancelMessageEdit();
			return;
		}
		const msg = chat.messages[index];
		if (!msg) return;
		const refs = annRefsFor(msg.content);
		annotations = refs ? seedAnnotationsFromRefs(msg.id, refs.refs) : [];
		editingAttachments = msg.attachments ? [...msg.attachments] : [];
		// Message content carries no stripped markers on save, so the
		// seed keeps its marker lines: recount instead of reconciling,
		// or the message's own image attachments would drop as
		// "deleted tags".
		editingSeed = refs ? refs.text : msg.content;
		editingPrevMarkers = countMarkers(editingSeed);
		editingPrevFileMarkers = countMarkers(editingSeed, FILE_MARKER);
		editingPrevPasted = countPastedTags(editingSeed);
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		editingMsgId = msg.id;
		// The edit action focuses on mount; keep the message on screen
		// without yanking it (the composer-at-bottom jump is gone).
		requestAnimationFrame(() =>
			document
				.getElementById(`msg-${index}`)
				?.scrollIntoView({ block: "nearest" })
		);
	}

	/**
	 * Inline-edit-only reset: drops the edit (annotations, attachments,
	 * edit id) while leaving the composer's own draft exactly alone.
	 */
	function resetInlineEdit(): void {
		annotations = [];
		reviewOpen = false;
		editingId = null;
		editDraft = "";
		editingMsgId = null;
		editingAttachments = [];
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		annDraft = "";
	}

	/** Esc during an edit: drop the draft, keep history untouched. */
	function cancelMessageEdit(): void {
		resetInlineEdit();
	}

	/** Ctrl+G hop-out blurs without canceling: the draft stays mounted
	for a click back in (only true focus-away reverts). */
	let blurCancelMuted = false;

	/** Focus leaving the in-place editor reverts to the untouched
	message (the draft dies with the editor, so history is safe):
	focus landing outside the edited message cancels — but the
	message's own action row stays live (fold stays gated, the
	commit checkmark must reach commitMessageEdit first). */
	function blurInlineEdit(event: FocusEvent): void {
		if (!editingMsgId || blurCancelMuted) return;
		const next = event.relatedTarget;
		if (next instanceof Element) {
			const box = event.currentTarget;
			if (box instanceof HTMLElement) {
				if (box.contains(next)) return;
				const boxArticle = box.closest("article");
				if (boxArticle !== null && boxArticle === next.closest("article"))
					return;
			}
			if (next.closest("[data-commit-edit]") !== null) return;
		}
		cancelMessageEdit();
	}

	/**
	 * Rewrite the edited message in place (text plus re-baked
	 * annotations, attachments, folds). Reads the in-place editor when
	 * it is mounted, so a send from the composer mid-edit still saves
	 * the message text rather than the composer draft.
	 */
	function saveMessageEdit(): void {
		const id = editingMsgId;
		if (id) {
			const src = msgEditor ?? editor;
			const prev = activeChat(chatState).messages.find((m) => m.id === id);
			const { stored, folds: keepFolds } = bakeEditedMessage(
				src?.getText() ?? "",
				src?.getPastes() ?? [],
				editingAttachments.filter((a) => a.kind === "image").length,
				editingSeed,
				prev?.pasteFolds
			);
			editMessageContent(chatState, id, withAnnotations(stored, annotations), {
				attachments: editingAttachments,
				pasteFolds: keepFolds
			});
		}
		resetInlineEdit();
	}

	/**
	 * Enter in the in-place editor (or send from the composer mid-edit):
	 * save the message in place, never resend — later messages stay
	 * exactly as they were. Returns false when the edited message
	 * vanished — the caller then falls through to a fresh send.
	 */
	function commitMessageEdit(): boolean {
		// Target resolution lives in commitEditTarget (pinned in
		// submit.test.ts); the save stays here.
		const index = commitEditTarget(chat.messages, editingMsgId);
		if (index === null) {
			resetInlineEdit();
			return false;
		}
		saveMessageEdit();
		return true;
	}

	/** Pasted images while in-place editing: join the edit's attachments. */
	function onInlineImagesPasted(files: File[]): void {
		if (!editingMsgId) return;
		void (async () => {
			let added = 0;
			for (const file of files) {
				try {
					const att = await fileToAttachment(file);
					if (!editingMsgId) return;
					editingAttachments = [...editingAttachments, att];
					added += 1;
				} catch (error: unknown) {
					failAttach(error instanceof Error ? error.message : String(error));
				}
			}
			insertInlineImageMarkers(added);
		})();
	}

	/** One `[Pasted image]` tag per fresh image, caret after each tag's space. */
	function insertInlineImageMarkers(count: number): void {
		if (!msgEditor || count <= 0) return;
		editingMarkerMuted = true;
		try {
			for (let i = 0; i < count; i++) {
				msgEditor.insertText(attachmentMarkerFor(msgEditor, "image"));
			}
			editingPrevMarkers = countMarkers(msgEditor.getText());
		} finally {
			editingMarkerMuted = false;
		}
	}

	/**
	 * Options for the in-place editor: the composer keymap (Enter sends,
	 * Alt+Enter stages, Ctrl+G hops out, Shift+Enter stays fence-aware)
	 * rebound to the edit — Enter and Alt+Enter both save the message
	 * in place, never resending. Markdown highlighting stays on so code
	 * keeps its colors while editing.
	 */
	function inlineOptions(): PromptEditorOptions {
		return {
			initialDoc: editingSeed,
			onSubmit: () => {
				commitMessageEdit();
			},
			onHopOut: () => {
				// Hop out blurs past the cancel gate: the draft stays
				// mounted for a click back in (see blurCancelMuted).
				blurCancelMuted = true;
				msgEditor?.blur();
				blurCancelMuted = false;
				enterScrollMode();
			},
			onImagesPasted: onInlineImagesPasted,
			onCopyImageTags: (indexes) =>
				copyImageTagBlobs(editingAttachments, indexes),
			onDocChange: (text, removed) => {
				// Tag → attachment half of two-way removal, mirrored
				// from the composer: deleted occurrences drop the
				// matching attachments by index.
				if (editingMarkerMuted) return;
				const step = syncTagRemovals(editingAttachments, text, removed, {
					markers: editingPrevMarkers,
					fileMarkers: editingPrevFileMarkers,
					pasted: editingPrevPasted
				});
				if (step.cleared) {
					editingAttachments = step.kept;
					// Attachment-scoped errors die with the attachment.
					clearNotice(notices, "inline");
				}
				editingPrevMarkers = step.counts.markers;
				editingPrevFileMarkers = step.counts.fileMarkers;
				editingPrevPasted = step.counts.pasted;
			}
		};
	}

	/**
	 * Svelte action mounting the in-place editor inside the message
	 * (the plain textarea, like the composer).
	 */
	function msgEditAction(node: HTMLElement): { destroy(): void } {
		msgEditor = createTextareaEditor(node, inlineOptions());
		msgEditor.setPlaceholder("");
		msgEditor.focus();
		return {
			destroy() {
				msgEditor?.destroy();
				msgEditor = null;
			}
		};
	}

	/** Held finger freezes auto-scroll: cancel the in-flight smooth
	scroll in place; stream growth queues nothing mid-hold. */
	function freezeScroll(): void {
		viewport.holding = true;
		const box = scrollBox;
		if (box) box.scrollTo({ top: box.scrollTop, behavior: "instant" });
	}
	/** Finger up: stay exactly where held (re-derive stick from the
	real position, so a later stream can't yank from stale state). */
	function releaseScroll(): void {
		viewport.holding = false;
		if (scrollBox) viewport.stick = nearBottom(scrollBox);
	}
	function scrollToBottom() {
		viewport.stick = true;
		// Resisted at submit: a held finger means stay, not scroll.
		if (viewport.holding) return;
		scrollBox?.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
	}
	/**
	 * Scroll after just-appended content renders: measuring in the same
	 * tick reads the pre-append height and strands the new message below
	 * the viewport (the send landed short on phones). tick() flushes the
	 * append first, so the scroll sees the message — and the thinking
	 * placeholder appended with it.
	 */
	function scrollAfterRender(): void {
		void tick().then(() => scrollToBottom());
	}
	/**
	 * Live stuck-to-bottom read (send paths): true only while the box
	 * sits within stick slop of its own bottom. The stick flag can't
	 * answer this — it goes stale across appends (and starts true, so
	 * a reader parked at the top with no scroll event yet still reads
	 * stuck). Call BEFORE appending: the append itself grows the
	 * height, so a post-append read always says unstuck.
	 */
	function stuckToBottom(): boolean {
		return scrollBox ? nearBottom(scrollBox) : false;
	}
	/** Stream-follow: while a reply streams into the visible chat, stay
	pinned to the newest token — but only while stuck. Instant, never
	queued behind the submit smooth-scroll. */
	$effect(() => {
		const sending = chatState.sending;
		const msgs = viewChat.messages;
		const last = msgs[msgs.length - 1];
		const len = sending && last?.role === "assistant" ? last.content.length : 0;
		if (len <= viewport.lastStreamLen) {
			viewport.lastStreamLen = len;
			return;
		}
		viewport.lastStreamLen = len;
		const box = scrollBox;
		if (viewport.stick && !viewport.holding && box)
			box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
	});

	function jumpTo(index: number) {
		selectedIdx = index;
		document
			.getElementById(`msg-${index}`)
			?.scrollIntoView({ block: "start", behavior: "smooth" });
	}

	/**
	 * Ctrl+G with the prompt unfocused: enter scroll mode with the cursor
	 * on the current message in view (topmost visible), so j/k/gg/G walk
	 * from where the user is looking instead of the newest message.
	 */
	function scrollToViewCursor(): void {
		// Detached entry: a later Ctrl+G stays out of the prompt (a
		// stale prompt-entry must not hop back).
		scrollFromPrompt = false;
		enterScrollMode();
		const messages = chat.messages;
		if (messages.length === 0) return;
		const viewport = scrollBox?.getBoundingClientRect();
		const top = viewport?.top ?? 0;
		const bottom = viewport?.bottom ?? window.innerHeight;
		// The message crossing a line a few lines below the viewport
		// top — a bottom sliver of the message above never wins, and a
		// taller-than-viewport message still matches by coverage.
		const line = viewCursorLine(top, bottom);
		for (let i = 0; i < messages.length; i++) {
			const el = document.getElementById(`msg-${i}`);
			if (!el) continue;
			const r = el.getBoundingClientRect();
			if (r.bottom > line && r.top < bottom) {
				selectedIdx = i;
				el.focus({ preventScroll: true });
				return;
			}
		}
		selectedIdx = messages.length - 1;
	}

	/**
	 * Index of the rendered message in the middle of the screen (the
	 * m/n pick): viewport-center line through the message rects, -1
	 * with no messages on screen. Missing nodes are skipped, so the
	 * measured array re-aligns to rendered indexes before picking.
	 */
	function centerMessageIndex(): number {
		const box = scrollBox;
		if (!box) return -1;
		const rect = box.getBoundingClientRect();
		const line = rect.top + rect.height / 2;
		const items: { index: number; top: number; bottom: number }[] = [];
		for (let i = 0; i < viewChat.messages.length; i++) {
			const el = document.getElementById(`msg-${i}`);
			if (!el) continue;
			const r = el.getBoundingClientRect();
			items.push({ index: i, top: r.top, bottom: r.bottom });
		}
		const at = indexAtViewportLine(
			items.map((item) => ({ top: item.top, bottom: item.bottom })),
			line
		);
		return at < 0 ? -1 : (items[at]?.index ?? -1);
	}

	function enterScrollMode() {
		focusMode = "scroll";
		// The prompt goes fully dormant: no caret, a hop-back hint, and
		// no typing — keystrokes land on the window, where scroll mode
		// owns the J/K keys and ignores the rest.
		editor?.blur();
		editor?.setPlaceholder(scrollPlaceholder());
		if (selectedIdx < 0 && chat.messages.length > 0) {
			selectedIdx = chat.messages.length - 1;
		}
	}

	function enterEditMode() {
		focusLog("enter-edit-mode", {
			from: focusMode,
			active: describeActiveElement()
		});
		focusMode = "edit";
		editor?.setPlaceholder(promptPlaceholder());
		// A fresh editing context always shows the prompt: a minted
		// chat (or any landing here) must never inherit a hidden bar.
		restorePrompt();
		editor?.focus();
		// The visible flip (including its visibility ramp) lands async:
		// arriving from a hidden or parked composer, the sync focus
		// above hits a hidden node and no-ops. Retry on frames until
		// the composer is truly focusable, unless focus has since moved
		// somewhere meaningful (a message, modal, or field).
		void tick().then(() => {
			let frames = 0;
			const land = (): void => {
				const active = document.activeElement;
				// A closing sidebar's row is not a settled home: entering
				// from the list focuses the composer only after the
				// collapse drops that row, so keep retrying through it.
				const settled =
					active &&
					active !== document.body &&
					!(settings.sidebarCollapsed && active.closest("aside"));
				if (settled) return;
				const node = document.querySelector<HTMLElement>(".prompt .ta-input");
				if (node && getComputedStyle(node).visibility !== "hidden") {
					editor?.focus();
					// A parked-composer focus no-ops silently: only stop
					// when the caret actually landed.
					const landed = closestFromTarget(
						document.activeElement,
						".prompt .ta-input"
					);
					if (landed) return;
				}
				if (++frames < 60) requestAnimationFrame(land);
			};
			requestAnimationFrame(land);
		});
	}

	/**
	 * Leave scroll mode without touching the prompt: for entries from
	 * a deactivated prompt, Ctrl+G and Esc step back out to the same
	 * deactivated state (nothing selected, no focus stolen).
	 */
	function exitScrollMode(): void {
		focusLog("exit-scroll-mode", {
			from: focusMode,
			active: describeActiveElement()
		});
		focusMode = "edit";
		selectedIdx = -1;
		if (document.activeElement instanceof HTMLElement)
			document.activeElement.blur();
	}

	/**
	 * Unselected-state chat scrolling (desktop, nothing selected):
	 * smooth line/half-page steps and top/bottom jumps. The hovered
	 * message edge (z/Z) measures in viewport space, like the
	 * double-tap path above.
	 */
	function scrollChatBy(dy: number): void {
		scrollBox?.scrollBy({ top: dy, behavior: "smooth" });
	}
	/**
	 * Start a frame-paced glide: pixels accrue per rAF tick from the first
	 * frame, so holding never fires the cancel-and-restart stutter that
	 * per-keydown smooth scrollBy calls produce under key repeat. d/u
	 * ramps from j/k speed to peak over SCROLL_HOLD_RAMP_MS (see
	 * holdGlideVelocity) instead of kicking at full speed; j/k cruise.
	 */
	function startScrollHold(
		key: string,
		velocity: number,
		tapDy?: number
	): void {
		stopScrollHold();
		if (!scrollBox) return;
		// The .messages column eases programmatic jumps (scroll-behavior:
		// smooth); per-frame glide sets need instant application, or the
		// box chases a moving target and lags several-fold behind.
		scrollBox.style.scrollBehavior = "auto";
		// The thumb stays up for the whole hold, not just while scroll
		// events stream: a hold clamped at an edge fires none, and a
		// stale fade timer must not strip it mid-hold.
		window.clearTimeout(viewport.idleTimer);
		scrollBox.classList.add("scrolling");
		// Generation check, not identity: the tick closes over the raw
		// hold while reads come back proxied, so only a primitive
		// distinguishes a superseded glide (see ViewportState.holdSeq).
		viewport.holdSeq += 1;
		const seq = viewport.holdSeq;
		viewport.hold = {
			key,
			velocity,
			tapDy:
				tapDy ??
				Math.sign(velocity) *
					scaleScrollPx(SCROLLKEY_LINE_PX, settings.fontScale),
			downAt: Date.now(),
			startT: performance.now(),
			lastT: performance.now(),
			raf: 0
		};
		const tick = (t: number) => {
			const hold = viewport.hold;
			if (!hold || viewport.holdSeq !== seq || !scrollBox) return;
			scrollBox.scrollTop = stepScrollTop(
				scrollBox.scrollTop,
				scaleScrollPx(
					holdGlideVelocity(hold.key, t - hold.startT),
					settings.fontScale
				),
				t - hold.lastT
			);
			hold.lastT = t;
			hold.raf = requestAnimationFrame(tick);
		};
		const first = viewport.hold;
		if (first) first.raf = requestAnimationFrame(tick);
	}
	/** Release a held key: quick taps land one discrete step, holds just stop. */
	function releaseScrollHold(event: KeyboardEvent): void {
		const hold = viewport.hold;
		if (!hold || event.key.toLowerCase() !== hold.key.toLowerCase()) return;
		cancelAnimationFrame(hold.raf);
		viewport.hold = null;
		scrollBox?.style.removeProperty("scroll-behavior");
		scrollBox?.classList.remove("scrolling");
		// A tap lands the hold's own step: one line for j/k, the skip
		// step for d/u (the shared scroll effect eases it — never a
		// jump). Holds just stop.
		if (holdIsTap(hold.downAt, Date.now()) && scrollBox) {
			scrollChatBy(hold.tapDy);
		}
	}
	function stopScrollHold(): void {
		if (viewport.hold) cancelAnimationFrame(viewport.hold.raf);
		viewport.hold = null;
		scrollBox?.style.removeProperty("scroll-behavior");
		scrollBox?.classList.remove("scrolling");
	}
	function scrollChatTop(): void {
		scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
	}
	function scrollChatBottom(): void {
		if (scrollBox)
			scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
	}
	function scrollHoveredEdge(edge: "start" | "end"): void {
		const el = document.getElementById(`msg-${hoveredIdx}`);
		const box = scrollBox;
		if (!el || !box) return;
		const boxRect = box.getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		// The floating card covers the box bottom: landing the message
		// end there slides it (buttons included — the row lives in the
		// article) underneath. Reserve the card plus a gap instead.
		const card = document.querySelector<HTMLElement>("main .prompt");
		const bottomReserve =
			edge === "end" && card
				? Math.ceil(card.getBoundingClientRect().height) + 8
				: 0;
		box.scrollTo({
			top: messageEdgeScrollTop({
				scrollTop: box.scrollTop,
				boxTop: boxRect.top,
				elTop: elRect.top,
				elHeight: elRect.height,
				viewH: box.clientHeight,
				edge,
				bottomReserve
			}),
			behavior: "smooth"
		});
	}
	/**
	 * Fullscreen exit for a HELD Escape (timer threshold in
	 * scrollkeys.ts). Device-only path: the Tauri window fullscreen
	 * (menu/green light) and the browser Fullscreen API both need a
	 * real window — unit tests pin only the hold threshold, and this
	 * is unverified on device (no playwright coverage for window
	 * chrome). Failures fall through silently: there is simply no
	 * fullscreen to exit.
	 */
	/**
	 * Fullscreen toggle (Cmd+E, Ctrl+Cmd+F): Tauri window chrome when
	 * shelled, the web Fullscreen API in a browser. The shell path
	 * needs core:window:allow-is-fullscreen + allow-set-fullscreen in
	 * the capability list; when both paths fail, say so instead of
	 * dying silent (a trimmed capability list once made both chords
	 * do nothing with zero feedback).
	 */
	async function toggleFullscreen(): Promise<void> {
		try {
			if (tauriBackendAvailable()) {
				const win = getCurrentWindow();
				await win.setFullscreen(!(await win.isFullscreen()));
				return;
			}
		} catch {
			// Fall through to the web Fullscreen API.
		}
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await document.documentElement.requestFullscreen();
		} catch {
			flashErrorToast("Fullscreen unavailable");
		}
	}
	/** Fullscreen exits: a 2s Escape hold or the Esc+f chord (a tap never exits). */
	async function exitFullscreen(): Promise<void> {
		try {
			if (tauriBackendAvailable()) {
				const win = getCurrentWindow();
				if (await win.isFullscreen()) await win.setFullscreen(false);
				return;
			}
		} catch {
			// Fall through to the web Fullscreen API.
		}
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
		} catch {
			// Nothing fullscreen to exit.
		}
	}
	/**
	 * Summon toggle, in-app half (Cmd/Ctrl+Shift+Space outside the
	 * editor): hide the window back to the previous app, mirroring
	 * the OS-global half in `desktop.rs` (both fire on one press;
	 * hide is idempotent so they never fight). The browser preview
	 * has no window to hide, so it keeps the old focus-composer
	 * behavior there.
	 */
	async function hideSummonWindow(): Promise<void> {
		try {
			if (tauriBackendAvailable()) {
				await getCurrentWindow().hide();
				return;
			}
		} catch {
			// Fall through to focusing the composer.
		}
		enterEditMode();
	}

	function cycleProvider(direction: 1 | -1) {
		// Same gating contract as the settings radios: Gemma lists
		// only where its bridge ships, offline Android narrows to it.
		const androidBridge = isAndroidUserAgent(navigator.userAgent);
		const ids = visibleProviderIds(
			listProviders(settings.customProviders).map((p) => p.id),
			{ android: androidBridge, online: navigator.onLine, local: androidBridge }
		);
		const id = stepCyclicId(ids, settings.activeProviderId, direction);
		if (id === undefined) return;
		settings.activeProviderId = id;
		persistSettings();
	}

	function cycleThinking(direction: 1 | -1) {
		const support = activeThinkingSupport(settings);
		settings.thinking = {
			...settings.thinking,
			[settings.activeProviderId]: cycleThinkingId(
				support,
				activeThinkingId(settings),
				direction
			)
		};
		persistSettings();
	}

	/**
	 * Voice follow for per-chat pills. appliedPill is the code whose voice
	 * is currently installed; pillBaseVoice is the locale from before it.
	 * Switching chats releases the old pill (restoring the base unless the
	 * user picked their own meanwhile) and installs the new one.
	 */
	let appliedPill: string | null = null;
	let pillBaseVoice: string | null = null;
	$effect(() => {
		const current =
			chatState.chats.find((c) => c.id === chatState.activeChatId) ?? null;
		const code = current?.replyLang ?? null;
		if (code === appliedPill) return;
		const old = appliedPill ? replyLanguageFor(appliedPill) : null;
		if (old && pillBaseVoice !== null && settings.voiceLang === old.voice) {
			settings.voiceLang = pillBaseVoice;
			// The restored value regains its standing, deliberate or not.
			settings.voiceLangPinned = true;
			persistSettings();
		}
		appliedPill = null;
		if (!code) return;
		const lang = replyLanguageFor(code);
		if (!lang) return;
		pillBaseVoice = settings.voiceLang;
		appliedPill = code;
		settings.voiceLang = lang.voice;
		// The pill owns the voice from here, unpinned: a launch without
		// the pill falls back to the system default, while the persisted
		// pill reinstalls its override on launch.
		settings.voiceLangPinned = false;
		persistSettings();
	});

	/** Pill lives on the active chat; the voice-follow effect above
	installs its voice. Unknown codes never reach the field. */
	function setReplyLang(code: string): void {
		if (!replyLanguageFor(code)) return;
		setChatReplyLang(chatState, chatState.activeChatId, code);
		openLangMenu = null;
	}

	function clearReplyLang(): void {
		setChatReplyLang(chatState, chatState.activeChatId, null);
		openLangMenu = null;
	}

	/** Shared by both `LangMenus` call sites (hero + composer dock). */
	const langMenusActions = {
		toggle: (id: LanguageMenu["id"], el: HTMLElement) =>
			toggleLangMenu(id, el),
		pick: (lang: ReplyLanguage) => {
			const quickKey = quickKeyFor(lang.code);
			if (activeReplyCode === lang.code && !quickKey) {
				clearReplyLang();
				// Clearing names the released language
				// in its own cleared word.
				flashToast(lang.cleared);
			} else {
				setReplyLang(lang.code);
				flashToast(switchToastFor(lang));
			}
			// Language picks tick on phones like the
			// family buttons above do.
			buzzTap();
			// Picking a language hands focus to the
			// composer on desktop: typing starts there
			// next, and focus never lingers on the
			// unmounted option (which left a stuck
			// pointer behind). Phones stay unfocused:
			// auto-focus pops the keyboard over the
			// composer instead of pushing it up. Tap
			// in when ready.
			if (!androidUI) editor?.focus();
		}
	};

	/** Send-button hold (touch or desktop mouse, empty composer):
	stash the reply language and drop to default, or restore the
	stash — the emoji vanishes and returns. Haptic ticks on every
	switch (phones); desktop toasts the swap like the menus do. */
	const SEND_HOLD_MS = 500;
	const replyLangStash = new SvelteMap<ChatId, string>();
	/** Send-button box for the prompt-level hold zone below. */
	let sendBtnEl: HTMLElement | null = $state(null);
	/**
	 * True when a point sits over the send button. The button is
	 * absolutely positioned inside a display:contents span (no box of
	 * its own) and disabled buttons eat their events — so holds arm
	 * from the prompt's own handlers by geometry, never by bubbling.
	 */
	function overSendButton(x: number, y: number): boolean {
		return pointInRect(x, y, sendBtnEl?.getBoundingClientRect());
	}
	let sendHoldTimer: ReturnType<typeof setTimeout> | null = null;

	function sendHoldStart(): void {
		// In-prompt note edits own the arrow (tap files, even empty):
		// never arm a language swap underneath them. Staged
		// annotations ride the send either way, so they never block
		// the hold — only text and attachments disarm it.
		const empty = composerText() === "" && attachments.length === 0;
		if (!sendHoldArmed(sendHoldTimer !== null, !!promptAnnEdit, empty))
			return;
		sendHoldTimer = setTimeout(() => {
			sendHoldTimer = null;
			swapReplyLangHold();
		}, SEND_HOLD_MS);
	}

	function sendHoldEnd(): void {
		if (sendHoldTimer !== null) {
			clearTimeout(sendHoldTimer);
			sendHoldTimer = null;
		}
	}

	function swapReplyLangHold(): void {
		const id = chatState.activeChatId;
		const next = swapReplyLang(activeReplyCode, replyLangStash.get(id) ?? null);
		if (next.current === activeReplyCode) return;
		if (next.stash !== null) replyLangStash.set(id, next.stash);
		setChatReplyLang(chatState, id, next.current);
		buzzTap();
		const lang = next.current ? replyLanguageFor(next.current) : null;
		flashToast(
			lang
				? switchToastFor(lang)
				: (replyLanguageFor(next.stash)?.cleared ?? "Cleared")
		);
	}

	/**
	 * Reset the voice language to the checked keyboard input source
	 * (a chat delete's second half). Anything unknown — no source id
	 * (the bridge is down in browser preview) or an unrecognized
	 * layout — stays silent and leaves the language untouched:
	 * routine chat deletions must never toast.
	 */
	async function resetVoiceLangFromKeyboard(): Promise<void> {
		const sourceId = await currentKeyboardInputSource();
		if (!sourceId) return;
		const locale = voiceLocaleForInputSource(sourceId);
		if (!locale) return;
		settings.voiceLang = locale;
		persistSettings();
	}

	/**
	 * Drop one chat. The voice language follows the checked keyboard only
	 * when nothing with a language is left (a single blank chat remains).
	 */
	function dropChat(id: ChatId): void {
		// Deletes thump triple (done): unmistakable against the single
		// ticks of opens and folds. Every delete path shares it — row ×,
		// gestures, keyboard — so call sites carry no haptic of their own.
		if (androidUI) {
			void hapticBeatAsync("done", {
				enabled: settings.hapticsEnabled,
				shell: tauriBackendAvailable()
			});
		}
		stopVoice();
		if (id === chatState.activeChatId) {
			// Dropping the open chat discards its drafts (stored entry
			// pruned via the empty save), then the neighbor that slides
			// into its place restores its own filed drafts — and its
			// filed scroll position, via the switch effect.
			saveChatScroll();
			saveDraftAnnotations(
				id,
				[],
				chatState.chats.map((c) => c.id).filter((c) => c !== id)
			);
			resetDraftExtras();
			deleteChat(chatState, id);
			chatScrollTops.delete(id);
			annotations = loadDraftAnnotations(chatState.activeChatId);
			restoreChatScroll(chatState.activeChatId);
		} else {
			// Dropping a background chat must not touch the open
			// composer's in-memory drafts or attachments: only prune the
			// deleted id out of storage.
			deleteChat(chatState, id);
			chatScrollTops.delete(id);
			saveDraftAnnotations(
				chatState.activeChatId,
				annotations,
				chatState.chats.map((c) => c.id)
			);
		}
		if (
			chatState.chats.length === 1 &&
			chatState.chats[0]?.messages.length === 0
		) {
			void resetVoiceLangFromKeyboard();
		}
	}

	function promptOptions(): PromptEditorOptions {
		return {
			onSubmit,
			// Phones never send from the keyboard: Enter is a carriage
			// return there and the send button alone submits. Desktop
			// keeps Enter/Alt+Enter. (Snapshot-safe: the UA detection
			// above runs in this same mount, before the editor builds.)
			enterSubmits: !androidUI,
			onHopOut: () => {
				scrollFromPrompt = true;
				enterScrollMode();
			},
			onImagesPasted: onImagesPasted,
			onLongTextPasted: onLongTextPasted,
			onCopyImageTags: (indexes) => copyImageTagBlobs(attachments, indexes),
			onDocChange: (text, removed) => {
				hasText = text.trim().length > 0;
				// Tag → attachment half of two-way removal: tags are the
				// expressed intent, so deleted occurrences drop the
				// matching attachments by index, and orphans
				// (attachments with no tags, from undo and cross-editor
				// flows) drop the excess newest-first.
				if (markerSyncMuted) return;
				const step = syncTagRemovals(attachments, text, removed, {
					markers: prevMarkerCount,
					fileMarkers: prevFileMarkerCount,
					pasted: prevPastedCount
				});
				if (step.cleared) {
					attachments = step.kept;
					// Attachment-scoped errors die with the attachment —
					// otherwise the red line dangles over the next draft
					// with nothing left to explain.
					clearNotice(notices, "inline");
				}
				prevMarkerCount = step.counts.markers;
				prevFileMarkerCount = step.counts.fileMarkers;
				prevPastedCount = step.counts.pasted;
			}
		};
	}

	/**
	 * Fallback window drag: with the native titlebar gone, empty header
	 * space (and the sidebar head) starts a native move. Controls keep
	 * their clicks (buttons and fields are excluded); the browser preview
	 * early-returns. Needs the `core:window:allow-start-dragging`
	 * capability — without it the invoke is denied and the window sits
	 * immovable with no visible error.
	 */
	/** A drag denial already explained itself; don't toast on every grab. */
	let dragWarned = false;
	function dragWindow(event: MouseEvent): void {
		// Mobile shells have no draggable window: tapping empty header
		// space there only rejects startDragging into an error toast.
		if (!canWindowDrag(navigator.userAgent)) return;
		if (event.button !== 0 || !tauriBackendAvailable()) return;
		// The second press of a double-click zooms instead of dragging.
		if (event.detail > 1) return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			target.closest("button, input, select, textarea, a, .selectable")
		) {
			return;
		}
		// The startDragging call stays synchronous in the mousedown dispatch —
		// awaiting first would leave the native drag gesture.
		let drag: Promise<void>;
		try {
			drag = getCurrentWindow().startDragging();
		} catch (error) {
			drag = Promise.reject(
				error instanceof Error ? error : new Error(errorMessage(error))
			);
		}
		drag.catch((error: unknown) => {
			// A denial here once meant a silently immovable window (the
			// capability missed `core:window:allow-start-dragging`). Never
			// silent again: log always, toast once per session. The
			// rejection is often a plain object, never an Error, so the
			// message goes through errorMessage — String() printed
			// "[object Object]" into this toast.
			const message = errorMessage(error);
			console.warn("Window drag failed:", message);
			if (!dragWarned) {
				dragWarned = true;
				flashErrorToast(`Window drag failed: ${message}`);
			}
		});
	}

	/**
	 * Native menu bar clicks (desktop shell only): the Rust side emits
	 * `menu-action` with the item id. The frontend keeps its own key
	 * handlers for the browser runtime, where no menu exists — and on
	 * macOS the menu consumes its accelerators before the webview ever
	 * sees them, so the two paths don't double-fire.
	 */
	async function listenMenuActions(): Promise<void> {
		if (!tauriBackendAvailable()) return;
		try {
			await listen<string>("menu-action", (event) => {
				const action = event.payload;
				if (action === "settings") {
					toggleSettingsPanel();
					if (!settingsOpen) pulseCursor();
				} else if (action === "new-chat") {
					doNewChat();
				} else if (action === "delete-chat") {
					dropChat(chat.id);
					editor?.focus();
				} else if (action === "toggle-sidebar") {
					toggleSidebar();
					if (!settings.sidebarCollapsed) focusActiveSideChat();
				} else if (action === "next-chat") {
					stepChat(1);
				} else if (action === "prev-chat") {
					stepChat(-1);
				} else if (action === "shortcuts") {
					openShortcuts();
				} else if (action === "share-sheet") {
					void shareCurrentChat();
				} else if (action === "print-sheet") {
					printCurrentChat();
				} else if (action === "bigger-text") {
					adjustFontScale(0.1);
				} else if (action === "smaller-text") {
					adjustFontScale(-0.1);
				}
			});
		} catch (error) {
			console.warn(
				"Menu events unavailable:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	/**
	 * `ccez://` deep links (desktop shell only): `ccez://chat/<id>`
	 * opens the chat when it exists (unknown ids are ignored, never
	 * an error toast), `ccez://new` mints a chat. Cold-start links
	 * wait in the backend drain slot; live ones arrive as events.
	 */
	async function wireDeepLinks(): Promise<void> {
		if (!tauriBackendAvailable()) return;
		try {
			await listenDeepLinks((link) => {
				if (link.kind === "new-chat") {
					doNewChat();
					return;
				}
				const exists = chatState.chats.some((c) => c.id === link.chatId);
				if (!exists) return;
				saveDraftAnnotations(
					chatState.activeChatId,
					annotations,
					chatState.chats.map((c) => c.id)
				);
				selectChat(chatState, link.chatId as ChatId);
				annotations = loadDraftAnnotations(link.chatId);
				enterEditMode();
			});
		} catch (error) {
			console.warn(
				"Deep-link events unavailable:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	/**
	 * Share the visible chat as a study sheet: the backend writes the
	 * file for native share-out, then the OS sheet / clipboard /
	 * download fallback presents it. One toast names the outcome.
	 */
	async function shareCurrentChat(): Promise<void> {
		const lines = chat.messages.map((m) => ({
			role: m.role,
			content: m.content
		}));
		const title = sheetTitle(lines);
		const markdown = studySheetMarkdown(title, lines);
		const saved = await exportStudySheet(title, lines);
		const outcome = await shareStudySheet(title, markdown);
		const toast = shareOutcomeToast(outcome, saved);
		if (toast.error) flashErrorToast(toast.text);
		else flashToast(toast.text);
	}

	/**
	 * Print the visible chat as a study sheet (`#study-sheet-print`
	 * is the only node the print stylesheet shows; Save as PDF in
	 * that dialog writes the file).
	 */
	function printCurrentChat(): void {
		if (!printStudySheet()) flashErrorToast("Printing is unavailable here");
	}

	/**
	 * Double-click the title strip zooms the window (fills the screen):
	 * the macOS titlebar behavior, next to the green light that goes
	 * fullscreen instead. Clicks on controls keep their own actions.
	 */
	/**
	 * Double-click the empty gutters beside the centered column opens
	 * the nearby sidebar: left gutter the chat list, right gutter
	 * settings. Clicks on messages and controls keep their own
	 * actions (double-click still selects words); clicks inside the
	 * column but between messages do nothing. Lives on <main> (not
	 * .messages): on empty chats the messages pane caps at 60% height
	 * and the lower zone would otherwise be dead.
	 */
	function gutterDoubleClick(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement) || !scrollBox) return;
		if (
			target.closest(
				"article, button, input, select, textarea, a, summary, details, header, .prompt, .lang-menus, .attachments, .sel-menu, .review, .ann-pop"
			)
		) {
			return;
		}
		const bounds = columnBounds(
			[...scrollBox.querySelectorAll("article, .empty-state")].map((el) =>
				el.getBoundingClientRect()
			)
		);
		if (!bounds) return;
		const side = gutterSide(event.clientX, bounds.left, bounds.right);
		if (side === "left") {
			if (settings.sidebarCollapsed) {
				settings.sidebarCollapsed = false;
				persistSettings();
			}
		} else if (side === "right") {
			if (!settingsOpen) openSettingsPanel();
		} else if (
			target === scrollBox ||
			target.closest(".empty-state") === target
		) {
			// Open space in the column (the scroller's own padding past
			// the last message, or the empty-state box itself):
			// double-clicking summons the composer. Between-message gaps
			// land here too (margins hit-test to the scroller) — safe,
			// because a real text pick lands on text, never the scroller.
			editor?.focus();
		}
	}

	function zoomWindow(event: MouseEvent): void {
		if (!tauriBackendAvailable()) return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			target.closest("button, input, select, textarea, a")
		) {
			return;
		}
		try {
			getCurrentWindow()
				.toggleMaximize()
				.catch((error: unknown) => {
					const message =
						error instanceof Error ? error.message : String(error);
					console.warn("Window zoom failed:", message);
				});
		} catch (error) {
			console.warn(
				"Window zoom failed:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	onMount(() => {
		try {
			// iOS rides the same phone UI (touch composer, no hover,
			// native voice picker): the name is historical. Touch
			// tablets join it too: iPads in desktop-mode Safari report
			// a Macintosh UA, so touch points plus the coarse pointer
			// and screen size pick them up (see isTouchTablet).
			androidUI =
				isAndroidUserAgent(navigator.userAgent) ||
				isIOSUserAgent(navigator.userAgent) ||
				isTouchTablet({
					ua: navigator.userAgent,
					coarse: isCoarsePointer((q) => window.matchMedia(q)),
					maxTouchPoints: navigator.maxTouchPoints ?? 0,
					smallestScreenDim: Math.min(
						window.screen?.width ?? 0,
						window.screen?.height ?? 0
					)
				});
			iosUI = isIOSUserAgent(navigator.userAgent);
		} catch {
			androidUI = false;
			iosUI = false;
		}
		// Phones keep the prompt on screen instead of idle-hiding it:
		// there is no keyboard summon (i/Enter/Space) and the sliders
		// are hidden, so migrate an uncustomized timeout to "never"
		// and release any boot park before first paint.
		if (androidUI && !idleTimeoutCustomized) {
			settings.promptIdleSec = PROMPT_IDLE_NEVER;
			persistSettings();
			bootParked = false;
			promptIdle = false;
		}
		// Phones stay portrait: the native shell pins it in the
		// manifest (MainActivity screenOrientation); this runtime
		// attempt covers browser-hosted runs, and rejects harmlessly
		// where the API needs fullscreen first.
		try {
			if (androidUI && typeof screen.orientation?.lock === "function") {
				void screen.orientation.lock("portrait").catch(() => {});
			}
		} catch {
			// Orientation lock is best-effort outside the native shell.
		}
		// Chromium-only viewport key, appended at runtime on Android
		// alone: a static tag makes WebKit log "not recognized" noise
		// on every desktop/iOS load, and only the Android WebView
		// reads it (keyboard resizes the layout viewport there).
		try {
			if (isAndroidUserAgent(navigator.userAgent)) {
				const meta = document.querySelector('meta[name="viewport"]');
				const content = meta?.getAttribute("content") ?? "";
				if (meta && !content.includes("interactive-widget")) {
					meta.setAttribute(
						"content",
						`${content}, interactive-widget=resizes-content`
					);
				}
			}
		} catch {
			// Viewport tuning is best-effort; the visualViewport pin covers the rest.
		}
		// Shortcuts-modal labels: navigator.platform with User-Agent
		// Client Hints winning (see currentPlatform). Unknown platforms
		// read as non-Mac, so the Ctrl/Alt labels show.
		isMac = currentPlatform().isMac;
		// One engine everywhere, pinned silently (the desktop engine
		// picker is gone): system voices when the bridge is up, web
		// voices when it is not. The settings panel repeats the probe
		// for its picker; this is the silent path.
		void nativeTtsSupported().then((supported) => {
			const want = supported ? "native" : "web";
			if (settings.voiceEngine !== want) {
				settings.voiceEngine = want;
				persistSettings();
			}
		});
		// External-text bridge (Android OS selection menu): the entry
		// comes from the Annotate/Speak/Inspect manifest aliases, so
		// the text it carries is either a share from another app or
		// the selection just made in-app. Foreign text prefills the
		// composer; matching (or absent) text runs the tapped action
		// on the live web selection. The web row itself is untouched.
		if (tauriBackendAvailable()) {
			try {
				void listen<{ text: string | null; action: string | null }>(
					"annotate-external",
					(event) => {
						const text = event.payload?.text ?? null;
						const live = window.getSelection()?.toString() ?? "";
						const route = routeExternalText(event.payload?.action, text, live);
						if (route === "prefill" && text) {
							if (!chatState.activeChatId) newChat(chatState);
							editor?.setText(joinExternalDraft(editor?.getText() ?? "", text));
							editor?.focus();
							return;
						}
						placeSelMenu();
						if (!selMenu?.quote.trim()) {
							flashToast(
								`Select text first, then ${route === "speak" ? "Speak" : route === "inspect" ? "Inspect" : "Annotate"}.`
							);
							return;
						}
						if (route === "speak") void speakSelection();
						else if (route === "inspect") openInspect();
						else annotate();
					}
				).then(() => {
					// Cold start: a share that arrived before setup parked
					// in Rust — the listener is registered now, so drain it.
					void drainPendingExternalAsync({
						shell: tauriBackendAvailable()
					});
				});
			} catch (error) {
				console.warn(
					"External-text events unavailable:",
					error instanceof Error ? error.message : String(error)
				);
			}
		}
		// Native turns left behind: a killed process leaves streaming
		// files (marked interrupted here, with Retry) and finished ones
		// (rendered onto their placeholders). Chats load at module
		// level, so the scan runs on hydrated state; live turns stream
		// through the listeners below, which the scan skips.
		void reconcileNativeTurns();
		// File Handling launch: a .md file opened with the app lands
		// its text in the composer (blank-line joined like shared
		// text); anything else rides the attachments path. Where
		// launchQueue is missing no launch can arrive, and the
		// consumer stays unset.
		const launchQueue = window.launchQueue ?? null;
		consumeLaunchFiles(launchQueue, async (files) => {
			const { markdown, rest } = splitLaunchFiles(files);
			for (const file of markdown) {
				try {
					const text = await file.text();
					if (!chatState.activeChatId) newChat(chatState);
					editor?.setText(joinExternalDraft(editor?.getText() ?? "", text));
				} catch (error) {
					failAttach(error instanceof Error ? error.message : String(error));
				}
			}
			if (markdown.length > 0) {
				editor?.focus();
				flashToast(
					markdown.length === 1
						? "Opened file in the composer"
						: "Opened files in the composer"
				);
			}
			if (rest.length > 0) {
				const kinds = await addFiles(rest);
				insertAttachmentMarkers(kinds);
			}
		});
		// A pill-owned voice must not leak past its chat: when the
		// launch chat carries no reply pill and nobody pinned the
		// field, the voice falls back to the system default — new
		// chats start in English, pill chats reinstall their own.
		const launchChat =
			chatState.chats.find((c) => c.id === chatState.activeChatId) ?? null;
		if (!settings.voiceLangPinned && !launchChat?.replyLang) {
			const fallback = systemLocale();
			if (settings.voiceLang !== fallback) {
				settings.voiceLang = fallback;
				persistSettings();
			}
		}
		// Startup notification ask (the send gesture keeps its own):
		// with the background ping on, ask on launch so a later
		// backgrounded long reply may notify. No-op unless undecided.
		if (settings.replyNotifications) {
			void ensureReplyNotificationPermissionAsync({
				shell: tauriBackendAvailable()
			});
		}
		// Edge swipes toggle the sidebars on touch screens (Android
		// milestone): rightward from the left edge for chats, leftward
		// from the right edge for settings. Toggle, not open-only: with
		// no keyboard or Esc key, a swipe is the touch user's only way
		// back out. Multi-touch cancels, and the mostly-horizontal rule
		// keeps scrolling and code-block pans to themselves. Passive:
		// the app never blocks a scroll.
		/**
		 * Mid-screen swipe target (phone only): like the edge rule, but for
		 * strokes starting in the middle of the conversation. Gated on the
		 * Android UA so touchscreen laptops never see it, and suppressed
		 * while text is selected (handle-dragging), while starting in an
		 * editable, or while the shortcuts modal owns the screen. A
		 * rightward stroke summons the chats list from anywhere on the
		 * main chat except a message with fold on swipe on (message
		 * strokes fold either way there — only a leftward stroke folds
		 * otherwise). Dismissing an open settings panel still works,
		 * and leftward settings strokes are untouched.
		 */
		function middleSwipeTarget(
			start: { x: number; y: number; clean: boolean },
			ended: { clientX: number; clientY: number }
		): EdgePanel | null {
			if (!androidUI || !start.clean || shortcutsOpen || inspectChar)
				return null;
			if (window.getSelection()?.isCollapsed === false) return null;
			return contentSwipeTarget(
				start.x,
				start.y,
				ended.clientX,
				ended.clientY
			);
		}
		/**
		 * Shared edge-stroke outcome (touch swipes and desktop mouse
		 * drags): dismiss first, summon second. A rightward stroke with
		 * settings open closes settings; a leftward stroke with chats
		 * open closes the sheet. Gutter double-click stays as-is.
		 */
		function applyEdgeTarget(target: EdgePanel | null): void {
			// A summoned drawer replaces the phone switcher (never
			// stack) — but a null target summons nothing, so a lift
			// that resolves to no panel leaves the switcher alone
			// (this closed the hold-summoned switcher on release).
			if (target !== null && androidUI) chatSwitcherOpen = false;
			if (target === "chats") {
				if (settingsOpen) toggleSettingsPanel();
				// Touch: a left-to-right swipe opens the chats sidebar
				// (with its search box) and never closes it — a
				// rightward stroke only summons, the leftward stroke
				// below folds.
				else if (settings.sidebarCollapsed) {
					settings.sidebarCollapsed = false;
					persistSettings();
				}
			} else if (target === "settings") {
				// A leftward stroke never closes settings once open —
				// only a rightward stroke (the "chats" branch) dismisses.
				if (settingsOpen) return;
				if (!settings.sidebarCollapsed) {
					settings.sidebarCollapsed = true;
					persistSettings();
				} else toggleSettingsPanel();
			}
		}
		/**
		 * Desktop mouse edge-drag: the desktop analog of the touch edge
		 * swipe — press near the screen edge and drag horizontally to
		 * summon or dismiss the sidebars. Touch hardware rides the touch
		 * path above, so this is mouse-only and desktop-only. Text
		 * selection drags never count: a stroke that changed the
		 * selection, or started in an editable or on a control, is
		 * ignored. Passive: the app never blocks the drag.
		 */
		let edgeMouse: {
			x: number;
			y: number;
			clean: boolean;
			sel: string;
		} | null = null;
		window.addEventListener("pointerdown", (event) => {
			if (androidUI || event.pointerType !== "mouse" || event.button !== 0)
				return;
			const target = event.target;
			const clean =
				!(target instanceof Element) ||
				target.closest(
					"input, textarea, select, [contenteditable='true'], button, a"
				) === null;
			edgeMouse = {
				x: event.clientX,
				y: event.clientY,
				clean,
				sel: window.getSelection()?.toString() ?? ""
			};
		});
		window.addEventListener("pointerup", (event) => {
			const start = edgeMouse;
			edgeMouse = null;
			if (!start || !start.clean || androidUI) return;
			if (event.pointerType !== "mouse" || event.button !== 0) return;
			if ((window.getSelection()?.toString() ?? "") !== start.sel) return;
			applyEdgeTarget(
				edgeSwipeTarget(
					start.x,
					start.y,
					event.clientX,
					event.clientY,
					window.innerWidth
				)
			);
		});
		let edgeTouch: {
			id: number;
			x: number;
			y: number;
			at: number;
			scrollTop: number;
			clean: boolean;
			rowSwipe: boolean;
			codeSwipe: boolean;
			msgId: ChatMsgId | null;
			zone: FlickZone;
			inSwitcher: boolean;
			promptHadFocus: boolean;
		} | null = null;
		/** Single-finger hold on dead space (quick-switcher summon):
		armed on touchstart, cancelled by lift, travel, or scroll. */
		let emptyHoldTimer: ReturnType<typeof setTimeout> | null = null;
		function clearEmptyHoldTimer(): void {
			if (emptyHoldTimer) {
				clearTimeout(emptyHoldTimer);
				emptyHoldTimer = null;
			}
		}
		/**
		 * Where a single-finger stroke began, for the vertical-flick
		 * gestures (message / prompt / empty). Controls, fields, and
		 * chrome count as "other": taps there keep native behavior and
		 * strokes there belong to their owner, never to a gesture.
		 */
		/** Last single-tap point: pairs into the double-tap sidebar open. */
		let lastTapAt = 0;
		let lastTapX = 0;
		let lastTapY = 0;
		/** Pending empty-tap focus (new chat): fired unless the second
		tap pairs into the sidebar open instead. */
		let emptyTapTimer: ReturnType<typeof setTimeout> | null = null;
		/** Consecutive-tap run on message text (phones): double-tap
		selects the word, triple-tap the sentence and quadruple-tap
		the paragraph (see the touchend overrides below — native
		double-tap never fires under `touch-action: manipulation`).
		Own pairing — empty-space taps keep theirs above. */
		let msgTapSeq: TapSequence | null = null;
		function flickZoneOf(target: EventTarget | null): FlickZone {
			const el = target instanceof Element ? target : null;
			if (!el) return "other";
			if (
				el.closest(
					"button, a, input, textarea, select, summary, [contenteditable], .actions"
				)
			)
				return "other";
			if (el.closest(".prompt")) return "prompt";
			if (articleOf(el)) return "message";
			if (
				el.closest("main") &&
				el.closest(
					"aside, .modal, .modal-veil, .settings-panel, .find-bar, .search-palette, .sel-menu, .review, .lang-menu, .lang-menus, .hero, .toast"
				) === null
			)
				return "empty";
			return "other";
		}
		// Desktop twin of the tap-out rule below: a press starting
		// outside the composer cancels an in-prompt note edit.
		// Composer presses (typing, send arrow) keep it; the review
		// itself lives inside .prompt, so its buttons never cancel.
		window.addEventListener("mousedown", (event) => {
			// Badge presses never tap out: the capture-phase press
			// opens (or toggles) the edit before this bubble check
			// runs, so without the carve-out every marker tap would
			// open its edit and cancel it in the same gesture.
			const target = event.target instanceof Element ? event.target : null;
			if (
				promptAnnEdit &&
				!target?.closest(".prompt") &&
				!target?.closest("[data-ann-badge]")
			) {
				cancelPromptAnnEdit();
			}
		});
		window.addEventListener(
			"touchstart",
			(event) => {
				// Mobile in-prompt note edit: a stroke starting outside
				// the composer cancels it (tapping out drops the draft).
				// Composer taps keep it; the send arrow commits instead
				// (see doSend). Runs before every gesture below.
				// Badges never tap out either (see the mousedown twin):
				// re-press toggles through openBadge, and switching
				// markers opens the next edit directly.
				const tapTarget = event.target instanceof Element ? event.target : null;
				if (
					promptAnnEdit &&
					!tapTarget?.closest(".prompt") &&
					!tapTarget?.closest("[data-ann-badge]")
				) {
					cancelPromptAnnEdit();
				}
				if (event.touches.length > 1) {
					edgeTouch = null;
					clearEmptyHoldTimer();
					return;
				}
				const touch = event.touches[0];
				if (!touch) return;
				// Mid-screen swipes must never steal text entry: a swipe
				// starting in the composer or a field is cursor/scroll work.
				const target = event.target;
				const clean =
					!(target instanceof Element) ||
					target.closest(
						"input, textarea, select, [contenteditable='true']"
					) === null;
				// Message the stroke starts on (for swipe-to-fold). The
				// article id carries the viewChat index (see msg-{i}).
				const art = target instanceof Element ? articleOf(target) : null;
				const msgIndex = art ? Number(art.id.slice(4)) : NaN;
				const msgId = Number.isInteger(msgIndex)
					? (viewChat.messages[msgIndex]?.id ?? null)
					: null;
				// A stroke starting on the action row is the row's own
				// scroll: scrolling an overflowing row must never fold
				// the message or summon a sidebar.
				const rowSwipe =
					target instanceof Element && target.closest(".actions") !== null;
				// Same for sideways pans inside code and latex blocks: the
				// inner scroller owns the stroke, so it folds neither the
				// block nor the message around it.
				const codeSwipe =
					target instanceof Element &&
					target.closest(".ccez-code, .ccez-math") !== null;
				// Strokes inside the chat switcher belong to the switcher
				// card (cycle on swipe): the window paths below stay out.
				const inSwitcher =
					target instanceof Element &&
					target.closest(".chat-switcher") !== null;
				// Snapshot before the tap blurs anything: a tap-away that
				// dismisses the keyboard must not re-arm focus below.
				const promptHadFocus =
					document.activeElement instanceof Element &&
					document.activeElement.closest(".prompt") !== null;
				edgeTouch = {
					id: touch.identifier,
					x: touch.clientX,
					y: touch.clientY,
					at: Date.now(),
					scrollTop: scrollBox?.scrollTop ?? 0,
					clean,
					rowSwipe,
					codeSwipe,
					msgId,
					zone: flickZoneOf(target),
					inSwitcher,
					promptHadFocus
				};
				// Single-finger hold on dead space summons the quick
				// switcher too (not just the double-tap): a still
				// half-second press, cancelled by lift, travel, scroll,
				// or a second finger. Text keeps its native long-press
				// (only the "empty" zone arms here).
				clearEmptyHoldTimer();
				if (
					androidUI &&
					!chatSwitcherOpen &&
					edgeTouch.zone === "empty" &&
					(window.getSelection()?.isCollapsed ?? true)
				) {
					const heldId = touch.identifier;
					const heldTop = scrollBox?.scrollTop ?? 0;
					emptyHoldTimer = setTimeout(() => {
						emptyHoldTimer = null;
						if (edgeTouch?.id !== heldId) return;
						if ((scrollBox?.scrollTop ?? 0) !== heldTop) return;
						openChatSwitcher();
					}, 500);
				}
			},
			{ passive: true }
		);
		// A travelling finger is a scroll or swipe, never a hold.
		window.addEventListener(
			"touchmove",
			(event) => {
				if (!emptyHoldTimer || !edgeTouch || event.touches.length !== 1) return;
				const touch = event.touches[0];
				if (
					touch &&
					Math.hypot(touch.clientX - edgeTouch.x, touch.clientY - edgeTouch.y) >
						12
				) {
					clearEmptyHoldTimer();
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchend",
			(event) => {
				const start = edgeTouch;
				edgeTouch = null;
				clearEmptyHoldTimer();
				if (!start) return;
				let ended: {
					identifier: number;
					clientX: number;
					clientY: number;
				} | null = null;
				for (let i = 0; i < event.changedTouches.length; i++) {
					const candidate = event.changedTouches[i];
					if (candidate && candidate.identifier === start.id) ended = candidate;
				}
				if (!ended) return;
				// Strokes on the switcher veil cycle chats anywhere on
				// screen (taps still close via click): every other
				// window gesture stays out.
				if (start.inSwitcher) {
					const step = switcherVeilStep(
						start.x,
						start.y,
						ended.clientX,
						ended.clientY
					);
					if (step !== null) stepSwitcher(step);
					return;
				}
				// Phone: a stroke starting on a message folds it either
				// way while fold on swipe is on — a rightward message
				// stroke folds instead of summoning the chats list (off
				// messages and with the toggle off, rightward summons
				// via the stroke below as before). An active text
				// selection wins — folding mid-select would eat the
				// highlight.
				if (
					androidUI &&
					settings.foldOnSwipe &&
					start.msgId &&
					!start.rowSwipe &&
					!start.codeSwipe &&
					messageFoldSwipe(start.x, start.y, ended.clientX, ended.clientY) &&
					window.getSelection()?.isCollapsed !== false
				) {
					// Haptic lives inside toggleFold (every fold path
					// shares it — swipe, alt-click, action button).
					toggleFold(start.msgId);
					return;
				}
				// Double-tap on empty space opens the quick switcher
				// (Android): the list keeps its swipe and button openers,
				// and prompt flicks never count. Taps are short, still, unscrolled
				// strokes over dead space: text takes its own double-tap
				// word pick below, controls keep their taps.
				if (androidUI && !iosUI) {
					const now = Date.now();
					const tapped =
						now - start.at <= 300 &&
						Math.hypot(ended.clientX - start.x, ended.clientY - start.y) <=
							12 &&
						Math.abs((scrollBox?.scrollTop ?? 0) - start.scrollTop) <= 10 &&
						start.zone === "empty" &&
						window.getSelection()?.isCollapsed !== false;
					const paired =
						tapped &&
						now - lastTapAt < 400 &&
						Math.hypot(ended.clientX - lastTapX, ended.clientY - lastTapY) < 32;
					if (tapped) {
						lastTapAt = now;
						lastTapX = ended.clientX;
						lastTapY = ended.clientY;
					}
					if (paired) {
						lastTapAt = 0;
						// The second tap owns the gesture: a pending
						// empty-tap focus must not pop the keyboard
						// behind the opening switcher.
						if (emptyTapTimer) {
							clearTimeout(emptyTapTimer);
							emptyTapTimer = null;
						}
						// Dead-space double-tap opens the quick switcher
						// (the list keeps its swipe and button openers).
						openChatSwitcher();
						return;
					}
					// Single tap on the dead space of an empty new chat
					// focuses the composer (phones have no i key). Fired
					// past the double-tap window so the opener above wins
					// the pair; chats with messages keep tap-to-peace. A
					// tap that dismisses the keyboard never re-arms: the
					// prompt had focus when the stroke began, so this tap
					// is the way out, not the way in. Dismissal taps
					// never summon either: a tap that lands while a
					// language sheet is open closes it (touchend runs
					// before the mouseup closer), and a tap beside an
					// open sidebar belongs to the drawer, not the
					// composer — both stay keyboard-down.
					if (
						tapped &&
						!paired &&
						viewChat.messages.length === 0 &&
						!start.promptHadFocus &&
						openLangMenu === null &&
						settings.sidebarCollapsed
					) {
						if (emptyTapTimer) clearTimeout(emptyTapTimer);
						emptyTapTimer = setTimeout(() => {
							emptyTapTimer = null;
							editor?.focus();
						}, 380);
					}
				}
				// Message taps pair into runs (phones): double-tap stays
				// native (word select), triple-tap takes the sentence and
				// quadruple-tap the paragraph (selectSentenceAtPoint /
				// selectParagraphAtPoint do the selecting just below).
				// The pair pins the revealed row
				// open: the second tap's click would otherwise toggle it
				// shut (see toggleMessageActions). No collapsed gate: the
				// third tap lands on the second's word pick by design.
				if (androidUI && start.msgId && !start.rowSwipe) {
					const now = Date.now();
					const msgTapped =
						now - start.at <= 300 &&
						Math.hypot(ended.clientX - start.x, ended.clientY - start.y) <=
							12 &&
						Math.abs((scrollBox?.scrollTop ?? 0) - start.scrollTop) <= 10 &&
						start.zone === "message";
					if (msgTapped) {
						msgTapSeq = nextTapCount(
							msgTapSeq,
							now,
							ended.clientX,
							ended.clientY
						);
						// Double-tap takes the word itself (native never
						// fires under `touch-action: manipulation`): the
						// pin holds the revealed row open while the pick
						// lands.
						if (msgTapSeq.count === 2) {
							msgDoubleTapPin = { id: start.msgId, at: now };
							selectWordAtPoint(ended.clientX, ended.clientY);
						}
						// Triple-tap takes the sentence, quadruple-tap the
						// paragraph (this counter only ever sees
						// single-finger taps). A false return keeps the
						// native pick: the override never fires blind.
						else if (msgTapSeq.count === 3)
							selectSentenceAtPoint(ended.clientX, ended.clientY);
						else if (msgTapSeq.count === 4)
							selectParagraphAtPoint(ended.clientX, ended.clientY);
					}
				}
				// Thumb-wide edge zone (not the 24px helper default a
				// thumb in a case can't land). Rightward strokes summon
				// the chats list from anywhere on the main chat (see
				// middleSwipeTarget) — except strokes starting on the
				// action row or inside code/math blocks, where the inner
				// scroller owns the stroke.
				const target = start.rowSwipe || start.codeSwipe
					? null
					: (edgeSwipeTarget(
							start.x,
							start.y,
							ended.clientX,
							ended.clientY,
							window.innerWidth,
							48,
							64
						) ?? middleSwipeTarget(start, ended));
				// The quick switcher owns every swipe while up: strokes
				// on its veil cycle chats, and nothing may summon a
				// sidebar behind it.
				if (chatSwitcherOpen && (target === "chats" || target === "settings"))
					return;
				if (target === "chats" && androidUI && !iosUI) {
					// A rightward stroke summons the chats list (double-tap
					// stays as the other opener) and never dismisses it —
					// only a settings panel yields to it, and only the
					// leftward stroke below folds the list itself.
					if (settingsOpen) settingsOpen = false;
					else if (settings.sidebarCollapsed) {
						settings.sidebarCollapsed = false;
						persistSettings();
					}
					return;
				}
				if (target === "settings" && androidUI) {
					// Phones: a leftward stroke off messages and the
					// prompt opens settings (message-start strokes fold
					// via the branch above when fold on swipe is on —
					// or do nothing when short — and prompt-start
					// strokes never reach here as unclean; with the
					// toggle off the stroke falls through to settings
					// like any other). An open chats list folds instead,
					// and an open panel stays (rightward dismisses it).
					// Desktop keeps the shared edge outcome below.
					if (settingsOpen) return;
					if (start.rowSwipe) return;
					if (start.msgId && settings.foldOnSwipe) return;
					if (!settings.sidebarCollapsed) {
						settings.sidebarCollapsed = true;
						persistSettings();
					} else openSettingsPanel(true);
					return;
				}
				applyEdgeTarget(target);
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchcancel",
			() => {
				edgeTouch = null;
			},
			{ passive: true }
		);
		// Touch text selection: a long-press selects natively, but the
		// compatibility mouse sequence trailing it looks like a stale
		// click (mousedown snapshots the already-made selection, mouseup
		// clears it as "unchanged"), so the menu never appears. Handle
		// touchend directly — a lift over message text with a NEW
		// selection summons the menu — and the guard in onMouseUp
		// swallows the compat mouseup behind it. Multi-touch gestures
		// claim their own sequences; taps matching the pre-touch
		// selection are handle nudges, not new picks.
		let touchMenuAt = 0;
		let multiTouchSeen = false;
		let selTouchStart: { x: number; y: number; sel: string } | null = null;
		window.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length > 1) {
					multiTouchSeen = true;
					selTouchStart = null;
					return;
				}
				const first = event.touches[0];
				selTouchStart = first
					? {
							x: first.clientX,
							y: first.clientY,
							sel: window.getSelection()?.toString() ?? ""
						}
					: null;
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchend",
			(event) => {
				const start = selTouchStart;
				selTouchStart = null;
				if (event.touches.length === 0) {
					const claimed = multiTouchSeen;
					multiTouchSeen = false;
					if (claimed) return;
				} else if (multiTouchSeen) {
					return;
				}
				if (!androidUI || shortcutsOpen || inspectChar || !start) return;
				const touch = event.changedTouches[0];
				if (!touch) return;
				// No travel limit: dragging the selection handles across
				// lines ends far from where the touch began, and that lift
				// is exactly the multi-line pick the menu must serve. Scrolls
				// can't summon it (they leave the selection unchanged, so the
				// equality check below filters them), and lifts outside text
				// fail the .rendered check.
				const el = document.elementFromPoint(touch.clientX, touch.clientY);
				if (!el?.closest(".messages .rendered")) return;
				const live = window.getSelection()?.toString() ?? "";
				if (live === "" || live === start.sel) return;
				placeSelMenu(touch.clientX, touch.clientY);
				touchMenuAt = Date.now();
				// Headphones in: the fresh selection reads itself aloud
				// on release (when a voice fits). The menu stays up, so
				// Annotate is still one tap away after listening.
				// Phones never do this: every selection would talk.
				if (!androidUI && settings.autoSpeakSelection) {
					const fresh = currentQuote();
					if (fresh)
						void speakQuote(fresh.quote, fresh.messageId, true, fresh.context);
				}
			},
			{ passive: true }
		);
		// A dead highlight drops its menu at once: taps elsewhere (and
		// handle collapses) clear the selection without touching the
		// mouse/touch summon paths, so without this the menu stranded
		// until the 4.5s timer. Presses that began in the menu stand
		// down (see menuPressAt): the button's own release collapses
		// the highlight, and Annotate runs off the stored quote.
		document.addEventListener("selectionchange", () => {
			if (!selMenu) return;
			if (Date.now() - menuPressAt < 1000) return;
			// A hover transition's engine collapse (no press at all):
			// put the stored range back while the hover change is
			// fresh. Any other clear falls through to the dismiss
			// below — plain clicks always press first, so they never
			// land here.
			if (Date.now() - lastHoverChangeAt < 500) {
				const liveKeep = window.getSelection();
				if (selMenu?.range && (!liveKeep || liveKeep.toString() === "")) {
					try {
						liveKeep?.removeAllRanges();
						liveKeep?.addRange(selMenu.range.cloneRange());
					} catch {
						// Detached since the click: fall through below.
					}
					if ((liveKeep?.toString() ?? "") !== "") return;
				}
			}
			// Hover-shaped engine clear: no press, no key, no
			// programmatic clear since the menu opened — the pointer
			// cruising other messages (or the menu's own shadow) must
			// not cost the highlight. Put the stored range back and
			// keep the menu; detached nodes fall through to the
			// dismiss below. Genuine clears always stamp newer (a
			// click-away or fresh drag presses, an arrow-collapse
			// keys, Escape/pills clear programmatically), so they
			// keep dismissing.
			// Only an empty live selection rescues: a live one is new
			// work (reselects, swaps), never a hover-clear.
			const liveBefore = window.getSelection();
			const rescueRange =
				!liveBefore || liveBefore.isCollapsed || liveBefore.toString() === ""
					? selMenu?.range
					: null;
			if (
				rescueRange &&
				lastPressAt <= selMenuOpenedAt &&
				lastProgrammaticClearAt <= selMenuOpenedAt
			) {
				const liveRescue = window.getSelection();
				try {
					if (
						document.contains(rescueRange.startContainer) &&
						document.contains(rescueRange.endContainer)
					) {
						liveRescue?.removeAllRanges();
						liveRescue?.addRange(rescueRange.cloneRange());
					}
				} catch {
					// Detached mid-hover: fall through to the dismiss below.
				}
				if ((liveRescue?.toString() ?? "") !== "") return;
			}
			const live = window.getSelection();
			if (!live || live.isCollapsed || live.toString() === "") {
				const anchor = live?.anchorNode;
				// No anchor at all (a bare removeAllRanges, no press
				// behind it): a body swap always leaves a collapsed or
				// detached anchor behind, so anchorless is a genuine
				// clear and the menu drops at once. The pointer riding
				// the menu stands down — WebKit empties the document
				// selection on menu hover, and the enter restore below
				// puts it back.
				if (!anchor) {
					// A programmatic clear newer than the open (the
					// capture collapse that drops the native toolbar)
					// strands no range to restore, but the stored quote
					// still stands: keep the menu. Every other
					// clearSelection() caller nulls the menu in the same
					// tick, so this only ever fires for the capture.
					if (lastProgrammaticClearAt > selMenuOpenedAt) return;
					if (!selMenuHover) selMenu = null;
					return;
				}
				// A body swap under the highlight (stream chunk, aid
				// rebuild, late enhancement) detaches the anchor node:
				// the stored quote still stands, so the menu stands with
				// it and Annotate keeps working...
				if (!document.contains(anchor)) return;
				// ...or collapses it onto the attached container (WebKit
				// fires selectionchange for this; Chromium stays silent):
				// when the collapse is newer than the last press it is
				// the swap's, so the menu stands on its stored quote. A
				// real clear always arrives on a press and still dismisses.
				if (lastBodySwapAt > lastPressAt) return;
				// WebKit also empties the document selection when the
				// pointer moves onto the floating menu itself — no DOM
				// change, no press, nothing to stamp (Chromium keeps
				// it). While the pointer is over the menu the collapse
				// is the engine's, so the menu stands on its stored
				// quote and Annotate keeps working. The message must
				// still be there: a Delete/cut with the pointer parked
				// over the menu really does clear, and must dismiss.
				const menuMessageId = selMenu?.messageId;
				if (
					selMenuHover &&
					menuMessageId !== undefined &&
					chat.messages.some((m) => m.id === menuMessageId)
				)
					return;
				selMenu = null;
			}
			// Live reselects refresh the stored quote in place
			// (replacement, never mutation, so the dock re-renders):
			// extending past one character hides Inspect, shrinking
			// back restores it. Rescue paths returned above, so a live
			// selection here is new work.
			if (live && !live.isCollapsed && live.toString() !== "" && selMenu) {
				const refreshed = currentQuote();
				if (refreshed && refreshed.quote !== selMenu.quote) {
					selMenu = {
						...selMenu,
						quote: refreshed.quote,
						context: refreshed.context,
						messageId: refreshed.messageId,
						range:
							live.rangeCount > 0
								? live.getRangeAt(0).cloneRange()
								: selMenu.range
					};
				}
			}
		});
		// Two-finger horizontal swipes open drawers (left = settings,
		// right = chats list); a vertical two-finger slide jumps the chat
		// (up to the top, down to the bottom — gg and G); a three-finger
		// horizontal swipe steps chats (left = newer, right = older, no
		// focus: the keyboard stays down); a two-finger double tap
		// jumps to the bottom on Android (sidebar toggle on iOS); a
		// three-finger tap deletes the tapped message; a three-finger
		// hold wipes every chat on Android (current chat on iOS).
		// Taps start away from controls, drawers, and the modal;
		// swipes and slides track from anywhere a modal isn't open, and
		// the swipe's pinch veto (see twoFingerSwipeDir) keeps page zoom.
		let twoTrack: {
			start: [FingerTrack, FingerTrack];
			end: [FingerTrack, FingerTrack];
			/** False when a finger landed on a control: swipes and slides
			still fire (settings from anywhere), but tap-pairing never
			does (a double-tap on a button must not delete a chat). */
			clean: boolean;
		} | null = null;
		// Main-chat pinch owns font size (both phone platforms; the
		// sidebar keeps the default page zoom): while a clean
		// two-finger press starts in the messages column, spread steps
		// scale the text and veto the swipe/tap paths at release.
		let pinchBaseline = 0;
		let pinchStartSpread = 0;
		let pinchFont = false;
		let pinchMoved = false;
		let pinchStepped = false;
		let threeTrack: {
			id: number;
			x: number;
			y: number;
			cx: number;
			cy: number;
			moved: number;
			at: number;
		} | null = null;
		let twoTapAt = 0;
		let lastTwoTapAt = 0;
		/**
		 * Chat switcher overlay (phones): a two-finger hold on the main
		 * chat opens it; swipes inside cycle chats, tapping away closes.
		 * The flag itself is top-level state (runes can't live in
		 * onMount); only the hold timer lives here.
		 */
		/** Two-finger hold: armed while both fingers rest, fired once. */
		let holdTimer: ReturnType<typeof setTimeout> | null = null;
		let holdFired = false;
		/**
		 * Three-finger hold: armed while the trio rests, fired once (a
		 * wipe). The release consumes the flag so it never falls
		 * through to the message-delete tap.
		 */
		let threeHoldTimer: ReturnType<typeof setTimeout> | null = null;
		let threeHoldFired = false;
		function clearThreeHoldTimer(): void {
			if (threeHoldTimer) {
				clearTimeout(threeHoldTimer);
				threeHoldTimer = null;
			}
		}
		function clearHoldTimer(): void {
			if (holdTimer) {
				clearTimeout(holdTimer);
				holdTimer = null;
			}
		}
		/** Lead-finger travel of the live two-finger press, if any. */
		function twoFingerHeldStill(maxMove = 12): boolean {
			if (!twoTrack) return false;
			return (
				Math.hypot(
					twoTrack.end[0].x - twoTrack.start[0].x,
					twoTrack.end[0].y - twoTrack.start[0].y
				) <= maxMove &&
				Math.hypot(
					twoTrack.end[1].x - twoTrack.start[1].x,
					twoTrack.end[1].y - twoTrack.start[1].y
				) <= maxMove
			);
		}
		const gestureClean = (event: TouchEvent): boolean => {
			if (!androidUI || shortcutsOpen) return false;
			const target = event.target;
			return (
				!(target instanceof Element) ||
				target.closest(
					"input, textarea, select, [contenteditable='true'], button, aside, .settings-panel, .modal, .sel-menu"
				) === null
			);
		};
		const trackOf = (t: Touch): FingerTrack => ({
			id: t.identifier,
			x: t.clientX,
			y: t.clientY
		});
		window.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length === 2) {
					const a = event.touches[0];
					const b = event.touches[1];
					// Phones track from anywhere a modal isn't open: a
					// finger landing on a button used to kill the whole
					// gesture, which read as "swipe left sometimes
					// doesn't open settings". A live highlight no longer
					// vetoes either — the swipe itself picks text on the
					// way down, which self-vetoed message-start swipes
					// almost every time. Loose tracks still swipe and
					// slide; only clean ones pair taps, and taps never
					// pair mid-select (see the guards below).
					const modalBusy =
						shortcutsOpen || palette.open || inspectChar !== null;
					const clean = !modalBusy && gestureClean(event);
					twoTrack =
						a && b && androidUI && !modalBusy
							? {
									start: [trackOf(a), trackOf(b)],
									end: [trackOf(a), trackOf(b)],
									clean
								}
							: null;
					// A clean two-finger press starts the double-tap clock.
					twoTapAt = twoTrack !== null && twoTrack.clean ? Date.now() : 0;
					threeTrack = null;
					clearThreeHoldTimer();
					threeHoldFired = false;
					// Pinch-to-font arms only in the messages column: the
					// sidebar and sheets keep the default page zoom.
					const target = event.target;
					pinchFont =
						twoTrack !== null &&
						target instanceof Element &&
						target.closest("main .messages") !== null;
					pinchBaseline = pinchStartSpread =
						a && b
							? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
							: 0;
					pinchMoved = false;
					pinchStepped = false;
					// Two-finger hold opens the chat switcher: both fingers
					// resting on the main chat (not controls, drawers, or a
					// modal) for half a second. Movement or release cancels
					// before it fires; firing consumes the release below.
					clearHoldTimer();
					holdFired = false;
					if (twoTrack !== null && twoTrack.clean && !chatSwitcherOpen) {
						holdTimer = setTimeout(() => {
							holdTimer = null;
							if (twoTrack !== null && twoFingerHeldStill()) {
								holdFired = true;
								openChatSwitcher();
							}
						}, 500);
					}
				} else if (event.touches.length === 3) {
					const first = event.touches[0];
					threeTrack =
						first && gestureClean(event)
							? {
									id: first.identifier,
									x: first.clientX,
									y: first.clientY,
									cx: first.clientX,
									cy: first.clientY,
									moved: 0,
									at: Date.now()
								}
							: null;
					twoTrack = null;
					clearHoldTimer();
					pinchFont = false;
					pinchMoved = false;
					// Three-finger hold wipes the thread: the trio
					// resting still for 600ms (past tap range) fires
					// once; travel or lift cancels before it fires.
					clearThreeHoldTimer();
					threeHoldFired = false;
					if (threeTrack !== null) {
						threeHoldTimer = setTimeout(() => {
							threeHoldTimer = null;
							if (threeTrack !== null && threeTrack.moved <= 12) {
								threeHoldFired = true;
								// Haptic lives inside dropChat (triple thump).
								dropChat(chatState.activeChatId);
								flashToast("Chat deleted");
							}
						}, 600);
					}
				} else {
					twoTrack = null;
					clearHoldTimer();
					clearThreeHoldTimer();
					threeHoldFired = false;
					pinchFont = false;
					pinchMoved = false;
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchmove",
			(event) => {
				if (threeTrack) {
					const lead = Array.from(event.touches).find(
						(t) => t.identifier === threeTrack?.id
					);
					if (lead) {
						threeTrack.moved = Math.max(
							threeTrack.moved,
							Math.hypot(
								lead.clientX - threeTrack.x,
								lead.clientY - threeTrack.y
							)
						);
						threeTrack.cx = lead.clientX;
						threeTrack.cy = lead.clientY;
					}
					// A wandering trio is a swipe-in-progress, not a hold.
					if (threeHoldTimer && threeTrack.moved > 12) clearThreeHoldTimer();
				}
				if (twoTrack) {
					for (const t of Array.from(event.touches)) {
						const slot = twoTrack.end.find((e) => e.id === t.identifier);
						if (slot) {
							slot.x = t.clientX;
							slot.y = t.clientY;
						}
					}
					// A wandering hold is a swipe-in-progress, not a hold.
					if (holdTimer && !twoFingerHeldStill()) clearHoldTimer();
				}
				// Main-chat pinch steps the text size live: re-baseline
				// per step so a held pinch keeps scaling, one haptic
				// tick per step. Any real spread change vetoes the
				// swipe/tap paths at release below.
				if (pinchFont && event.touches.length === 2) {
					const a = event.touches[0];
					const b = event.touches[1];
					if (a && b) {
						const spread = Math.hypot(
							a.clientX - b.clientX,
							a.clientY - b.clientY
						);
						if (Math.abs(spread - pinchStartSpread) > 12) pinchMoved = true;
						const step = pinchZoomStep(pinchBaseline, spread);
						if (step !== 0) {
							pinchBaseline = spread;
							pinchStepped = true;
							adjustFontScale(step * 0.1, true);
							void hapticBeatAsync("send", {
								enabled: settings.hapticsEnabled,
								shell: tauriBackendAvailable()
							});
						}
					}
				}
			},
			{ passive: true }
		);
		// Main-chat pinch owns its gesture: block the default page zoom
		// while both fingers are down in the messages column (a separate
		// non-passive listener — the tracker above stays passive).
		window.addEventListener(
			"touchmove",
			(event) => {
				if (pinchFont && event.touches.length === 2) event.preventDefault();
			},
			{ passive: false }
		);
		// iOS ignores touchmove prevention for pinch zoom: its gesture
		// event must preventDefault instead (a no-op everywhere else).
		document.addEventListener("gesturestart", (event) => {
			if (pinchFont) event.preventDefault();
		});
		window.addEventListener(
			"touchend",
			(event) => {
				clearHoldTimer();
				// A partial lift breaks the trio: no hold, no tap.
				if (threeTrack && event.touches.length > 0) {
					threeTrack = null;
					clearThreeHoldTimer();
					threeHoldFired = false;
				}
				if (twoTrack) {
					// A fired hold owns the release: no swipe, slide, or
					// tap pairing after the switcher opens.
					if (holdFired && event.touches.length === 0) {
						holdFired = false;
						twoTrack = null;
						pinchFont = false;
						pinchMoved = false;
						pinchStepped = false;
						return;
					}
					for (const t of Array.from(event.changedTouches)) {
						const slot = twoTrack.end.find((e) => e.id === t.identifier);
						if (slot) {
							slot.x = t.clientX;
							slot.y = t.clientY;
						}
					}
					if (event.touches.length === 0) {
						const twoStart = twoTrack.start;
						const twoEnd = twoTrack.end;
						const dir = twoFingerSwipeDir(twoStart, twoEnd);
						// Phones slide vertically too (handled below): compute
						// while the tracks are alive; horizontal strokes read
						// null here so the swipe step above keeps them.
						const slide =
							androidUI && dir === null
								? twoFingerSlideDir(twoStart, twoEnd)
								: null;
						const now = Date.now();
						const moved = Math.max(
							Math.hypot(
								twoEnd[0].x - twoStart[0].x,
								twoEnd[0].y - twoStart[0].y
							),
							Math.hypot(
								twoEnd[1].x - twoStart[1].x,
								twoEnd[1].y - twoStart[1].y
							)
						);
						twoTrack = null;
						// A pinch owns the gesture: spread motion vetoes
						// the swipe step, the vertical slide, and the tap pairing below.
						// Settings opens on a shorter leftward glide (64px):
						// message-start swipes run short on thumbs, and the
						// panel dismisses with one tap, so a hair-trigger
						// costs nothing. Every other direction keeps 96px.
						if (dir === null && androidUI && !pinchMoved && !settingsOpen) {
							if (twoFingerSwipeDir(twoStart, twoEnd, 64) === -1) {
								openSettingsPanel(true);
							}
						}
						if (dir !== null && !pinchMoved) {
							// Phones: a two-finger swipe left opens
							// settings (the one-finger left stroke never
							// does); a two-finger swipe right summons the
							// chats list. Chat steps moved to three
							// fingers; desktop keeps stepping both
							// directions.
							if (dir === -1 && androidUI && !settingsOpen)
								openSettingsPanel(true);
							else if (dir === 1 && androidUI) {
								if (settingsOpen) settingsOpen = false;
								else if (settings.sidebarCollapsed) {
									settings.sidebarCollapsed = false;
									persistSettings();
								}
								chatSwitcherOpen = false;
							} else stepChat(dir, false);
						}
						// Still two-finger taps pair into a bottom jump
						// (Android: no Home/End keys, and a tap lands
						// where a slide stroke can't start); swipes take
						// the step path instead. Message delete moved
						// to the three-finger tap, the chat wipe to the
						// three-finger hold. iOS keeps the sidebar
						// toggle. Never mid-select: opening settings
						// stopped vetoing on a highlight, but a jump
						// must not fire under one.
						else if (
							!pinchMoved &&
							androidUI &&
							twoTapAt > 0 &&
							moved <= 12 &&
							now - twoTapAt <= 400 &&
							window.getSelection()?.isCollapsed !== false
						) {
							if (now - lastTwoTapAt < 600) {
								lastTwoTapAt = 0;
								if (iosUI) {
									// The open keyboard would cover the sidebar.
									if (document.activeElement instanceof HTMLElement)
										document.activeElement.blur();
									toggleSidebar();
								} else {
									// On a message: its end lands above the
									// dock. On empty space: the thread
									// bottom. The quiet tick lives inside
									// the jump.
									scrollMessageEndIntoView(twoEnd[0].x, twoEnd[0].y);
								}
							} else lastTwoTapAt = now;
						}
						// Phones: a two-finger vertical slide jumps the chat —
						// up to the top, down to the bottom (phones have no
						// Home/End keys). Same pinch veto as the swipe step;
						// desktop keeps swipes only.
						if (slide !== null && !pinchMoved && scrollBox) {
							if (slide === "top")
								scrollBox.scrollTo({ top: 0, behavior: "smooth" });
							else
								scrollBox.scrollTo({
									top: scrollBox.scrollHeight,
									behavior: "smooth"
								});
							void hapticBeatAsync("send", {
								enabled: settings.hapticsEnabled,
								shell: tauriBackendAvailable()
							});
						}
						// Pinch zoom toasts once on release with the
						// landed size (steps stay quiet mid-gesture).
						if (pinchStepped)
							flashToast(`Text size ${Math.round(settings.fontScale * 100)}%`);
						pinchFont = false;
						pinchMoved = false;
						pinchStepped = false;
					}
				}
				if (threeTrack && event.touches.length === 0) {
					const track = threeTrack;
					threeTrack = null;
					const now = Date.now();
					// The lead finger's lift carries its last position:
					// fold it in before judging, so a swipe released
					// without a final move still measures full travel.
					for (const t of Array.from(event.changedTouches)) {
						if (t.identifier === track.id) {
							track.cx = t.clientX;
							track.cy = t.clientY;
						}
					}
					// Phones step chats on a three-finger horizontal swipe
					// (left = newer, right = older, keyboard stays down);
					// a near-stationary trio still pairs into the tap below.
					const swipe = androidUI
						? threeFingerSwipeDir(track.x, track.y, track.cx, track.cy)
						: null;
					if (swipe !== null) {
						// Left steps newer (minting past the end), right
						// older — matching the switcher veil above.
						stepChat(swipe === 1 ? -1 : 1, false);
						void hapticBeatAsync("send", {
							enabled: settings.hapticsEnabled,
							shell: tauriBackendAvailable()
						});
						// Never mid-select, like the two-finger jump above.
						// A fired hold owns the release: the wipe already
						// landed, so the tap below must not run after it.
					} else if (
						isThreeFingerTap(3, track.moved, now - track.at) &&
						window.getSelection()?.isCollapsed !== false
					) {
						const wiped = threeHoldFired;
						threeHoldFired = false;
						clearThreeHoldTimer();
						if (!wiped) {
							// A three-finger tap deletes the tapped
							// message (the lead finger's lift point
							// maps back to the thread). Off-message
							// taps do nothing.
							const target = messageIndexAtPoint(track.cx, track.cy);
							const id =
								target === null ? undefined : viewChat.messages[target]?.id;
							const at = id ? chat.messages.findIndex((m) => m.id === id) : -1;
							if (at >= 0) {
								dropMessage(at);
								flashToast("Message deleted");
							}
						}
					}
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchcancel",
			() => {
				twoTrack = null;
				threeTrack = null;
				clearHoldTimer();
				holdFired = false;
				clearThreeHoldTimer();
				threeHoldFired = false;
			},
			{ passive: true }
		);
		if (!promptEl) return;
		// Plain-textarea composer: no measurement cache (no collapse)
		// and no compositor layer games (no tap ghost).
		editor = createTextareaEditor(promptEl, promptOptions());
		editor.setPlaceholder(promptPlaceholder());
		// Desktop lands in the prompt on launch; phones don't — popping
		// the keyboard on every cold start is the mobile annoyance.
		// Always-hide mode never takes focus on its own: the prompt is
		// visible exactly while the composer holds focus, so a mount
		// steal would restore it straight back (and fight every
		// remount, including hot reloads).
		if (!androidUI && settings.promptIdleSec !== PROMPT_IDLE_ALWAYS) {
			editor.focus();
			// Mount-time focus can lose to hydration churn; retry on next
			// frame so a fresh window and a new chat both land in the prompt.
			requestAnimationFrame(() => editor?.focus());
		}
		// First paint can measure while the webview is still settling
		// (window restore, DPR): cached line boxes go stale and the prompt
		// snaps to a new height on the next measure. Settle it up front,
		// after paint, like the window-focus path does.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => editor?.remeasure())
		);

		/**
		 * One Escape ladder for the whole app (capture phase, so it
		 * pre-empts bubble-phase widget handlers like the pill's own
		 * Esc): topmost layer first, exactly one layer per press.
		 * Callers preventDefault + stopPropagation around it.
		 */
		const dismissEscape = (inEditor: Element | null | undefined): void => {
			if (shortcutsOpen || inspectChar) {
				// A modal always wins Esc, even from inside the prompt.
				shortcutsOpen = false;
				inspectChar = null;
			} else if (chatSwitcherOpen) {
				// The phone switcher dismisses like any modal.
				closeChatSwitcher();
			} else if (palette.open) {
				// The search palette wins Esc next, even from its input.
				// A first ESC moves DOM focus input -> list (the query
				// stays, the highlight is already tracked); a second
				// ESC — or one with no results — closes.
				if (
					document.activeElement === searchInputEl &&
					palette.hits.length > 0
				) {
					focusSearchHit(palette.cursor);
				} else closeSearch();
			} else if (find.open) {
				// The find bar closes from anywhere (its input included).
				closeFind();
			} else if (reviewOpen) {
				// The annotations review closes from anywhere (its
				// textarea keeps its own Esc-to-cancel below).
				reviewOpen = false;
				editingId = null;
			} else if (refsPopOpen) {
				// A sent message's filed-annotations card sits below
				// the review in z, so it dismisses right after it —
				// but a row edit cancels first and the card stays
				// open (a second Esc closes it).
				if (refsEditing) cancelRefsEdit();
				else refsPopOpen = null;
			} else if (expandedTags.length > 0) {
				// A history attachment popup is Svelte state (not DOM),
				// so it sits in the ladder beside the filed-annotations
				// card: Esc closes it.
				expandedTags = [];
			} else if (editingMsgId) {
				// An in-progress message edit cancels from anywhere,
				// including inside the prompt (capture phase pre-empts
				// the editor, which binds nothing to Esc).
				cancelMessageEdit();
			} else if (inEditor) {
				// ESC with the composer focused: drop the caret and
				// dismiss composer-adjacent overlays. Voice keeps playing
				// (it has its own toggle); modals, search, and
				// message edits keep their earlier branches above.
				editor?.blur();
				selMenu = null;
				dismissSelPanels();
				openLangMenu = null;
			} else {
				// A bare Esc must never reach the OS/browser default
				// that exits native fullscreen — Esc+f is the only way
				// out. No text harm outside fields.
				// The pill's own Esc handler sits on its textarea
				// (bubble phase), which this capture branch pre-empts —
				// so close it here, or Esc strands an open box.
				cancelAnnPop();
				selMenu = null;
				dismissSelPanels();
				inspectChar = null;
				openLangMenu = null;
				settingsOpen = false;
				shortcutsOpen = false;
				stopVoice();
				// Bare Esc drops a lingering message highlight with the
				// menu (click-away parity): editor and field selections
				// are another gesture's business and keep theirs.
				const liveEsc = window.getSelection();
				const escAnchor =
					liveEsc?.anchorNode instanceof Element
						? liveEsc.anchorNode
						: liveEsc?.anchorNode?.parentElement;
				if (
					liveEsc &&
					!liveEsc.isCollapsed &&
					escAnchor?.closest(".messages .rendered")
				) {
					clearSelection();
				}
				// Scroll mode entered from a deactivated prompt steps
				// back out on Esc (prompt-entry Esc keeps scroll mode).
				if (focusMode === "scroll" && !scrollFromPrompt) exitScrollMode();
			}
		};

		const onKey = (event: KeyboardEvent) => {
			// Idle-prompt restore allowlist: while hidden, only bare
			// i / Enter / Space / backslash bring the prompt back
			// (never typed — the key is a summon, like scroll mode's
			// i). Every other key merely re-arms the hide timer via
			// the stamp listener.
			if (promptIdle) {
				const inPromptEditor = isPromptEditorTarget(event.target);
				const idleAction = promptIdleKeyAction({
					...keyFacts(event),
					repeat: event.repeat,
					isComposing: event.isComposing,
					inPromptEditor,
					activeInPrompt: isPromptTarget(document.activeElement),
					overlayOpen: stageOwnedByOverlay({
						shortcutsOpen,
						searchOpen: palette.open,
						inspectOpen: inspectChar !== null,
						findOpen: find.open,
						settingsOpen,
						sidebarOpen: !settings.sidebarCollapsed
					}),
					inOwnedTarget: isIdleOwnedTarget(event.target)
				});
				if (idleAction === "restore") {
					focusLog("key-idle-restore", {
						key: event.key,
						target: describeFocusTarget(event.target),
						active: describeActiveElement()
					});
					event.preventDefault();
					restorePrompt();
					// The visibility flip flushes async: focusing now
					// would hit a still-hidden composer (a no-op), so
					// land once the tick makes it focusable again.
					void tick().then(() => enterEditMode());
					return;
				}
				if (idleAction === "swallow") {
					focusLog("key-idle-swallow", {
						key: event.key,
						target: describeFocusTarget(event.target),
						active: describeActiveElement()
					});
					event.preventDefault();
					return;
				}
			}
			// H/L step the Inspect stroke preview while it is open
			// (never leaves the menu): bare keys only, never from a
			// field, and never with modifiers.
			const inspectStep = inspectStepAction({
				...keyFacts(event),
				inspectOpen: inspectChar !== null,
				inField: isInspectFieldTarget(event.target)
			});
			if (inspectStep !== null) {
				consumeEvent(event);
				stepInspect(inspectStep);
				return;
			}
			// The shortcuts filter types freely: bare keys never reach
			// the global bindings — only Esc (close) and ⌘F (focus)
			// keep theirs, both handled below. Modified chords pass
			// through like any other input.
			if (
				shortcutsFilterBlocksKey({
					...keyFacts(event),
					inFilter: isFilterTarget(event.target)
				})
			) {
				return;
			}
			// Bare Space or backslash on an empty composer dismisses:
			// no message starts with a space, so it is never content
			// (backslash rides as the Space-equivalent) — blur (and
			// always-hide hides on blur). Repeats are swallowed while
			// focused; the restore path above already ignores repeats,
			// so a held key can't bounce the prompt back open. Own-
			// message edits and attachment drafts are exempt: clearing
			// real work must stay explicit (Escape).
			const spaceAction = spaceKeyAction({
				...keyFacts(event),
				repeat: event.repeat,
				isComposing: event.isComposing,
				editing: editingMsgId !== null,
				hasAttachments: attachments.length > 0,
				composerEmpty: composerText() === "",
				inPrompt: isPromptEditorTarget(event.target)
			});
			if (spaceAction === "dismiss-composer") {
				event.preventDefault();
				editor?.blur();
				return;
			}
			if (spaceAction === "swallow-repeat") {
				event.preventDefault();
				return;
			}
			// Bare Enter on an empty composer dismisses like Space
			// (Shift+Enter stays a newline); text still sends below.
			if (
				enterKeyAction({
					...keyFacts(event),
					repeat: event.repeat,
					isComposing: event.isComposing,
					editing: editingMsgId !== null,
					hasAttachments: attachments.length > 0,
					composerEmpty: composerText() === "",
					inPrompt: isPromptEditorTarget(event.target)
				}) === "dismiss-composer"
			) {
				event.preventDefault();
				editor?.blur();
				return;
			}
			// Fullscreen-hold tracking rides above every Escape path:
			// the keydown dismiss behavior below is untouched (a tap
			// still dismisses exactly as today); the keyup handler
			// exits fullscreen only past the hold threshold.
			if (event.key === "Escape" && !event.repeat) escDownAt = Date.now();
			const inEditor = closestFromTarget(event.target, ".ta-input");
			// One snapshot for the whole modifier-chord table below (see
			// commandChord): priority lives in the table, bodies stay here
			// as `if (chord === ...)` chains, never a switch.
			// The modal owns ⌘/Ctrl+F while open on every runtime (it
			// filters this list only, never the chat): this intercept
			// runs ahead of the shell-gated find chord so the browser
			// preview keeps it too.
			if (
				shortcutsOpen &&
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey &&
				event.code === "KeyF"
			) {
				consumeEvent(event);
				const shortcutInput: HTMLInputElement | null = shortcutInputEl;
				if (shortcutInput) {
					/* eslint-disable @typescript-eslint/no-unsafe-call -- lint-program-only: the $state rune type
						does not resolve under eslint's program here, but svelte-check (real tsc) types both calls. */
					shortcutInput.focus();
					shortcutInput.select();
					/* eslint-enable @typescript-eslint/no-unsafe-call */
				}
				return;
			}
			const chord = commandChord({
				...keyFacts(event),
				// Browser preview leaves print/find to the browser;
				// only the shell owns those chords.
				inShell: tauriBackendAvailable()
			});
			if (event.key === "Escape") {
				// One ladder for every layer (see dismissEscape):
				// topmost first, exactly one per press.
				consumeEvent(event);
				dismissEscape(inEditor);
				return;
			}
			if (chord === "toggle-palette") {
				// Full-text search palette across chats/annotations.
				// Browsers reserve Ctrl+P for print and may keep it; the
				// shell owns the combo and always delivers it.
				consumeEvent(event);
				if (palette.open) closeSearch();
				else openSearch();
				return;
			}
			if (chord === "toggle-fullscreen") {
				// Fullscreen toggle: Cmd+E and Ctrl+Cmd+F. Claimed
				// before find below, so the dual-modifier chord never
				// reads as Cmd/Ctrl+F.
				consumeEvent(event);
				void toggleFullscreen();
				return;
			}
			if (chord === "find-toggle") {
				// In-chat find across the visible messages, cycling hits.
				// The fullscreen chords are claimed above, so
				// Ctrl+Cmd+F never lands here. The modal-open ⌘F
				// intercept runs ahead of chord dispatch (every
				// runtime), so reaching here means the modal is shut.
				consumeEvent(event);
				// Repeat ⌘F closes the bar it opened.
				if (find.open) closeFind();
				else openFind();
				return;
			}
			if (
				summonHideAction({
					summon: isSummonHotkey(event),
					inEditor: inEditor !== null
				}) === "hide"
			) {
				// The OS-global half in desktop.rs fires too; hide is
				// idempotent.
				consumeEvent(event);
				void hideSummonWindow();
				return;
			}
			const pastesAction = pastesKeyAction({
				pastesChord: chord === "toggle-pastes",
				inEditor: inEditor !== null
			});
			if (pastesAction !== null) {
				if (pastesAction === "toggle") editor?.togglePastes();
				consumeEvent(event);
				return;
			}
			const sendAction = sendKeyAction({
				sendChord: chord === "send",
				inField: isFieldTarget(event.target)
			});
			if (sendAction === "send") {
				consumeEvent(event);
				onSubmit("send");
				return;
			}
			if (sendAction === "field-keeps") return;
			if (
				chord === "provider-next" ||
				chord === "provider-prev" ||
				chord === "thinking-next" ||
				chord === "thinking-prev"
			) {
				// Capture phase (see listener below): fires before the editor can
				// swallow the combo, so the shortcuts work from anywhere.
				consumeEvent(event);
				if (chord === "provider-next") cycleProvider(1);
				else if (chord === "provider-prev") cycleProvider(-1);
				else if (chord === "thinking-next") cycleThinking(1);
				else cycleThinking(-1);
				return;
			}
			if (chord === "new-chat") {
				// New chat from anywhere, even inside the prompt. The
				// Ctrl+Alt+N spelling uses the physical key code: macOS
				// Option+N reports key "~". ⇧⌘N does the same:
				// single-window app, so there is no new window to open.
				// Note: browsers reserve ⌘N for a new window, so in a
				// plain browser tab this never arrives — the shell owns it.
				consumeEvent(event);
				doNewChat();
				return;
			}
			if (chord === "toggle-voice") {
				consumeEvent(event);
				setVoiceEnabled(!voiceOn());
				return;
			}
			const delScope = deleteChatScope({
				...keyFacts(event),
				inEditor: inEditor !== null,
				inEditable: isEditableTarget(event.target)
			});
			if (delScope === "chat") {
				// ⌘Delete drops the whole current chat (a blank one takes
				// its place, so the composer never strands) and resets the
				// voice language to the checked keyboard. Mac Delete-key
				// reports Backspace; forward-delete reports Delete. Typing
				// targets keep the plain chord for line-kill habits; the
				// ⇧⌘Delete variant works everywhere, same single chat.
				consumeEvent(event);
				dropChat(chat.id);
				editor?.focus();
				return;
			}
			// One snapshot for the sidebar/settings/zoom cluster (see
			// chromeChord): same token across spellings, bodies stay
			// here as `if (chrome === ...)` chains, never a switch.
			const chrome = chromeChord({
				...keyFacts(event),
				inEditor: inEditor !== null,
				hovered: hoveredIdx >= 0,
				inField: isFieldTarget(event.target),
				// Browser preview has tab switching on these chords;
				// only the shell owns them.
				inShell: tauriBackendAvailable(),
				// Digits pick the reply language only before the
				// first send; after that they jump chats.
				chatLocked: viewChat.messages.length > 0
			});
			if (chrome === "toggle-sidebar") {
				// ⇧⌘[ and ⌘B: physical key codes for the shifted
				// brackets (layout-dependent `key` values), plain key
				// for ⌘B. Opening the list lands on the active chat.
				consumeEvent(event);
				toggleSidebar();
				if (!settings.sidebarCollapsed) focusActiveSideChat();
				return;
			}
			if (chrome === "toggle-settings") {
				// ⇧⌘], ⌘., ⌘, (the macOS Settings shortcut), and ⇧⌘,
				// (Shift turns the comma key into "<" on US layouts, so
				// both spellings count).
				consumeEvent(event);
				toggleSettingsPanel();
				return;
			}
			if (chrome === "dismiss-or-sidebar") {
				// ⇧⌘H with settings open closes them and lands in the
				// prompt; otherwise it mirrors ⌘B for the chat list.
				consumeEvent(event);
				if (settingsOpen) {
					settingsOpen = false;
					enterEditMode();
					return;
				}
				toggleSidebar();
				if (!settings.sidebarCollapsed) focusActiveSideChat();
				return;
			}
			if (chrome === "dismiss-or-settings") {
				// ⇧⌘L with the chat list open closes it and lands in
				// the prompt; otherwise it mirrors ⌘, for settings.
				consumeEvent(event);
				if (!settings.sidebarCollapsed) {
					settings.sidebarCollapsed = true;
					persistSettings();
					enterEditMode();
					return;
				}
				toggleSettingsPanel();
				return;
			}
			if (chrome === "shortcuts-toggle") {
				// ⇧⌘/ (the "?" chord) toggles the shortcuts modal.
				consumeEvent(event);
				if (shortcutsOpen) shortcutsOpen = false;
				else openShortcuts();
				return;
			}
			if (chrome === "step-chat-newer" || chrome === "step-chat-older") {
				// ⇧⌘J steps down (newer chat, minting one past the
				// newest end); ⇧⌘K steps up (older) — with ⌘[ / ⌘] and
				// ⌘↑ / ⌘↓ as shell aliases (same tokens). Works
				// sidebar-closed. Never takes focus: stepping is
				// navigation, and landing in the prompt (opening it,
				// popping the keyboard) is the switcher's job, not the
				// step's.
				consumeEvent(event);
				stepChat(chrome === "step-chat-newer" ? 1 : -1, false);
				return;
			}
			if (chrome === "zoom") {
				// ⌘+ / ⌘- scales the whole UI (the app's own zoom — the
				// shell has no browser-chrome zoom to fall back on). With Shift
				// held the same chords widen/narrow the chat column instead.
				consumeEvent(event);
				const narrow = event.key === "-" || event.key === "_";
				if (event.shiftKey) adjustChatWidth(narrow ? -2 : 2);
				else adjustFontScale(narrow ? -0.1 : 0.1);
				return;
			}
			if (chrome === "quick-lang") {
				// ⌘1…⌘0 toggles the priority language in flag order —
				// pressing the active one's key clears it again. The
				// body checks the code exists first.
				const code = QUICK_LANG_CODES[quickLangIndexForKey(event.key)];
				if (code) {
					consumeEvent(event);
					if (activeReplyCode === code) clearReplyLang();
					else setReplyLang(code);
					return;
				}
			}
			if (chrome === "jump-chat") {
				// Locked-chat digits jump to the nth visible chat (the
				// chat keeps its own reply language — per-chat by
				// design, so a French chat never turns German). Out of
				// range buzzes instead of minting.
				const target = sideVisibleChats()[quickLangIndexForKey(event.key)];
				if (!target) {
					buzzNo();
					return;
				}
				consumeEvent(event);
				transitionToChat(target.id);
				return;
			}
			if (chrome === "delete-message") {
				const target = chat.messages[hoveredIdx];
				if (target) {
					consumeEvent(event);
					stopAudioForMessage(target.id);
					deleteMessage(chatState, hoveredIdx);
					return;
				}
			}
			// One snapshot for every hovered-message hotkey below: the
			// guards each walked the target themselves, so this is also
			// fewer ancestor walks per keypress, not more.
			const msgFacts = {
				...keyFacts(event),
				inEditor: inEditor !== null,
				inField: isFieldTarget(event.target),
				inEditable: isEditableTarget(event.target),
				inInteractive: isInteractiveTarget(event.target),
				inFieldOrFilter: isInspectFieldTarget(event.target),
				hasSelection: (window.getSelection()?.toString() ?? "") !== "",
				hoveredIdx,
				escDownAt
			};
			const msgAction = messageKeyAction(msgFacts);
			if (msgAction === "annotate-selection") {
				// Double-tap a word, hit A: file the live selection as
				// an annotation with "?" staged as the note — send to
				// file the question, or type over it.
				event.preventDefault();
				placeSelMenu();
				annotate("?");
				return;
			}
			if (msgAction === "toggle-aids") {
				// A toggles every aid the hovered message offers — pinyin
				// over Chinese lines, furigana over Japanese ones (dual
				// rendering applies each to its own lines, so a mixed
				// message reads end to end instead of favoring Japanese).
				// Same offers the buttons show: refs-stripped display
				// text over the rendered list, never raw stored content.
				const target = viewChat.messages[hoveredIdx];
				const kinds = target
					? offeredLocalAids(aidDisplayText(target.content), activeReplyCode)
					: [];
				if (target && kinds.length > 0) {
					consumeEvent(event);
					const { pin, unpin } = toggleAidKinds(kinds, pinnedKinds(target.id));
					for (const kind of unpin) unpinLocalAid(target, kind);
					for (const kind of pin) pinLocalAid(target, kind);
					return;
				}
			}
			if (msgAction === "pin-pinyin" || msgAction === "pin-furigana") {
				// M pins pinyin, N pins furigana on the message in the
				// middle of the screen (toggle — a second press lifts it).
				// Kinds the center message doesn't offer stay off, exactly
				// like A on an unoffered hover. The token names the kind,
				// so the body never re-reads the key.
				const idx = centerMessageIndex();
				const target = idx >= 0 ? viewChat.messages[idx] : undefined;
				const want: LocalAid =
					msgAction === "pin-pinyin" ? "pinyin" : "furigana";
				const toggle = target
					? toggleSingleAid(
							offeredLocalAids(aidDisplayText(target.content), activeReplyCode),
							pinnedKinds(target.id),
							want
						)
					: null;
				if (target && toggle !== null) {
					consumeEvent(event);
					if (toggle === "unpin") unpinLocalAid(target, want);
					else pinLocalAid(target, want);
					return;
				}
			}
			if (msgAction === "exit-fullscreen") {
				// Esc+f exits fullscreen — the only way out. Escape
				// alone never exits (it keeps its dismiss job).
				consumeEvent(event);
				escDownAt = 0;
				void exitFullscreen();
				return;
			}
			if (msgAction === "fold-hovered") {
				// F folds/unfolds the hovered message. The prompt owns
				// keystrokes inside it, so typing "f" there is untouched.
				const target = chat.messages[hoveredIdx];
				if (target) {
					event.preventDefault();
					toggleFold(target.id);
					return;
				}
			}
			if (msgAction === "edit-hovered") {
				// E pulls the hovered own message into the composer for
				// editing — same ownership rule as F, own messages only.
				if (canEditMessage(chat.messages, hoveredIdx)) {
					event.preventDefault();
					editMessage(hoveredIdx);
					return;
				}
			}
			if (msgAction === "cut-hovered") {
				// X cuts the hovered message (copies, then deletes): Shift+D
				// below deletes without touching the clipboard.
				// An in-place code edit owns its keystrokes — X types x.
				event.preventDefault();
				cutHoverMessage(hoveredIdx);
				return;
			}
			if (msgAction === "delete-hovered") {
				// Shift+D drops the hovered message and copies nothing
				// (X is the cut key). Bare Delete never deletes — too easy
				// to hit while reading. Physical code, so any layout's D
				// works. Buttons and links keep their own keys.
				event.preventDefault();
				const doomed = chat.messages[hoveredIdx];
				if (doomed) stopAudioForMessage(doomed.id);
				deleteMessage(chatState, hoveredIdx);
				return;
			}
			if (msgAction === "copy-hovered") {
				// C copies the hovered message as plain text (the row
				// button's own path, toast included) — only with nothing
				// selected, so a live selection keeps its keys.
				const target = viewChat.messages[hoveredIdx];
				if (target) {
					consumeEvent(event);
					copyText(target.content, target.role);
					return;
				}
			}
			if (msgAction === "branch-hovered") {
				// Shift+C branches from the hovered message, same as its
				// row button.
				const target = viewChat.messages[hoveredIdx];
				if (target) {
					consumeEvent(event);
					branchFrom(chatState, hoveredIdx);
					return;
				}
			}
			if (msgAction === "speak-hovered") {
				// Shift+R reads the hovered message aloud (Stop when it is
				// the one playing) — the row button's toggle, gated the
				// same way, so languageless text stays silent.
				const target = viewChat.messages[hoveredIdx];
				if (target && messageSpeakable(target)) {
					consumeEvent(event);
					if (messageSpeaking(target)) stopVoice();
					else void speakReply(target);
					return;
				}
			}
			if (
				msgAction === "speak-word" ||
				msgAction === "speak-sentence" ||
				msgAction === "speak-paragraph"
			) {
				// Shift+W/S/P read the word, sentence, paragraph under
				// the mouse point (off-text points buzz, like the menu's
				// empty-tap path). No point yet (keyboard-only so far)
				// buzzes too — there is nothing to resolve.
				consumeEvent(event);
				if (!lastHoverClient) {
					buzzNo();
					return;
				}
				speakUnitAtPoint(
					lastHoverClient.x,
					lastHoverClient.y,
					msgAction === "speak-word"
						? "word"
						: msgAction === "speak-sentence"
							? "sentence"
							: "paragraph"
				);
				return;
			}
			// One snapshot for the open chat list (see sidebarListAction):
			// it owns j/k/space/l/Delete with preview-as-you-go. Bodies
			// stay here as `if (sideAction === ...)` chains, never a switch.
			const inSidebar = isSidebarTarget(event.target);
			if (isFieldTarget(event.target)) {
				focusLog("key-in-field", {
					key: event.key,
					target: describeFocusTarget(event.target),
					active: describeActiveElement(),
					focusMode,
					promptIdle
				});
			}
			const sideAction = sidebarListAction({
				...keyFacts(event),
				listOpen: !settings.sidebarCollapsed,
				inSidebar,
				inField: isFieldTarget(event.target),
				inChatRow: isChatRowTarget(event.target)
			});
			if (sideAction !== null) {
				focusLog("key-sidebar-consume", {
					key: event.key,
					action: sideAction,
					target: describeFocusTarget(event.target),
					active: describeActiveElement()
				});
			}
			if (sideAction === "walk-down" || sideAction === "walk-up") {
				// Walking switches to each chat (preview-as-you-go).
				event.preventDefault();
				const delta = sideAction === "walk-down" ? 1 : -1;
				const chats = chatState.chats;
				const from =
					sideIdx >= 0
						? sideIdx
						: chats.findIndex((c) => c.id === chatState.activeChatId);
				focusSideChat(from + delta);
				const landed = chats[Math.min(Math.max(sideIdx, 0), chats.length - 1)];
				if (landed) transitionToChat(landed.id);
				return;
			}
			if (sideAction === "enter") {
				// Space would click the focused button by default; take
				// it over so entering always lands in the prompt
				// (resolveSidebarSpaceEnter: nothing selected stays
				// on the current chat, never the top one).
				event.preventDefault();
				settings.sidebarCollapsed = true;
				persistSettings();
				if (
					resolveSidebarSpaceEnter(sideIdx, chatState.chats.length).kind ===
					"stay"
				) {
					enterEditMode();
				} else enterSideChat();
				return;
			}
			if (sideAction === "delete-chat") {
				// Delete drops the focused chat and lands on the one
				// below (or a fresh blank when the list empties).
				event.preventDefault();
				deleteSideChat();
				return;
			}
			// Bare Space never changes modes: it belongs to typing and
			// buttons, scrolls natively everywhere else, and summons
			// the hidden prompt through the key path above — scroll
			// mode is entered with Ctrl+G only.
			if (
				scrollEnterAction({
					...keyFacts(event),
					inScrollMode: focusMode === "scroll",
					inEditor: inEditor !== null,
					androidUI,
					shortcutsOpen,
					searchOpen: palette.open,
					inspectOpen: inspectChar !== null,
					inOwnedTarget: isScrollEnterOwnedTarget(event.target)
				})
			) {
				// Ctrl+G outside the composer enters scroll mode at the
				// current message in view (scroll → edit stays on the
				// branch below, like I).
				event.preventDefault();
				scrollToViewCursor();
				return;
			}
			const modalScroll = modalScrollAction({
				...keyFacts(event),
				shortcutsOpen,
				searchOpen: palette.open,
				inspectOpen: inspectChar !== null,
				inEditor: inEditor !== null,
				androidUI,
				inEditable: isEditableTarget(event.target)
			});
			if (modalScroll !== null) {
				// The shortcuts modal scrolls under j/k like the main
				// chat, contained: the palette and Inspect keep their own
				// keys, fields keep typing, and the main column never moves.
				const modalBox =
					document.querySelector<HTMLElement>(".modal-veil .modal");
				if (modalBox) {
					const dy =
						modalScroll === "line-down"
							? SCROLLKEY_LINE_PX
							: -SCROLLKEY_LINE_PX;
					consumeEvent(event);
					modalBox.scrollBy({ top: dy, behavior: "smooth" });
					return;
				}
			}
			if (focusMode !== "scroll" && !inEditor && !androidUI) {
				// Desktop scrolling with nothing selected: no message
				// selected (edit mode), no sidebar focus, no modal
				// owning the screen, and no typing target under the
				// key. Every existing binding above keeps its keys —
				// this branch only claims otherwise-unbound bare keys.
				const modalOpen = Boolean(shortcutsOpen || palette.open || inspectChar);
				const typing = Boolean(
					inEditor || isEditableTarget(event.target) || inSidebar
				);
				// Ctrl+U/D jumps and empty-chat Space/Enter/i (see
				// unselectedScrollAction); the intent glide below keeps
				// its own guard and extracted call.
				const unselected = unselectedScrollAction({
					...keyFacts(event),
					scrollable: true,
					modalOpen,
					typing,
					findOpen: find.open,
					emptyPromptSpace: keyFocusesEmptyPrompt({
						...keyFacts(event),
						messageCount: viewChat.messages.length,
						inInteractive: isSpaceInteractiveTarget(event.target)
					}),
					hasScrollBox: scrollBox !== undefined
				});
				if (unselected === "half-jump-up" || unselected === "half-jump-down") {
					// Ctrl+U / Ctrl+D jump an instant half-page, vim-style
					// (repeats jump again) — including with nothing selected.
					// Bare d/u fast-scroll instead (desktop) or stay dead
					// (phones); other ctrl chords keep theirs.
					event.preventDefault();
					lastGAt = 0;
					if (scrollBox) {
						scrollChatBy(
							halfPageDy(
								scrollBox.clientHeight,
								unselected === "half-jump-up" ? -1 : 1
							)
						);
					}
					return;
				}
				if (unselected === "empty-enter") {
					event.preventDefault();
					lastGAt = 0;
					enterEditMode();
					return;
				}
				if (
					!modalOpen &&
					!typing &&
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey
				) {
					const intent = unselectedScrollIntent(
						event.key,
						ggArmed(lastGAt, Date.now())
					);
					if (intent) {
						if (intent.kind === "gg-prefix") {
							lastGAt = Date.now();
						} else {
							lastGAt = 0;
							if (
								intent.kind === "line" ||
								intent.kind === "half-page" ||
								intent.kind === "skip"
							) {
								// Bare d/u stay dead on phones (touch owns
								// scrolling there); desktop skips a smooth
								// fixed step per tap and glides fast while
								// held — never an instant jump.
								if (intent.kind === "half-page" && androidUI) {
									event.preventDefault();
									return;
								}
								// Held keys glide via the rAF loop (no restart
								// stutter); the loop owns repeats until keyup.
								// Other line sources (arrows) keep stepping.
								// Taps land the hold's own step (line for
								// j/k, skip step for d/u).
								const velocity = scrollBox
									? scrollHoldVelocity(event.key)
									: null;
								if (velocity !== null) {
									if (!event.repeat && scrollBox) {
										// Fixed steps ride the text size (see
										// scaleScrollPx); half-pages stay
										// viewport-based.
										const step = settings.fontScale;
										const tapDy =
											intent.kind === "half-page"
												? halfPageDy(scrollBox.clientHeight, intent.dir)
												: intent.kind === "skip"
													? scaleScrollPx(
															intent.dir * SCROLLKEY_SKIP_PX,
															step
														)
													: Math.sign(velocity) *
														scaleScrollPx(SCROLLKEY_LINE_PX, step);
										startScrollHold(
											event.key,
											scaleScrollPx(velocity, step),
											tapDy
										);
									}
								} else if (intent.kind === "line")
									scrollChatBy(scaleScrollPx(intent.dy, settings.fontScale));
								else if (scrollBox)
									scrollChatBy(halfPageDy(scrollBox.clientHeight, intent.dir));
							} else if (intent.kind === "top") scrollChatTop();
							else if (intent.kind === "bottom") scrollChatBottom();
							else if (intent.kind === "hovered-edge" && hoveredIdx >= 0) {
								scrollHoveredEdge(intent.edge);
							} else return;
						}
						event.preventDefault();
						return;
					}
					lastGAt = 0;
				}
			}
			// One snapshot for the scroll-mode tail (see scrollModeAction):
			// `lastGAt` bookkeeping and every scroll effect stay here as
			// `if` chains, never a switch.
			const scrollAction = scrollModeAction({
				...keyFacts(event),
				phoneUI: androidUI,
				inScrollMode: focusMode === "scroll",
				inEditor: inEditor !== null,
				inFind: isFindBarTarget(event.target),
				inField: isFieldTarget(event.target),
				inInteractive: isInteractiveTarget(event.target),
				gArmed: ggArmed(lastGAt, Date.now()),
				atNewest: selectedIdx >= chat.messages.length - 1,
				scrollFromPrompt
			});
			if (scrollAction === null) {
				if (focusMode !== "scroll" || inEditor) return;
				if (isFindBarTarget(event.target)) return;
				return;
			}
			focusLog("key-scroll-consume", {
				key: event.key,
				action: scrollAction,
				target: describeFocusTarget(event.target),
				active: describeActiveElement(),
				focusMode
			});
			if (scrollAction === "arm-g") {
				// A lone g starts the gg beat without consuming the key.
				lastGAt = Date.now();
				return;
			}
			if (scrollAction === "step-down") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(selectedIdx + 1);
				return;
			}
			if (scrollAction === "step-up") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(Math.max(selectedIdx - 1, 0));
				return;
			}
			if (scrollAction === "go-top") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(0);
				return;
			}
			if (scrollAction === "go-bottom") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(chat.messages.length - 1);
				return;
			}
			if (
				scrollAction === "half-jump-up" ||
				scrollAction === "half-jump-down"
			) {
				// Ctrl+U / Ctrl+D jump one instant half-page per press,
				// vim-style (repeats jump again). Shift+D keeps its
				// delete job above.
				event.preventDefault();
				lastGAt = 0;
				const dir: 1 | -1 = scrollAction === "half-jump-up" ? -1 : 1;
				if (scrollBox) scrollChatBy(halfPageDy(scrollBox.clientHeight, dir));
				return;
			}
			if (scrollAction === "skip-down" || scrollAction === "skip-up") {
				// Bare d/u taps skip one smooth fixed step (a little,
				// never a half-page); holds glide with the same ramp as
				// unselected — repeats belong to the loop, never restart
				// it (that would reset the ramp and stutter).
				event.preventDefault();
				lastGAt = 0;
				const dir: 1 | -1 = scrollAction === "skip-up" ? -1 : 1;
				if (scrollBox && !event.repeat) {
					const velocity = scrollHoldVelocity(event.key);
					const skipDy = scaleScrollPx(
						dir * SCROLLKEY_SKIP_PX,
						settings.fontScale
					);
					if (velocity !== null)
						startScrollHold(
							event.key,
							scaleScrollPx(velocity, settings.fontScale),
							skipDy
						);
					else scrollChatBy(skipDy);
				}
				return;
			}
			if (scrollAction === "enter-edit") {
				event.preventDefault();
				lastGAt = 0;
				enterEditMode();
				return;
			}
			if (scrollAction === "scroll-toggle") {
				// Ctrl+G returns to a focused, type-ready composer only
				// when scroll mode started there (the editor keymap
				// handles edit → scroll). Entering from a deactivated
				// prompt steps back out instead. Either way swallow the
				// chord: the browser would open find-next.
				event.preventDefault();
				lastGAt = 0;
				if (scrollFromPrompt) enterEditMode();
				else exitScrollMode();
				return;
			}
		};
		const onFocusIn = (event: FocusEvent) => {
			focusLog("focusin", {
				target: describeFocusTarget(event.target),
				active: describeActiveElement(),
				focusMode
			});
			if (closestFromTarget(event.target, ".ta-input")) {
				focusMode = "edit";
				// A frame later, like the annotation pill paths: the
				// pan lands with or just after the focus event.
				void tick().then(repinThreadBehindPromptFocus);
			}
		};
		/** Thread position stamped on a composer press (the focus pan
		reads it back). Null outside composer presses. */
		let promptPressSt: { sx: number; sy: number; st: number } | null = null;
		/**
		 * Phones re-pin the thread behind composer focus: the WebView
		 * pans on textbox focus (same quirk the annotation pill paths
		 * work around), snapping the thread even though the
		 * bottom-docked field was already visible — worst mid keyboard
		 * transition, when the pan targets stale geometry and the
		 * thread jumps, the keyboard covers, and the native resize
		 * jumps again. Restore only when the field landed on screen;
		 * a genuinely hidden field keeps its browser scroll.
		 */
		function repinThreadBehindPromptFocus(): void {
			if (!androidUI || !promptPressSt) return;
			const { sx, sy, st } = promptPressSt;
			promptPressSt = null;
			const field = document.querySelector(".prompt .ta-input");
			const box = scrollBox;
			if (!(field instanceof HTMLElement) || !box || !window.visualViewport)
				return;
			const r = field.getBoundingClientRect();
			const vv = window.visualViewport;
			if (r.top < 0 || r.left < 0 || r.bottom > vv.height || r.right > vv.width)
				return;
			if (window.scrollX !== sx || window.scrollY !== sy)
				window.scrollTo(sx, sy);
			if (box.scrollTop !== st) box.scrollTop = st;
		}
		// Badge press switches the edit box directly (A → B in one
		// click). Mousedown with preventDefault runs before the open
		// textarea's blur-save can fire, so the current pop saves and
		// the next opens synchronously — no re-stamp race eats the
		// press. The delegated click in MessageBody stays as the
		// keyboard path (Enter). Desktop Chrome eats the click that
		// trails a preventDefaulted mousedown, but iOS Safari fires
		// it — without the press stamp below, every tap opens the
		// menu on mousedown and toggles it straight shut on click.
		const onBadgePress = (event: MouseEvent) => {
			if (event.button !== 0) return;
			const target = event.target instanceof Element ? event.target : null;
			const badge = target?.closest<HTMLElement>("[data-ann-badge]");
			if (!badge) return;
			event.preventDefault();
			const id = (badge.dataset.annBadge ?? "") as AnnotationId;
			// A re-press toggles closed (cancel): saving first would
			// restart the fade the toggle is about to cancel.
			if (!(annPop && !annPopClosing && annPop.id === id)) saveAnnPop();
			// Same boundary as MessageBody's badge click: stamped ids.
			// The press point anchors the desktop edit menu; phones
			// edit in the composer and ignore it.
			focusLog("badge-press", { id, active: describeActiveElement() });
			openBadge(id, { x: event.clientX, y: event.clientY });
			lastBadgePress = { id, at: Date.now() };
		};
		/**
		 * Click-off closes the annotations review (desktop): a press
		 * outside the pill/card unpins it. Presses inside .ann-wrap
		 * (pill toggle, quote jumps, edit buttons) keep their own
		 * behavior; phones keep tap-driven flow and skip this.
		 */
		const dismissReview = (event: MouseEvent) => {
			if (event.button !== 0 || androidUI || !reviewOpen) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(".ann-wrap")) return;
			reviewOpen = false;
			editingId = null;
		};
		// Double-click summons the menu for the native word pick (the
		// pick finalizes after mouseup, so mouseup alone never sees it).
		// Triple-click keeps native paragraph selection: badges are
		// absolutely-positioned overlays with user-select:none, so they
		// no longer interrupt it the way inline marks did.
		const clickGuardsPass = (event: MouseEvent): boolean => {
			if (event.altKey) return false;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(".sel-menu, .review, button, input, textarea")) {
				return false;
			}
			return true;
		};
		/**
		 * Middle-click toggles the shortcuts modal from anywhere
		 * (links included — the app has no external links worth a
		 * new tab): open when closed, close when open. Either way
		 * it interrupts speech like Esc does — a modal over talking
		 * is never what the click meant.
		 */
		const onMiddleClick = (event: MouseEvent) => {
			if (event.button !== 1) return;
			// A middle-drag just acted: the release is the gesture's
			// end, never a shortcuts toggle.
			if (midDragged) {
				midDragged = false;
				midDown = null;
				midActed = false;
				return;
			}
			event.preventDefault();
			shortcutsOpen = !shortcutsOpen;
			stopVoice();
		};
		const onDoubleClick = (event: MouseEvent) => {
			if (!clickGuardsPass(event)) return;
			const live = window.getSelection();
			if (live) lockSelectionToMessage(live, articleOf);
			// Word picks at a line's end grab the trailing newline,
			// painting the line beneath (same terminator as triple-click
			// paragraph picks, which trims in onSelectEnd instead).
			if (live && live.rangeCount > 0) {
				try {
					trimParagraphTerminator(live.getRangeAt(0));
				} catch {
					// Cosmetic: the untrimmed pick still summons.
				}
			}
			placeSelMenu(event.clientX, event.clientY);
			if (androidUI) scrollActionsIntoView(event);
		};
		/**
		 * Double-tapping a message whose action row is off-screen
		 * scrolls the row into view: its buttons live below the fold
		 * and a phone has no hover to reveal them. Rows already
		 * visible never move (nearest), and desktop keeps word-select
		 * only. Own and assistant rows share the .actions class.
		 */
		const scrollActionsIntoView = (event: MouseEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			const actions = target?.closest("article")?.querySelector(".actions");
			const box = scrollBox;
			if (!(actions instanceof HTMLElement) || !(box instanceof HTMLElement))
				return;
			const row = actions.getBoundingClientRect();
			const view = box.getBoundingClientRect();
			if (row.bottom > view.bottom || row.top < view.top) {
				actions.scrollIntoView({ block: "nearest", behavior: "smooth" });
			}
		};
		// No triple-click handler: native paragraph selection finalizes
		// on the third mouseup, where onSelectEnd already locks it to the
		// message and summons the menu.
		// Selection text at the last mousedown: a mouseup that changed
		// nothing started on blank space, so a stale highlight is dropped
		// instead of re-summoning the menu.
		let downSel = "";
		const snapSelection = (): void => {
			downSel = window.getSelection()?.toString() ?? "";
		};
		/**
		 * A press that starts outside message text must not eat a live
		 * highlight: dragging in from the gutter would otherwise collapse
		 * the selection at press time, before mouseup ever sees it. Only
		 * dead chrome qualifies — the prompt, sidebars, and controls keep
		 * their native press behavior (clicks still fire everywhere;
		 * this only skips the selection reset).
		 */
		const preserveMessageHighlight = (event: MouseEvent): void => {
			if (event.button !== 0) return;
			const target = event.target instanceof Element ? event.target : null;
			if (!target?.closest("main") || target.closest(".rendered, .prompt"))
				return;
			const live = window.getSelection();
			const anchor =
				live && !live.isCollapsed
					? live.anchorNode instanceof Element
						? live.anchorNode
						: live.anchorNode?.parentElement
					: null;
			if (!anchor?.closest(".messages .rendered")) return;
			event.preventDefault();
		};
		/** Press point for the drag-vs-click read in onMouseUp below. */
		let downClient: { x: number; y: number } | null = null;
		const noteDownPoint = (event: MouseEvent): void => {
			downClient =
				event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
		};
		/**
		 * Middle-drag on a message: press (button 1) records the point
		 * and owning message; a horizontal run folds it, a vertical run
		 * switches chats (up older, down newer). One action per press —
		 * `midActed` latches so a long stroke never folds twice. Below
		 * the arming distance the press stays a click and auxclick keeps
		 * its shortcuts toggle (see onMiddleClick); `midDragged` tells
		 * it to stand down instead.
		 */
		let midDown: { x: number; y: number; id: ChatMsgId } | null = null;
		let midDragged = false;
		let midActed = false;
		const noteMiddleDown = (event: MouseEvent): void => {
			midDown = null;
			midDragged = false;
			midActed = false;
			if (event.button !== 1) return;
			const target = event.target instanceof Element ? event.target : null;
			if (
				!target ||
				target.closest(
					"button, a, input, textarea, select, summary, [contenteditable], .prompt, aside, .modal"
				)
			)
				return;
			const article = target.closest('article[id^="msg-"]');
			if (!article) return;
			const index = Number(article.id.slice(4));
			const id = chat.messages[index]?.id;
			if (!id) return;
			midDown = { x: event.clientX, y: event.clientY, id };
		};
		const noteMiddleMove = (event: MouseEvent): void => {
			if (!midDown || midActed) return;
			// Middle button held (buttons bitmask 4): a move without it
			// is a stray, never a gesture.
			if ((event.buttons & 4) === 0) return;
			const gesture = middleDragGesture(
				event.clientX - midDown.x,
				event.clientY - midDown.y
			);
			if (!gesture) return;
			midDragged = true;
			midActed = true;
			if (gesture === "fold-message") toggleFold(midDown.id);
			else stepChat(gesture === "older-chat" ? -1 : 1, false);
		};
		/** Release clears an unacted press (the click's auxclick owns
		the toggle and needs no state); an acted drag persists until
		auxclick consumes it above. */
		const clearMiddleDown = (event: MouseEvent): void => {
			if (event.button !== 1 || midDragged) return;
			midDown = null;
			midActed = false;
		};
		/** Latest pointer point (drag-vs-click for the mid-drag
		collapse restore below). Passive, one store per move. */
		let lastMoveClient: { x: number; y: number } | null = null;
		/** Latest window pointer point (keyboard speech chords read
		the word/sentence/paragraph under it): passive, one store per
		move into the component-level cell below, never reactive. */
		const noteHoverPoint = (event: MouseEvent): void => {
			lastHoverClient = { x: event.clientX, y: event.clientY };
		};
		const noteMovePoint = (event: MouseEvent): void => {
			if (!selectingInMessage && !offChatDragArmed) return;
			lastMoveClient = { x: event.clientX, y: event.clientY };
			// Silent engine collapses (no selectionchange fires) get
			// restored here, synchronously before paint; evented ones
			// go through trimMessageDrag below. Plain lets only — no
			// re-render for pointer travel.
			const live = window.getSelection();
			if (live) {
				restoreDragSelection(live);
				trackDragSelection(live);
			}
		};
		// A drag that starts in message text never highlights its
		// neighbors: while the button is down, any selection escaping
		// the anchor article trims back live (mouseup's lock only fixed
		// it after the fact, flashing two messages blue mid-drag).
		let selectingInMessage = false;
		// A drag that starts off-chat (gutter, margins, off-screen)
		// never highlights above the cursor's current line: while the
		// button is down, an anchor end outside message text pins back
		// to the focus line's start on every selection change.
		let offChatDragArmed = false;
		// Cross-message drag containment (WebKit): the engine re-anchors
		// a drag into the next selectable block, and the flip fires no
		// selectionchange the lock can see — post-flip both ends sit in
		// one article, so the highlight visibly jumps messages and the
		// quote lands on the wrong one. While a message drag is down,
		// every other article's prose goes unselectable inline (a
		// stylesheet can't reach the child component's .rendered past
		// scoping): the engine clamps at the anchor article's edge
		// instead of flipping, and mouseup's lock only ever sees one
		// article. Always cleared on mouseup/blur — never a resting state.
		let dragAnchorArticle: Element | null = null;
		const containDragTo = (article: Element | null): void => {
			if (dragAnchorArticle === article) return;
			for (const el of document.querySelectorAll("[data-drag-none]")) {
				if (el instanceof HTMLElement) {
					el.style.userSelect = "";
					el.style.removeProperty("-webkit-user-select");
				}
				el.removeAttribute("data-drag-none");
			}
			dragAnchorArticle?.removeAttribute("data-drag-anchor");
			dragAnchorArticle = article;
			if (!article) return;
			article.setAttribute("data-drag-anchor", "1");
			const scope = article.closest(".messages") ?? document;
			for (const prose of scope.querySelectorAll(
				'article[id^="msg-"]:not([data-drag-anchor]) .rendered'
			)) {
				if (prose instanceof HTMLElement) {
					prose.setAttribute("data-drag-none", "1");
					prose.style.userSelect = "none";
					prose.style.setProperty("-webkit-user-select", "none");
				}
			}
		};
		// Last in-article drag selection (nodes + offsets): WebKit folds
		// the whole drag when the focus crosses into unselectable
		// content (gaps, contained articles), collapsing mid-gesture.
		// While the button stays down and moving, that collapse is
		// never intent — put the last good selection back before paint
		// so the highlight freezes at the anchor article's edge instead
		// of vanishing. Clicks never move (>4px, the onMouseUp line),
		// so click-deselect still clears. Nodes are re-checked on every
		// restore (stream swaps detach them).
		let lastGoodDragRange: {
			an: Node;
			ao: number;
			fn: Node;
			fo: number;
		} | null = null;
		const movedSinceDown = (): boolean => {
			if (!downClient || !lastMoveClient) return false;
			return (
				Math.hypot(
					lastMoveClient.x - downClient.x,
					lastMoveClient.y - downClient.y
				) > 4
			);
		};
		const trackDragSelection = (live: Selection): void => {
			if (live.isCollapsed || live.rangeCount === 0) return;
			const anchorNode = live.anchorNode;
			const focusNode = live.focusNode;
			if (!anchorNode || !focusNode) return;
			const anchorArticle = articleOf(anchorNode);
			if (anchorArticle && anchorArticle === dragAnchorArticle) {
				lastGoodDragRange = {
					an: anchorNode,
					ao: live.anchorOffset,
					fn: focusNode,
					fo: live.focusOffset
				};
			}
		};
		const restoreDragSelection = (live: Selection): boolean => {
			if (!live.isCollapsed) return false;
			if (!movedSinceDown() || !lastGoodDragRange) return false;
			// Dragging home to the anchor point cancels: only resurrect
			// collapses stranded outside the anchor article.
			if (articleOf(live.anchorNode) === dragAnchorArticle) return false;
			// Collapses inside the prompt or a control are that
			// gesture's business (editor selections), never the
			// message drag's.
			const collapsedEl =
				live.anchorNode instanceof Element
					? live.anchorNode
					: live.anchorNode?.parentElement;
			if (collapsedEl?.closest("input, textarea")) return false;
			const { an, ao, fn, fo } = lastGoodDragRange;
			if (!document.contains(an) || !document.contains(fn)) {
				lastGoodDragRange = null;
				return false;
			}
			try {
				live.setBaseAndExtent(an, ao, fn, fo);
				return true;
			} catch {
				return false;
			}
		};
		const armMessageDrag = (event: MouseEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			// Clicking off dismisses the pinyin overlay even when the
			// highlight itself lingers (the panel is pointer-transparent,
			// so every press lands outside it). A right-click re-summons
			// through contextmenu right after when it still applies.
			dismissSelPanels();
			selectingInMessage =
				event.button === 0 && !!target?.closest(".messages .rendered");
			offChatDragArmed =
				event.button === 0 && !target?.closest(".messages .rendered");
			lastGoodDragRange = null;
			containDragTo(selectingInMessage ? articleOf(target) : null);
		};
		const trimMessageDrag = (): void => {
			if (selectingInMessage) {
				const live = window.getSelection();
				if (live) {
					restoreDragSelection(live);
					trackDragSelection(live);
					lockSelectionToMessage(live, articleOf);
				}
				return;
			}
			clampOffChatDrag();
			// The readings overlays belong to one highlight: a changed
			// or cleared selection dismisses them (mid-drag leaves them
			// until release, like the menu's own paths).
			if (selPinyin || selFurigana) {
				const now = currentQuote();
				const anchor = selPinyin ?? selFurigana?.[0];
				if (
					!now ||
					!anchor ||
					now.messageId !== anchor.messageId ||
					now.quote !== anchor.quote
				)
					dismissSelPanels();
			}
		};
		// Native OS menu in the prompt and across the settings
		// panel: while a live selection sits inside either, the
		// Activity shows the real OS menu (Copy / Cut / Paste)
		// instead of the empty dummy — selectable labels are only
		// honest with a menu behind them. Native fields hide their
		// range from window.getSelection(), so the focused
		// field's own start/end is read too. The select event covers
		// field selections where selectionchange never fires.
		// Transitions only — handle drags stay silent on the bridge.
		const notePromptSelection = (): void => {
			const live = window.getSelection();
			const focused = document.activeElement;
			let fieldLive = false;
			if (
				focused instanceof HTMLInputElement ||
				focused instanceof HTMLTextAreaElement
			) {
				try {
					fieldLive = fieldSelectionLive(
						focused.selectionStart,
						focused.selectionEnd
					);
				} catch {
					fieldLive = false;
				}
			}
			reportOsMenu(
				[promptEl, settingsEl],
				live?.anchorNode ?? null,
				live?.isCollapsed ?? true,
				undefined,
				fieldLive
			);
		};
		const clampOffChatDrag = (): void => {
			if (!offChatDragArmed) return;
			try {
				const live = window.getSelection();
				if (!live || live.rangeCount === 0) return;
				// Mid-drag engine collapse first (same restore as the
				// in-message path below): WebKit folds the drag when
				// the focus crosses unselectable content.
				restoreDragSelection(live);
				if (live.isCollapsed) return;
				const anchorNode = live.anchorNode;
				const focusNode = live.focusNode;
				if (!anchorNode || !focusNode) return;
				const anchorEl =
					anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
				const focusEl =
					focusNode instanceof Element ? focusNode : focusNode.parentElement;
				if (!focusEl?.closest(".messages .rendered")) return;
				// Anchors in the prompt or a control are their own
				// gesture (editor selections, button presses) — never
				// an off-chat message drag. An anchor stranded in
				// ANOTHER message's prose (first contact grazed it on
				// the way in) re-seats below instead of freezing: the
				// highlight would span messages and mouseup's lock
				// would quote text the pointer never settled on.
				if (anchorEl?.closest("input, textarea")) return;
				if (
					anchorEl?.closest(".messages .rendered") &&
					articleOf(anchorNode) === articleOf(focusNode)
				)
					return;
				// Only the upward side clamps: an anchor below the
				// cursor highlights below it, which is allowed.
				let anchorAbove: boolean;
				if (anchorNode === focusNode)
					anchorAbove = live.anchorOffset < live.focusOffset;
				else {
					anchorAbove = !!(
						anchorNode.compareDocumentPosition(focusNode) &
						Node.DOCUMENT_POSITION_FOLLOWING
					);
				}
				if (!anchorAbove) {
					// An anchor below the cursor is allowed — unless it
					// sits in another message's prose, where mouseup's
					// lock would quote text the pointer never settled
					// on. Re-seat it to the focus line like the upward
					// side; anchors below in non-message content still
					// highlight below them untouched.
					if (
						anchorEl?.closest(".messages .rendered") &&
						articleOf(anchorNode) !== articleOf(focusNode) &&
						focusNode instanceof Text
					) {
						containDragTo(articleOf(focusNode));
						const text = focusNode.textContent ?? "";
						const start = lineStartOffset(text, live.focusOffset);
						live.setBaseAndExtent(
							focusNode,
							start,
							focusNode,
							live.focusOffset
						);
						trackDragSelection(live);
					}
					return;
				}
				// First contact with message text anchors the drag: later
				// moves into other articles clamp at this article's edge
				// instead of flipping the anchor (see containDragTo).
				containDragTo(articleOf(focusNode));
				if (anchorNode instanceof Text && anchorNode === focusNode) {
					const text = anchorNode.textContent ?? "";
					const fixed = clampDragAnchorToFocusLine(
						text,
						live.anchorOffset,
						live.focusOffset
					);
					if (fixed !== live.anchorOffset) {
						live.setBaseAndExtent(
							anchorNode,
							fixed,
							focusNode,
							live.focusOffset
						);
					}
					trackDragSelection(live);
					return;
				}
				// Cross-node: the anchor sits in earlier (or foreign)
				// content — pin it to the cursor line's start inside
				// the focus node, so nothing above that line stays
				// highlighted.
				if (focusNode instanceof Text) {
					const text = focusNode.textContent ?? "";
					const start = lineStartOffset(text, live.focusOffset);
					live.setBaseAndExtent(focusNode, start, focusNode, live.focusOffset);
				}
				trackDragSelection(live);
			} catch {
				// Selection trimming is cosmetic: never break the drag.
			}
		};
		const onMouseUp = (event: MouseEvent) => {
			// Release-restore before the clears below: a drag that died
			// mid-gesture (WebKit folds it crossing unselectable
			// content) summons off its last live selection instead of
			// nothing. Clicks never moved (restore no-ops) so
			// click-deselect still clears; releases outside the chat
			// stay silent (sidebar release = cancel); right-click keeps
			// its speak path.
			const upTarget = event.target instanceof Element ? event.target : null;
			if (event.button !== 2 && upTarget?.closest(".messages")) {
				const liveUp = window.getSelection();
				if (liveUp) restoreDragSelection(liveUp);
			}
			selectingInMessage = false;
			offChatDragArmed = false;
			lastGoodDragRange = null;
			lastMoveClient = null;
			containDragTo(null);
			// Compat mouseup trailing a touch-handled selection: the menu
			// is already up, and the staleness check below would clear it
			// as a no-change click (touchMenuAt lives with the touchend
			// listener above).
			if (Date.now() - touchMenuAt < 800) return;
			// Ignore clicks that start inside the prompt, popups, or buttons —
			// only freshly selected message text summons the menu.
			if (event.button === 2) return; // right-click speaks via contextmenu, never the menu
			// Non-element targets (synthetic document/window events) carry no
			// selection UI — real mouse-ups always target an Element.
			const target = event.target instanceof Element ? event.target : null;
			if (openLangMenu) {
				if (!target?.closest(".lang-menu")) {
					openLangMenu = null;
					// A tap-away never summons: the touchend dead-space
					// branch stands down while a sheet is open, but a
					// timer armed just before the sheet opened (or any
					// ordering edge) dies here instead of popping the
					// keyboard behind the closing menu.
					if (emptyTapTimer) {
						clearTimeout(emptyTapTimer);
						emptyTapTimer = null;
					}
				}
			}
			if (
				target?.closest(
					".sel-menu, .ann-dock, .review, button, input, textarea"
				)
			) {
				// Clicking away into the prompt or a control clears the
				// highlight and drops the menu with it — but never the
				// menu's own clicks: the Annotate button's click fires
				// after this mouseup (the phone composer's docked twin
				// included). Drags ending on a control keep the old path
				// (a selection drawn across into a button still summons).
				if (!target?.closest(".sel-menu, .ann-dock")) {
					const endedDrag = downClient
						? Math.hypot(
								event.clientX - downClient.x,
								event.clientY - downClient.y
							) > 4
						: false;
					if (!endedDrag) {
						focusLog("mouseup-clear-on-control", {
							target: describeFocusTarget(event.target),
							active: describeActiveElement()
						});
						// WebKit: clearing the selection on mouseup after a
						// field took focus destroys the just-placed caret —
						// later keystrokes dispatch yet never become text
						// (see mouseupKeepsSelection: clicks into editables
						// already moved the selection there, and presses
						// that keep field focus keep a live caret too).
						if (!mouseupKeepsSelection(event.target, document.activeElement)) {
							window.getSelection()?.removeAllRanges();
						}
						selMenu = null;
					} else if ((window.getSelection()?.toString() ?? "") === "") {
						selMenu = null;
					}
				}
				return;
			}
			const live = window.getSelection();
			const liveText = live?.toString() ?? "";
			// Clicks clear stale highlights; drags never do — a press in
			// the gutter that travels into the chat keeps the highlight
			// it started with (the press itself is preserved above).
			const dragged = downClient
				? Math.hypot(
						event.clientX - downClient.x,
						event.clientY - downClient.y
					) > 4
				: false;
			// A plain click anywhere dismisses: the stale-highlight path
			// below clears it (a changed selection from a multi-click
			// reselect is new work, not a collapse — it falls through to
			// the normal summon path). Escape / the timer still dismiss.
			// Phones exempt a fresh multi-tap run: the double-tap word
			// pick (and the triple/quad sentence/paragraph overrides)
			// land between touchend and this compatibility mouseup, so
			// downSel already includes the fresh pick and the equality
			// below misreads it as "nothing changed" — clearing the
			// word the tap just selected. msgTapSeq only ever counts
			// past one on Android (see the touchend run tracker), so
			// desktop multi-clicks keep the old path untouched.
			if (
				!dragged &&
				liveText === downSel &&
				(event.detail <= 1 || event.detail >= 4) &&
				!multiTapOwnsRelease(msgTapSeq, Date.now())
			) {
				// A plain click changed nothing: blank space, a collapsed
				// caret, or inside the old highlight (the engine collapses
				// that only after mouseup dispatches, so the stale text
				// still reads "selected" here — re-summoning off it is what
				// stranded the menu on a cleared highlight). Drop any stale
				// highlight and never re-summon. Multi-click sequences
				// (detail 2–3) keep the old path: their picks finalize
				// around these events.
				if (liveText !== "") live?.removeAllRanges();
				selMenu = null;
				return;
			}
			if (
				!dragged &&
				!target?.closest(".rendered") &&
				liveText !== "" &&
				liveText === downSel
			) {
				live?.removeAllRanges();
				selMenu = null;
				return;
			}
			onSelectEnd(event, event.clientX);
		};
		// Word under the cursor, or "" on open space / non-text.
		function wordUnderCursor(event: MouseEvent, body: Element): string {
			let range: Range | null = null;
			try {
				if (typeof document.caretRangeFromPoint === "function") {
					range = document.caretRangeFromPoint(event.clientX, event.clientY);
				}
			} catch {
				range = null;
			}
			const node = range?.startContainer;
			if (!node || node.nodeType !== Node.TEXT_NODE || !body.contains(node))
				return "";
			const text = node.textContent ?? "";
			const offset = range?.startOffset ?? 0;
			// Caret snapped past the text (open-space click resolving
			// to a node edge): only retry inside the char when the
			// point is actually over the text — far padding is message
			// space, not the edge word (the touch double-tap path
			// keeps its own retry in wordAtNodeOffset, which has no
			// point to check).
			if ((offset >= text.length || offset <= 0) && text.length > 0) {
				try {
					const edge = document.createRange();
					if (offset >= text.length) {
						edge.setStart(node, text.length - 1);
						edge.setEnd(node, text.length);
						if (event.clientX > edge.getBoundingClientRect().right + 2)
							return "";
					} else {
						edge.setStart(node, 0);
						edge.setEnd(node, 1);
						if (event.clientX < edge.getBoundingClientRect().left - 2)
							return "";
					}
				} catch {
					// Unmeasurable edge: fall through to the word retry.
				}
			}
			// Node-edge landings (a click on a glyph's far edge
			// resolving past it) retry inside the char.
			return wordAtNodeOffset(text, offset);
		}
		// Desktop right-click reads aloud (the selection, else the word
		// under the cursor, else the whole message; a second
		// right-click restarts it, never stops it) AND opens the
		// native menu: no preventDefault here, so Copy stays
		// available beside speech.
		// (Android long-press never starts audio — it summons the menu.)
		const onContextMenu = (event: MouseEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			// The native menu never appears on desktop: right-click
			// belongs to the app (speech, folds), never the webview.
			// preventDefault suppresses only the native menu — every
			// branch below still runs. Editable fields keep theirs
			// (spellcheck, copy/paste), and phones keep the long-press
			// native callout on purpose (see below).
			if (!androidUI && !isFieldTarget(event.target)) event.preventDefault();
			// Android long-press fires contextmenu mid-hold, before
			// touchend: summon the menu off the live selection and
			// consume the event, so the native callout never appears
			// beside ours. The selection (and its handles) stay live
			// for handle-dragging; the lift below drops the highlight
			// once the quote is stored.
			if (androidUI && target?.closest(".messages .rendered")) {
				event.preventDefault();
				if (currentQuote()) {
					placeSelMenu(event.clientX, event.clientY);
					touchMenuAt = Date.now();
				}
				return;
			}
			if (androidUI) return;
			const body = target?.closest(".messages .rendered");
			if (!body) return;
			// Code comes before the control check below on purpose: the
			// copy icon is a button, but a code block (body or folded
			// label) toggles its fold here, never speech. Headless
			// chrome has no fold bar, so the wrapper toggles directly;
			// the copy and Run icons stay silent via the control check.
			const codeBlock = closestFromTarget(event.target, ".ccez-code");
			if (
				codeBlock &&
				body.contains(codeBlock) &&
				!target?.closest("[data-code-copy], [data-code-run]")
			) {
				// Right-click toggles the fold (a left click on the
				// folded label opens it back up).
				if (codeBlock.dataset.folded === "1")
					codeBlock.removeAttribute("data-folded");
				else codeBlock.dataset.folded = "1";
				return;
			}
			// Display math folds the same way. Inline math has no
			// body chrome, so it falls through to speech below.
			const mathWrap = closestFromTarget(event.target, "[data-math-index]");
			if (
				mathWrap &&
				body.contains(mathWrap) &&
				mathWrap.classList.contains("ccez-math") &&
				!target?.closest(".ccez-math-copy, .ccez-math-tex")
			) {
				if (mathWrap.dataset.folded === "1")
					mathWrap.removeAttribute("data-folded");
				else mathWrap.dataset.folded = "1";
				return;
			}
			// Controls and links inside messages stay silent.
			if (target?.closest("button, input, textarea, a, summary")) return;
			// Highlighted text wins: a right-click with a live message
			// selection reads the whole selection (same per-quote
			// language as the sel-menu button). When the highlight
			// contains Han it also shows readings for just the
			// highlight — pinyin in Chinese text, furigana in
			// Japanese (per-kanji runs, so mixed selections like
			// 咲き誇り map back) — speech always runs; the panel is
			// a silent extra. Like Inspect, a lone Han char reads
			// its locale from the surrounding sentence.
			const quoted = currentQuote();
			if (quoted) {
				const probe =
					sentenceForQuote(quoted.context, quoted.quote) ?? quoted.context;
				if ([...quoted.quote].some((ch) => isHanChar(ch))) {
					if (
						hanOverlayLangFor(probe) !== "ja" &&
						offeredLocalAids(quoted.quote, activeReplyCode).includes("pinyin")
					) {
						const readings = readingsOnly(pinyinRuby(quoted.quote), " ", "rt");
						if (readings) placeSelPinyin(quoted, readings);
					} else if (hanOverlayLangFor(probe) === "ja") {
						// Speech waits for the sentence-correct kana: the
						// raw kanji would read with default guesses.
						void (async () => {
							const kana = await showSelectionFurigana(quoted);
							void speakQuote(
								kana ?? quoted.quote,
								quoted.messageId,
								false,
								quoted.context
							);
						})();
						return;
					}
				}
				void speakQuote(quoted.quote, quoted.messageId, false, quoted.context);
				return;
			}
			// No selection: a word under the cursor reads just that word
			// (same per-quote path as a selection); open message space
			// reads the whole message. speakReply gates the voice.
			const article = body.closest('article[id^="msg-"]');
			const msg = article
				? chat.messages[Number(article.id.slice(4))]
				: undefined;
			if (!msg) return;
			const word = wordUnderCursor(event, body);
			if (word) {
				void speakQuote(word, msg.id, false, speechText(msg.content));
				return;
			}
			void speakReply(msg);
		};
		// Holding Option morphs the send button into "Add +" (stage).
		const onAlt = (event: KeyboardEvent) => {
			if (event.key === "Alt") altHeld = event.type === "keydown";
		};
		/**
		 * Escape keyup: a HOLD past the threshold exits fullscreen; a
		 * tap does nothing here (the keydown path above already
		 * dismissed menus/overlays exactly as today).
		 */
		const onEscapeUp = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// A 2s hold exits fullscreen (tap never does — keydown above
			// already dismissed exactly as today). Device-only path, like
			// the Esc+f chord: no window chrome here, no observable effect.
			if (isEscapeHold(escDownAt, Date.now())) void exitFullscreen();
			escDownAt = 0;
		};
		const onBlur = () => {
			altHeld = false;
			escDownAt = 0;
			stopScrollHold();
			// A drag released off-window never sees mouseup: drop the
			// containment so prose stays selectable on return.
			lastGoodDragRange = null;
			lastMoveClient = null;
			containDragTo(null);
		};
		// Coming back to the window lands you in the prompt (pill box when
		// annotating), so Tab continues from there. Never yank focus out of
		// a field that already holds it.
		const onWinFocus = () => {
			// Back from background: the reply was seen, drop its badge.
			clearStudyBadge();
			const active = document.activeElement;
			if (
				active &&
				active !== document.body &&
				document.contains(active) &&
				(active.tagName === "INPUT" ||
					active.tagName === "TEXTAREA" ||
					active.tagName === "SELECT" ||
					(active instanceof HTMLElement && active.isContentEditable))
			) {
				return;
			}
			if (annPop && annPopBox) annPopBox.focus({ preventScroll: true });
			else if (settings.promptIdleSec !== PROMPT_IDLE_ALWAYS) {
				// Remeasure first (a no-op for the textarea composer, kept
				// for the interface): occlusion or a DPR change while away
				// can leave layout caches stale. Always-hide mode skips
				// the focus steal: returning to the window must not summon
				// a hidden prompt.
				editor?.remeasure();
				editor?.focus();
			}
		};
		// Web SpeechRecognition is service-blocked inside Tauri
		// shells, so the Mic buttons ride the native recognizer there
		// (macOS and Android have one; Windows and Linux shells hide
		// the buttons instead of toasting an error on every tap).
		canMic = micButtonsShown(
			micAvailable(),
			tauriBackendAvailable(),
			currentPlatform().isMac,
			isAndroidUserAgent(navigator.userAgent),
			isIOSUserAgent(navigator.userAgent)
		);
		// Voice inventory arrives async (slow on phones): the first
		// getVoices() kicks the load, voiceschanged bumps the gates.
		try {
			if (typeof speechSynthesis !== "undefined") {
				speechSynthesis.getVoices();
				speechSynthesis.onvoiceschanged = () => {
					webVoiceVersion++;
				};
				// Already loaded (desktop): still re-render once so the
				// gates read the real inventory, not the first empty one.
				if (speechSynthesis.getVoices().length > 0) webVoiceVersion++;
			}
		} catch {
			// Speech stays gated off, as before.
		}
		window.addEventListener("focus", onWinFocus);
		// Soft-keyboard transitions resize the visual viewport without
		// ever touching the document, and old phone WebViews time
		// resizes unreliably around them — the emptied composer can
		// strand at zero height after send until the next keystroke
		// re-grows it. A settled viewport re-measures up front instead
		// (typing would heal it anyway; this heals it before the next
		// keystroke).
		let viewportTimer: number | undefined;
		let kbPin = pinArmStart();
		let fullInnerHeight = window.innerHeight;
		// Consecutive firmly-closed frames (see kbFreshOpen): a fresh
		// open episode resets to the clean disarmed state.
		let kbClosedFrames = 0;
		const onViewportResize = (): void => {
			// Pin synchronously on every viewport frame: the old trailing
			// debounce let the composer lag a beat behind the keyboard
			// animation, then jump. Only the remeasure stays debounced.
			// Animation frames never engage the pin — only the settle
			// step below does, on stable geometry. Mid-animation the
			// layout height and the visual viewport update at different
			// rates, so engaging here grabs a transitional height and
			// the composer visibly moves twice (settle then releases
			// mid-flight). Frames only release on closed geometry.
			// Phone keyboard without resizes-content: the layout
			// viewport doesn't shrink, so the full-height flex
			// column (and the latest messages) slides under the
			// keyboard with no way to reach it. Pin .app to the
			// visual height while the keyboard is open, and expose
			// the overlap as --kb-height so the composer reflows
			// just above it. Modern Chrome tracks via the viewport
			// meta, so the heights agree and this stays inert — it
			// is the pre-108 fallback. Desktop and keyboard-closed
			// phones keep stylesheet height.
			if (androidUI && appEl && window.visualViewport) {
				const vv = window.visualViewport;
				const overlap = keyboardOverlapPx(window.innerHeight, vv.height);
				const open = isKeyboardOpen(window.innerHeight, vv.height);
				if (kbFreshOpen(kbClosedFrames, open)) {
					// Fresh episode starts clean like the first tap: a
					// leaked armed pin (or a baseline refreshed mid-close)
					// would otherwise engage on transitional heights and
					// move the composer twice. Settle re-arms on stable
					// geometry if the fallback is truly needed.
					kbPin = pinArmStart();
					appEl.style.height = "";
					appEl.style.setProperty("--kb-height", "0px");
				}
				kbClosedFrames = open ? 0 : kbClosedFrames + 1;
				if (!open) {
					// No baseline refresh here: closed frames include the
					// close animation, and stamping a mid-close height as
					// the baseline poisons the next open's settle (native
					// resize reads as full layout, the pin mis-arms).
					// Stable closed settles below own the baseline.
					if (kbPin.armed) {
						kbPin = pinArmStart();
						appEl.style.height = "";
						appEl.style.setProperty("--kb-height", "0px");
					}
				} else if (kbPin.armed) {
					// Settle-armed fallback pin tracks per frame.
					appEl.style.height = `${vv.height}px`;
					appEl.style.setProperty("--kb-height", `${overlap}px`);
				}
			}
			if (viewportTimer !== undefined) window.clearTimeout(viewportTimer);
			viewportTimer = window.setTimeout(() => {
				viewportTimer = undefined;
				// Settle with fresh geometry — the ONLY place the pin
				// engages. Closed geometry releases the pin and refreshes
				// the baseline (rotation-safe). Open geometry with a
				// shrunken layout means the native resize glides: stay
				// disarmed. Open geometry with a full layout is the
				// no-shrink fallback: arm here, on stable heights.
				if (androidUI && appEl && window.visualViewport) {
					const vv = window.visualViewport;
					const overlap = keyboardOverlapPx(window.innerHeight, vv.height);
					// Baseline discipline (see settlePin): a focused
					// editable means the keyboard may be up with both
					// viewports shrunk (reads closed) — grow the
					// baseline only, never stamp the glide low.
					const ae = document.activeElement;
					const editableFocused =
						ae instanceof HTMLElement &&
						ae.closest(
							'textarea, input:not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]'
						) !== null;
					const settled = settlePin(
						kbPin,
						fullInnerHeight,
						window.innerHeight,
						isKeyboardOpen(window.innerHeight, vv.height),
						100,
						!editableFocused
					);
					const wasArmed = kbPin.armed;
					kbPin = settled.pin;
					fullInnerHeight = settled.fullHeight;
					if (kbPin.armed && !wasArmed) {
						appEl.style.height = `${vv.height}px`;
						appEl.style.setProperty("--kb-height", `${overlap}px`);
					} else if (wasArmed && !kbPin.armed) {
						appEl.style.height = "";
						appEl.style.setProperty("--kb-height", "0px");
					}
				}
				editor?.remeasure();
			}, 250);
		};
		window.visualViewport?.addEventListener("resize", onViewportResize);
		window.visualViewport?.addEventListener("scroll", onViewportResize);
		void listenMenuActions();
		void wireDeepLinks();
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("keydown", onAlt);
		window.addEventListener("keyup", onAlt);
		window.addEventListener("keyup", onEscapeUp);
		window.addEventListener("keyup", releaseScrollHold);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focusin", onFocusIn);
		// Stamp the thread position on every composer press (capture:
		// the stamp must predate the focus pan). The focusin guard
		// reads it back a frame after focus lands in the field.
		const onPromptPress = (event: PointerEvent): void => {
			if (!androidUI || event.button !== 0) {
				promptPressSt = null;
				return;
			}
			const target = event.target instanceof Element ? event.target : null;
			if (!target?.closest(".prompt")) {
				promptPressSt = null;
				return;
			}
			promptPressSt = {
				sx: window.scrollX,
				sy: window.scrollY,
				st: scrollBox?.scrollTop ?? 0
			};
		};
		window.addEventListener("pointerdown", onPromptPress, true);
		window.addEventListener("mousedown", dismissReview, true);
		window.addEventListener("mousedown", onBadgePress, true);
		window.addEventListener("mousedown", preserveMessageHighlight, true);
		window.addEventListener("mousedown", snapSelection, true);
		window.addEventListener("mousedown", noteDownPoint, true);
		window.addEventListener("mousedown", armMessageDrag, true);
		window.addEventListener("mousedown", noteMiddleDown, true);
		window.addEventListener("mousemove", noteMovePoint, { passive: true });
		window.addEventListener("mousemove", noteMiddleMove, { passive: true });
		window.addEventListener("mousemove", noteHoverPoint, { passive: true });
		window.addEventListener("mouseup", clearMiddleDown);
		document.addEventListener("selectionchange", trimMessageDrag);
		document.addEventListener("selectionchange", notePromptSelection);
		// Native fields fire select on their own range (capture: the
		// event never bubbles).
		document.addEventListener("select", notePromptSelection, true);
		// Secondary scrollers share the main chat's fade: scroll events
		// don't bubble, so catch them on the way down and toggle the
		// same .scrolling class with the same short hold.
		const fadeTimers = new WeakMap<Element, number>();
		const onFadeScroll = (event: Event) => {
			const box = closestFromTarget(event.target, "[data-fade-scroll]");
			if (!box || box === scrollBox) return;
			box.classList.add("scrolling");
			const pending = fadeTimers.get(box);
			if (pending !== undefined) window.clearTimeout(pending);
			fadeTimers.set(
				box,
				window.setTimeout(() => {
					box.classList.remove("scrolling");
					fadeTimers.delete(box);
				}, 120)
			);
		};
		window.addEventListener("scroll", onFadeScroll, true);
		// The readings overlays track their highlight while it scrolls
		// (same anchor math as placement): a detached or collapsed
		// range dismisses them instead of stranding them. Furigana
		// groups re-resolve their own spans, so multi-line highlights
		// keep each panel glued to its kanji.
		const trackSelPinyin = (): void => {
			if (!selPinyin && !selFurigana) return;
			try {
				const live = window.getSelection();
				if (!live || live.rangeCount === 0 || live.isCollapsed) {
					dismissSelPanels();
					return;
				}
				const range = live.getRangeAt(0);
				if (!document.contains(range.startContainer)) {
					dismissSelPanels();
					return;
				}
				if (selFurigana) {
					const slices = selectionSlices(range);
					const first = selFurigana[0];
					if (!slices || !first) {
						dismissSelPanels();
						return;
					}
					const walkText = slices
						.map((s) => (s.node.textContent ?? "").slice(s.start, s.end))
						.join("");
					const qi = walkText.indexOf(first.quote);
					if (qi < 0) {
						dismissSelPanels();
						return;
					}
					let moved = false;
					const next = selFurigana.map((panel) => {
						const runs = panel.runs;
						const start =
							Math.min(...runs.map((run) => run.start)) + qi;
						const end = Math.max(...runs.map((run) => run.end)) + qi;
						const rect = spanRect(slices, start, end);
						if (!rect) return panel;
						const placed = panelXY(rect);
						if (placed.y !== panel.y || placed.above !== panel.above) {
							moved = true;
							return { ...panel, ...placed };
						}
						return panel;
					});
					if (moved) selFurigana = next;
				}
				if (!selPinyin) return;
				const rect = range.getBoundingClientRect();
				const placed = panelXY(rect);
				if (selPinyin.y !== placed.y || selPinyin.above !== placed.above)
					selPinyin = { ...selPinyin, ...placed };
			} catch {
				dismissSelPanels();
			}
		};
		window.addEventListener("scroll", trackSelPinyin, true);
		window.addEventListener("resize", trackSelPinyin);
		// The selection menu tracks its highlight while it scrolls
		// (same anchor math as the readings overlay above): the stored
		// summon range repositions it cursorlessly, and a detached
		// range dismisses it instead of stranding it. Scrolling never
		// dismisses a live menu — a wheel mid-aim is still aiming,
		// and on phones the native selection outlives the scroll, so
		// the dock does too (collapse still clears it at once).
		const trackSelMenu = (): void => {
			if (!selMenu?.range) return;
			try {
				const { range } = selMenu;
				if (
					!document.contains(range.startContainer) ||
					!document.contains(range.endContainer)
				) {
					selMenu = null;
					return;
				}
				const rect = range.getBoundingClientRect();
				const { x, y } = selMenuPlacement({
					cursorX: undefined,
					cursorY: undefined,
					rectLeft: rect.left,
					rectTop: rect.top,
					rectBottom: rect.bottom,
					rectWidth: rect.width,
					viewportWidth: window.innerWidth,
					viewportHeight: window.innerHeight,
					androidUI,
					iosUI,
					menuWidth: selMenuWidthEstimate(
						selMenu.quote,
						androidUI,
						settings.inspectEnabled
					)
				});
				if (
					selMenu.x !== x ||
					selMenu.y !== y ||
					selMenu.left !== rect.left ||
					selMenu.w !== rect.width
				)
					selMenu = { ...selMenu, x, y, left: rect.left, w: rect.width };
			} catch {
				selMenu = null;
			}
		};
		window.addEventListener("scroll", trackSelMenu, true);
		window.addEventListener("resize", trackSelMenu);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("dblclick", onDoubleClick);
		// Middle-click anywhere opens the shortcuts modal (no autoscroll).
		window.addEventListener("auxclick", onMiddleClick);
		window.addEventListener("contextmenu", onContextMenu, true);
		return () => {
			window.visualViewport?.removeEventListener("resize", onViewportResize);
			window.visualViewport?.removeEventListener("scroll", onViewportResize);
			if (viewportTimer !== undefined) window.clearTimeout(viewportTimer);
			window.removeEventListener("focus", onWinFocus);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("keydown", onAlt);
			window.removeEventListener("keyup", onAlt);
			window.removeEventListener("keyup", onEscapeUp);
			window.removeEventListener("keyup", releaseScrollHold);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focusin", onFocusIn);
			window.removeEventListener("pointerdown", onPromptPress, true);
			window.removeEventListener("mousedown", dismissReview, true);
			window.removeEventListener("mousedown", onBadgePress, true);
			window.removeEventListener("mousedown", preserveMessageHighlight, true);
			window.removeEventListener("mousedown", snapSelection, true);
			window.removeEventListener("mousedown", noteDownPoint, true);
			window.removeEventListener("mousedown", armMessageDrag, true);
			window.removeEventListener("mousedown", noteMiddleDown, true);
			window.removeEventListener("mousemove", noteMovePoint);
			window.removeEventListener("mousemove", noteMiddleMove);
			window.removeEventListener("mousemove", noteHoverPoint);
			window.removeEventListener("mouseup", clearMiddleDown);
			document.removeEventListener("selectionchange", trimMessageDrag);
			document.removeEventListener("selectionchange", notePromptSelection);
			document.removeEventListener("select", notePromptSelection, true);
			window.removeEventListener("scroll", onFadeScroll, true);
			window.removeEventListener("scroll", trackSelPinyin, true);
			window.removeEventListener("resize", trackSelPinyin);
			window.removeEventListener("scroll", trackSelMenu, true);
			window.removeEventListener("resize", trackSelMenu);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("dblclick", onDoubleClick);
			window.removeEventListener("auxclick", onMiddleClick);
			window.removeEventListener("contextmenu", onContextMenu, true);
			window.clearTimeout(viewport.idleTimer);
			stopSpeaking();
			stopNative();
			releaseStudyWake();
			stopDictation?.();
			editor?.destroy();
			editor = null;
		};
	});
</script>

<svelte:head>
	<title>Ccez LLM</title>
	{#if devBuild}
		<!-- Dev builds wear the red-dot logo in the tab so they never
			read as the release build (release keeps the yellow-dot
			favicon.png from app.html). -->
		<link rel="icon" type="image/svg+xml" href="/logo-dev.svg" />
	{/if}
</svelte:head>

<div
	class="app"
	bind:this={appEl}
	data-focus-mode={focusMode}
	data-shell={tauriBackendAvailable() ? "tauri" : "browser"}
	data-android={androidUI || null}
	data-ios={iosUI || null}
	data-fullbleed={(androidUI && settings.fontScale >= FULLBLEED_FONT_SCALE) ||
		null}
	style="--font-scale: {androidUI
		? Math.min(8, settings.fontScale)
		: settings.fontScale}; --chat-width: {effectiveChatWidth(
		androidUI,
		settings.fontScale,
		settings.chatWidth ?? 36
	)}; --msg-gap: {settings.messageGap ?? MESSAGE_GAP_DEFAULT}rem"
	data-mac={(isMac && !androidUI) || null}
>
	<Sidebar
		chats={sideVisibleChats()}
		activeId={chatState.activeChatId}
		collapsed={settings.sidebarCollapsed}
		android={androidUI}
		shell={tauriBackendAvailable()}
		newTitle={tip(
			isMac ? "New chat (⌘N or ⇧⌘N)" : "New chat (Ctrl+N or Ctrl+Shift+N)",
			"New chat"
		)}
		labelFor={chatLabel}
		bind:search={sideSearch}
		bind:searchEl={sideSearchEl}
		actions={{
			collapse: () => {
				settings.sidebarCollapsed = true;
				persistSettings();
			},
			dragWindow,
			zoomWindow,
			focusSearch: focusSideSearch,
			clearSearch: () => {
				sideSearch = "";
				focusSideSearch();
			},
			endPreview,
			previewHover,
			pick: (id: ChatId) => {
				// No preview clear here: transitionToChat clears it
				// inside the transition (clearing first flashes the
				// old chat before landing). A picked chat just closes
				// the list: entering must not summon the composer (a
				// parked prompt stays parked — summoning is one
				// keypress away). Keyboard Enter (enterSideChat) still
				// lands in the prompt; hands are already on keys there.
				sideIdx = chatState.chats.findIndex((c) => c.id === id);
				transitionToChat(id);
				settings.sidebarCollapsed = true;
				persistSettings();
			},
			exportOne: (item: Chat) => void exportOneChat(item),
			drop: (id: ChatId) => {
				dropChat(id);
				requestAnimationFrame(() => focusSideChat(sideIdx));
			},
			tipFor: sideTip,
			newChat: doNewChat,
			openSettings: openSettingsPanel
		}}
	/>

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<!-- Click-off closes the settings panel (keyboard users get Esc and ⌘,). -->
	<main
		class:empty={viewChat.messages.length === 0}
		class:hide-messages={settings.hideMessages}
		class:hide-buttons={settings.hideButtons}
		class:plain-user={!settings.ownBubble}
		class:hover-user={settings.hoverUserActions}
		class:hover-assistant={settings.hoverAssistantActions}
		class:scale-actions={settings.scaleActionsWithFont}
		class:alt={altHeld}
		onpointerdown={noteMainDown}
		onclick={closeSettingsFromMain}
		ondblclick={gutterDoubleClick}
	>
		<!-- Reply-language pills render in `LangMenus.svelte` (hero and
		composer call sites below); the page keeps the open menu, the
		phone sheet anchor, the active code, and the behaviors. -->
		<Toasts {notices} bind:toastAction android={androidUI} />
		<!-- Empty drag strip: nothing but the traffic-light clearance
		(the active reply language shows on the send button instead).
		Double-click zooms. -->
		<header
			role="toolbar"
			aria-label="App"
			tabindex="-1"
			onmousedown={dragWindow}
			ondblclick={zoomWindow}
		></header>

		<!-- In-chat find (Cmd/Ctrl+F): message-level cycling browser-style. -->
		{#if find.open && !androidUI}
			<!-- In-chat find renders in `FindBar.svelte`; the page keeps
			the query/cursor/hits, landing, and focus behind bindables
			and actions. -->
			<FindBar
				bind:query={find.query}
				bind:inputEl={findInputEl}
				hitCount={currentFindHits().length}
				cursor={find.cursor}
				actions={{
					input: () => {
						find.cursor = 0;
						landFindHit();
					},
					enter: (shift: boolean) => stepFind(shift ? -1 : 1),
					step: stepFind,
					close: closeFind
				}}
			/>
		{/if}

		<!-- Waypoint jump menu through `Waypoints.svelte`: the page
		keeps the open flag (shared with the composer trigger),
		the wrap node, the points, and jump; the component owns the
		nav markup and its surfaces. -->
		<Waypoints
			points={points}
			messages={chat.messages}
			pos={wpPos}
			settingsOpen={settingsOpen}
			previewing={previewing}
			bind:open={wpOpen}
			bind:wrapEl={wpWrap}
			actions={{
				toggle: () => {
					wpOpen = !wpOpen;
					buzzTap();
				},
				close: () => {
					wpOpen = false;
				},
				jump: (index: number, event: MouseEvent) => {
					jumpTo(index);
					wpOpen = false;
					buzzTap();
					// Mouse jumps release focus so hover-outside can
					// close: focus pinned on the item would hold the
					// menu open under a stationary pointer. Keyboard
					// (detail 0) keeps focus and the pin, so tabbing
					// users don't lose their place.
					if (event.detail > 0 && event.currentTarget instanceof HTMLElement)
						event.currentTarget.blur();
				}
			}}
		/>

		<!-- Thread column renders in `ThreadView.svelte`: the scrollable
		message list, per-row derivations, the empty hero, and the
		sending indicator. The page keeps chat state, focus, speech,
		aids, refs, popovers, and every behavior behind computed props
		and the actions object. -->
		<ThreadView
			messages={viewChat.messages}
			chatId={viewChat.id}
			{focusMode}
			{selectedIdx}
			{speakingId}
			{speakingSelection}
			{aidBusy}
			{vocalizing}
			{aidPin}
			{aidModelPin}
			{foldedIds}
			{aidPeek}
			{shownActionsId}
			{editingMsgId}
			{ocrBusyId}
			android={androidUI}
			showButtons={settings.showMessageButtons}
			{refsEditing}
			{refsBlink}
			{sourcesWanted}
			{expandedTags}
			{previewing}
			{activeReplyCode}
			foldTitle={tip(
				isMac ? "Fold this message (F or Option-click)" : "Fold this message (F or Alt-click)",
				"Fold this message"
			)}
			deleteTitle={tip(
				isMac ? "Delete this message (⌘D)" : "Delete this message",
				"Delete this message"
			)}
			aidPreferred={preferredLocalAid(activeReplyCode)}
			washId={pillWashId(annPop, annPopClosing) ??
				promptAnnWashId() ??
				editingId ??
				hoverBadgeId}
			sending={isSending(chatState, viewChat.id)}
			sendingChatId={chatState.sendingChatId}
			sendingPhase={(isSending(chatState, viewChat.id) &&
				hasFetchActive(chatState, viewChat.id)) ||
			nativeFetching.has(viewChat.id)
				? "fetch"
				: (isSending(chatState, viewChat.id) ||
							liveNative.has(viewChat.id)) &&
					  !hasReplyStarted(chatState, viewChat.id)
					? "waiting"
					: null}
			{sendElapsed}
			waitingLabel={thinkingLabelFor(activeReplyCode ?? settings.replyLang)}
			{chatStepDir}
			{useMock}
			{openLangMenu}
			{langMenuAnchor}
			{langMenusActions}
			bind:scrollBox
			bind:popOpen={refsPopOpen}
			bind:refsDraft={refsEditDraft}
			bind:refsBox={refsEditBox}
			actions={{
				noteScrolling,
				freezeScroll,
				releaseScroll,
				clearStepDir: () => (chatStepDir = null),
				hoverRow: (i: number) => {
					hoveredIdx = i;
					lastHoverChangeAt = Date.now();
				},
				sentTagModels,
				marksFor,
				aidedTextFor,
				localAidsOverrideFor,
				pinnedKinds,
				messageSpeaking,
				messageSpeakable,
				speakTitle,
				toggleFold,
				toggleMessageActions,
				articleLeave: onArticleLeave,
				editFocusOut: blurInlineEdit,
				editAction: msgEditAction,
				toggleSentTag,
				copyAttachment,
				recognizeAttachment,
				clearSentRefs,
				refsQuoteClick,
				copyAnnotation,
				startRefsEdit,
				saveRefsEdit,
				cancelRefsEdit,
				setHoverBadge: (id: string | null) => (hoverBadgeId = id),
				badgeClick: openBadgeClick,
				attachAction: sentTagAction,
				toast: flashToast,
				togglePasteFold,
				setAidBusy,
				aidFailed,
				copyText,
				branchHere,
				dropMessage,
				stopVoice,
				speakReply,
				unpinModelAid,
				runModelAidFor,
				unpinLocalAid,
				pinLocalAid,
				peekAid,
				unpeekAid,
				commitMessageEdit,
				editMessage,
				rerunFrom,
				retryFailed,
				releaseRowFocus,
				holdActionsOpen,
				releaseActionsHold
			}}
		/>

		{#if (missingKey || (noKeyLock && !settingsOpen)) && !androidUI}
			<p class="error-banner" role="alert">
				Set an API key first —
				<button
					type="button"
					class="link"
					data-settings-toggle
					onclick={() => {
						openSettingsPanel();
						pulseCursor();
					}}
				>
					open Settings</button
				>.
			</p>
		{/if}

		<!-- Attachment strip: pills and image/pasted-text cards over the
		thread. Attachments.svelte owns the strip markup, card buttons,
		and surfaces; the page keeps the array, drag/expand/busy flags,
		and the editor/toast side effects. The inline error stays paged
		in the shared `.error` look (Svelte scoping binds page CSS to
		page markup, so moving it would drop the red pairing). -->
		<Attachments
			attachments={attachments}
			expanded={expandedPastes}
			dragging={stripDragging}
			busyId={ocrBusyId}
			idle={promptIdle}
			inlineError={notices.inline.message}
			actions={{
				dragStart: stripDragStart,
				dragMove: stripDragMove,
				dragEnd: stripDragEnd,
				clickGate: stripClickGate,
				toggleExpand: togglePastedExpand,
				copy: copyAttachment,
				recognize: (att: Attachment) => void recognizeAttachment(att),
				remove: removeAttachment
			}}
		/>
		{#if notices.inline.message && !androidUI}
			<p
				class="error attach-error"
				class:composer-idle={promptIdle}
				role="alert"
			>
				{notices.inline.message}
			</p>
		{/if}

		<!-- Composer: file input, prompt card, tools, send, and banner
		through `Composer.svelte` (the page keeps the editor, state,
		and behaviors). The inline attach error above stays paged in
		the shared `.error` look. -->
		<Composer
			hidden={!!annPop && androidUI && !iosUI}
			parked={promptParked()}
			preview={previewing && viewChat.messages.length === 0}
			hasText={hasText}
			android={androidUI}
			ios={iosUI}
			hasSelMenu={selMenu !== null}
			inspectQuote={selMenu?.quote ?? ""}
			inspectEnabled={settings.inspectEnabled}
			annotations={annotations}
			reviewOpen={reviewOpen}
			bind:editingId
			bind:draft={editDraft}
			bind:box={editBox}
			bind:highlightId={highlightAnnId}
			bind:pillEl={annPill}
			attachBusy={attachBusy}
			canMic={canMic}
			micEnabled={settings.micEnabled}
			dictating={dictating}
			voiceOn={voiceOn()}
			speaking={speakingId !== null}
			altKey={altm}
			replyLang={activeReplyLang}
			altHeld={altHeld}
			canSubmit={canSubmit}
			hasAnnEdit={promptAnnEdit !== null}
			banner={notices.banner.message}
			waypointCount={points.length}
			wpOpen={wpOpen}
			bind:promptEl
			bind:sendBtnEl
			actions={{
				floorClick: focusPromptFloor,
				holdStart: (x: number, y: number) => {
					if (overSendButton(x, y)) sendHoldStart();
				},
				holdEnd: sendHoldEnd,
				intakeFiles: (files: File[]) =>
					void addFiles(files).then((kinds) => insertAttachmentMarkers(kinds)),
				mic: () => void toggleMic(),
				voice: toggleVoice,
				wpToggle: () => {
					wpOpen = !wpOpen;
					buzzTap();
				},
				submit: (alt: boolean) => onSubmit(alt ? "stage" : "send"),
				menuPress: noteMenuPress,
				menuTouch: noteMenuBtnTouch,
				annotateTouch,
				speakTouch,
				inspectTouch,
				annotate,
				speak: () => void speakSelection(),
				inspect: openInspect,
				review: {
					toggle: () => (reviewOpen = !reviewOpen),
					clearAll: clearAllAnnotations,
					quote: reviewQuoteClick,
					copy: copyAnnotation,
					remove: removeAnnotation,
					save: saveEdit,
					pencil: editAnnotationAtMark
				}
			}}
		/>

		<!-- Speech errors render from `Toasts.svelte` (top notice,
		tap to dismiss); the banner below stays paged. -->
		{#if !androidUI && viewChat.messages.length === 0}
			<LangMenus
				openId={openLangMenu}
				anchor={langMenuAnchor}
				activeCode={activeReplyCode}
				android={androidUI}
				previewing={previewing}
				actions={langMenusActions}
			/>
		{/if}
	</main>

	{#if selMenu && !previewing && !iosUI}
		<!-- Floating Annotate/Copy/Inspect menu: the page owns the
		state, placement, drag, and idle-dismiss; SelMenu owns the
		buttons and surfaces. -->
		<SelMenu
			menu={selMenu}
			dragging={selMenuDragging}
			android={androidUI}
			inspectEnabled={settings.inspectEnabled}
			bind:menuEl={selMenuEl}
			actions={{
				press: noteMenuPress,
				dragStart: menuDragStart,
				dragMove: menuDragMove,
				dragEnd: menuDragEnd,
				enter: enterSelMenu,
				leave: () => (selMenuHover = false),
				// Wrapped: Svelte hands the click event to a bare
				// reference, and the event would become the draft and
				// crash the pill's trim on render.
				annotate: () => annotate(),
				annotateTouch,
				copy: () => void copySelection(),
				copyTouch,
				inspect: openInspect,
				inspectTouch,
				btnTouch: noteMenuBtnTouch
			}}
		/>
	{/if}

	<!-- Selection readings panels: pronunciations for just the
	highlight. Readings.svelte owns the panels and their surfaces;
	the page keeps placement, tracking, and dismiss. -->
	<Readings pinyin={selPinyin} furigana={selFurigana} previewing={previewing} />

	{#if annPop}
		<!-- Annotation pill through AnnPop: the page keeps pop state,
		the draft seed, and the save paths; the component owns the
		pill, the field, the grow action, and their surfaces. -->
		<AnnPop
			pop={annPop}
			bind:draft={annDraft}
			bind:box={annPopBox}
			closing={annPopClosing}
			android={androidUI}
			micEnabled={canMic && settings.micEnabled}
			dictating={pillDictating}
			scrollBox={scrollBox}
			actions={{
				key: annPopKey,
				blur: blurAnnPop,
				save: saveAnnPop,
				cancel: cancelAnnPop,
				remove: (id: string) => {
					removeAnnotation(id);
					editor?.focus();
				},
				mic: () => void togglePillMic()
			}}
		/>
	{/if}

	{#if answerPop}
		<!-- Answer popup through AnnAnswer: the page keeps open state,
		badge-anchor placement, and the add-to-prompt behavior; the
		component owns the card and its surface. Self-heals when its
		annotation is deleted or sent while open. -->
		{@const pop = answerPop}
		{@const answered = annotations.find((a) => a.id === pop.id)}
		{#if answered?.answer}
			<AnnAnswer
				id={answered.id}
				quote={answered.quote}
				answer={answered.answer}
				x={pop.x}
				y={pop.y}
				width={pop.w}
				actions={{
					addToPrompt: addAnswerToPrompt,
					close: () => (answerPop = null)
				}}
			/>
		{/if}
	{/if}

	<!-- Settings drawer through `SettingsDrawer.svelte` (double-click
	on open space closes the panel; keyboard users keep Meta+,): the
	page keeps the open flag, the settings object, token labels, and
	every behavior; the component owns the drawer shell, the inner,
	and their surfaces. -->
	<SettingsDrawer
		open={settingsOpen}
		{settings}
		tokensLabel="{formatTokens(split.prompt)} in / {formatTokens(
			split.completion
		)} out"
		tokensTitle="{total} tokens total this chat"
		android={androidUI}
		bind:panelEl={settingsEl}
		actions={{
			commit: () => persistSettings(),
			toast: flashToast,
			panelClose: () => {
				settingsOpen = false;
				pulseCursor();
			},
			shortcuts: openShortcuts,
			expand: zoomWindow,
			drawerClose: () => {
				settingsOpen = false;
			}
		}}
	/>

	{#if androidUI && chatSwitcherOpen}
		<!-- Phone chat switcher: card plus mint/delete actions through
		the shared modal shell. The page owns chat state and the open
		flag; ChatSwitcher owns the card, actions, and surfaces. -->
		<ChatSwitcher
			title={chatLabel(activeChat(chatState)?.createdAt ?? Date.now())}
			position="{chatState.chats.findIndex(
				(c) => c.id === chatState.activeChatId
			) + 1} / {chatState.chats.length}"
			openedAt={switcherOpenedAt}
			actions={{
				close: closeChatSwitcher,
				step: stepSwitcher,
				newChat: doNewChat,
				deleteActive: () => dropChat(chatState.activeChatId)
			}}
		/>
	{/if}

	{#if shortcutsOpen}
		<!-- Shortcuts modal through the shared shell: the page keeps
		the open flag, the filter reset, and ⌘F focus; the component
		owns the list, the field, and their surfaces. -->
		<ShortcutsModal
			android={androidUI}
			mac={isMac}
			bind:query={shortcutQuery}
			bind:inputEl={shortcutInputEl}
			closeTitle={tip(
				isMac ? "Close (⇧⌘/)" : "Close (Ctrl+Shift/)",
				"Close"
			)}
			onClose={() => (shortcutsOpen = false)}
		/>
	{/if}

	{#if palette.open}
		<!-- Command palette through the shared shell: the page keeps
		the palette object, focus, and search behaviors; the component
		owns the dialog markup, the hit list, and their surfaces. -->
		<SearchPalette
			{palette}
			bind:inputEl={searchInputEl}
			bind:resultsEl={searchResultsEl}
			actions={{
				query: runSearchQuery,
				close: closeSearch,
				move: moveSearchCursor,
				enter: enterSearchHit,
				focusHit: focusSearchHit
			}}
		/>
	{/if}
	{#if inspectChar && inspectData}
		<!-- Character Inspect overlay through the shared shell: the page
		keeps the open character, vectors, step, and locale default;
		InspectOverlay owns the overlay, stepper, toggle, and surfaces. -->
		<InspectOverlay
			char={inspectChar}
			data={inspectData}
			strokes={inspectStrokes}
			stroke={inspectStroke}
			bind:lang={inspectLang}
			actions={{
				close: () => (inspectChar = null),
				step: strokeStep,
				holdStart: startStrokeHold,
				holdStop: stopStrokeHold,
				buzz: buzzInspectTap
			}}
		/>
	{/if}
	<!-- Print-only study sheet renders in `StudySheet.svelte`; the page
	keeps the title call. -->
	<StudySheet title={sheetTitle(chat.messages)} messages={chat.messages} />
</div>

<style>
	.app {
		display: flex;
		height: 100vh;
		height: 100dvh;
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		color: #1c1c1e;
		color: var(--ink);
		background: #fff;
		background: var(--bg);
		color-scheme: light dark;
		/* Phones never pan sideways: a horizontal drift is a gesture,
		not a scroll (it used to open settings by accident). clip, not
		hidden, so fixed drawers stay viewport-relative. */
		overflow-x: clip;
	}
	/* Chat-list drawer renders in `Sidebar.svelte` now (drawer box,
	rows, search, tips, and phone seating moved with the markup). */
	/* (Settings drawer shell in `SettingsDrawer.svelte`.) */
	/* Dialog shells render in `Modal.svelte` now (veil, box, and
	per-dialog chrome moved with each dialog through the shell);
	content heads render in each dialog. No paged dialog markup
	remains. */
	/* Shortcuts filter and key grid render in `ShortcutsModal.svelte`
	now (field chrome, focus ring, and rows moved with the markup).
	The palette input keeps its own focus ring below. */
	/* Search palette dialog renders in `SearchPalette.svelte` now
	(markup, hits, and surfaces moved with it; the box seating lives
	in `Modal.svelte`). */
	/* Dialog head hover, inspect overlay, and switcher chrome all
	render in their dialog components now; no paged dialog rules
	remain. */
	/* (Inspect locale toggle, body, and facts render in
	`InspectOverlay.svelte`.) */
	/* (Inspect glyph column renders in `InspectOverlay.svelte`.) */
	/* (Inspect stepper/decomp render in `InspectOverlay.svelte`.) */
	/* (Inspect stepper states render in `InspectOverlay.svelte`.) */
	/* (count/onkun in `InspectOverlay.svelte`.) */
	/* (Decomposition tree renders in `InspectOverlay.svelte`.) */
	/* Key grid rows render in `ShortcutsModal.svelte` (moved with
	the dialog). */
	/* Row × color rides in `Sidebar.svelte` (moved with the drawer). */

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		position: relative;
	}
	/* Slim title strip: an empty drag surface, no bar. Tall enough to
	clear the traffic lights, borderless so it reads as window chrome
	instead of UI. */
	header {
		display: flex;
		align-items: center;
		gap: 1rem;
		min-height: 1.75rem;
		padding: 0 1.4rem;
		font-size: 0.82rem;
		/* Chrome, not content: no I-beam, no text selection for the
		native window-drag region to fight over. Buttons keep their
		own pointer cursor. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
		/* Invisible gesture strip: no background, blur, or border, so
		messages bleed edge to edge underneath it. It still overlays
		the column (position + z-index) for its only two jobs —
		mousedown window-drag and double-click zoom — which means the
		top strip's pixels show text but don't take clicks. Companion
		rules: .messages keeps zero top padding (full bleed) while
		scroll-padding-top parks programmatic scrolls below the strip
		so jumped-to targets stay clickable. */
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 35;
		background: transparent;
		border-bottom: 0;
	}
	/* The title strip stays a drag surface everywhere except controls
	(see dragWindow). */
	/* Waypoint surfaces render in `Waypoints.svelte` now (nav,
	ticks, menu, sheet, and keyframes moved with the markup). */
	/* Find bar renders in `FindBar.svelte` now (bar, input, count,
	step/close buttons). */
	button.link {
		font: inherit;
		color: inherit;
		text-decoration: underline;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	/* Overlay traffic lights sit at x:20–72, y:26 (see trafficLightPosition
	in tauri.conf.json). The header clears them with left padding; the
	empty sidebar head indents by the same amount so the chat list
	starts at the same x. */
	.app[data-shell="tauri"] header {
		padding-left: 5.75rem;
		/* Sit the top chrome a touch lower so it centers on the
		native traffic lights instead of riding above them. */
		padding-top: 1.15rem;
	}
	/* (Tauri first-message offset in `MessageArticle.svelte`.) */
	/* Shell/Android side-head seating rides in `Sidebar.svelte`
	(moved with the drawer). */
	/* Traffic-light hover fade lives in the shell (see
	src-tauri/src/trafficlights.rs): the native Overlay buttons paint
	above the webview, so no web patch can fade them — the stale
	bg-colored cover that sat here fought the native fade and ghosted
	the cluster, and is gone. */
	/* Android is a Tauri shell with no traffic lights and no window
	drag: drop the desktop clearance and the empty drag strip. */
	.app[data-android] header {
		padding-left: 1.4rem;
		padding-top: 0;
		/* The strip stays: with the webview reporting a zero top inset,
		its 28px is the status-clock clearance, not spare room. */
	}
	/* Notch and home-indicator clearance: the reply pill stops riding
	under the status clock, the composer clears the gesture bar. env()
	is 0 where the webview already insets, so this no-ops there. */
	.app[data-android] header {
		padding-top: env(safe-area-inset-top, 0px);
	}
	.app[data-android] main {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	/* (Phone settings sheet in `SettingsDrawer.svelte`.) */
	/* Composer surfaces render in `Composer.svelte` now (phone card,
	tools bar, send seat, highlight dock, and field caps moved with
	the markup). */
	/* Phones scroll by thumb: no scrollbar chrome anywhere. Touch
	scrolling itself is untouched — only the track/thumb paint hides.
	:global (not a bare *) so Svelte keeps the rule: it prunes vendor
	pseudo-elements it cannot verify, which would drop the paint half. */
	.app[data-android] :global(*) {
		scrollbar-width: none;
	}
	.app[data-android] :global(*::-webkit-scrollbar) {
		display: none;
	}
	/* (Phone composer ramps, thumb row, and highlight dock in
	`Composer.svelte`.) */
	/* Empty chat on phones: the pills row is the last in-flow child, so
	a tall hero plus big fonts push it under the floating prompt card
	(which then eats its taps). Reserve the prompt's footprint below. */
	.app[data-android] main.empty {
		padding-bottom: 9.5rem;
	}
	/* Thumb-sized targets on phones: the dock's edit actions render
	in `ReviewDock.svelte` (moved with the dock). Message-row icons
	stay tight so the row never overflows the phone width. */
	/* Phone pill buttons render in `AnnPop.svelte` (moved with
	the pill). */
	/* Phone drawer chrome renders in `Sidebar.svelte` (moved with
	the drawer). */
	/* Counter pill rides right of the audio button (DOM-first, so
	order pushes it past voice); the wrap goes static so the review
	panel anchors to the card. Desktop keeps its left slot and its
	inline review. */
	/* Phone dock seating renders in `ReviewDock.svelte` (moved
	with the dock). */
	/* Phone pill type renders in `AnnPop.svelte` (moved with
	the pill). */
	/* (Language pills in `LangMenus.svelte`.) */
	/* Phone gestures list renders in `ShortcutsModal.svelte`
	(single-column override moved with the dialog). */
	/* (Waypoint nav in `Waypoints.svelte`: the last paged nav moved
	with its buttons.) */
	/* Chat-switch crossfade covers the messages only: an unscoped
	transition snapshots the whole page, so the closing sidebar and
	the parking prompt ghost mid-switch — the prompt reads as
	summoned twice, flickering. The root pair cuts instantly while
	message bodies keep the crossfade (:global — these pseudos live
	on the document, and the scope hash would break them). The
	`messages` name lives only around the switch (see
	scopeMessagesTransition): a standing name makes .messages a
	stacking context, trapping the annotation badges under the
	header strip so their clicks land on the chrome beneath. */
	:global(::view-transition-old(root)),
	:global(::view-transition-new(root)) {
		animation: none;
	}
	/* Every other scroller fades exactly like the main chat: invisible
	until a scroll is in flight (one capture-phase listener below toggles
	.scrolling with the same short hold). Global: extracted components
	(Modal, ReviewDock, SearchPalette, Sidebar) render their scrollers
	outside this component's scope, and the toggle listener is
	document-wide — the utility must be too. */
	:global([data-fade-scroll]) {
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
		transition: scrollbar-color 0.3s ease;
	}
	:global([data-fade-scroll])::-webkit-scrollbar {
		width: 8px;
		height: 8px;
	}
	:global([data-fade-scroll])::-webkit-scrollbar-track {
		background: transparent;
	}
	:global([data-fade-scroll])::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 4px;
		transition: background-color 0.3s ease;
	}
	:global([data-fade-scroll].scrolling) {
		scrollbar-color: rgba(142, 142, 147, 0.55) transparent;
		transition: scrollbar-color 0.12s ease;
	}
	:global([data-fade-scroll].scrolling)::-webkit-scrollbar-thumb {
		background: rgba(142, 142, 147, 0.55);
		transition: background-color 0.12s ease;
	}
	/* (Drawer fade-scroll restate in `SettingsDrawer.svelte`; the
	chat-list drawer keeps its own copy in `Sidebar.svelte`.) */
	/* (Waypoint fade-scroll restate in `Waypoints.svelte`.) */
	/* (Waypoint touch sheet in `Waypoints.svelte`.) */
	/* (Empty-state pills dock in `LangMenus.svelte`.) */
	/* (Empty hero in `EmptyHero.svelte`.) */
	/* (Pill row, lists, and badges in `LangMenus.svelte`.) */
	/* Article shell surfaces render in `MessageArticle.svelte` now
	(row, bubble, edit box, and states moved with the markup). */
	/* (Own-message row in `MessageArticle.svelte`.) */
	/* (Phone in-place edit in `MessageArticle.svelte`.) */
	/* (Assistant column and plain-user bubble in
	`MessageArticle.svelte`.) */
	/* (Selection ring and Option-arm cursor in
	`MessageArticle.svelte`.) */
	/* Sent file/image folds render in `SentAttachments.svelte` now
	(tags row + inline folds, popup card, fold surfaces). */
	/* Baked-refs card renders in `SentRefs.svelte` now (pill, pop,
	items, editor, light theme). Article-seating rules moved with it. */

	/* Attachment strip: same 1.2rem column edges as the composer (never
	a full-bleed row), one scrolling row when many — pills never wrap
	into a tall stack and never spill past the column. The strip is a
	positioned overlay, exactly as wide as the prompt but only as tall
	as its cards: it docks a fixed margin above the card while the
	thread runs full-height behind and beside it, text visible around
	the pills. */
	/* Attachment strip surfaces live with their markup in
	`Attachments.svelte` (Svelte scoping binds them to the strip). */
	/* The tray paints no background of its own: pills float over the
	thread with the text visible between them (a veil here read as a
	white block occluding the messages). Surfaces are solid now —
	no frost anywhere — so the strip simply stays transparent. */
	/* Toast surfaces live with their markup in `Toasts.svelte`
	(Svelte scoping binds them to the buttons); only the voice error
	below stays paged. */
	/* Speech errors ride under the toast: top of the screen, big
	enough to notice, same dark-red pairing as the old banner so it
	reads in both themes. A tap dismisses; silence still expires it. */
	/* The speech-error notice renders in `Toasts.svelte` now (same
	always-dark surface, moved with the markup). */
	@keyframes voice-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	/* Message action row renders in `MessageActions.svelte` now
	(row, buttons, tooltips, reveal and seating). Shared `.error`
	and `.tdots` surfaces stay global for their other consumers. */
	/* Pretty default text selection in both themes… */
	:global(::selection) {
		background: rgba(0, 122, 255, 0.28);
		background: var(--sel-tint);
	}
	/* (Speak-aloud selection tint in `MessageArticle.svelte`.) */
	/* (hidden-input in `Composer.svelte`.) */
	/* System-callout look: one translucent pill, hairline dividers, no
	gaps. On iOS this IS the selection menu (the native callout is
	suppressed over messages), so it should feel at home there — a
	generic pill with text buttons, no Apple marks. The ring seats it
	on white: blur + shadow alone read as a smudge over text. */
	/* The selection menu's surfaces live with its markup in
	`SelMenu.svelte` (Svelte scoping binds them to the buttons). */
	/* Selection pinyin: readings for just the highlight. Same glass
	as the selection menu, but pointer-transparent (read-only — it
	must never disturb the highlight or block the native menu).
	Desktop docks it above the highlight while the menu rides the
	cursor; phones dock it below, since the menu owns above. */
	/* Reading panels render in `Readings.svelte` now (panel glass,
	anchoring, and run colors moved with the markup). */
	/* Document tint: selected kanji glow in their popup color
	while the panels are up (unwrapped on dismiss). */
	:global(.rendered .frbt0) {
		color: var(--pair0);
	}
	:global(.rendered .frbt1) {
		color: var(--pair1);
	}
	:global(.rendered .frbt2) {
		color: var(--pair2);
	}
	:global(.rendered .frbt3) {
		color: var(--pair3);
	}
	/* Annotation pill surfaces render in `AnnPop.svelte` now
	(markup, grow action, and card chrome moved with the pill). */
	/* (closing/tall in `AnnPop.svelte`.) */
	/* (field/row in `AnnPop.svelte`.) */
	/* (tool/cancel/save buttons in `AnnPop.svelte`.) */
	/* (light-theme pill in `AnnPop.svelte`.) */
	/* (fresh pill in `AnnPop.svelte`.) */
	/* Review dock surfaces render in `ReviewDock.svelte` now
	(card, rows, editor, and popover moved with the dock). */
	/* (quote/comment/editor in `ReviewDock.svelte`.) */
	/* (edit actions in `ReviewDock.svelte`.) */
	/* (wrap/pill/tools in `ReviewDock.svelte`.) */
	/* (phone review type in `ReviewDock.svelte`.) */
	/* (pencil/copy/del icons in `ReviewDock.svelte`.) */
	/* (quote/pencil link rules in `ReviewDock.svelte`.) */
	/* (popover card in `ReviewDock.svelte`.) */
	/* (Hide-messages mode in `MessageArticle.svelte`.) */
	/* (Phone plain-user row in `MessageArticle.svelte`.) */
	/* (Phone article widths in `MessageArticle.svelte`.) */
	/* dir=auto puts Arabic paragraphs at the right edge; the chat
	reads left-aligned, so alignment follows the column while the
	base direction (selection, drag) stays with the text. */
	.app[data-android] :global(.rendered [dir="auto"]) {
		text-align: left;
	}
	/* Own-row packing, speaking slot, and phone button order render
	in `MessageActions.svelte` (moved with the row). */
	/* Row tooltips hang below the buttons and render in one rise-and-settle
	(single-run keyframes on a static transform): unlike the native title
	bubble, nothing can fire a second nudge while the pointer stays put.
	Absolute, so they never push the row around. The 2s hold means
	brush-past hovers stay quiet; reduced-motion users get a plain fade. */
	@keyframes tip-rise {
		from {
			opacity: 0;
			translate: -50% 4px;
		}
		to {
			opacity: 1;
			translate: -50% 0;
		}
	}
	/* (Drawer reduced-motion settle in `SettingsDrawer.svelte`.) */
	/* Shared error look (composer banner, attach error, message-row
	error): global, since the row renders in `MessageActions.svelte`
	outside this component's scope. */
	:global(.error) {
		/* Same size as the status line, so error text and its retry
		button row read as one row. Fixed unless the button opt-in
		below says otherwise. */
		font-size: 0.85rem;
		color: #94250a;
	}
	/* Same opt-in as the message buttons: row error text follows the
	text size only when message-button scaling is on (same cap). */
	:global(main.scale-actions) :global(.error) {
		font-size: calc(0.85rem * min(var(--font-scale, 1), 2));
	}
	/* Same opt-in for the latex chrome: the `$` toggle and copy button
	scale with the text size like the message buttons (same 4x cap),
	so the pair never reads tiny under huge type. Box, `$` type, and
	glyph scale together, keeping the shared-box centering. */
	main.scale-actions :global(.ccez-math-tex),
	main.scale-actions :global(.ccez-math-copy) {
		height: calc(1.3rem * min(var(--font-scale, 1), 4));
		width: calc(1.3rem * min(var(--font-scale, 1), 4));
		font-size: calc(0.85rem * min(var(--font-scale, 1), 4));
	}
	main.scale-actions :global(.ccez-math-copy .action-glyph) {
		height: calc(1rem * min(var(--font-scale, 1), 4));
		width: calc(1rem * min(var(--font-scale, 1), 4));
	}
	/* Sending status renders in `SendingIndicator.svelte` now
	(line, colored dots, elapsed). */
	/* Loading dots exist only while busy, so an idle aid button is
	exactly its visible label — hover and spacing never cover text
	that isn't there. Fully global (both halves in :global): the dots
	render in `MessageActions.svelte` (aid buttons) and
	`SendingIndicator.svelte`, whose spans carry no page hash. */
	:global(.tdots span) {
		display: inline-block;
		animation: tdot-pulse 1.2s ease-in-out infinite;
	}
	:global(.tdots span:nth-child(2)) {
		animation-delay: 0.2s;
	}
	:global(.tdots span:nth-child(3)) {
		animation-delay: 0.4s;
	}
	@keyframes tdot-pulse {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 1;
		}
	}
	/* Hover state changes ease everywhere (reduced-motion keeps these;
	only the landing glide and the hover underline are gated there). */
	button {
		transition:
			color 0.15s ease,
			background-color 0.15s ease,
			border-color 0.15s ease,
			opacity 0.15s ease;
	}
	/* Composer card, idle hide, and banner tint render in
	`Composer.svelte` now (markup, card, and surfaces moved with the
	composer). */
	/* Idle-hide covers the inline attach error too (the strip rides
	with the prompt from `Attachments.svelte`): same slide/fade so no
	image bubble lingers over the chat, restored with the next input. */
	.attach-error {
		transition:
			transform 0.25s ease,
			opacity 0.25s ease,
			visibility 0s;
	}
	.attach-error.composer-idle {
		/* Same 0.75rem settle and ramp as the card: the old
		full-height slide outran the prompt — taller trays visibly
		faster. The fade does the hiding; the slide just settles. */
		transform: translateY(0.75rem);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			transform 0.25s ease,
			opacity 0.25s ease,
			visibility 0s linear 0.25s;
	}
	/* Reduced motion settles the summon instantly: no slide, no fade
	ramp on the card or its error — what lands is the final frame.
	After every ramp above (equal specificity, later wins), so the
	desktop rise honors the OS setting like the drawers already do. */
	/* (Card settle in `Composer.svelte`; the inline error below keeps
	its own reduced-motion settle.) */
	@media (prefers-reduced-motion: reduce) {
		.attach-error {
			transition: none;
		}
	}
	/* No entrance animation on the composer: it used to glide down on the
	first message, exactly while the first tokens streamed in — on a slow
	phone GPU the overlap reads as flicker. The composer just stays put. */
	/* (Send button in `Composer.svelte`.) */
	/* (Tools cluster, tool seats, voice/mic states, and selection
	dock in `Composer.svelte`.) */
	/* `.file-kind` badges render in `Attachments.svelte` now. */
	/* (Field, placeholder, and tool-seating rules in
	`Composer.svelte`.) */
	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	/* Caret rides --ink, placeholders ride --line-hover. */
	/* Centered reading column on wide screens (DeepSeek-web rhythm).
	The cap rides --chat-width off .app (desktop slider, 36 = the default
	fixed width); the fallback keeps phones and older saves identical. */
	/* Shared column width (sending status): global, since the status
	renders in `SendingIndicator.svelte`; article and hero keep
	their own pairings in their components. */
	:global(.sending) {
		align-self: center;
		width: 100%;
		max-width: min(100%, calc(var(--chat-width, 36) * 1rem));
		box-sizing: border-box;
	}
	/* (First-message offset in `MessageArticle.svelte`.) */
	/* (Composer width and outline in `Composer.svelte`; the banner
	keeps its own width there too.) */
	/* `.attachments` keeps its own tray width in `Attachments.svelte`. */
	/* `.review` keeps its own tray width in `ReviewDock.svelte`. */
	/* (Pill-row width in `LangMenus.svelte`.) */
	/* Missing-key banner above the attachment strip: paged markup,
	so it keeps its own error pairing here (same tokens as the
	composer's banner in `Composer.svelte`; Svelte scoping binds
	each pairing to the markup that renders it). */
	.error-banner {
		margin: 0 1.2rem;
		font-size: 0.85rem;
		padding: 0.6rem 0.8rem;
		border-radius: 8px;
		background: #fdecea;
		background: var(--error-bg);
		color: #94250a;
		color: var(--error-ink);
		width: calc(100% - 2.4rem);
		max-width: calc(var(--chat-width, 36) * 1rem);
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
	}

	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	:global(html[data-theme="dark"]) {
		color-scheme: dark;
	}
	/* .app rides the --bg/--ink tokens now; no dark override needed. */
	/* aside rides the --bg/--line-soft tokens now; no dark override needed. */
	/* active is transparent in the base already; row/new/del ride
	--hover-wash/--focus/--alarm/--line/--dim now. */
	/* Sidebar text never rides on inheritance alone: old phone
	WebViews resolve button colors (ButtonText) against the wrong
	scheme, and the × had no dark color at all. */
	/* side-chat pins --ink (ButtonText trap); del rides --dim now. */
	/* header carries no border width, so its dark border-color was a
	no-op; .voice-float split out into --muted above (hover rides
	--ink with the other tool icons). */
	/* Selection tint rides --sel-tint now (pinned in the chrome paint test). */
	/* .voice-float.on rides --ok now. */
	/* .settings-panel rides the --bg/--line-soft tokens now; no dark override needed. */
	/* The overlay pill rides --bg-raised/--line-soft now; no dark override needed. */
	/* .modal rides the --bg/--ink/--line-soft tokens now; no dark override needed. */
	/* Dialog × hovers render in each dialog component now. */
	/* Phone gestures-list dark divisor moved with the dialog
	(`ShortcutsModal.svelte`). */
	/* (Waypoint sheet-head dark rides in `Waypoints.svelte`.) */
	/* .bubble rides the --bg-wash token now; no dark override needed. */
	/* plain-user is background:none in the base already: nothing to override. */
	/* article.selected rides --focus now. */
	/* .actions buttons ride --muted/--ink now (icon-btn shares the hover).
	The read-aloud green rides in `MessageActions.svelte`. */
	/* tool-icon hovers ride --ink now. */
	/* .error-banner rides --error-bg/--error-ink now: no dark override needed. */
	/* sent tags inherit body type; attachment pills ride --hl now
	(rules live in `Attachments.svelte`). */
	/* ann-wrap rides --line/--muted/--ink; review-tools ride --muted/--danger now. */
	/* sel-menu rides --bg-raised/--line/--bg-wash/--ink;
	ann-pop is dark-always; review rides --panel/--line-soft. */
	/* .review-item.highlight rides --hl now. */
	/* review-head/label ride --muted/--ink; review textarea rides --field/--line/--strong. */
	/* Dark primary: light pill, dark text (mirrors the send
	button's inversion); Cancel stays quiet gray text. */
	/* edit-actions ride --invert/--invert-ink/--muted/--ink now. */
	/* .muted rides --muted now (sole use: the translating note). */
	/* .prompt rides --bg/--line/--line-hover/--focus now; no dark overrides needed. */
	/* Lang menus ride --ink/--strong/--line/--bg-raised/--bg-wash/--focus now. */
	/* .send-btn rides --invert/--invert-ink now. */
	/* Study-sheet screen hide moved with the markup to
	`StudySheet.svelte`; the print rules stay global in app.css. */
</style>
