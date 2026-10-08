<script lang="ts">
	import { flushSync, onMount, tick, untrack } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import { fade } from "svelte/transition";

	// Document theme tokens + print sheet: global CSS
	// lives in src/app.css, imported here (single route).
	import "../app.css";
	import {
		createChatState,
		formatTokens,
		activeChat,
		newChat,
		selectChat,
		ensureGameChat,
		appendAssistantMessage,
		abortSend,
		newChatMsgId,
		setChatReplyLang,
		setChatCorrection,
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
		waypointIndexAt,
		waypointOffsets,
		sendMessage,
		fileAssistantMessage,
		setPasteFold,
		isSending,
		hasReplyStarted,
		hasFetchActive,
		refreshTrimSummary,
		generateChatTitle,
		renameChat,
		setTrimPoint,
		trimPointIndex,
		resolveSendCompletion,
		landingSignal,
		replyPhase,
		type Chat,
		type ChatMsg,
		type ChatId,
		type ChatMsgId
	} from "$lib/chat";
	import {
		loadSettings,
		saveSettings,
		activeThinkingSupport,
		activeThinkingId,
		resolveTheme,
		systemLocale,
		CHAT_WIDTH_DEFAULT,
		PROMPT_WIDTH_BASE_REM,
		FONT_SCALE_MAX,
		stepFontScale,
		stepChatWidth,
		MESSAGE_GAP_DEFAULT,
		LINE_HEIGHT_DEFAULT,
		effectiveChatWidth,
		effectivePromptWidth,
		FULLBLEED_FONT_SCALE,
		HYPHENATE_FONT_SCALE,
		PROMPT_IDLE_ALWAYS,
		PROMPT_IDLE_NEVER,
		type AppSettings
	} from "$lib/settings";
	import { cycleThinkingId } from "$lib/providers/thinking";
	import {
		QUICK_LANG_CODES,
		langMenuAnchorFor,
		langNameForTag,
		quickKeyFor,
		replyLanguageFor,
		stepPillVoice,
		switchToastFor,
		LANGUAGE_MENUS,
		menuOrder,
		typeaheadBuffer,
		typeaheadMatch,
		thinkingLabelFor,
		type LangMenuAnchor,
		type LanguageMenu,
		type ReplyLanguage
	} from "$lib/languages";
	import {
		listProviders,
		type ProviderId
	} from "$lib/providers/registry";
	import { isImeKey } from "$lib/editContext";
	import {
		OFFLINE_FALLBACK_ID,
		offlineTarget,
		onlineRestore
	} from "$lib/offline";
	import { mockProviderEnabled } from "$lib/providers/mock";
	import { ProviderKeys } from "$lib/provider-keys.svelte";
	import {
		isOnDeviceProvider,
		onDeviceNotReadyCopy,
		onDeviceStatus
	} from "$lib/ondevice/bridge";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { emit, listen } from "@tauri-apps/api/event";
	import {
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
		clampTapDy,
		scrollHoldVelocity,
		stepScrollTop,
		tapReleaseRest,
		unselectedScrollIntent
	} from "$lib/scrollkeys";
	import {
		hydrateSecrets,
		secretsSurviveReload,
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

	import StudySheet from "$lib/components/StudySheet.svelte";
	import SettingsDrawer from "$lib/components/SettingsDrawer.svelte";
	import FindBar from "$lib/components/FindBar.svelte";
	import Composer from "$lib/components/Composer.svelte";
	import Waypoints from "$lib/components/Waypoints.svelte";
	import {
		plainBody,
		sourcesAsked,
		messageCopyText
	} from "$lib/render";
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
		countPasteSlots,
		isPastedTextAttachment,
		makePastedTextAttachment,
		pastedMarkerInsert,
		pastedTextsAt,
		writePastedTextAt,
		splicePastedText,
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
	promptInclusions,
	canHoldDeleteBadge,
	buildMarksFor,
	aidedTextForMsg,
	seedAnnotationsFromRefs,
	annotationCopyText,
	promptAnnWashIdFor,
	annEditCommitToast,
	addAnnotation,
	attachAnnotationAnswer,
	type Annotation,
	type AnnotationId,
	type AnnotationMark,
	type StoryAnchor
} from "$lib/annotations";
import {
	resolveSentRefTarget,
	locateQuote
} from "$lib/quote-match";
import {
	withAnnotations,
	annRefsFor,
	commitRefsEdit,
	planClearSentRefs
} from "$lib/annotation-block";
import {
	pressExpandedSelection,
	selMenuPlacement,
	readingPanelPlacement,
	menuYAbovePanel,
	clampPanelCenterX,
	highlightSteady,
	panelCenterMoved,
	lineStartOffset,
	clampDragAnchorToFocusLine,
	menuBtnTouchAction,
	selMenuDragTarget
} from "$lib/sel-geometry";
import {
	loadDraftAnnotations,
	saveDraftAnnotations
} from "$lib/annotation-drafts-store";
import {
	handsFreeNext,
	type HandsFreeEvent,
	type HandsFreePhase
} from "$lib/handsFree";
import {
	GAME_LINE_CLOSED_EVENT,
	GAME_LINE_EVENT,
	GAME_LINE_FILE_EVENT,
	GAME_LINE_OPEN_EVENT,
	closeGameLine,
	openGameLine,
	translateGameLine,
	type GameLineFile
} from "$lib/gameLine";
	import { AnnotationDrafts } from "$lib/annotation-drafts.svelte";
	import {
		trimParagraphTerminator,
		quoteRange,
		rangesExcludingReadings,
		wrapRangeExcludingBadges,
		unwrapMark,
		invalidateWashPaint,
		lockSelectionToMessage,
		quoteTextNodes,
		repaintLiveWash,
		snapSelectionToWordEdges
	} from "$lib/annotations-stamp";
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
	import { NewsMode } from "$lib/news-mode.svelte";
	import { AnnotateMode } from "$lib/annotate-mode.svelte";
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
		textBlockAtPoint,
		tintSelectionSpans,
		unwrapFuriganaTint
	} from "$lib/selTint";
	import { caretOffsetInBlock, nodeAtBlockOffset } from "$lib/caret";
	import {
		frontendPingOnDone
	} from "$lib/turns";
	import { NativeTurns } from "$lib/native-turns.svelte";
	import { replySystemPrompt } from "$lib/replyPrompt";
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
		deleteScope,
		inspectStepAction,
		keyFacts,
		answerCardKeyAction,
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
		sidebarSpeakTarget,
		spaceKeyAction,
		enterKeyAction
	} from "$lib/keybindings";
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
		middleDragGesture,
		flickZoneOfTarget,
		isNewsChipsTarget
	} from "$lib/events";
	import {
		aidDisplayText,
		offeredLocalAids,
		preferredLocalAid,
		sentenceBounds,
		paragraphBounds,
		extractWordAt,
		hanOverlayLangFor,
		runModelAid,
		aidTargetLines,
		aidFailureToast,
		selectAidInput,
		spliceAidResult,
		messageAidKinds,
		readingsOnly,
		annotationAnswer,
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
		findQueryFor,
		groupHitsByChat,
		hitMatchText,
		matchedText,
		type SearchHit
	} from "$lib/chatSearch";
	import {
		chatLabel,
		chatTitle,
		filterSidebarChats,
		sideTip
	} from "$lib/sidebar";
	import { emptyFind, stepFindCursor, type FindState } from "$lib/find";
	import { emptyPalette, type PaletteState } from "$lib/palette";
	import {
		annPopBlurAction,
		annPopCancelKind,
		annPopSaveKind,
		annPopWidth,
		pillWashId,
		placeAnnAnswer,
		placeAnnCard
	} from "$lib/annPop";
	import {
		idleTapAction,
		shouldHideForAlways,
		shouldParkForNews,
		shouldIdleHide
	} from "$lib/idle";
	import {
		submitAction,
		sendAction,
		editMessageAction,
		newestUserMessageIndex,
		commitEditTarget,
		shouldRumbleOnFirstToken
	} from "$lib/submit";
	import {
		emptyViewport,
		pickScrollAnchor,
		rectInClear,
		clearLandingDelta,
		stickAfterScroll,
		type ScrollAnchor,
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
	import { nativeSaveMarkdown, nativeSaveText } from "$lib/nativeExport";
	import FlashcardDeck from "$lib/components/FlashcardDeck.svelte";
	import { createPromptGlide, type PromptGlide } from "$lib/promptGlide";
	import {
		AMBIENT_GAP_MS,
		PRESS_SELECTOR,
		STEP_GAP_MS,
		beatAllowed
	} from "$lib/uiHaptics";
	import ReaderView from "$lib/components/ReaderView.svelte";
	import {
		phraseIndexAtOffset,
		readerKeyAction,
		readerPhrases,
		readerStep,
		startReader,
		type ReaderEvent,
		type ReaderState
	} from "$lib/reader";
	import { FlashcardsMode } from "$lib/flashcards-mode.svelte";
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
		setSpeechRate,
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
		webSpeechErrorCopy,
		speechErrorStep,
		punjabiSpeechText,
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
	import {
		captureSourceFor,
		capturePixels,
		friendlyCaptureError,
		isScreenRecordingDenial,
		openScreenRecordingSettings,
		shouldStageCapture,
		captureSupported,
		type CaptureOneShot
	} from "$lib/nativeCapture";
	import CaptureOverlay from "$lib/components/CaptureOverlay.svelte";
	import { voiceLocaleForInputSource } from "$lib/keyboardLang";
	import { joinExternalDraft, routeExternalText } from "$lib/externalText";
	import {
		listenDeepLinks,
		listenGameCapture,
		openAreaPicker,
		listenAreaPicked,
		listenAreaPickRequested,
		showMainWindow,
		isSummonHotkey,
		type AreaPick,
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
	/** Settings as loaded, with the launch-only resets applied (boot
	reads go through this; the live object below is bound into the
	settings panels). */
	const bootSettings = loadSettings();
	// The chat list always starts closed — a persisted open state never
	// survives a start or refresh.
	bootSettings.sidebarCollapsed = true;
	// Voice readback always starts off for the same reason: every launch
	// begins quiet, no matter what it was left on.
	bootSettings.voice = false;
	let settings = $state(bootSettings);

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

	const useMock = mockProviderEnabled();
	/** Keys, the no-key lock, and provider resolution (see provider-keys). */
	const providerKeys = new ProviderKeys({
		getSettings: () => settings,
		mock: useMock,
		secure: tauriBackendAvailable(),
		isPhone: () => androidUI,
		hydrate: hydrateSecrets,
		migrateLegacy: migrateLegacySecret
	});
	let editor: PromptEditor | null = $state(null);
	/** Composer height glide (attached with the editor on mount). */
	let promptGlide: PromptGlide | null = null;
	let promptEl: HTMLElement | undefined = $state();
	let settingsEl: HTMLElement | undefined = $state();
	let scrollBox: HTMLElement | undefined = $state();
	/** App root (pinned to the visual height while the phone keyboard is up). */
	let appEl: HTMLElement | undefined = $state();
	/** Scroll/viewport values: one grouped object, so
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
			annotateMode.selMenu = null;
		/* The language sheet is fitted to its open-frame geometry:
		a thread scroll invalidates the fit, so it closes instead of
		floating mis-anchored. */
		if (openLangMenu) openLangMenu = null;
		// The orange pill sticks to its document point, never the
		// viewport: shift it by the scroll delta so it rides with
		// the quote that opened it (fixed plus tracking reads as
		// absolute, with the mount untouched). The answer card
		// rides the same way, off its own open-offset.
		if (annPop && !annPopClosing && scrollBox) {
			const dy = scrollBox.scrollTop - annPopTop;
			if (dy !== 0) {
				annPopTop = scrollBox.scrollTop;
				annPop = { ...annPop, y: annPop.y - dy };
			}
		}
		if (annotateMode.answerPop && !annotateMode.answerClosing && scrollBox) {
			const dy = scrollBox.scrollTop - annotateMode.answerPopTop;
			if (dy !== 0) {
				annotateMode.answerPopTop = scrollBox.scrollTop;
				annotateMode.answerPop = { ...annotateMode.answerPop, y: annotateMode.answerPop.y - dy };
			}
		}
		saveChatScroll();
		if (scrollBox) noteStick(scrollBox);
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
	/** Message ids already toasted for send errors (Android shows no inline error). */
	const errorToasted = new SvelteSet<ChatMsgId>();
	/** Last token stamp per chat (both engines): the phase chip reads
	staleness off the 1s send ticker, so the think between tool
	rounds brings Thinking back instead of leaving a dead gap. */
	const lastTokenAt = new SvelteMap<ChatId, number>();
	/** Android background turns (see native-turns.svelte.ts). */
	const nativeTurns = new NativeTurns({
		getChatState: () => chatState,
		getSettings: () => settings,
		routeFacts: () => ({
			androidUI,
			shell: tauriBackendAvailable(),
			mock: useMock,
			onDevice: isOnDeviceProvider(settings.activeProviderId)
		}),
		systemFor: (target) =>
			replySystemPrompt(settings, activeReplyCode, target),
		isShell: () => tauriBackendAvailable(),
		isVisible: () => document.visibilityState === "visible",
		stuckToBottom: () => stuckToBottom(),
		scrollAfterRender: () => scrollAfterRender(),
		afterSend: (chatId) => afterSend(chatId, { native: true }),
		markToken: (chatId) => lastTokenAt.set(chatId, Date.now()),
		buzzFirst: (foreground) => buzzBeat("first", foreground),
		dismissReplyNotification: () =>
			void dismissReplyNotificationAsync({ shell: tauriBackendAvailable() })
	});
	/**
	 * Android reports errors as toasts, never inline chrome: a phone
	 * column has no room for a persistent banner, and a font-scaled
	 * error span blows the action row apart. Toasts auto-dismiss, so
	 * the "set an API key" notice goes away on its own too.
	 */
	$effect(() => {
		if (!androidUI) return;
		if (providerKeys.noKeyToastDue(settingsOpen)) flashErrorToast("No API key");
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
	// Draft annotations for the active chat (filed list, edit stash,
	// per-chat load/save, pins, filing, ask flow): state and verbs
	// live in the module; effects, gestures, onKey, the send pipeline,
	// the pill, and readings stay paged and delegate in. Forward
	// closures (notices, newsMode, annotateMode, androidUI) all
	// resolve before the first call, like newsMode's onBadge. Annotated
	// (not inferred): the two controllers reference each other.
	const drafts: AnnotationDrafts = new AnnotationDrafts({
		getActiveChatId: () => chatState.activeChatId,
		getChatIds: () => chatState.chats.map((c) => c.id),
		resolveProvider: () => providerKeys.resolveActive(),
		answerQuestion: (provider, q) => annotationAnswer(provider, q),
		answerContextFor: (ann) =>
			annotateMode.answerContextFor(ann, ann.quote, ann.at ?? 0),
		notifyBanner: (message) => showNotice(notices, "banner", message),
		clearBanner: () => clearNotice(notices, "banner"),
		toastError: (message) => flashErrorToast(message),
		isPhone: () => androidUI,
		isNewsStoryOpen: (link) =>
			newsMode.news?.stories.some((s) => s.link === link) ?? false,
		openBadge: (id) => annotateMode.openBadge(id)
	});
	$effect(() => {
		drafts.autosave();
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
		const draftCount = drafts.list.length;
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
	/** Whether the annotations review drawer is open. */
	let reviewOpen = $state(false);
	/** Pill node for the composer's pillEl bind (the staged pill is
	 * gone — pin-only now — but the bind stays for focus geometry). */
	let annPill: HTMLButtonElement | null = $state(null);
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
		// Offsets in message order (trimmed rows count as passed);
		// the position math lives in chat (pure, tested).
		const offsets = waypointOffsets(
			points,
			trimPointIndex(activeChat(chatState)),
			(p) => box.querySelector<HTMLElement>(`#msg-${p}`)?.offsetTop ?? null
		);
		wpPos = waypointIndexAt(offsets, box.scrollTop);
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
	/**
	 * Mobile in-prompt annotation create: the composer holds the
	 * pending comment (the transplanted popover textbox can't reliably
	 * summon the phone keyboard), the send arrow files it, tapping out
	 * cancels. Filed notes never transplant — they open the dock.
	 * Desktop never sets this — the popover stays. The stash restores
	 * the drafted chat text on file and on cancel.
	 */
	let promptAnnEdit: { pending: true } | null = $state(null);
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
	/** Draft list stash and filed view live in the drafts controller. */
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
	/** Cursor-anchored annotation pill (ChatGPT-style). Null when closed. */
	let annPop = $state<{
		id: string;
		x: number;
		y: number;
		fresh: boolean;
	} | null>(null);
	/** Thread scroll offset when the pill opened: the pill sticks to
	its document point (never the viewport), so scrolls shift it by
	the delta — fixed plus tracking, no mount move needed. */
	let annPopTop = 0;
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
		/** Quote occurrence for scroll re-anchoring (see rectForQuoteSpan). */
		at: number;
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
		/** Quote occurrence for scroll re-anchoring (see rectForQuoteSpan). */
		at: number;
		runs: GroupedRun[];
		plain: boolean;
		/** Resolved slice offsets (sentence offsets plus the quote
		shift) for scroll re-anchoring: the group re-measures
		against the live selection instead of its open-frame rect. */
		span: { start: number; end: number } | null;
	}
	let selFurigana = $state<FuriganaPanel[] | null>(null);
	/** Pinned panels belong to an open pill/answer, not the live
	highlight: creating/answering steals focus (collapsing the
	document selection), so the watcher must not dismiss them on
	empty — only on a mismatched new highlight, or explicitly on
	submit/cancel/close (dismissSelPanels resets this). */
	let panelsPinned = $state(false);
	/** Drop every selection overlay at once: the flat panel, the
	furigana panels, and the document tint. Every dismiss site below
	uses this — a bare selPinyin clear would strand tinted kanji. */
	function dismissSelPanels(): void {
		panelsPinned = false;
		selPinyin = null;
		selFurigana = null;
		unwrapFuriganaTint();
		// Unwrap surgery breaks live wash ranges the same way wraps
		// do (see above): repair a wash that outlives its panels.
		repaintLiveWash();
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
	 * Pending multi-click menu summon: double/triple/quadruple
	 * presses summon once the sequence settles (300ms with no new
	 * press) instead of after press 2 — the menu appearing mid-run
	 * would eat press 3/4 (the click lands on the menu and clears
	 * the pick), breaking triple/quad sentence/paragraph. The next
	 * mousedown cancels it. Single-press drags summon instantly.
	 */
	const MULTI_CLICK_SETTLE_MS = 300;
	let multiClickMenuAt: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		if (!annotateMode.selMenu) {
			annotateMode.selMenuHover = false;
			return;
		}
		if (annotateMode.selMenuHover) return;
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
							hover: annotateMode.selMenuHover,
							lastInputAt,
							now: Date.now(),
							idleMs: SEL_MENU_IDLE_MS
						}) === "rearm"
					) {
						arm();
						return;
					}
					annotateMode.selMenu = null;
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
		const menu = annotateMode.selMenu;
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
		if (x !== null) annotateMode.selMenu = { ...menu, x };
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
			// Leaving is silent by design: the shade notice already
			// says the reply keeps working, and the ready ping owns
			// the background — no haptic here, the service claim
			// needs none.
			if (document.visibilityState !== "visible") return;
			clearStudyBadge();
			void dismissReplyNotificationAsync({
				shell: tauriBackendAvailable()
			});
			void nativeTurns.reconcile();
		};
		// Native turn events (Android shell): token stream, fetch phase,
		// retry resets, and completion. Suspension-safe by design —
		// anything missed lands through the return/boot scan instead.
		const unlistenTurns = nativeTurns.listen(listen);
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
		void nativeTurns.reconcile();
		return () => {
			window.removeEventListener("pointerdown", stampPress);
			window.removeEventListener("keydown", stampPress);
			document.removeEventListener("visibilitychange", onVisible);
			unlistenTurns();
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
		if (!t || !annotateMode.selMenu) return;
		selMenuDrag = { mx: t.clientX, my: t.clientY, x0: annotateMode.selMenu.x, y0: annotateMode.selMenu.y };
		selMenuDragging = true;
	}
	function menuDragMove(event: TouchEvent): void {
		const drag = selMenuDrag;
		const t = event.changedTouches[0];
		if (!drag || !t || !annotateMode.selMenu) return;
		// Target resolution lives in selMenuDragTarget (pinned in
		// annotations.test.ts); the suppress stamp and assignment stay
		// here as effects.
		const at = selMenuDragTarget(
			drag,
			{ x: t.clientX, y: t.clientY },
			window.innerWidth,
			window.innerHeight
		);
		if (!at) return;
		menuDragSuppressAt = Date.now();
		annotateMode.selMenu = { ...annotateMode.selMenu, x: at.x, y: at.y };
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
		// Decision lives in menuBtnTouchAction (pinned in
		// annotations.test.ts: a menu drag just ended here eats the
		// tap via the drift guard, plus the synthesized sequel); the
		// touch reset, press stamp, and run stay here as effects.
		const t = event.changedTouches[0];
		const action = menuBtnTouchAction({
			now: Date.now(),
			suppressAt: menuDragSuppressAt,
			start: menuBtnTouchStart,
			end: t ? { x: t.clientX, y: t.clientY } : null
		});
		menuBtnTouchStart = null;
		menuPressAt = Date.now();
		if (action !== "run") return;
		event.preventDefault();
		run();
	}
	function annotateTouch(event: TouchEvent): void {
		menuBtnTouch(event, () => annotateMode.annotate());
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
		if (!annotateMode.selMenu) return;
		const menu = annotateMode.selMenu;
		buzzTap();
		if (settings.readerMode !== "off") {
			annotateMode.selMenu = null;
			void openReader(menu.quote);
			return;
		}
		// Japanese kanji speak their sentence reading, never the raw
		// fragment (right-click parity): になる美 alone converts to
		// になるうつくしい — the bare quote would read 美 as ビ with
		// no sentence to correct it. showSelectionFurigana also shows
		// the popup, so this path skips popupSelectionReadings.
		const probe = sentenceForQuote(menu.context, menu.quote) ?? menu.context;
		// Headline picks read aloud with no readings panels
		// (message-DOM placement has nothing to place on).
		if (
			menu.messageId &&
			[...menu.quote].some((ch) => isHanChar(ch)) &&
			hanOverlayLangFor(probe) === "ja"
		) {
			const kana = await showSelectionFurigana({
				quote: menu.quote,
				messageId: menu.messageId
			});
			void speakQuote(kana ?? menu.quote, selSpeakKey(menu), true, menu.context);
			if (androidUI) liftSelMenuAboveReadings();
			return;
		}
		if (menu.messageId) {
			void popupSelectionReadings(
				menu.quote,
				menu.messageId,
				menu.context
			).then(() => {
				if (androidUI) liftSelMenuAboveReadings();
			});
		}
		void speakQuote(menu.quote, selSpeakKey(menu), true, menu.context);
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
		if (!androidUI || !annotateMode.selMenu) return;
		if (!selPinyin?.above && !selFurigana?.some((panel) => panel.above))
			return;
		requestAnimationFrame(() => {
			const tops: number[] = [];
			document.querySelectorAll(".sel-pinyin.above").forEach((el) => {
				if (el instanceof HTMLElement)
					tops.push(el.getBoundingClientRect().top);
			});
			const menu = selMenuEl;
			const current = annotateMode.selMenu;
			if (!(menu instanceof HTMLElement) || !current || tops.length === 0)
				return;
			const mr = menu.getBoundingClientRect();
			if (mr.width === 0 || mr.height === 0) return;
			const y = menuYAbovePanel(Math.min(...tops), mr.height);
			if (y < current.y) annotateMode.selMenu = { ...current, y };
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
	/**
	 * Readings panels track their highlight through scrolls like the
	 * menu does: a fixed panel placed against its open-frame rect
	 * drifts as replies stream and the thread moves under it (at
	 * large type the drift reads as "far away"). Each panel
	 * re-measures against the live selection while it still covers
	 * the panel's quote; moved-on or collapsed selections leave
	 * panels alone (the watcher dismisses those).
	 */
	function trackReadingsPanels(): void {
		if (!selPinyin && !selFurigana) return;
		try {
			const selection = window.getSelection();
			const range =
				selection && selection.rangeCount > 0
					? selection.getRangeAt(0)
					: null;
			if (!range || range.collapsed) return;
			if (
				!document.contains(range.startContainer) ||
				!document.contains(range.endContainer)
			)
				return;
			const slices = selectionSlices(range);
			if (!slices) return;
			const walkText = slices
				.map((s) => (s.node.textContent ?? "").slice(s.start, s.end))
				.join("");
			if (selPinyin && walkText.includes(selPinyin.quote)) {
				const rect = range.getBoundingClientRect();
				if (rect.width > 0 || rect.height > 0) {
					const placed = panelXY(rect);
					if (
						placed.x !== selPinyin.x ||
						placed.y !== selPinyin.y ||
						placed.above !== selPinyin.above
					)
						selPinyin = { ...selPinyin, ...placed };
				}
			}
			if (selFurigana) {
				const quote = selFurigana[0]?.quote;
				if (!quote || !walkText.includes(quote)) return;
				let moved = false;
				const next = selFurigana.map((panel) => {
					const rect = panel.span
						? spanRect(slices, panel.span.start, panel.span.end)
						: null;
					const placed = panelXY(rect ?? range.getBoundingClientRect());
					if (
						placed.x !== panel.x ||
						placed.y !== panel.y ||
						placed.above !== panel.above
					)
						moved = true;
					return { ...panel, ...placed };
				});
				if (moved) selFurigana = next;
			}
		} catch {
			// Measurement races leave panels where they are.
		}
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
		quoted: { quote: string; messageId: ChatMsgId; at?: number },
		html: string
	): void {
		const live = window.getSelection();
		const rect = live?.rangeCount
			? live.getRangeAt(0).getBoundingClientRect()
			: null;
		// A zero-area rect is a detached or hidden range (focus
		// collapse across engines, pill focus in the shell): placing
		// from it strands the panel at the viewport corner, so skip
		// instead — resolve re-anchors from the document below.
		if (!rect || (rect.width === 0 && rect.height === 0)) return;
		selPinyin = {
			...panelXY(rect),
			quote: quoted.quote,
			messageId: quoted.messageId,
			at: quoted.at ?? 0,
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
	async function showSelectionFurigana(
		quoted: {
			quote: string;
			messageId: ChatMsgId;
			at?: number;
		},
		// Pinned callers (create/answer) pass the context outright:
		// their highlight is gone (focus collapse) by resolve time,
		// so the pending panel's own anchor stands in for the live
		// match below.
		explicitContext?: string
	): Promise<string | null> {
		dismissSelPanels();
		// Pinned callers (create/answer) resolve after pill focus
		// collapses the selection: re-pin past this clear, or the
		// loading panel dies on the next selectionchange before the
		// worker lands. Unpinned (right-click) stays unpinned.
		if (explicitContext !== undefined) panelsPinned = true;
		placeSelPinyin(quoted, "…");
		const live = annotateMode.currentQuote();
		const context =
			live && live.messageId === quoted.messageId && live.quote === quoted.quote
				? live.context
				: (explicitContext ??
					(selPinyin?.quote === quoted.quote &&
					selPinyin.messageId === quoted.messageId
						? quoted.quote
						: null));
		if (!context) return null;
		// Convert the sentence, slice the highlight: isolated text
		// misreads (生 alone is せい, in 生まれる it is う).
		const sentence = sentenceForQuote(context, quoted.quote) ?? quoted.quote;
		let html: string;
		try {
			html = await furiganaHtml(sentence, "furigana");
		} catch {
			html = "";
		}
		const now = annotateMode.currentQuote();
		const anchored =
			selPinyin?.quote === quoted.quote &&
			selPinyin.messageId === quoted.messageId;
		if (!now) {
			// No live highlight: unpinned resolves need one (drop),
			// pinned resolves re-anchor from the document below —
			// the submit/focus collapse took it, nobody moved on.
			if (!explicitContext) return null;
		} else if (
			now.messageId !== quoted.messageId ||
			now.quote !== quoted.quote
		) {
			// A moved-on highlight drops the async result — unless
			// the pending panel still addresses this quote (the
			// collapse is ours, not theirs).
			if (!(explicitContext && anchored)) return null;
		}
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
				document,
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
		// document kanji. A dead highlight (focus collapse after the
		// pill opens, DOM surgery under the worker) re-locates the
		// quote in the document first: every group still measures its
		// own span instead of stacking all panels on one rect — only
		// a vanished quote strands the popup.
		const selection = window.getSelection();
		let range =
			selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		if (!range || range.collapsed || !document.contains(range.startContainer)) {
			range =
				rangeForQuote(quoted.messageId, quoted.quote, quoted.at ?? 0) ??
				range;
		}
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
			// No live highlight (focus collapse or DOM surgery took
			// it before the worker landed): re-anchor from the
			// document instead of dismissing — or stranding a panel
			// at the corner from a zero-area rect. Detached ranges
			// report zeros (truthy), so area-guard the live rects.
			const live = rect ?? highlightRect;
			const usable =
				live && (live.width > 0 || live.height > 0) ? live : null;
			const anchor =
				usable ??
				screenRectForQuote(quoted.messageId, quoted.quote, quoted.at ?? 0);
			if (!anchor) {
				dismissSelPanels();
				return null;
			}
			panels.push({
				...panelXY(anchor),
				quote: quoted.quote,
				messageId: quoted.messageId,
				at: quoted.at ?? 0,
				runs,
				plain: solo,
				span: exact ? { start, end } : null
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
		// Tint wraps yank quoted text nodes out from under a live
		// registry wash (a removed endpoint collapses to its parent
		// and the paint goes blank): re-locate and repaint the live
		// wash off the post-surgery DOM. Unconditional: a failed
		// tint can still have partially wrapped, and the repair is a
		// no-op with no live wash or no resolvable quote. Unwrap
		// sites ride dismissSelPanels below, same repair.
		if (exact && slices && !solo) {
			tintSelectionSpans(slices, tintSpans);
			repaintLiveWash();
		}
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
	// Readings panels for a Han quote (right-click, answer open,
	// create): local pinyin places at once; Japanese resolves
	// sentence-correct kana first (async). A silent extra — speech
	// stays with the caller, which awaits the kana when the voice
	// needs it. Placement reads the live rect, so the quote must be
	// selected at call time; pinned callers (create/answer) keep
	// their panels past the focus collapse that follows, with an
	// explicit context for the async resolve. Never throws.
	async function readingsForQuote(
		quoted: {
			quote: string;
			messageId: ChatMsgId;
			context: string;
			at?: number;
		},
		pin = false
	): Promise<string | null> {
		if (!pin) panelsPinned = false;
		else panelsPinned = true;
		const probe =
			sentenceForQuote(quoted.context, quoted.quote) ?? quoted.context;
		if (![...quoted.quote].some((ch) => isHanChar(ch))) {
			if (pin) panelsPinned = false;
			return null;
		}
		if (
			hanOverlayLangFor(probe) !== "ja" &&
			offeredLocalAids(quoted.quote, activeReplyCode).includes("pinyin")
		) {
			const readings = readingsOnly(pinyinRuby(quoted.quote), " ", "rt");
			if (readings) placeSelPinyin(quoted, readings);
			if (pin && !selPinyin) panelsPinned = false;
			return null;
		}
		if (hanOverlayLangFor(probe) === "ja") {
			const kana = await showSelectionFurigana(
				quoted,
				pin ? quoted.context : undefined
			);
			if (pin && !selPinyin && !selFurigana) panelsPinned = false;
			return kana;
		}
		if (pin) panelsPinned = false;
		return null;
	}
	/** Sync offer check behind readingsForQuote: creation keeps
	the highlight (instead of clearing it) exactly when panels
	are coming, so they have a live rect to place against. */
	function quoteOffersReadings(quoted: {
		quote: string;
		messageId: ChatMsgId;
		context: string;
	}): boolean {
		const probe =
			sentenceForQuote(quoted.context, quoted.quote) ?? quoted.context;
		if (![...quoted.quote].some((ch) => isHanChar(ch))) return false;
		return (
			(hanOverlayLangFor(probe) !== "ja" &&
				offeredLocalAids(quoted.quote, activeReplyCode).includes("pinyin")) ||
			hanOverlayLangFor(probe) === "ja"
		);
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
	function copySelection(): void {
		const quote = annotateMode.selMenu?.quote ?? "";
		if (quote === "") return;
		copyPlain(quote, "Copied");
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
	function flashToast(
		message: string,
		action?: () => void,
		timeoutMs = toastTimeoutFor(message)
	): void {
		flashNotice(notices, "toast", message, timeoutMs);
		toastAction = action ? { seq: notices.toast.seq, run: action } : null;
	}
	function dismissToast(): void {
		clearNotice(notices, "toast");
	}
	/** Transient top error toast: action failures (send errors, export,
	attach, mic) render in the red pairing, themed both ways. An
	optional tap action (same generation-pinned lifetime as the
	plain-toast action) opens the fix instead of copying — the
	Screen Recording denial arms the System Settings pane. */
	let errorToastAction = $state<{ seq: number; run: () => void } | null>(null);
	function flashErrorToast(message: string, action?: () => void): void {
		flashNotice(
			notices,
			"errorToast",
			message,
			errorToastTimeoutFor(message)
		);
		errorToastAction = action
			? { seq: notices.errorToast.seq, run: action }
			: null;
	}
	/** Missing-key notice, one source: banner everywhere, toast on
	phones. Ask, aids, and locked taps share it so the copy and the
	pairing never fork. */
	function flashMissingKey(): void {
		const message = "Set an API key first — open Settings.";
		showNotice(notices, "banner", message);
		if (androidUI) flashErrorToast(message);
	}
	let stopDictation: (() => void) | null = null;
	let openLangMenu: LanguageMenu["id"] | null = $state(null);
	/** Typeahead inside the open language menu: the landed language
	and the letters typed so far (reset after a pause). */
	let langTyped = $state<string | null>(null);
	let langTypeBuffer = { query: "", at: 0 };
	$effect(() => {
		void openLangMenu;
		langTyped = null;
		langTypeBuffer = { query: "", at: 0 };
	});
	/** Keys for an open language menu: letters jump, arrows step,
	Enter picks. True when the key was the menu's. */
	function langMenuKey(event: KeyboardEvent): boolean {
		const menu = LANGUAGE_MENUS.find((m) => m.id === openLangMenu);
		if (!menu || event.metaKey || event.ctrlKey || event.altKey) return false;
		const order = menuOrder(menu);
		const at = order.findIndex((l) => l.code === langTyped);
		if (event.key === "Enter") {
			const lang = order[at];
			if (!lang) return false;
			langMenusActions.pick(lang);
			return true;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			const step = event.key === "ArrowDown" ? 1 : -1;
			const next = at < 0 ? (step > 0 ? 0 : order.length - 1) : (at + step + order.length) % order.length;
			langTyped = order[next]?.code ?? null;
			return true;
		}
		if (event.key.length === 1 && /\p{L}/u.test(event.key)) {
			langTypeBuffer = typeaheadBuffer(langTypeBuffer, event.key, Date.now());
			const hit = typeaheadMatch(order, langTypeBuffer.query);
			if (hit !== null) langTyped = order[hit]?.code ?? null;
			return true;
		}
		return false;
	}
	/* Sheet anchor: the open list escapes the thread scroller
	(fixed, centered on the screen) because inside .messages
	anything past its box clips — Europe's 20-item list read as
	five languages cut by a rectangle. Short lists drop under
	their pill, long ones center (see .lang-list-fixed). */
	let langMenuAnchor: LangMenuAnchor | null = $state(null);
	/** Learner news mode (empty chats only): picking a language
	opens its story cards under the pill rail; launching a session
	collapses the panel and the chat holds only the session.
	State and behavior live in `NewsMode`; the page only wires
	its collaborators here. */
	const newsMode = new NewsMode({
		getEditor: () => editor,
		getAttachments: () => attachments,
		setAttachments: (next) => {
			attachments = next;
		},
		seedComposer: (text) => {
			const ed = editor;
			if (!ed) throw new Error("news-no-editor");
			markerSyncMuted = true;
			try {
				ed.setText(text);
				syncMarkerCounts();
			} finally {
				markerSyncMuted = false;
			}
		},
		toast: (message) => flashToast(message),
		toastError: (message) => flashErrorToast(message),
		tapTick: () => buzzTap(),
		denyBuzz: () => buzzNo(),
		resolveProvider: () => providerKeys.resolveActive(),
		getStorage: () => localStorage,
		isPhone: () => androidUI,
		parkPrompt: () => {
			promptIdle = true;
		},
		restorePrompt: () => restorePrompt(),
		requestSend: () => {
			void doSend();
		}
	});
	// Annotation orchestration (selection menu, create/commit, badge
	// cards, review jumps, quote helpers): state and verbs live in
	// the module; effects, gestures, onKey, the send pipeline, the
	// pill, and readings stay paged and delegate in.
	const annotateMode = new AnnotateMode({
		getAnnotations: () => drafts.list,
		setAnnotations: (next) => {
			drafts.setList(next);
		},
		filePendingDraft: (pending, draft) => drafts.filePending(pending, draft),
		getPending: () => pendingAnn,
		setPending: (next) => {
			pendingAnn = next;
		},
		getAnnDraft: () => annDraft,
		setAnnDraft: (next) => {
			annDraft = next;
		},
		getHighlight: () => highlightAnnId,
		setHighlight: (id) => {
			highlightAnnId = id;
		},
		setReviewOpen: (open) => {
			reviewOpen = open;
		},
		getChatMessages: () => chat.messages,
		getViewMessages: () => viewChat.messages,
		getMessageContent: (id) =>
			chatState.chats.flatMap((c) => c.messages).find((m) => m.id === id)
				?.content ?? null,
		isAidPinned: (messageId) => aidModelPin.has(messageId),
		getNews: () => newsMode.news,
		getSettings: () => ({
			fontScale: settings.fontScale,
			inspectEnabled: settings.inspectEnabled,
			hapticsEnabled: settings.hapticsEnabled
		}),
		isPhone: () => androidUI,
		isIOS: () => iosUI,
		isPreviewing: () => previewing,
		getScrollBox: () => scrollBox,
		ensureSwapObserver: () => ensureSwapObserver(),
		speak: (quote, key, keepMenu, context) => {
			void speakQuote(quote, key, keepMenu, context);
		},
		selSpeakKey: (sel) => selSpeakKey(sel),
		annSpeakKey: (ann) => annSpeakKey(ann),
		quoteOffers: (quoted) => quoteOffersReadings(quoted),
		readingsFor: (quoted, pin) => {
			void readingsForQuote(quoted, pin);
		},
		dismissSelPanels: () => dismissSelPanels(),
		openCreatePill: (id, x, y, draft) => {
			annDraft = draft;
			settleAnnPop();
			annPop = { id, x, y, fresh: true };
			annPopTop = scrollBox?.scrollTop ?? 0;
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
			if (settings.hapticsEnabled) {
				lastBeatAt = performance.now();
				vibrateTick(6);
			}
		},
		cancelPillFor: (id) => {
			if (annPop && !annPopClosing && annPop.id === id) {
				cancelAnnPop();
				return true;
			}
			return false;
		},
		dismissPill: (id) => {
			if (id !== undefined && id !== null) {
				if (annPop?.id === id) {
					settleAnnPop();
					annPop = null;
				}
				return;
			}
			settleAnnPop();
			if (annPop && !annPopClosing) {
				settleAnnPop();
				annPop = null;
			}
		},
		stopPillMic: () => stopPillMic(),
		refitAnswerCard: (id) => refitAndroidCard("answer", id),
		popWidth: () => popWidth(),
		hasPromptEdit: () => promptAnnEdit !== null,
		commitPromptEdit: () => commitPromptAnnEdit(),
		editInPrompt: (comment) => editAnnotationInPrompt({ pending: true }, comment),
		scrollRectIntoClear: (rect) => scrollRectIntoClear(rect),
		flashJumpMark: (locate) => flashJumpMark(locate),
		unstick: () => {
			viewport.stick = false;
		},
		toast: (message) => flashToast(message),
		toastError: (message) => flashErrorToast(message),
		buzzDelete: () => buzzBeat("done", androidUI)
	});
	function toggleLangMenu(id: LanguageMenu["id"], btn: HTMLElement): void {
		// Family open/close ticks on phones (buzzTap self-gates to
		// Android and honors the haptics toggle).
		buzzTap();
		if (openLangMenu === id) {
			openLangMenu = null;
			return;
		}
		// A fresh sheet covers the top-center toast seat: fold any
		// lingering confirmation (the pick toast names its language)
		// instead of painting over the options.
		dismissToast();
		openLangMenu = id;
		const r = btn.getBoundingClientRect();
		const composerTop =
			promptEl?.getBoundingClientRect().top ?? window.innerHeight;
		// Smart anchor geometry lives in languages (pure, tested);
		// only the DOM reads stay here.
		langMenuAnchor = langMenuAnchorFor({
			btnLeft: r.left,
			btnBottom: r.bottom,
			composerTop,
			viewportWidth: window.innerWidth
		});
	}
	$effect(() => {
		if (!openLangMenu) langMenuAnchor = null;
	});
	/* A fitted box goes stale on any geometry change (rotation,
	keyboard glide, window resize): close it instead of wearing a
	mis-anchored sheet. */
	$effect(() => {
		if (!openLangMenu) return;
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
	/** Flashcards: sitting, schedule, and export (see flashcards-mode). */
	const flashcards = new FlashcardsMode({
		getChats: () => chatState.chats,
		draftsFor: (id) => drafts.draftsFor(id),
		isEnabled: () => settings.flashcardsEnabled,
		isChatEmpty: () => activeChat(chatState).messages.length === 0,
		isShell: () => tauriBackendAvailable(),
		isPhone: () => androidUI,
		focusComposer: () => editor?.focus(),
		speakQuote: (quote, id, context) => void speakQuote(quote, id, true, context),
		getSpeakingSelection: () => speakingSelection,
		stopVoice: () => stopVoice(),
		saveText: (filename, text) =>
			nativeSaveText(filename, text, { name: "Anki import", extensions: ["txt"] }),
		copyText: (text) => copyExportText(text),
		downloadText: (text, filename) => downloadMarkdownFile(text, filename),
		isDismissal: (error) => isPermissionDismissal(error),
		toast: (message) => flashToast(message),
		toastError: (message) => flashErrorToast(message)
	});
	// Turning flashcards off mid-sitting closes the deck.
	$effect(() => {
		if (!settings.flashcardsEnabled && untrack(() => flashcards.isOpen))
			flashcards.close();
	});
	/**
	 * Big-word reader (see reader.ts): the open session (null closed)
	 * and the voice routing for its text. The reader speaks phrase by
	 * phrase through startSpeech; a generation guard drops ends from
	 * phrases a pause, jump, or close already replaced.
	 */
	// Voice speed rides module state in voice.ts (every speak path,
	// web and native, reads it there).
	$effect(() => setSpeechRate(settings.voiceSpeed ?? 1));
	let reader = $state<ReaderState | null>(null);
	const readerOpen = $derived(reader !== null);
	let readerLang: string | ((sentence: string) => string) = "en-US";
	let readerSeq = 0;
	async function openReader(text: string, offset = 0): Promise<void> {
		const mode = settings.readerMode;
		if (mode === "off") return;
		const phrases = readerPhrases(text, undefined, settings.readerWords ?? 0);
		if (phrases.length === 0) return;
		const fallback = latinFallback(settings.voiceLang);
		const voices = webVoices();
		const seed = await quoteLangFor(text, fallback);
		readerLang = await sentenceLangsFor(text, seed, voices, fallback);
		reader = startReader(phrases, mode, phraseIndexAtOffset(text, phrases, offset));
		speakReaderPhrase();
	}
	function speakReaderPhrase(): void {
		const phrase = reader?.phrases[reader.index];
		if (!phrase) return;
		const seq = ++readerSeq;
		const lang = typeof readerLang === "function" ? readerLang(phrase.sentence) : readerLang;
		startSpeech("reader", phrase.text, lang, false, () => {
			if (seq === readerSeq) stepReader("spoken");
		});
	}
	function stepReader(event: ReaderEvent): void {
		if (!reader) return;
		const next = readerStep(reader, event);
		reader = next.state;
		if (next.effects.close) {
			closeReader();
			return;
		}
		if (next.effects.stop) {
			readerSeq++;
			stopVoice();
		}
		if (next.effects.speak) speakReaderPhrase();
	}
	function closeReader(): void {
		readerSeq++;
		reader = null;
		if (speakingId === "reader") stopVoice();
	}
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
		if (!annotateMode.selMenu) return;
		const quote = annotateMode.selMenu.quote.trim();
		if (!shouldShowInspect(quote, settings.inspectEnabled)) return;
		// One delegated tick for every open path (dock, menu, key):
		// Android-only and toggle-gated inside, so desktop stays silent.
		buzzTap();
		inspectChar = quote;
		inspectLang = inspectLangFor(quote, annotateMode.selMenu.context);
		annotateMode.clearSelection();
		annotateMode.selMenu = null;
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
			!nativeTurns.live.has(chatState.activeChatId) &&
			(hasText || attachments.length > 0 || drafts.list.length > 0)
	);

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
			messages: c.messages.map((m) => ({
				id: m.id,
				content: m.content,
				role: m.role
			}))
		}));
	}

	/** Search header for a chat: its title and time, so a hit says
	which conversation it came from. */
	function searchChatTitle(chatId: string): string {
		const target = chatState.chats.find((c) => c.id === chatId);
		if (!target) return "";
		return `${chatTitle(target)} · ${chatLabel(target.createdAt)}`;
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
					drafts.list,
					(id) => drafts.draftsFor(id)
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

	// No Cmd+scroll text zoom, deliberately: trackpad momentum keeps
	// firing wheel events with Cmd held after the fingers lift, and
	// WheelEvent exposes no finger-contact signal — every swipe ran
	// away past its gesture. Cmd+= / Cmd+- (menu and chrome chords),
	// pinch, and the sliders remain the zoom paths.
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
					palette.hits = groupHitsByChat(hits);
					palette.cursor = 0;
					palette.busy = false;
				})
				.catch(() => {
					palette.hits = [];
					palette.busy = false;
				});
		}, 120);
	}

	/** Chat switching cuts instantly — no crossfade, no slide: one
	chat is replaced by the next in the same frame. */
	function transitionToChat(id: Parameters<typeof selectChat>[1]): void {
		const from = chatState.activeChatId;
		dismissSelPanels();
		newsMode.clear();
		const mutate = (): void => {
			// File the leaving chat's scroll first (a no-op mid-peek,
			// where the box shows another chat), then clear the hover
			// preview in the same flush, never before it: clearing
			// first renders the old chat for a frame, so picking a
			// previewed row flashes back before landing.
			saveChatScroll();
			previewChatId = null;
			// Draft annotations belong to one chat: file the leaving
			// chat's away, then restore the entering chat's. Doing both
			// inside the transition keeps the autosave effect (which
			// also keys on activeChatId) from ever filing one chat's
			// drafts under another's id.
			drafts.fileChat(from);
			selectChat(chatState, id);
			drafts.restoreChat(id);
			// Answers lost crossing chats (or a restart) refire here:
			// inflight asks stay single via the asking set, answered
			// drafts never refire.
			drafts.resumeUnanswered();
			restoreChatScroll(id);
		};
		// Re-entering the live chat (preview-as-you-go already landed
		// here, or Enter on the active row) is identical state either
		// way; cycling inside the open phone switcher cuts the same
		// way. Every path lands in the same flush below.
		if (id !== from && !chatSwitcherOpen) {
			// Leaving for another chat stops the voice: the readout
			// belongs to the old chat, and a new chat never inherits it.
			stopVoice();
		}
		mutate();
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
		viewport.missed = false;
		viewport.anchor = null;
	}

	/** Jump to a palette hit: its chat, scrolled to its message. */
	function enterSearchHit(hit: SearchHit): void {
		const chat = chatState.chats.find((c) => c.id === hit.doc.chatId);
		if (!chat) return;
		const query = palette.query;
		transitionToChat(chat.id);
		palette.open = false;
		palette.query = "";
		palette.hits = [];
		if (hit.doc.msgId) {
			const index = chat.messages.findIndex((m) => m.id === hit.doc.msgId);
			if (index >= 0 && androidUI) {
				// Phones have no find chord: when the chat holds more
				// matches, the find bar opens on this one with the
				// field unfocused (no keyboard) so ‹ › step the rest.
				const findQuery = findQueryFor(query);
				const stops = findMessageIndices(
					chat.messages.map((m) => m.content),
					findQuery
				);
				if (stops.length > 1 && stops.includes(index)) {
					find = { ...emptyFind(), open: true, query: findQuery };
					requestAnimationFrame(() => {
						// The bar counts the visible (untrimmed) thread.
						find.cursor = Math.max(currentFindHits().indexOf(index), 0);
						landFindHit();
					});
					return;
				}
			}
			if (index >= 0) {
				// The jump lands silently: the message scrolls into view
				// and takes DOM focus (Tab still walks message order),
				// but nothing is selected — edit mode owns j/k from here
				// so they glide instead of walking from a cursor. (No
				// enterEditMode: focus stays on the message, not the
				// composer.)
				focusMode = "edit";
				selectedIdx = -1;
				// The matched words flash where the hit lands (hold, then
				// fade), so a long message shows where to look.
				const flashText = hitMatchText(hit);
				const msgId = hit.doc.msgId as ChatMsgId;
				requestAnimationFrame(() => {
					const el = document.getElementById(`msg-${index}`);
					el?.focus({ preventScroll: true });
					if (flashText) jumpToQuotedText(msgId, flashText);
					else {
						el?.scrollIntoView({ block: "center", behavior: "smooth" });
						pulseLanded(index);
					}
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
		if (!find.open) return [];
		// Find searches the visible thread: trimmed rows match nothing
		// (undo the trim to search the whole history).
		const floor = Math.max(trimPointIndex(viewChat), 0);
		return findMessageIndices(
			viewChat.messages.map((m) => m.content),
			find.query
		).filter((i) => i >= floor);
	}
	function landFindHit(): void {
		const index = currentFindHits()[find.cursor];
		if (index === undefined) return;
		enterScrollMode();
		selectedIdx = index;
		const msg = viewChat.messages[index];
		const flashText = msg ? matchedText(msg.content, find.query) : null;
		requestAnimationFrame(() => {
			// Each stop flashes the matched words inside the message.
			if (msg && flashText) jumpToQuotedText(msg.id, flashText);
			else {
				document
					.getElementById(`msg-${index}`)
					?.scrollIntoView({ block: "center", behavior: "smooth" });
				pulseLanded(index);
			}
		});
	}

	/** Picking a chat from a filtered list lands on the filter's first
	match there, flashed, instead of wherever the chat was left. */
	function landFilterMatch(id: ChatId, query: string): void {
		if (!query.trim()) return;
		requestAnimationFrame(() => {
			if (chatState.activeChatId !== id) return;
			for (const msg of viewChat.messages) {
				const text = matchedText(msg.content, query);
				if (text) {
					jumpToQuotedText(msg.id, text);
					return;
				}
			}
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
		buzzBeat("first", androidUI && !silent);
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
		bootSettings.promptIdleSec === PROMPT_IDLE_ALWAYS &&
		(activeChat(chatState)?.messages.length ?? 0) > 0;
	let promptIdle = $state(bootParked);
	/** Any activity delays the hide; restoring is allowlisted below. */
	function stampInput(): void {
		lastInputAt = Date.now();
	}
	/** Allowlisted restore: show the hidden prompt again. */
	function restorePrompt(): void {
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
		// Phones never park: no summon gesture exists there, so a
		// parked composer strands with no way back.
		if (androidUI) return;
		if (
			shouldParkForNews({
				newsOpen: newsMode.news !== null,
				phone: androidUI,
				inPrompt: isPromptTarget(next),
				hasText
			})
		) {
			promptIdle = true;
			return;
		}
		if (
			!shouldHideForAlways({
				alwaysMode: settings.promptIdleSec === PROMPT_IDLE_ALWAYS,
				inPrompt: isPromptTarget(next),
				emptyChat: viewChat.messages.length === 0
			})
		)
			return;
		promptIdle = true;
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
		 * keeps tap-to-summon (no keyboard to press i on); Android
		 * has no summon gesture, so phones never park at all and
		 * taps keep native behavior everywhere. The visible floor
		 * tap stays for all: with the prompt already up, tapping
		 * its floor lands the caret.
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
			// Hidden on desktop: no click summons, full stop. Only
			// iOS tap-summons from here (Android never parks).
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
			if (settings.promptIdleSec !== PROMPT_IDLE_ALWAYS && newsMode.news === null) return;
			if (!closestFromTarget(event.target, ".prompt .ta-input")) return;
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
			// inert roots, so those hides are untouched. Chromium fires
			// a removal's focusout while the node is still attached, in
			// the middle of Svelte's DOM update (where a state write
			// throws), so the decision waits a microtask: by then a
			// removed node reads detached.
			const target = event.target;
			const next: EventTarget | null = event.relatedTarget ?? null;
			if (
				(next === null || next === document.body) &&
				Date.now() - promptPressAt < 1500
			) {
				return;
			}
			queueMicrotask(() => {
				if (target instanceof Element) {
					if (!document.contains(target)) return;
					if (target.closest("[inert]")) return;
				}
				hideForAlways(next);
			});
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
		// In-place edit dismiss: a press outside the edited message
		// cancels back to the untouched message (click-only cancel —
		// hover and focus-to-nowhere never do, see blurInlineEdit).
		// Presses inside the editing article are its own row (fold,
		// rerun, the commit checkmark) and stay live; presses in the
		// composer keep today's blur path, so a mid-edit send still
		// commits the message instead of dropping it.
		const onEditOutside = (event: PointerEvent): void => {
			if (!editingMsgId) return;
			const target = event.target instanceof Element ? event.target : null;
			if (!target) return;
			const box = document.querySelector(".msg-edit");
			if (box) {
				if (box.contains(target)) return;
				const article = box.closest("article");
				if (article && article.contains(target)) return;
			}
			if (target.closest(".prompt")) return;
			cancelMessageEdit();
		};
		window.addEventListener("pointerdown", onEditOutside, { capture: true });
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
			window.removeEventListener("pointerdown", onEditOutside, {
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
			// none: no tail to protect, hero owns the space — except
			// news mode, whose card list is a tail like any thread.
			const emptyChat = viewChat.messages.length === 0 && newsMode.news === null;
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
			if (clearPx !== lastClearPx)
				mainEl.style.setProperty("--tail-clear", `${clearPx}px`);
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
	/** UI text scale in 10% steps (50–2000% everywhere). */
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
	/** Prompt-only text size in 10% steps (50–2000%): ⌘[ / ⌘]
	 * resizes the composer without touching message text. */
	function adjustPromptScale(delta: number): void {
		const current = settings.promptScale ?? 1;
		const next = stepFontScale(current, delta);
		if (next === current) {
			flashToast(`Prompt text size ${Math.round(current * 100)}% (limit)`);
			return;
		}
		settings.promptScale = next;
		persistSettings();
		flashToast(`Prompt text size ${Math.round(next * 100)}%`);
	}
	/** Prompt-only width in 2rem steps (desktop only — phones fill
	 * the viewport): ⇧⌘[ / ⇧⌘] widens the composer, never the
	 * column. */
	function adjustPromptWidth(delta: number): void {
		if (androidUI) return;
		const current = settings.promptWidth ?? PROMPT_WIDTH_BASE_REM;
		const next = stepChatWidth(current, delta);
		if (next === current) {
			flashToast(`Prompt width ${current} rem (limit)`);
			return;
		}
		settings.promptWidth = next;
		persistSettings();
		flashToast(`Prompt width ${next} rem`);
	}

	/** Pointer-down spot for click-off-to-close (select-drags must not count). */
	let mainDown: { x: number; y: number } | null = null;
	/** Main-press serial: every pointerdown counts, so the answer
	click-off guard can tell the opening press's own trailing
	click (no press since) from a new click-off (a new press). */
	let mainPressSeq = 0;
	function noteMainDown(event: PointerEvent): void {
		mainPressSeq++;
		mainDown = { x: event.screenX, y: event.screenY };
	}
	/** Last pointer position over the chat (plain field, never state):
	hover hotkeys resolve the word under it without a selection. */
	let lastPointer = { x: 0, y: 0 };
	function noteMainMove(event: PointerEvent): void {
		lastPointer = { x: event.clientX, y: event.clientY };
	}
	/**
	 * Word under the pointer for hover hotkeys: caret-precise (not
	 * element hover), bounded with the word segmenter, null on
	 * whitespace or outside text. The caller selects the range, so
	 * the quote files exactly like a live selection.
	 */
	function hoverWordRange(): {
		word: string;
		node: Text;
		start: number;
		end: number;
	} | null {
		let range: Range | null;
		try {
			range = document.caretRangeFromPoint(lastPointer.x, lastPointer.y);
		} catch {
			return null;
		}
		if (!range) return null;
		const node = range.startContainer;
		if (!(node instanceof Text)) return null;
		// Message text and news headlines only: action-row buttons,
		// badges, and pills are words too, but filing UI chrome as an
		// annotation is nonsense — those hovers keep the old aids
		// behavior.
		if (!node.parentElement?.closest(".rendered, .news-card-title")) return null;
		const text = node.textContent ?? "";
		const bounds = wordBoundsAt(text, range.startOffset);
		if (!bounds) return null;
		const word = text.slice(bounds[0], bounds[1]);
		if (!word.trim()) return null;
		return { word, node, start: bounds[0], end: bounds[1] };
	}
	/**
	 * Clicking into the main chat closes the sidebars: the settings
	 * panel and the chats list both collapse, so the click lands on a
	 * full-width conversation. Controls tagged data-settings-toggle
	 * manage the panel themselves and are skipped; drags (text
	 * selection) are not plain clicks.
	 */
	function closeSettingsFromMain(event: MouseEvent): void {
		// An open answer card closes on a plain click anywhere off
		// it (the badge toggles itself, so badge clicks stay out).
		// Drags (text selection) are not plain clicks.
		const down = mainDown;
		mainDown = null;
		const dragged =
			!!down && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5;
		if (
			annotateMode.answerPop &&
			!dragged &&
			event.target instanceof Element &&
			!event.target.closest(".ann-answer") &&
			!event.target.closest("[data-ann-badge]") &&
			// The opening press's own trailing click (WebKit fires
			// it after a preventDefaulted mousedown; Chromium eats
			// it): the room-making scroll below the fold moves the
			// badge mid-press, so the click lands off-badge on a
			// common ancestor and would shut the card it just
			// opened. Same press only (no pointerdown since, same
			// 800ms window as openBadgeClick): a new click-off
			// always brings its own press and still closes.
			!(
				annotateMode.lastBadgePress &&
				annotateMode.lastBadgePress.id === annotateMode.answerPop.id &&
				annotateMode.lastBadgePress.seq === mainPressSeq &&
				Date.now() - annotateMode.lastBadgePress.at < 800
			)
		) {
			annotateMode.closeAnswerPop();
		}
		if (!settingsOpen && settings.sidebarCollapsed) return;
		if (dragged) return;
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

	/** Palette presets: each side's tokens gate on its attribute
	alongside data-theme, so both sit set whichever side shows. */
	$effect(() => {
		document.documentElement.dataset.lightStyle = settings.lightStyle;
		document.documentElement.dataset.darkStyle = settings.darkStyle;
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
		buzzBeat("first");
	}
	function closeChatSwitcher(): void {
		if (!chatSwitcherOpen) return;
		chatSwitcherOpen = false;
		buzzBeat("send");
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
		buzzBeat("send");
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
		// Both platforms honor the Messages checkbox (off removes the
		// row outright); the gate below decides tap toggling.
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
		// beat; the send paths keep theirs.
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
	/**
	 * The chat the list's keys act on: the focused row when focus sits
	 * on one (Tab and clicks move focus without the cursor), else the
	 * cursor. `sideIdx` indexes the visible (filtered) rows, never the
	 * full list. Syncs the cursor to what it returns.
	 */
	function sideCursorChat(
		target: EventTarget | null
	): (typeof chatState.chats)[number] | null {
		const visible = sideVisibleChats();
		const row = closestFromTarget(target, "aside ul li button.side-chat");
		const id = row instanceof HTMLElement ? row.dataset["chatId"] : undefined;
		const byRow = id ? visible.findIndex((c) => c.id === id) : -1;
		const at = byRow >= 0 ? byRow : clampChatIndex(sideIdx, visible.length);
		if (at === null) return null;
		sideIdx = at;
		return visible[at] ?? null;
	}

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
	 * blanks. `focus` lands plain steps in the prompt too; `focusMint`
	 * lands only a minted chat or the empty newest it would have
	 * minted past (the keyboard step path: plain steps stay
	 * focus-free navigation, a fresh chat opens ready to type).
	 */
	function stepChat(direction: 1 | -1, focus = true, focusMint = false): void {
		const chats = chatState.chats;
		const step = planChatStep(chats, chatState.activeChatId, direction);
		if (step.kind === "none") return;
		if (step.kind === "stay") {
			// Touch steps never take focus: landing in the prompt
			// would pop the keyboard on every swipe. Keyboard steps
			// keep the old path — and a stay IS a fresh chat (past
			// the newest end while it is still empty), so the mint
			// flag lands it in the prompt too, ready to type.
			if (focus || focusMint) enterEditMode();
			return;
		}
		if (step.kind === "mint") {
			// File the leaving chat's drafts away first: resetDraftExtras
			// empties the list, and the autosave effect would then
			// persist the empty list under the old id (draft restore
			// on return would come back blank).
			drafts.fileChat(chatState.activeChatId);
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
			if (focus || focusMint) enterEditMode();
			buzzBeat("send");
			return;
		}
		if (step.kind !== "goto") return;
		sideIdx = sideVisibleChats().findIndex((c) => c.id === step.id);
		buzzBeat("send");
		transitionToChat(step.id);
		// Landing is the switch effect's job (filed position, else
		// top): a smooth top-scroll here would fight the restore.
		if (focus) enterEditMode();
	}

	/** Enter the cursor chat from the keyboard, close the list, and land in its prompt. */
	function enterSideChat(target: EventTarget | null = null): void {
		const item = sideCursorChat(target);
		if (!item) return;
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
	function deleteSideChat(target: EventTarget | null = null): void {
		const item = sideCursorChat(target);
		if (!item) return;
		const at = sideIdx;
		dropChat(item.id);
		sideIdx = clampChatIndex(at, sideVisibleChats().length) ?? -1;
		requestAnimationFrame(() => focusSideChat(sideIdx));
	}

	/** Unsent composer extras quote one chat's messages — never carry over. */
	function resetDraftExtras(): void {
		drafts.clearForNewChat();
		reviewOpen = false;
		editingMsgId = null;
		editingAttachments = [];
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
					countPasteSlots(doc) > 0
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
		annotateMode.selMenu = null;
	}

	function doNewChat(): void {
		// A fresh chat opens medium (first), like settings.
		buzzBeat("first", androidUI);
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
		drafts.fileChat(chatState.activeChatId);
		resetDraftExtras();
		newChat(chatState);
		newsMode.clear();
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

	/** Dev servers (and `tauri dev`) wear the red-dot tab logo. */
	const devBuild = import.meta.env.DEV === true;
	// Switching to a locked provider tries its pre-bundle item once.
	$effect(() => providerKeys.tryLegacyWhenLocked());
	let wasLocked = false;
	$effect(() => {
		editor?.setDisabled(providerKeys.locked);
		// Locking wipes the live composer text (a provider switch must
		// not strand a dead draft over the locked field). Nothing
		// persists text drafts, so nothing needs saving here. The
		// prompt itself stays hintless either way — the missing key
		// explains through the banner and tap-to-explain, never a
		// placeholder.
		if (providerKeys.locked && !wasLocked) editor?.clear();
		wasLocked = providerKeys.locked;
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
		if (annotateMode.selMenu) return;
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
		prevPastedCount = countPasteSlots(doc);
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

	/** Source menu toggle (composer capture button): three static
	 * actions, no listing — the OS picker runs after the pick. */
	function toggleCaptureMenu(): void {
		if (!settings.captureEnabled) return;
		captureMenu = { open: !captureMenu.open };
	}
	/** Source-menu action: one-shot off the picked source (the
	 * global chord keeps its own saved source). An interactive
	 * cancel (Esc/right-click in the OS picker) stays silent. */
	function runCaptureAction(source: CaptureOneShot): void {
		captureMenu = { open: false };
		void runCaptureFlow(source);
	}
	/** File a capture as an assistant message: no model call, no
	 * send — the read lands in the thread ready to annotate and
	 * question. Follows the send path's scroll contract (snapshot
	 * stuck-to-bottom first, scroll after render). */
	function fileCaptureAsAssistant(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;
		const stuck = stuckToBottom();
		fileAssistantMessage(chatState, trimmed);
		if (stuck) scrollAfterRender();
		flashToast("Capture filed to chat.");
		lastGameLine = trimmed;
		if (settings.gameLine) void pushGameLine();
	}

	/** Last captured line for the game overlay (pushed on open +
	 * capture). Plain — handlers only, never the template. */
	let lastGameLine: string | null = null;

	/** Settings toggle: open/close the overlay window. The checkbox
	 * bind flips the flag first; a failed invoke reverts it, so the
	 * box never shows a window that isn't there (the browser preview
	 * rejects and toasts instead of pretending). */
	async function toggleGameLine(): Promise<void> {
		const on = settings.gameLine;
		try {
			if (on) await openGameLine();
			else await closeGameLine();
		} catch {
			settings.gameLine = !on;
			persistSettings();
			flashErrorToast("The game line needs the desktop app.");
			return;
		}
		persistSettings();
		if (on) void pushGameLine();
	}

	/** Push the last line (translated, cached per line) to the
	 * overlay. No line, no provider, or no backend: silent — the
	 * overlay keeps whatever it shows. */
	async function pushGameLine(): Promise<void> {
		const line = lastGameLine?.trim();
		if (!line || !settings.gameLine || !tauriBackendAvailable()) return;
		let translation: string | null = null;
		try {
			const provider = await providerKeys.resolveActive();
			if (provider) translation = await translateGameLine(provider, line);
		} catch {
			translation = null;
		}
		const theme =
			typeof document === "undefined"
				? "light"
				: (document.documentElement.dataset.theme ?? "light");
		try {
			await emit(GAME_LINE_EVENT, { line, translation, theme });
		} catch {
			// Overlay closed mid-push: the next open re-requests.
		}
	}

	/** File an overlay selection into the Game chat: the line lands
	 * as an assistant message (context + history), the annotation
	 * files answered against it, and Flashcards harvest it from the
	 * game drafts. Never touches the active chat or its view. */
	async function fileGameAnnotation(file: GameLineFile): Promise<void> {
		if (!file || typeof file.quote !== "string") return;
		const quote = file.quote.trim();
		if (!quote) return;
		const line = lastGameLine?.trim() || quote;
		const game = ensureGameChat(chatState);
		// The line lands through the live entry (see ensureGameChat):
		// appending to a stale reference would never persist.
		const lineId =
			appendAssistantMessage(chatState, game.id, line) ?? newChatMsgId();
		let list = addAnnotation(
			loadDraftAnnotations(game.id),
			lineId,
			quote,
			file.comment.trim()
		);
		try {
			const provider = await providerKeys.resolveActive();
			if (provider) {
				const answer = await annotationAnswer(provider, {
					quote,
					question: file.comment.trim(),
					context: line
				});
				const added = list[list.length - 1];
				if (added) list = attachAnnotationAnswer(list, added.id, answer);
			}
		} catch {
			saveDraftAnnotations(
				game.id,
				list,
				chatState.chats.map((c) => c.id)
			);
			flashErrorToast("Filed to Game chat, but the answer failed.");
			return;
		}
		saveDraftAnnotations(
			game.id,
			list,
			chatState.chats.map((c) => c.id)
		);
		flashToast("Filed to Game chat.");
	}
	/** Overlay confirm: the checked text files as an assistant
	 * message (never a model call). */
	function confirmCaptureStaged(text: string): void {
		const staged = captureStaged;
		captureStaged = null;
		if (!staged || text.trim().length === 0) return;
		fileCaptureAsAssistant(text);
	}
	/** Overlay dismiss: back to the composer, caret ready. */
	function dismissCaptureStaged(): void {
		captureStaged = null;
		editor?.focus();
	}
	/** Re-entrant guard: the chord can double-fire (repeat, both
	 * chords at once) — one capture at a time. Plain let, no UI
	 * binds it. */
	let captureBusy = false;
	/** Window capture available (backend probe, cached on success):
	the composer button rides it plus the settings kill-switch. */
	let canCapture = $state(false);
	/** Source-menu state (closed by default; opened by the composer
	button). */
	let captureMenu = $state<{ open: boolean }>({ open: false });
	/** Low-confidence read awaiting a check (overlay card owns it;
	null sends straight through). */
	let captureStaged = $state<{ text: string; confidence: number } | null>(
		null
	);
	/** Capture-any-window OCR: screenshot the source, recognize it
	 * like an attachment, and file the read as an assistant message
	 * — no model call, no send, ready to annotate and question. A
	 * one-shot runs the composer's picked action (fullscreen or the
	 * OS window/area picker); without one the saved square wins
	 * silently behind the game, else the window comes forward and
	 * the flow screenshots the saved source (or the frontmost
	 * window) for the global chord. Weak reads stage in the overlay
	 * card for a check; misses and backend failures toast, never
	 * throw — except an interactive cancel (Esc/right-click), which
	 * stays silent. The settings checkbox gates both chords.
	 */
	/** Open the screen-capture privacy row (macOS System Settings →
	Privacy & Security → Screen Recording): the denial toast's tap
	action. The command declines off-macOS, so the fallback prints
	the in-pane path the deep link can't open. */
	async function openCaptureSettings(): Promise<void> {
		if (!tauriBackendAvailable()) return;
		try {
			await openScreenRecordingSettings();
			// The deep link gives no landing confirmation and
			// sub-anchors can be swallowed: always print the
			// in-pane row alongside (voice-settings convention).
			flashToast("Screen Recording row: Privacy & Security → Screen Recording.");
		} catch {
			flashToast(
				"Screen Recording lives in System Settings → Privacy & Security."
			);
		}
	}
	/** Set-area overlay (global ⇧⌘U or the in-app chord): opens the
	 * plain transparent overlay on the desktop Space — no photo,
	 * no capture flash, no focus yank. The square is global screen
	 * points with no window affinity, so drawing it on the
	 * desktop is enough wherever the game shares the resolution; a
	 * mismatch toasts truthfully instead of blaming permissions.
	 * The settings checkbox gates both chords.
	 */
	async function openAreaOverlay(): Promise<void> {
		if (!tauriBackendAvailable()) {
			flashErrorToast("Area picking needs the desktop app.");
			return;
		}
		if (!settings.captureEnabled) return;
		const opened = await openAreaPicker();
		if (!opened) flashErrorToast("Area picking needs the desktop app.");
	}
	async function runCaptureFlow(oneShot?: CaptureOneShot): Promise<void> {
		if (captureBusy || !settings.captureEnabled) return;
		captureBusy = true;
		try {
			let pixels: string | null;
			try {
				const source = captureSourceFor(oneShot, settings.captureArea, {
					windowId: null,
					savedWindowId: settings.captureSourceId,
					fullscreen: settings.captureFullscreen
				});
				// No saved square: the chord path needs the window
				// visible (legacy show-first); the square path stays
				// silent behind the game.
				if (source.kind === "window" && !oneShot) await showMainWindow();
				pixels = await capturePixels(source);
				// The OS picker died silent: Esc or right-click.
				if (pixels === null) return;
			} catch (error) {
				const raw = error instanceof Error ? error.message : String(error);
				// A denial tap opens the privacy row; every other
				// failure keeps the copy-on-tap error toast.
				if (isScreenRecordingDenial(raw))
					flashErrorToast(friendlyCaptureError(raw), () =>
						void openCaptureSettings()
					);
				else flashErrorToast(friendlyCaptureError(raw));
				return;
			}
			const dataUrl = `data:image/png;base64,${pixels}`;
			// Same routing as attachments: native first, WASM
			// fallback where Vision has no model, one reply-led
			// retry under the floor, keep the better pass.
			const native = await ocrSupported();
			const fallbackLangs =
				!native || !visionSupports(activeReplyCode)
					? ocrFallbackLangs(activeReplyCode)
					: null;
			try {
				let result = fallbackLangs
					? await recognizeFallbackText(dataUrl, fallbackLangs)
					: await recognizeImageText(dataUrl, null);
				if (!fallbackLangs && result.confidence < OCR_RETRY_BELOW) {
					try {
						const retry = await recognizeImageText(
							dataUrl,
							ocrRetryHint(activeReplyCode)
						);
						result = keepBestRecognition(result, retry);
					} catch {
						// First pass stands.
					}
				}
				const text = result.text.trim();
				if (!text) {
					flashErrorToast("No text found in this capture.");
					return;
				}
				if (shouldStageCapture(text, result.confidence)) {
					// The overlay card owns the check (autofocused
					// input; Enter files, Esc dismisses + refocuses).
					captureStaged = { text, confidence: result.confidence };
					return;
				}
				fileCaptureAsAssistant(text);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				flashErrorToast(
					fallbackLangs ? friendlyFallbackError(message) : friendlyOcrError(message)
				);
			}
		} finally {
			captureBusy = false;
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
		buzzTap();
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

	function articleTop(index: number): number | null {
		const article = document.querySelector(`#msg-${index}`);
		return article instanceof HTMLElement
			? article.getBoundingClientRect().top
			: null;
	}

	// Keep an article parked across a height change above it: the trim
	// hides rows (undo restores them), so shift the scroller by the
	// anchor's drift instead of letting the viewport jump.
	function holdArticle(index: number, top: number | null): void {
		if (top === null || !(scrollBox instanceof HTMLElement)) return;
		flushSync();
		const now = document.querySelector(`#msg-${index}`);
		if (now instanceof HTMLElement) {
			scrollBox.scrollTop += now.getBoundingClientRect().top - top;
		}
	}

	async function trimAbove(chat: Chat, index: number): Promise<void> {
		const target = chat.messages[index];
		if (!target || target.role !== "assistant" || index <= 0) return;
		if (chat.trimmedThrough === target.id) return;
		// An edit box above the point would hide with its draft
		// stranded (the hazard the fold gate guards) — finish it first.
		if (editingMsgId !== null) {
			const at = chat.messages.findIndex((m) => m.id === editingMsgId);
			if (at !== -1 && at < index) {
				flashToast("Finish the edit first — trim keeps it.");
				return;
			}
		}
		if (refsEditing !== null) {
			const refsId = refsEditing.messageId;
			const at = chat.messages.findIndex((m) => m.id === refsId);
			if (at !== -1 && at < index) {
				flashToast("Finish the refs edit first — trim keeps it.");
				return;
			}
		}
		const provider = await providerKeys.resolveActive();
		if (!provider) {
			const message = "Set an API key first — open Settings.";
			showNotice(notices, "banner", message);
			if (androidUI) flashErrorToast(message);
			return;
		}
		buzzTap();
		const top = articleTop(index);
		setTrimPoint(chatState, chat, target.id);
		holdArticle(index, top);
		// The marker lands above the parked point — if the toolbar
		// covers it, nudge the least that clears it (nearest moves
		// nothing when the marker already reads; scroll-padding keeps
		// it below the strip like any jumped-to row).
		const marker = document.querySelector(".trim-marker");
		if (marker instanceof HTMLElement && scrollBox instanceof HTMLElement) {
			scrollBox.style.scrollBehavior = "auto";
			marker.scrollIntoView({ block: "nearest" });
			scrollBox.style.scrollBehavior = "";
		}
		try {
			await refreshTrimSummary(chatState, chat, provider, target.id);
		} catch (error) {
			// Summary failed: unhide rather than strand the prefix out
			// of context (the next send still windows normally).
			const retop = articleTop(index);
			setTrimPoint(chatState, chat, null);
			holdArticle(index, retop);
			const message = error instanceof Error ? error.message : String(error);
			showNotice(notices, "banner", message);
			if (androidUI) flashErrorToast(message);
		}
	}

	function undoTrim(chat: Chat): void {
		if (!chat.trimmedThrough) return;
		const index = chat.messages.findIndex(
			(m) => m.id === chat.trimmedThrough
		);
		const top = index >= 0 ? articleTop(index) : null;
		buzzTap();
		setTrimPoint(chatState, chat, null);
		// The rolling summary stays compacted: undo restores the
		// scrollback, not the verbatim context.
		if (index >= 0) holdArticle(index, top);
	}

	/** Last haptic beat of any kind (see uiHaptics.ts). */
	let lastBeatAt = 0;
	/** Ambient tick for a control press or slider step (phones). */
	function ambientBeat(kind: "tap" | "step", gap: number): void {
		if (!androidUI || !settings.hapticsEnabled) return;
		const now = performance.now();
		if (!beatAllowed(now, lastBeatAt, gap)) return;
		lastBeatAt = now;
		void hapticBeatAsync(kind, { shell: tauriBackendAvailable() });
	}
	/** Light UI tick (phones): button taps with no visible
	confirmation of their own. Gated by the haptics toggle. */
	function buzzTap(): void {
		if (!androidUI) return;
		lastBeatAt = performance.now();
		void hapticBeatAsync("tap", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
	}
	/** Stern denial buzz (phones): refused actions. */
	function buzzNo(): void {
		if (!androidUI) return;
		lastBeatAt = performance.now();
		void hapticBeatAsync("no", {
			enabled: settings.hapticsEnabled,
			shell: tauriBackendAvailable()
		});
	}
	/**
	 * Shared first/send/done beat: one shell+toggle wiring point.
	 * The gate stays at the call site (phones-only vs always), so
	 * each call reads as what-it-is plus when — never a bare kind.
	 */
	function buzzBeat(kind: "first" | "send" | "done", active = true): void {
		if (!active) return;
		lastBeatAt = performance.now();
		void hapticBeatAsync(kind, {
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

	/** Viewed-message index under a tap point (multi-finger deletes):
	articles carry msg-{index} ids; anything else is not a message. */
	function messageIndexAtPoint(
		clientX: number,
		clientY: number
	): number | null {
		const target = document.elementFromPoint(clientX, clientY);
		const article = target ? annotateMode.articleOf(target) : null;
		if (!(article instanceof HTMLElement)) return null;
		return messageIndexFromId(article.id, viewChat.messages.length);
	}

	/** Prose block owning a tap point's text (rendered message only),
	with the caret range at the point. Null outside message text. */
	/** Caret offset ↔ node math lives in $lib/caret (jsdom-tested). */
	/** Triple-tap: select the sentence around the tap point. False
	keeps native behavior (the override never fires blind). */
	/** Shared tap-to-select engine: resolve the span with a bounds
	function, then set the live selection to it. Word and sentence
	taps differ only in the span function, so they share this (the
	paragraph tap selects the whole block instead). */
	function selectSpanAtPoint(
		clientX: number,
		clientY: number,
		spanFor: (text: string, caret: number) => [number, number] | null
	): boolean {
		const found = textBlockAtPoint(clientX, clientY);
		const selection = window.getSelection();
		if (!found || !selection) return false;
		const text = found.block.textContent ?? "";
		const caret = caretOffsetInBlock(
			document,
			found.block,
			found.range.startContainer,
			found.range.startOffset
		);
		const span = spanFor(text, caret);
		if (!span) return false;
		const [start, end] = span;
		if (end <= start) return false;
		const anchor = nodeAtBlockOffset(document, found.block, start);
		const focus = nodeAtBlockOffset(document, found.block, end);
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

	function selectSentenceAtPoint(clientX: number, clientY: number): boolean {
		return selectSpanAtPoint(clientX, clientY, (text, caret) => {
			const [start, end] = sentenceBounds(text, caret);
			return end <= start ? null : [start, end];
		});
	}

	/** Double-tap: select the word around the tap point. The native
	double-tap gesture never fires for touch here (`touch-action:
	manipulation` on html/body eats it — verified on-device: the pair
	produces one empty selectionchange), so the run takes the word
	itself (Segmenter bounds, CJK-aware) instead of leaving the pair
	to the OS. Mouse double-click is unaffected. False keeps native
	behavior. */
	function selectWordAtPoint(clientX: number, clientY: number): boolean {
		return selectSpanAtPoint(clientX, clientY, (text, caret) =>
			wordBoundsAt(text, caret)
		);
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
		// Desktop multi-click overrides (same spans as the phone tap
		// runs): triple-click takes the sentence, quadruple-click the
		// whole paragraph block — never the native paragraph pick.
		// A false return keeps the native range: the override never
		// fires blind. Runs before the message lock so the span
		// resolves in the untouched DOM.
		if (!androidUI && event.detail >= 3) {
			const picked =
				event.detail === 3
					? selectSentenceAtPoint(event.clientX, event.clientY)
					: selectParagraphAtPoint(event.clientX, event.clientY);
			if (!picked) return;
		}
		// Selections never span messages or headlines: a drag
		// crossing into another article or card trims back to the
		// anchor's edge first.
		if (live) lockSelectionToMessage(live, (n) => annotateMode.articleOf(n) ?? annotateMode.headlineOf(n));
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
		// Multi-click summons wait for the sequence to settle (see
		// multiClickMenuAt): press 4 must land on text, never on the
		// menu press 2 or 3 summoned.
		if (!androidUI && event.detail >= 2) {
			if (multiClickMenuAt !== null) clearTimeout(multiClickMenuAt);
			const cx = cursorX;
			const cy = event.clientY;
			multiClickMenuAt = setTimeout(() => {
				multiClickMenuAt = null;
				annotateMode.placeSelMenu(cx, cy);
			}, MULTI_CLICK_SETTLE_MS);
		} else {
			annotateMode.placeSelMenu(cursorX, event.clientY);
		}
	}

	/** Ask flow (single-flight sets, ask, resume scan) lives in the
	drafts controller. */
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
		// The create pill commits its pending annotation; the edit
		// card (orange pencil) rewrites the filed comment and
		// re-asks at once. A stale pop addressing anything else
		// just closes.
		if (annPopSaveKind(annPop.id, pendingAnn?.id ?? null) === "commit-pending") {
			annotateMode.commitPending();
		} else if (annPop.fresh === false) {
			if (drafts.commitCommentEdit(annPop.id, annDraft))
				flashToast(annEditCommitToast(false));
		}
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
		if (cancelKind === "drop-pending") {
			pendingAnn = null;
			// The dropped draft owned the highlight (kept for
			// readings panels while creating): both go with it.
			annotateMode.clearSelection();
			dismissSelPanels();
		} else if (cancelKind === "delete-fresh") drafts.deleteById(id);
		editor?.focus();
	}

	function annPopKey(event: KeyboardEvent): void {
		if (isImeKey(event)) return;
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
	pill alike run 90% of the chat column, clamped to fit narrow
	phones. */
	function popWidth(): number {
		return annPopWidth({
			chatWidthRem: effectiveChatWidth(
				androidUI,
				settings.fontScale,
				settings.chatWidth ?? 36
			),
			viewportWidth: window.innerWidth
		});
	}

	/**
	 * Refit an open Android card to its measured height: the open-time
	 * estimate overshoots short cards (daylight above bottom badges)
	 * and collapses to the top whenever the keyboard shortens the
	 * viewport. Re-reads the live badge anchor, so scrolls and keyboard
	 * transitions re-land the card instead of stranding the estimate.
	 * y-only: x rides the known width already (re-clamped through the
	 * same math). No-op unless this exact card is still open.
	 */
	function refitAndroidCard(kind: "answer" | "edit", id: string): void {
		if (!androidUI) return;
		const width = kind === "answer" ? annotateMode.answerPop?.w : popWidth();
		const open = kind === "answer" ? annotateMode.answerPop : annPop;
		if (!open || open.id !== id || width === undefined) return;
		if (kind === "answer" ? annotateMode.answerClosing : annPopClosing) return;
		const card = document.querySelector(
			kind === "answer" ? ".ann-answer" : ".ann-pop"
		);
		if (!(card instanceof HTMLElement)) return;
		const height = card.getBoundingClientRect().height;
		if (!(height > 0)) return;
		const badge = document.querySelector(`[data-ann-badge="${id}"]`);
		const rect = badge?.getBoundingClientRect();
		if (!rect) return;
		const y = placeAnnCard({
			anchorX: open.x + width / 2,
			anchorY: rect.bottom,
			width,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
			cardHeight: height
		}).y;
		if (kind === "answer" && annotateMode.answerPop) annotateMode.answerPop = { ...annotateMode.answerPop, y };
		if (kind === "edit" && annPop) annPop = { ...annPop, y };
	}

	/**
	 * Orange pencil (answer card or dock row): the filed answer
	 * reopens in the edit card, in place where its answer sat. The
	 * answer close is instant — a morph, not a dismiss — so the
	 * comment stays on screen throughout. Saving rewrites the
	 * comment and re-asks at once (see saveAnnPop).
	 */
	function editOrangeAnnotation(id: AnnotationId): void {
		const current = drafts.list.find((a) => a.id === id);
		if (!current || current.answer === undefined) return;
		// The edit card unpins the stream follow like any badge
		// press: typing must not fight the follow.
		viewport.stick = false;
		stopPillMic();
		if (annotateMode.answerTimer) {
			clearTimeout(annotateMode.answerTimer);
			annotateMode.answerTimer = null;
		}
		annotateMode.answerClosing = false;
		if (annotateMode.answerPop?.id === id) annotateMode.answerPop = null;
		if (annPop && !annPopClosing) {
			settleAnnPop();
			annPop = null;
		}
		const quoteRect = document
			.querySelector(`[data-ann-badge="${id}"]`)
			?.parentElement?.getBoundingClientRect();
		const width = popWidth();
		// Same below-quote placement as the answer card it morphs
		// from (click anchor unknown: center on the quote); phones
		// keep the centered card (keyboard geometry).
		const placed =
			!androidUI && quoteRect
				? placeAnnAnswer({
						viewportWidth: window.innerWidth,
						menuX: quoteRect.left + quoteRect.width / 2,
						highlightLeft: quoteRect.left,
						highlightWidth: quoteRect.width,
						highlightBottom: quoteRect.bottom,
						width,
						fontScale: settings.fontScale
					})
				: placeAnnCard({
						anchorX: quoteRect
							? quoteRect.left + quoteRect.width / 2
							: window.innerWidth / 2,
						anchorY: quoteRect ? quoteRect.bottom : window.innerHeight / 2,
						width,
						viewportWidth: window.innerWidth,
						viewportHeight: window.innerHeight,
						// Open-time estimate; the tick below refits
						// to the measured card on Android.
						cardHeight: 240
					});
		highlightAnnId = id;
		annDraft = current.comment;
		settleAnnPop();
		annPop = { id, x: placed.x, y: placed.y, fresh: false };
		annPopTop = scrollBox?.scrollTop ?? 0;
		if (androidUI) void tick().then(() => refitAndroidCard("edit", id));
		// The card mounts async: land the caret once it flushes,
		// like the create pill.
		void tick().then(() => annPopBox?.focus({ preventScroll: true }));
		if (settings.hapticsEnabled) {
			lastBeatAt = performance.now();
			vibrateTick(6);
		}
	}

	/**
	 * Screen rect for a quote re-located in its rendered message (no
	 * live selection needed): the resolve-time anchor when focus
	 * collapse or DOM surgery took the highlight off the wire before
	 * the worker landed. First fragment, never the union — same rule
	 * as the live spanRect path — and null when the quote is gone
	 * (edited, folded, or another chat), so callers dismiss instead
	 * of stranding a panel at the viewport corner.
	 */
	function screenRectForQuote(
		messageId: ChatMsgId,
		quote: string,
		at = 0
	): DOMRect | null {
		const range = rangeForQuote(messageId, quote, at);
		if (!range) return null;
		try {
			const slices = selectionSlices(range);
			const rect = slices ? spanRect(slices, 0, quote.length) : null;
			range.detach();
			return rect;
		} catch {
			return null;
		}
	}

	/**
	 * Live Range for a quote re-located in its rendered message: panel
	 * placement and scroll re-anchoring measure per-group spans off
	 * this when the highlight itself is gone (focus collapse, DOM
	 * surgery) — every group keeps its own screen span instead of
	 * stacking on one rect. Null when the quote is gone.
	 */
	function rangeForQuote(
		messageId: ChatMsgId,
		quote: string,
		at = 0
	): Range | null {
		const index = chat.messages.findIndex((m) => m.id === messageId);
		if (index === -1) return null;
		const root = document.querySelector(`article#msg-${index} .rendered`);
		if (!(root instanceof HTMLElement)) return null;
		const nodes = quoteTextNodes(root);
		const loc = locateQuote(
			nodes.map((n) => n.textContent ?? ""),
			quote,
			at
		);
		if (!loc) return null;
		const startNode = nodes[loc.startNode];
		const endNode = nodes[loc.endNode];
		if (!startNode || !endNode) return null;
		try {
			const range = document.createRange();
			range.setStart(startNode, Math.min(loc.startOffset, startNode.length));
			range.setEnd(endNode, Math.min(loc.endOffset, endNode.length));
			return range;
		} catch {
			return null;
		}
	}

	/**
	 * Screen rect for a quote-relative span (a furigana group's slice
	 * of its quote): scroll re-anchoring keeps every panel on its own
	 * kanji instead of stacking the quote's single rect. First match
	 * when the span resolves nowhere (the historical repeat rule).
	 */
	function rectForQuoteSpan(
		messageId: ChatMsgId,
		quote: string,
		at: number,
		start: number,
		end: number
	): DOMRect | null {
		const range = rangeForQuote(messageId, quote, at);
		if (!range) return null;
		try {
			const slices = selectionSlices(range);
			const rect = slices ? spanRect(slices, start, end) : null;
			range.detach();
			return rect;
		} catch {
			return null;
		}
	}

	/** Prompt-inclusion chips for the composer: pinned annotations
	only — creating one never lists it. Each chip carries the three
	things (quote, question, answer), cut off with an ellipsis, and
	clicking it jumps to the badge with a blink. Chips carry no
	buttons at all: no edits, no removals — unpin from the drawer. */
	/**
	 * Move a pending annotation comment into the composer (phone
	 * create only — the transplanted textboxes can't reliably summon
	 * keyboards or hold focus): the pending annotation files on the
	 * arrow. Filed notes never transplant; they open the dock. The
	 * review closes so the composer owns the screen; the wash keeps
	 * the quote visible.
	 */
	/**
	 * Wash id for an in-prompt note create (phones): the composer owns
	 * the screen while creating, so the pending filing washes its
	 * preview. Without this the comment box floats over an unmarked
	 * thread.
	 */
	function promptAnnWashId(): string | null {
		return promptAnnWashIdFor(promptAnnEdit, pendingAnn?.id ?? null);
	}
	function editAnnotationInPrompt(
		target: { pending: true },
		comment: string
	): void {
		settleAnnPop();
		annPop = null;
		promptAnnStash = editor?.getText() ?? "";
		promptAnnEdit = target;
		// The in-prompt edit unpins the stream follow: the quote
		// landing below re-pins geometrically when it scrolls, so an
		// already-visible quote (no scroll) would otherwise keep the
		// follow yanking under the typing.
		viewport.stick = false;
		reviewOpen = false;
		editor?.setText(comment);
		// The box stays empty with no placeholder: the highlighted
		// quote above the composer is the whole prompt.
		editor?.caretToEnd();
		// Filing never scrolls: the view stays exactly where the reader
		// put it (phones used to hoist the quote above the keyboard,
		// which yanked long threads on every annotation).
		// Best-effort: the opening tap's canceled gesture can block
		// the summon on some WebViews, but a plain tap on the
		// composer always works — it summons for chat typing today.
		void tick().then(() => editor?.focus());
	}

	/** Send-arrow commit for an in-prompt note create (see doSend):
	files the pending annotation and fires its own request at once
	(blue while it waits, orange when the reply lands). */
	function commitPromptAnnEdit(): void {
		if (!promptAnnEdit) return;
		buzzBeat("send");
		const comment = editor?.getText() ?? "";
		drafts.filePending(pendingAnn, comment);
		pendingAnn = null;
		highlightAnnId = null;
		exitPromptAnnEdit();
		// Brisk confirmation tick, not the standard read-timed hold.
		flashToast(annEditCommitToast(true), undefined, 1500);
		void tick().then(() => editor?.focus());
	}

	/** Tapping out drops an in-prompt note create: a pending filing
	never existed (typing only lived in the composer — nothing writes
	until the arrow). */
	function cancelPromptAnnEdit(): void {
		if (!promptAnnEdit) return;
		pendingAnn = null;
		highlightAnnId = null;
		exitPromptAnnEdit();
	}

	/** Leave in-prompt edit mode and give the composer back its
	drafted chat text. Focus stays where it is (the commit path
	re-focuses explicitly; a tap-out cancel must not steal it back). */
	function exitPromptAnnEdit(): void {
		promptAnnEdit = null;
		editor?.setText(promptAnnStash);
		promptAnnStash = "";
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
	 * (see annotateMode.reviewQuoteClick) — the note stays selectable, buttons keep
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
		const target = resolveSentRefTarget(
			drafts.list,
			viewChat.messages,
			messageId,
			quote
		);
		if (target.kind === "live") {
			annotateMode.gotoAnnotation({ id: target.id, messageId: target.messageId ?? null });
			return;
		}
		if (target.kind === "quoted") {
			jumpToQuotedText(target.messageId, quote);
			return;
		}
		if (target.kind === "gone") {
			flashErrorToast("Annotation no longer exists");
			return;
		}
		document
			.querySelector(`#msg-${target.index}`)
			?.scrollIntoView({ block: "center", behavior: "smooth" });
		pulseLanded(target.index);
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
			// No words to flash (folded, or the quote spans markup):
			// tint the whole message instead.
			const article = document.querySelector(`#msg-${index}`);
			if (article instanceof HTMLElement) {
				article.scrollIntoView({ block: "center", behavior: "smooth" });
				pulseLanded(index);
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
		badgeHover((id: string | null) => (annotateMode.hoverBadgeId = id), null);
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
		// Pinned only: filed-but-unpinned badges survive (double-click
		// adds to the prompt; clear-all only takes those back).
		drafts.clearPromptPins();
		pendingAnn = null;
		reviewOpen = false;
		highlightAnnId = null;
		// An in-prompt edit dies with the list: hand the composer
		// back its drafted chat text instead of stranding the note.
		if (promptAnnEdit) exitPromptAnnEdit();
		// Clearing everything thumps like a delete (done): the same
		// unmistakable triple against single-tap ticks.
		buzzBeat("done");
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
		// Badge faces never change (numbers only), so the memo key
		// carries content alone — opening or pinning never restamps.
		return memoMarks(
			messageId,
			buildMarksFor(
				drafts.list,
				messageId,
				aidModelPin.has(messageId),
				pendingAnn
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
		if (annotateMode.selMenu) return;
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
		if (annotateMode.selMenu) return;
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
		annotateMode.hoverBadgeId = null;
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
		if (had) flashErrorToast(aidFailureToast(reason));
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
		const provider = await providerKeys.resolveActive();
		if (!provider) {
			flashMissingKey();
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
		quiet = false,
		/** Natural end only (never stop/cancel): the reader's advance. */
		onNaturalEnd?: () => void
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
			onNaturalEnd,
			onError: (message) => {
				if (speechErrorStep({ useNative, fellBack }) === "fallback") {
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
						onNaturalEnd,
						onError: (webMessage) => {
							if (!quiet)
								setVoiceError(
									webSpeechErrorCopy(webMessage, webVoices().length === 0)
								);
							resetVoice();
						}
					});
					if (!ok) resetVoice();
					return;
				}
				if (!quiet)
					setVoiceError(
						useNative
							? friendlyNativeError(message)
							: webSpeechErrorCopy(message, webVoices().length === 0)
					);
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

	async function speakReply(
		msg: ChatMsg,
		quiet = false,
		/** Natural end only (never stop/cancel): the converse loop's re-listen. */
		onNaturalEnd?: () => void
	): Promise<boolean> {
		const text = speechText(msg.content);
		if (!text) return false;
		const fallback = latinFallback(settings.voiceLang);
		const voices = webVoices();
		// No Punjabi voice on the device: the Hindi voice reads the
		// transliteration instead of the default voice going silent.
		const speakable = punjabiSpeechText(text, voices);
		if (!messageSpeakableFor(settings.voiceEngine, msg.content, fallback, voices)) {
			if (!quiet) setVoiceError("No voice for this language.");
			return false;
		}
		const stripped = speakable.replace(/```[\s\S]*?```/g, " ");
		if (!quiet && settings.readerMode !== "off") {
			void openReader(stripped);
			return true;
		}
		// Whole-message voice seeds the Latin sentences; each one then
		// resolves its own language, so four languages read in four
		// voices (see sentenceLangsFor).
		const seed = await quoteLangFor(stripped, fallback);
		startSpeech(
			msg.id,
			speakable,
			await sentenceLangsFor(
				stripped,
				seed,
				voices,
				latinFallback(settings.voiceLang)
			),
			quiet,
			onNaturalEnd
		);
		return true;
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
	 * permission-gated title-only notification + badge fires. Silent
	 * when focused, silent for failures and blank replies.
	 */
	function maybeNotifyReplyDone(msg: ChatMsg | undefined): void {
		if (!settings.replyNotifications) return;
		if (!msg || msg.role !== "assistant" || msg.error) return;
		if (!msg.content.trim()) return;
		// Shell goes native (Android WebView has no Notification ctor);
		// the async ping still fires when the reply lands backgrounded.
		void notifyReplyDoneAsync("Reply finished", {
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
		// Reader on: read from this sentence to the end of the message.
		if (settings.readerMode !== "off") {
			void openReader(full, at);
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
	/** Speech ownership key for a selection: the message id, or
	 * the story link for headline picks (opaque either way). */
	function selSpeakKey(sel: {
		messageId: ChatMsgId | null;
		story?: StoryAnchor;
	}): string {
		return sel.messageId ?? `story:${sel.story?.link ?? ""}`;
	}

	/** Same key for a filed annotation (message ids stay bare). */
	function annSpeakKey(ann: Pick<Annotation, "messageId" | "story">): string {
		return ann.messageId ?? `story:${ann.story?.link ?? ""}`;
	}

	async function speakQuote(
		quote: string,
		messageId: string,
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
		const voices = webVoices();
		// No Punjabi voice on the device: the Hindi voice reads the
		// transliteration instead of the default voice going silent.
		quote = punjabiSpeechText(quote, voices);
		context = punjabiSpeechText(context, voices);
		const sentence = sentenceForQuote(context, quote);
		const probe = sentence ?? context;
		const lang = effectiveSpeechLang(
			await quoteLangForContext(
				probe,
				context,
				latinFallback(settings.voiceLang)
			),
			voices
		);
		if (!speechAttemptable(settings.voiceEngine, lang, voices)) {
			annotateMode.selMenu = null;
			setVoiceError("No voice for this language.");
			return;
		}
		if (!keepMenu) annotateMode.selMenu = null;
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
	/**
	 * Shared mic-tap engine: start guard, stop-active, native-first
	 * start, unavailable toast. The composer and the annotation pill
	 * differ only in where the transcript lands and which cells track
	 * the run, so both ride this with their own tails in the
	 * callbacks (a stale stop is always null on entry — every exit
	 * path clears it — so the optional halt calls stay exact).
	 */
	async function runDictationFlow(opts: {
		startArmed: boolean;
		stopActive: boolean;
		haltActive: () => void;
		beginActive: (stop: () => void) => void;
		onTranscript: (transcript: string) => void;
	}): Promise<void> {
		if (!opts.startArmed) return;
		if (opts.stopActive) {
			opts.haltActive();
			return;
		}
		dismissToast();
		const stop = await dictateNativeFirst(
			(transcript) => {
				opts.onTranscript(transcript);
			},
			(message) => {
				flashErrorToast(message);
				opts.haltActive();
			}
		);
		if (!stop) {
			flashErrorToast(micUnavailableMessage(tauriBackendAvailable()));
			return;
		}
		opts.beginActive(stop);
	}
	async function togglePillMic(): Promise<void> {
		await runDictationFlow({
			startArmed: !micStarting,
			stopActive: stopPillDictation !== null,
			haltActive: stopPillMic,
			beginActive: (stop) => {
				stopPillDictation = stop;
				pillDictating = true;
			},
			onTranscript: (transcript) => {
				annDraft = appendDictation(annDraft, transcript);
				stopPillMic();
			}
		});
	}

	async function toggleMic(): Promise<void> {
		// The mic serves one master: a one-shot tap stops the loop first.
		if (converse !== "idle") dispatchConverse({ type: "toggle" });
		await runDictationFlow({
			startArmed: !micStarting,
			stopActive: dictating,
			haltActive: () => {
				stopDictation?.();
				stopDictation = null;
				dictating = false;
			},
			beginActive: (stop) => {
				stopDictation = stop;
				dictating = true;
			},
			onTranscript: (transcript) => {
				editor?.insertText(dictationInsert(transcript));
				dictating = false;
				stopDictation = null;
			}
		});
	}

	/**
	 * Hands-free conversation (learner chats): the machine in
	 * handsFree.ts owns the phase; this dispatcher runs its effects
	 * (dictation, send, readback) and feeds outcomes back as events.
	 * One-shot dictation and converse never overlap: starting one
	 * stops the other.
	 */
	let converse = $state<HandsFreePhase>("idle");
	/** Pending utterance text for the send effect. */
	let converseUtterance = "";
	/** Chat the converse send went to (readback + abort pin). */
	let converseOriginId: ChatId | null = null;
	/** True from a converse send until its completion lands: the
	 * reply belongs to the loop even when the user stopped or
	 * switched chats mid-stream (no stray normal readback). */
	let converseOwnedSend = false;
	let stopConverseListen: (() => void) | null = null;

	function dispatchConverse(event: HandsFreeEvent): void {
		const step = handsFreeNext(converse, event);
		converse = step.phase;
		for (const effect of step.effects) {
			if (effect === "startListening") void converseListen();
			else if (effect === "stopListening") converseHaltListen();
			else if (effect === "send") converseSend();
			else if (effect === "readback") void converseReadback();
			else if (effect === "stopAll") converseStopAll();
		}
	}

	async function converseListen(): Promise<void> {
		converseHaltListen();
		dismissToast();
		const stop = await dictateNativeFirst(
			(transcript) => {
				if (providerKeys.locked) {
					// The key vanished mid-loop: every turn is doomed
					// (the composer locks too), so end it.
					dispatchConverse({ type: "failed" });
					return;
				}
				// Silence re-arms in the machine; a refused send comes
				// back as sendBlocked from the send effect.
				converseUtterance = transcript;
				dispatchConverse({ type: "utterance", text: transcript });
			},
			(message) => {
				flashErrorToast(message);
				dispatchConverse({ type: "failed" });
			}
		);
		if (!stop) {
			flashErrorToast(micUnavailableMessage(tauriBackendAvailable()));
			dispatchConverse({ type: "failed" });
			return;
		}
		// A stop (or a newer listen) may have landed mid-start: only
		// the live listener keeps its handle.
		if (converse !== "listening") {
			stop();
			return;
		}
		stopConverseListen = stop;
	}

	function converseHaltListen(): void {
		stopConverseListen?.();
		stopConverseListen = null;
	}

	function converseSend(): void {
		const utterance = converseUtterance;
		converseUtterance = "";
		// Append, never replace: the user may have typed while we
		// listened, and their draft is not ours to wipe.
		editor?.insertText(dictationInsert(utterance));
		const action = submitAction({
			annPopOpen: annPop !== null && !annPopClosing,
			annEdit: promptAnnEdit !== null,
			canSubmit:
				!providerKeys.locked &&
				!isSending(chatState) &&
				!nativeTurns.live.has(chatState.activeChatId),
			sendGuardTripped: Date.now() < sendGuardUntil,
			kind: "send"
		});
		if (action !== "send" || promptAnnEdit !== null || editingMsgId !== null) {
			// Refused (busy, locked, popup, guard) or rerouted (an
			// in-prompt note edit / message edit would file through
			// instead of starting a turn, stranding the loop): the
			// words stay in the composer and the loop listens again.
			dispatchConverse({ type: "sendBlocked" });
			return;
		}
		converseOwnedSend = true;
		converseOriginId = chatState.activeChatId;
		onSubmit("send");
	}

	async function converseReadback(): Promise<void> {
		const origin =
			(converseOriginId &&
				chatState.chats.find((c) => c.id === converseOriginId)) ||
			chat;
		const last = origin.messages[origin.messages.length - 1];
		if (!last || last.role !== "assistant" || !last.content.trim()) {
			dispatchConverse({ type: "failed" });
			return;
		}
		// Quiet (no reader detour): the loop owns the re-listen.
		const started = await speakReply(last, true, () =>
			dispatchConverse({ type: "speakDone" })
		);
		if (!started) {
			flashErrorToast("No voice for this language.");
			dispatchConverse({ type: "failed" });
		}
	}

	function converseStopAll(): void {
		converseHaltListen();
		stopVoice();
		if (converseOriginId) abortSend(converseOriginId);
		converseUtterance = "";
	}

	function toggleConverse(): void {
		if (converse === "idle") {
			// One-shot dictation yields to the loop (and stays off:
			// its transcript tail would double-send otherwise).
			if (dictating) {
				stopDictation?.();
				stopDictation = null;
				dictating = false;
			}
		}
		dispatchConverse({ type: "toggle" });
	}

	/**
	 * Converse-owned completions skip the normal readback: while the
	 * loop runs, the machine reads; after a mid-send stop, nothing
	 * reads at all. Returns true when this completion belonged to
	 * the loop (consumed either way).
	 */
	function maybeHandsFreeReply(origin: Chat, sent: ChatMsg | undefined): boolean {
		if (!converseOwnedSend) return false;
		converseOwnedSend = false;
		if (converse === "sending") {
			if (sent?.role === "assistant" && !sent.error && sent.content.trim()) {
				dispatchConverse({ type: "replyDone" });
			} else {
				// Errored/empty reply: end the loop audibly (the
				// failed effect toasts).
				dispatchConverse({ type: "failed" });
			}
		}
		return true;
	}

	/**
	 * Immediate settings save. Keys mirror to secret storage first, then
	 * the settings copy persists blanks wherever that storage outlives a
	 * reload (the shell, and the web's encrypted store). Every save path
	 * must use this: a bare saveSettings(settings) would write live
	 * in-memory keys to disk next to the stored copy.
	 */
	function saveSettingsNow(source?: AppSettings): void {
		const live = source ?? $state.snapshot(settings);
		// Offline parking is session state: disk keeps the parked-from
		// provider, so a reload while offline can't strand the user on
		// the on-device fallback (the mount re-parks if still offline).
		const snapshot =
			offlineParkedFrom !== null && live.activeProviderId === OFFLINE_FALLBACK_ID
				? { ...live, activeProviderId: offlineParkedFrom }
				: live;
		void (async () => {
			await persistSecrets(snapshot);
			saveSettings(
				(await secretsSurviveReload()) ? withBlankedKeys(snapshot) : snapshot
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
			nativeTurns.fetching.has(viewChat.id) ||
			nativeTurns.live.has(viewChat.id);
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

	/** Inline chat rename (sidebar row): the page owns it so the Esc
	ladder can cancel it like every other inline edit. */
	let renamingChatId = $state<ChatId | null>(null);
	let renameDraft = $state("");
	let renameEl: HTMLInputElement | undefined = $state();
	function startRename(item: Chat): void {
		renamingChatId = item.id;
		renameDraft = item.title ?? (item.messages.length > 0 ? chatTitle(item) : "");
		void tick().then(() => {
			renameEl?.focus();
			renameEl?.select();
		});
	}
	function commitRename(): void {
		const id = renamingChatId;
		if (id === null) return;
		renamingChatId = null;
		const target = chatState.chats.find((c) => c.id === id);
		if (!target) return;
		// An untouched automatic title stays automatic (the model may
		// still name the chat); anything else is the user's name.
		if (!target.title && renameDraft.trim() === chatTitle(target)) return;
		renameChat(chatState, id, renameDraft);
	}
	function cancelRename(): void {
		renamingChatId = null;
	}

	/** Name an untitled chat once it has a reply (setting on, game
	chat excluded): one short call to the active model, silent on
	failure so the opening question keeps standing in. */
	function maybeTitleChat(origin: Chat): void {
		if (!settings.aiTitles || origin.title || origin.game) return;
		void (async () => {
			const provider = await providerKeys.resolveActive();
			if (provider) await generateChatTitle(chatState, origin, provider);
		})();
	}

	/** Shared send tail (fresh sends, resends, native completions):
	resolve the origin chat's last message, thump or ping, follow the
	stream, read back, notify, and settle the composer. Reads pin to
	the origin id, never the live chat. A deleted origin skips the
	readback (there is nothing left to read aloud). */
	/** Land a staged send's reply as its annotations' answers: blue
	asked through the pill turn orange. Consumes this chat's pending
	asks either way — a blank or failed reply renders as a plain
	message and leaves its annotations blue, never stranded. A
	background landing patches the origin chat's stored drafts; the
	active chat's live list is only touched when it is the origin. */
	function afterSend(originId: ChatId, opts?: { native?: boolean }): void {
		const { sent, stillHere } = resolveSendCompletion(
			chatState,
			originId,
			chat.id
		);
		lastTokenAt.delete(originId);
		if (sent?.role === "assistant" && !sent.error) {
			// Foreground only: backgrounded, the reply-ready ping owns
			// the moment — any haptic here would buzz behind the user's
			// back and double the ping.
			const signal = landingSignal(
				stillHere,
				document.visibilityState === "visible",
				androidUI
			);
			if (signal === "done") buzzBeat("done");
			else if (signal === "tick") {
				// Other-chat landing on phones: tick plus a tappable
				// toast — a reply must not finish silently in a thread
				// the user left. Tapping opens the origin chat.
				buzzTap();
				flashToast("Reply ready", () => {
					transitionToChat(originId);
					// Land on the new reply's start and pulse it.
					requestAnimationFrame(() => {
						const last = Math.max(viewChat.messages.length - 1, 0);
						document
							.getElementById(`msg-${last}`)
							?.scrollIntoView({ block: "start", behavior: "smooth" });
						pulseLanded(last);
					});
				});
			}
		}
		// Follow the stream only while its chat is open — and only a
		// stuck reader: a finished reply must not yank a mid-thread
		// reader back to the end. After a switch the new chat keeps
		// its own scroll position.
		// A pinned view rides the final render down via the resize
		// hold (instant); an unpinned one is never moved.
		if (stillHere && viewport.stick) void tick().then(() => holdScrollOnResize());
		const origin = chatState.chats.find((c) => c.id === originId);
		if (origin && !maybeHandsFreeReply(origin, sent)) maybeSpeakReply(origin);
		if (origin && sent?.role === "assistant" && !sent.error)
			maybeTitleChat(origin);
		// Native completions skip the frontend ping: Rust pings the
		// same id ~5s later (seen-grace) and the re-post double-buzzes.
		if (frontendPingOnDone(opts?.native ?? false)) maybeNotifyReplyDone(sent);
		// The reply's layout churn (hero unmount, list growth, keyboard
		// transitions on phones) can strand the emptied composer's cached
		// line boxes at zero height: settle a re-measure after paint, like
		// the mount path does, so it holds one line without a keystroke.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => editor?.remeasure())
		);
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
		// Typing past the news panel sends a normal turn: the panel
		// stands down (session launches already cleared it).
		newsMode.clear();
		// Haptic tap on send (silenced by the haptics toggle; native
		// haptics in the shell, Web vibrator in the preview).
		buzzBeat("send");
		clearStudyBadge();
		// No permission ask from the send gesture: tapping send must
		// never raise anything notification-shaped. The startup ask
		// (same gating) is the only prompt, so a later backgrounded
		// long reply may still notify once granted there.
		if (action === "commit-edit") {
			// Saving an edit rewrites the message in place, never
			// resends — and the composer text below still sends as a
			// fresh message either way.
			commitMessageEdit();
		}
		// Native route (Android shell, network text turns): decided
		// before the provider resolves and the composer clears, so the
		// native path never touches the Keychain (its key rides the
		// turn request instead) and a missing key keeps the draft.
		const nativeConfig = nativeTurns.route(attachments);
		const nativeSystem = nativeConfig
			? replySystemPrompt(settings, activeReplyCode, chat)
			: "";
		// The local model either answers or refuses here: no send into
		// a missing/downloading Nano, and the draft stays for a retry.
		if (!nativeConfig && (await blockUnreadyOnDevice())) return;
		const provider = nativeConfig ? null : await providerKeys.resolveActive();
		if (!provider && !nativeConfig) {
			providerKeys.missing = true;
			return;
		}
		providerKeys.missing = false;
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
		// Pinned annotations bake as context (quote, question, answer
		// each); everything else filed stays filed — badges outlive
		// the send, and pins consume (the baked message carries them
		// now, so the next send starts unpinned).
		const outgoingAnnotations = drafts.consumePromptPins();
		// The prompt empties the moment the message goes out — not when the
		// (possibly long) reply finishes streaming in. Filed annotations
		// survive the send (badges stay, answered or not); only pins
		// consume. Attachment pills clear with it (`outgoing` already
		// captured them for the send).
		editor?.clear();
		attachments = [];
		expandedPastes = [];
		pendingAnn = null;
		reviewOpen = false;
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
			await nativeTurns.send({
				baked,
				kept,
				pasteFolds: mergeFolds(folds, pastedFolds),
				config: nativeConfig,
				system: nativeSystem
			});
			return;
		}
		// Unreachable with a live provider (null returns above), but the
		// narrowing keeps the call below honest without an assertion.
		if (!provider) {
			providerKeys.missing = true;
			return;
		}
		// Before the append below (see stuckToBottom): the provider
		// await above is real time, so snapshot here, not earlier.
		const stuck = stuckToBottom();
		const sending = sendMessage(
			chatState,
			provider,
			replySystemPrompt(settings, activeReplyCode, chat),
			baked,
			{
				attachments: kept,
				thinking: activeThinkingId(settings),
				pasteFolds: mergeFolds(folds, pastedFolds),
				// Haptic rumble as the reply starts arriving — only while
				// its chat is still open. A mid-stream switch must not
				// rumble the new chat for the old one's reply.
				onFirstToken: () => {
					if (
						shouldRumbleOnFirstToken(
							chat.id,
							sentFrom.id,
							document.visibilityState === "visible"
						)
					)
						buzzBeat("first");
				},
				onToken: () => {
					lastTokenAt.set(sentFrom.id, Date.now());
				}
			}
		);
		if (stuck) scrollAfterRender();
		await sending;
		// Keep drafts when the reply failed so nothing silently drops.
		// Asked and answered annotations survive the landing (the
		// send-time reset keeps them); the reply lands on them in
		// afterSend, so nothing resets here.
		afterSend(sentFrom.id);
	}

	async function resend() {
		stopVoice();
		// A resend is a send too: same tap, rumble, and thump as doSend.
		buzzBeat("send");
		// Native resends (Android): Retry buttons land here after
		// dismissing the failed reply, so the retried turn survives the
		// background exactly like a fresh one. Guards mirror the fresh
		// send; the last user message's own attachments decide images.
		const lastResend = chat.messages[chat.messages.length - 1];
		const resendConfig = nativeTurns.route(lastResend?.attachments ?? []);
		if (resendConfig) {
			providerKeys.missing = false;
			await nativeTurns.resend(resendConfig);
			return;
		}
		// TypeScript resends resolve the provider (Keychain on first
		// use); the native branch above never gets here.
		if (await blockUnreadyOnDevice()) return;
		const provider = await providerKeys.resolveActive();
		if (!provider) {
			providerKeys.missing = true;
			return;
		}
		providerKeys.missing = false;
		const resentFrom = chat;
		await resendLast(
			chatState,
			provider,
			replySystemPrompt(settings, activeReplyCode, chat),
			{
				thinking: activeThinkingId(settings),
				onFirstToken: () => {
					if (
						shouldRumbleOnFirstToken(
							chat.id,
							resentFrom.id,
							document.visibilityState === "visible"
						)
					)
						buzzBeat("first");
				},
				onToken: () => {
					lastTokenAt.set(resentFrom.id, Date.now());
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
		if (providerKeys.locked && !target?.closest("button, input, select, a, .ann-wrap")) {
			flashMissingKey();
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
			annEdit: promptAnnEdit !== null,
			canSubmit,
			sendGuardTripped: Date.now() < sendGuardUntil,
			kind
		});
		if (action === "ignore") {
			// A send attempted while this chat's reply streams buzzes
			// denial — except an in-prompt note edit, which files
			// through (decided above; doSend commits it, never a
			// chat turn). Empty Enter stays silent, like before.
			if (
				isSending(chatState) &&
				(hasText || attachments.length > 0 || drafts.list.length > 0)
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
		const seeds = refs ? seedAnnotationsFromRefs(msg.id, refs.refs) : [];
		drafts.beginOwnEdit(chatState.activeChatId, seeds);
		editingAttachments = msg.attachments ? [...msg.attachments] : [];
		// Message content carries no stripped markers on save, so the
		// seed keeps its marker lines: recount instead of reconciling,
		// or the message's own image attachments would drop as
		// "deleted tags".
		editingSeed = refs ? refs.text : msg.content;
		editingPrevMarkers = countMarkers(editingSeed);
		editingPrevFileMarkers = countMarkers(editingSeed, FILE_MARKER);
		editingPrevPasted = countPasteSlots(editingSeed);
		reviewOpen = false;
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
	function resetInlineEdit(saved = false): void {
		drafts.endOwnEdit(chatState.activeChatId, saved);
		reviewOpen = false;
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

	/** Focus leaving the in-place editor: a real focus landing
	outside the edited message reverts to the untouched message
	(the draft dies with the editor, so history is safe) — but
	focus to nowhere never cancels. Hovering another message's
	buttons blurs the editor with no target (the row hover blur),
	and killing the draft there strands the user's text mid-move:
	the draft stays mounted for a click back in. Presses outside
	cancel instead (see onEditOutside), as does Esc. The message's
	own action row stays live (fold stays gated, the commit
	checkmark must reach commitMessageEdit first). */
	function blurInlineEdit(event: FocusEvent): void {
		if (!editingMsgId || blurCancelMuted) return;
		const next = event.relatedTarget;
		if (next === null || next === document.body) return;
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
	 * Rewrite the edited message in place (text plus attachments,
	 * folds). Pinned annotations re-bake like a send does; unpinned
	 * ones never enter stored text — editing must not smuggle
	 * unapproved context into history. Reads the in-place editor
	 * when it is mounted, so a send from the composer mid-edit still
	 * saves the message text rather than the composer draft.
	 */
	function saveMessageEdit(): void {
		const id = editingMsgId;
		if (id) {
			const src = msgEditor ?? editor;
			const prev = activeChat(chatState).messages.find((m) => m.id === id);
			// Regions never persist: an expanded hand-typed tag saves
			// as its inner prose (brackets stripped, tags untouched),
			// so no ⟦⟧ leaks into storage. Region-free drafts pass
			// through identical, keeping the untouched-save shortcut.
			const { stored, folds: keepFolds } = bakeEditedMessage(
				splicePastedText(src?.getText() ?? "", []),
				src?.getPastes() ?? [],
				editingAttachments.filter((a) => a.kind === "image").length,
				editingSeed,
				prev?.pasteFolds
			);
			editMessageContent(chatState, id, withAnnotations(stored, promptInclusions(drafts.list)), {
				attachments: editingAttachments,
				pasteFolds: keepFolds
			});
			// Saving is silent in the thread (the text just rewrites),
			// so the checkmark earns the same confirmation an
			// annotation edit gets ("Annotation edited").
			flashToast("Message edited");
		}
		resetInlineEdit(id !== null);
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
			onCopyPastedTexts: (indexes) =>
				pastedTextsAt(editingAttachments, indexes),
			onPasteSlotCollapsed: (index, inner) => {
				editingAttachments = writePastedTextAt(
					editingAttachments,
					index,
					inner
				);
			},
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
	/** Stickiness by intent (see stickAfterScroll), plus the reading
	anchor an unpinned reader keeps across re-renders. */
	function noteStick(box: HTMLElement): void {
		const top = box.scrollTop;
		viewport.stick = stickAfterScroll({
			stick: viewport.stick,
			top,
			lastTop: viewport.lastTop,
			gap: box.scrollHeight - top - box.clientHeight,
			slop: STICK_PX
		});
		viewport.lastTop = top;
		if (viewport.stick) {
			viewport.missed = false;
			viewport.anchor = null;
		} else {
			viewport.anchor = readScrollAnchor(box);
		}
	}
	function readScrollAnchor(box: HTMLElement): ScrollAnchor | null {
		const boxTop = box.getBoundingClientRect().top;
		const rects: Array<{ id: string; top: number; bottom: number }> = [];
		for (const el of box.querySelectorAll<HTMLElement>('article[id^="msg-"]')) {
			const r = el.getBoundingClientRect();
			rects.push({ id: el.id, top: r.top, bottom: r.bottom });
			if (r.bottom > boxTop) break;
		}
		return pickScrollAnchor(rects, boxTop);
	}
	/** Content resized (a reply finishing, its action row, readings,
	audio, annotations): a pinned view stays at the bottom, an unpinned
	reader stays on the line they were reading. Never anything else. */
	function holdScrollOnResize(): void {
		const box = scrollBox;
		if (!box || viewport.holding) return;
		if (viewport.stick) {
			if (box.scrollHeight - box.scrollTop - box.clientHeight > 1)
				box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
			return;
		}
		const anchor = viewport.anchor;
		if (!anchor) return;
		const el = document.getElementById(anchor.id);
		if (!el || !box.contains(el)) return;
		const delta =
			el.getBoundingClientRect().top - box.getBoundingClientRect().top - anchor.offset;
		if (Math.abs(delta) > 0.5) {
			box.scrollTop += delta;
			viewport.lastTop = box.scrollTop;
		}
	}
	$effect(() => {
		const box = scrollBox;
		void viewChat.messages.length;
		if (!box || typeof ResizeObserver === "undefined") return;
		// One hold per frame, outside the observer callback: scrolling
		// inside it re-sizes lazily laid-out rows and loops the observer.
		let frame = 0;
		const ro = new ResizeObserver(() => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				holdScrollOnResize();
			});
		});
		for (const el of box.querySelectorAll('article[id^="msg-"]')) ro.observe(el);
		return () => {
			ro.disconnect();
			if (frame) cancelAnimationFrame(frame);
		};
	});
	/** "Jump to latest": back to the newest text, pinned again. */
	function jumpToLatest(): void {
		viewport.missed = false;
		scrollToBottom();
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
		if (!viewport.stick) viewport.missed = true;
		else if (!viewport.holding && box)
			box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
	});
	/** Mirror the stick flag onto the scroller for specs: e2e pins
	unpin-on-annotate against this (geometry can't — a one-line
	wrap plus the one-token effect lag plus the completion slop
	make scroll deltas unassertable). Change-guarded, so steady
	scrolling writes nothing. */
	$effect(() => {
		const box = scrollBox;
		if (!box) return;
		const want = viewport.stick ? "true" : "false";
		if (box.dataset.stick !== want) box.dataset.stick = want;
	});

	function jumpTo(index: number) {
		// A trim hides the prefix: selection never parks on an
		// unmounted row (gg lands on the first visible message).
		selectedIdx = Math.max(index, Math.max(trimPointIndex(viewChat), 0));
		document
			.getElementById(`msg-${selectedIdx}`)
			?.scrollIntoView({ block: "start", behavior: "smooth" });
	}

	/** Tint a landed message once (see `article.landed` in app.css),
	starting when the jump's scroll settles so the fade plays in view.
	A repeat landing restarts it. */
	function pulseLanded(index: number): void {
		const start = (): void => {
			const el = document.getElementById(`msg-${index}`);
			if (!el) return;
			el.classList.remove("landed");
			void el.offsetWidth;
			el.classList.add("landed");
			el.addEventListener("animationend", () => el.classList.remove("landed"), {
				once: true
			});
		};
		const box = scrollBox;
		if (!(box instanceof HTMLElement) || !("onscrollend" in box)) {
			setTimeout(start, 450);
			return;
		}
		let done = false;
		const go = (): void => {
			if (done) return;
			done = true;
			box.removeEventListener("scrollend", go);
			start();
		};
		box.addEventListener("scrollend", go);
		// No scroll (already in view) never fires scrollend.
		setTimeout(go, 600);
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
		// The prompt goes fully dormant: no caret and no typing —
		// keystrokes land on the window, where scroll mode owns the
		// J/K keys and ignores the rest.
		editor?.blur();
		if (selectedIdx < 0 && chat.messages.length > 0) {
			selectedIdx = chat.messages.length - 1;
		}
	}

	function enterEditMode() {
		focusMode = "edit";
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
				// A frame scheduled before a dismiss must not fire
				// after it: focusing a re-hidden composer restores it
				// via focusin, undoing the dismiss (or un-idling under
				// a summon key, which then types instead of summoning).
				if (promptIdle) return;
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
	 * per-keydown smooth scrollBy calls produce under key repeat — and a
	 * hold moves at once instead of sitting out the tap window. d/u
	 * ramps from j/k speed to peak over SCROLL_HOLD_RAMP_MS (see
	 * holdGlideVelocity) instead of kicking at full speed; j/k cruise.
	 * A tap still lands exactly its step total: the release lands only
	 * the remainder past accrued glide frames (see releaseScrollHold).
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
			tapDy: clampTapDy(
				tapDy ??
					Math.sign(velocity) *
						scaleScrollPx(SCROLLKEY_LINE_PX, settings.fontScale),
				scrollBox.clientHeight
			),
			glided: 0,
			downAt: Date.now(),
			startT: performance.now(),
			glideT: null,
			lastT: performance.now(),
			raf: 0
		};
		const tick = (t: number) => {
			const hold = viewport.hold;
			if (!hold || viewport.holdSeq !== seq || !scrollBox) return;
			// Glide from the first frame: the ramp ages from motion
			// start (glideT), so the hold engages at ramp speed with
			// no dead window and no kick.
			if (hold.glideT === null) hold.glideT = t;
			const before = scrollBox.scrollTop;
			scrollBox.scrollTop = stepScrollTop(
				before,
				scaleScrollPx(
					holdGlideVelocity(hold.key, t - hold.glideT),
					settings.fontScale
				),
				t - hold.lastT
			);
			hold.glided += scrollBox.scrollTop - before;
			hold.lastT = t;
			hold.raf = requestAnimationFrame(tick);
		};
		const first = viewport.hold;
		if (first) first.raf = requestAnimationFrame(tick);
	}
	/** Release a held key: taps land the step remainder past accrued
	glide (exact step totals, never glide plus the step); holds and
	slow releases (already past the step) just stop. */
	function releaseScrollHold(event: KeyboardEvent): void {
		const hold = viewport.hold;
		if (!hold || event.key.toLowerCase() !== hold.key.toLowerCase()) return;
		cancelAnimationFrame(hold.raf);
		viewport.hold = null;
		scrollBox?.style.removeProperty("scroll-behavior");
		scrollBox?.classList.remove("scrolling");
		if (holdIsTap(hold.downAt, Date.now()) && scrollBox) {
			const rest = tapReleaseRest(hold.tapDy, hold.glided);
			if (rest !== 0) scrollChatBy(rest);
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
	 * user picked their own meanwhile) and installs the new one. The
	 * decision is the pure stepPillVoice (unit-tested); the effect only
	 * wires it to state and persists on change.
	 */
	let appliedPill: string | null = null;
	let pillBaseVoice: string | null = null;
	$effect(() => {
		const current =
			chatState.chats.find((c) => c.id === chatState.activeChatId) ?? null;
		const code = current?.replyLang ?? null;
		const next = stepPillVoice(
			{
				appliedPill,
				pillBaseVoice,
				voiceLang: settings.voiceLang,
				voiceLangPinned: settings.voiceLangPinned
			},
			code,
			(check) => replyLanguageFor(check)?.voice ?? null
		);
		appliedPill = next.appliedPill;
		pillBaseVoice = next.pillBaseVoice;
		if (
			next.voiceLang === settings.voiceLang &&
			next.voiceLangPinned === settings.voiceLangPinned
		)
			return;
		settings.voiceLang = next.voiceLang;
		// The restored value regains its standing, deliberate or not;
		// the pill owns the voice from an install, unpinned, so a
		// launch without the pill falls back while the persisted
		// pill reinstalls its override on launch.
		settings.voiceLangPinned = next.voiceLangPinned;
		persistSettings();
	});
	/** Follow-chat target for the voice-language picker: the pill
	locale while one is set, else the current (base) tag. Choosing
	it unpins back to automatic. */
	const followVoice = $derived(
		activeReplyLang
			? { tag: activeReplyLang.voice, name: activeReplyLang.name }
			: {
					tag: settings.voiceLang,
					name: langNameForTag(settings.voiceLang)
				}
	);

	/** Pill lives on the active chat; the voice-follow effect above
	installs its voice. Unknown codes never reach the field. */
	function setReplyLang(code: string): void {
		if (!replyLanguageFor(code)) return;
		setChatReplyLang(chatState, chatState.activeChatId, code);
		openLangMenu = null;
		// Empty chats open learner news for the picked language (the
		// submenu and ⌘number share this funnel); anywhere else the
		// pick just switches and any open panel goes away.
		if (activeChat(chatState).messages.length === 0) newsMode.enterNewsMode(code);
		else newsMode.news = null;
	}

	function clearReplyLang(): void {
		setChatReplyLang(chatState, chatState.activeChatId, null);
		openLangMenu = null;
		newsMode.close();
	}

	/** Correction toggle lives on the active chat; default off. */
	function toggleCorrection(): void {
		const current = activeChat(chatState).correction ?? false;
		setChatCorrection(chatState, chatState.activeChatId, !current);
	}

	/** Shared by the `LangMenus` hero call site (see `ThreadView`). */
	const langMenusActions = {
		toggle: (id: LanguageMenu["id"], el: HTMLElement) =>
			toggleLangMenu(id, el),
		hover: (lang: ReplyLanguage) => {
			// Only empty chats open news on a pick, so only they warm it.
			if (activeChat(chatState).messages.length === 0) newsMode.prefetch(lang.code);
		},
		pick: (lang: ReplyLanguage) => {
			const quickKey = quickKeyFor(lang.code, isMac);
			if (activeReplyCode === lang.code && !quickKey) {
				clearReplyLang();
				// Clearing names the released language
				// in its own cleared word.
				flashToast(lang.cleared);
			} else {
				setReplyLang(lang.code);
				// The news panel's header names the language in its
				// own words; a toast there sat over the region pills.
				if (newsMode.news === null) flashToast(switchToastFor(lang));
			}
			// Language picks tick on phones like the
			// family buttons above do.
			buzzTap();
			// Picking a language hands focus to the
			// composer on desktop: typing starts there
			// next, and focus never lingers on the
			// unmounted option (which left a stuck
			// pointer behind). News mode skips it (the
			// composer parks hidden — summon to type).
			// Phones stay unfocused: auto-focus pops
			// the keyboard over the composer instead
			// of pushing it up. Tap in when ready.
			// After the flush: closing news un-hides the composer, and
			// a still-hidden field drops focus silently.
			if (!androidUI && newsMode.news === null)
				void tick().then(() => editor?.focus());
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
		buzzBeat("done", androidUI);
		stopVoice();
		if (id === chatState.activeChatId) {
			// The open chat's news panel (and any story launch still
			// fetching) goes with it, as on a chat switch.
			newsMode.clear();
			// Dropping the open chat discards its drafts (stored entry
			// pruned via the empty save), then the neighbor that slides
			// into its place restores its own filed drafts — and its
			// filed scroll position, via the switch effect.
			saveChatScroll();
			drafts.discardChat(
				id,
				chatState.chats.map((c) => c.id).filter((c) => c !== id)
			);
			resetDraftExtras();
			// A live turn must not outlive its chat: stop it so the
			// runner settles and the shade notice dismisses too.
			void nativeTurns.stopChat(id);
			deleteChat(chatState, id);
			chatScrollTops.delete(id);
			drafts.restoreChat(chatState.activeChatId);
			restoreChatScroll(chatState.activeChatId);
		} else {
			// Dropping a background chat must not touch the open
			// composer's in-memory drafts or attachments: only prune the
			// deleted id out of storage — but its live turns still stop,
			// or the shade notice orphans.
			void nativeTurns.stopChat(id);
			deleteChat(chatState, id);
			chatScrollTops.delete(id);
			drafts.fileChat(chatState.activeChatId);
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
			onCopyPastedTexts: (indexes) => pastedTextsAt(attachments, indexes),
			onPasteSlotCollapsed: (index, inner) => {
				attachments = writePastedTextAt(attachments, index, inner);
			},
			onAutogrow: () => promptGlide?.measure(),
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
	 * Game-line overlay channel (desktop shell only): the overlay
	 * requests the current line on boot, files selections into the
	 * Game chat, and the backend reports its close so the settings
	 * toggle mirrors the window.
	 */
	async function listenGameLine(): Promise<void> {
		if (!tauriBackendAvailable()) return;
		try {
			await listen(GAME_LINE_OPEN_EVENT, () => void pushGameLine());
			await listen<GameLineFile>(GAME_LINE_FILE_EVENT, (event) =>
				void fileGameAnnotation(event.payload)
			);
			await listen(GAME_LINE_CLOSED_EVENT, () => {
				if (!settings.gameLine) return;
				settings.gameLine = false;
				persistSettings();
			});
		} catch (error) {
			console.warn(
				"Game-line events unavailable:",
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
				drafts.fileChat(chatState.activeChatId);
				selectChat(chatState, link.chatId as ChatId);
				drafts.restoreChat(link.chatId);
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
							// A share, deep link, or send-text chord is an
							// explicit summon: bring an idle-hidden prompt back
							// so the text never lands in an invisible editor.
							restorePrompt();
							editor?.focus();
							return;
						}
						annotateMode.placeSelMenu();
						if (!annotateMode.selMenu?.quote.trim()) {
							flashToast(
								`Select text first, then ${route === "speak" ? "Speak" : route === "inspect" ? "Inspect" : "Annotate"}.`
							);
							return;
						}
						if (route === "speak") void speakSelection();
						else if (route === "inspect") openInspect();
						else annotateMode.annotate();
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
		void nativeTurns.reconcile();
		// Filed annotation asks a restart took off the wire relaunch
		// here (answered drafts never refire, keyless boots stay
		// silent) — blue badges turn orange on their own.
		drafts.resumeUnanswered();
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
			if (!androidUI || !start.clean || shortcutsOpen || flashcards.isOpen || readerOpen || inspectChar)
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
			chipSwipe: boolean;
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
			// Priority lives in flickZoneOfTarget (pinned in
			// events.test.ts); the page only injects its article
			// test here.
			return flickZoneOfTarget(
				target,
				(el) => annotateMode.articleOf(el) !== null
			);
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
				const art = target instanceof Element ? annotateMode.articleOf(target) : null;
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
				// Same for the news region-chip rail: it scrolls
				// horizontally, so a sideways stroke there scrolls
				// the flags — never summons a sidebar.
				const chipSwipe = isNewsChipsTarget(target);
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
					chipSwipe,
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
						// lands. CJK taps resolve through the
						// point-anchored range first (same as desktop
						// double-click): aid readings split the DOM, so
						// the caret can land on a reading instead of the
						// base char — selecting nothing, with no
						// handles. Other scripts keep the span engine.
						if (msgTapSeq.count === 2) {
							msgDoubleTapPin = { id: start.msgId, at: now };
							const cjk = cjkWordRangeAtPoint(ended.clientX, ended.clientY);
							if (cjk) {
								try {
									const pick = window.getSelection();
									pick?.removeAllRanges();
									pick?.addRange(cjk);
								} catch {
									selectWordAtPoint(ended.clientX, ended.clientY);
								}
							} else selectWordAtPoint(ended.clientX, ended.clientY);
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
				// action row, inside code/math blocks, or on the news
				// chip rail, where the inner scroller owns the stroke.
				const target = start.rowSwipe || start.codeSwipe || start.chipSwipe
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
				if (!androidUI || shortcutsOpen || flashcards.isOpen || readerOpen || inspectChar || !start) return;
				const touch = event.changedTouches[0];
				if (!touch) return;
				// No travel limit: dragging the selection handles across
				// lines ends far from where the touch began, and that lift
				// is exactly the multi-line pick the menu must serve. Scrolls
				// can't summon it (they leave the selection unchanged, so the
				// equality check below filters them), and lifts outside text
				// fail the .rendered check.
				const el = document.elementFromPoint(touch.clientX, touch.clientY);
				if (!el?.closest(".messages .rendered, .news-card-title")) return;
				const live = window.getSelection()?.toString() ?? "";
				if (live === "" || live === start.sel) return;
				annotateMode.placeSelMenu(touch.clientX, touch.clientY);
				touchMenuAt = Date.now();
				// Headphones in: the fresh selection reads itself aloud
				// on release (when a voice fits). The menu stays up, so
				// Annotate is still one tap away after listening.
				// Phones never do this: every selection would talk.
				if (!androidUI && settings.autoSpeakSelection) {
					const fresh = annotateMode.currentQuote();
					if (fresh)
						void speakQuote(fresh.quote, selSpeakKey(fresh), true, fresh.context);
				}
			},
			{ passive: true }
		);
		// Orange-badge hold-to-delete (Android): a still 2s press on
		// an answered badge deletes its annotation (the delete thumps
		// like any other). Blue badges never arm — their tap only
		// toasts Loading. Lift, travel, scroll, or a second finger
		// cancels; the fire re-checks the badge is still answered
		// and the thread never scrolled (destructive, so strict).
		// The fire stamps its id so the trailing compatibility mouse
		// press can't reopen the now-gone badge on its way up.
		let badgeHoldTimer: ReturnType<typeof setTimeout> | null = null;
		let badgeHold: { x: number; y: number; top: number } | null = null;
		let badgeHoldFired: { id: string; at: number } | null = null;
		const clearBadgeHoldTimer = (): void => {
			if (badgeHoldTimer) {
				clearTimeout(badgeHoldTimer);
				badgeHoldTimer = null;
			}
			badgeHold = null;
		};
		window.addEventListener(
			"touchstart",
			(event) => {
				clearBadgeHoldTimer();
				if (!androidUI || iosUI || event.touches.length !== 1) return;
				const first = event.touches[0];
				const target = event.target instanceof Element ? event.target : null;
				const badge = target?.closest("[data-ann-badge]");
				if (!first || !badge) return;
				const id = badge.getAttribute("data-ann-badge") ?? "";
				// Every filed badge holds to delete, blue or orange.
				if (!canHoldDeleteBadge(drafts.list.find((a) => a.id === id)))
					return;
				badgeHold = {
					x: first.clientX,
					y: first.clientY,
					top: scrollBox?.scrollTop ?? 0
				};
				badgeHoldTimer = setTimeout(() => {
					badgeHoldTimer = null;
					const held = badgeHold;
					badgeHold = null;
					if (!held) return;
					if ((scrollBox?.scrollTop ?? 0) !== held.top) return;
					if (!canHoldDeleteBadge(drafts.list.find((a) => a.id === id)))
						return;
					annotateMode.removeAnnotation(id);
					badgeHoldFired = { id, at: Date.now() };
				}, 2000);
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchmove",
			(event) => {
				if (!badgeHoldTimer || !badgeHold || event.touches.length !== 1) return;
				const touch = event.touches[0];
				if (
					touch &&
					Math.hypot(touch.clientX - badgeHold.x, touch.clientY - badgeHold.y) >
						12
				) {
					clearBadgeHoldTimer();
				}
			},
			{ passive: true }
		);
		window.addEventListener("touchend", clearBadgeHoldTimer, {
			passive: true
		});
		window.addEventListener("touchcancel", clearBadgeHoldTimer, {
			passive: true
		});
		// A dead highlight drops its menu at once: taps elsewhere (and
		// handle collapses) clear the selection without touching the
		// mouse/touch summon paths, so without this the menu stranded
		// until the 4.5s timer. Presses that began in the menu stand
		// down (see menuPressAt): the button's own release collapses
		// the highlight, and Annotate runs off the stored quote.
		document.addEventListener("selectionchange", () => {
			if (!annotateMode.selMenu) return;
			if (Date.now() - menuPressAt < 1000) return;
			// A hover transition's engine collapse (no press at all):
			// put the stored range back while the hover change is
			// fresh. Any other clear falls through to the dismiss
			// below — plain clicks always press first, so they never
			// land here.
			if (Date.now() - lastHoverChangeAt < 500) {
				const liveKeep = window.getSelection();
				if (annotateMode.selMenu?.range && (!liveKeep || liveKeep.toString() === "")) {
					try {
						liveKeep?.removeAllRanges();
						liveKeep?.addRange(annotateMode.selMenu.range.cloneRange());
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
					? annotateMode.selMenu?.range
					: null;
			if (
				rescueRange &&
				lastPressAt <= annotateMode.selMenuOpenedAt &&
				annotateMode.lastProgrammaticClearAt <= annotateMode.selMenuOpenedAt
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
					// annotateMode.clearSelection() caller nulls the menu in the same
					// tick, so this only ever fires for the capture.
					if (annotateMode.lastProgrammaticClearAt > annotateMode.selMenuOpenedAt) return;
					if (!annotateMode.selMenuHover) annotateMode.selMenu = null;
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
				const menuMessageId = annotateMode.selMenu?.messageId;
				if (
					annotateMode.selMenuHover &&
					menuMessageId !== undefined &&
					chat.messages.some((m) => m.id === menuMessageId)
				)
					return;
				annotateMode.selMenu = null;
			}
			// Live reselects refresh the stored quote in place
			// (replacement, never mutation, so the dock re-renders):
			// extending past one character hides Inspect, shrinking
			// back restores it. Rescue paths returned above, so a live
			// selection here is new work.
			if (live && !live.isCollapsed && live.toString() !== "" && annotateMode.selMenu) {
				const refreshed = annotateMode.currentQuote();
				if (refreshed && refreshed.quote !== annotateMode.selMenu.quote) {
					annotateMode.selMenu = {
						...annotateMode.selMenu,
						quote: refreshed.quote,
						context: refreshed.context,
						messageId: refreshed.messageId,
						range:
							live.rangeCount > 0
								? live.getRangeAt(0).cloneRange()
								: annotateMode.selMenu.range
					};
				}
			}
		});
		// Two-finger horizontal swipes open drawers (left = settings,
		// right = chats list); a vertical two-finger slide jumps the chat
		// (up to the top, down to the bottom — gg and G); a three-finger
		// horizontal swipe steps chats (left = newer, right = older, no
		// focus: the keyboard stays down); a two-finger double tap
		// toggles the sidebar on iOS and does nothing on Android
		// (double-taps never scroll); a three-finger tap deletes the
		// tapped message; a three-finger hold wipes every chat on
		// Android (current chat on iOS).
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
			if (!androidUI || shortcutsOpen || flashcards.isOpen || readerOpen) return false;
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
						shortcutsOpen || flashcards.isOpen || readerOpen || palette.open || inspectChar !== null;
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
							const before = settings.fontScale;
							adjustFontScale(step * 0.1, true);
							// At the smallest or largest size the step
							// changes nothing: a denial buzz says so
							// instead of a tick that feels like growth.
							if (settings.fontScale === before) buzzNo();
							else buzzBeat("send");
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
						// Two-finger taps pair into the iOS sidebar toggle
						// only: double-taps never scroll anywhere (a thumb
						// heel resting mid-tap used to read as a second
						// finger and fire the old message-end jump under
						// word selects). Swipes take the step path
						// instead. Message delete moved to the
						// three-finger tap, the chat wipe to the
						// three-finger hold. Never mid-select: opening
						// settings stopped vetoing on a highlight, but
						// the toggle must not fire under one.
						else if (
							!pinchMoved &&
							iosUI &&
							twoTapAt > 0 &&
							moved <= 12 &&
							now - twoTapAt <= 400 &&
							window.getSelection()?.isCollapsed !== false
						) {
							if (now - lastTwoTapAt < 600) {
								lastTwoTapAt = 0;
								// The open keyboard would cover the sidebar.
								if (document.activeElement instanceof HTMLElement)
									document.activeElement.blur();
								toggleSidebar();
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
							buzzBeat("send");
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
						buzzBeat("send");
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
		promptGlide = createPromptGlide(promptEl);
		// Ambient haptics: bubble phase, so a handler's own explicit
		// beat lands first and the tick behind it stands down.
		const onPressHaptic = (event: MouseEvent): void => {
			const control =
				event.target instanceof Element
					? event.target.closest(PRESS_SELECTOR)
					: null;
			if (!control || control.matches(":disabled")) return;
			ambientBeat("tap", AMBIENT_GAP_MS);
		};
		const onStepHaptic = (event: Event): void => {
			const el = event.target;
			if (el instanceof HTMLInputElement && el.type === "range")
				ambientBeat("step", STEP_GAP_MS);
		};
		document.addEventListener("click", onPressHaptic);
		document.addEventListener("input", onStepHaptic);
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
			} else if (renamingChatId) {
				// A chat rename cancels, leaving the old name.
				cancelRename();
			} else if (captureStaged) {
				// The weak-capture overlay dismisses from anywhere (its
				// input included) and hands the caret back — the
				// component owns no Esc of its own, so this is the
				// only closer and it cannot double-fire.
				dismissCaptureStaged();
			} else if (captureMenu.open) {
				// The source menu sits below the overlay in z, so it
				// dismisses right after it.
				captureMenu = { open: false };
			} else if (reviewOpen) {
				// The annotations review closes from anywhere (the
				// staged pill keeps its own Esc-to-discard below).
				reviewOpen = false;
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
			} else if (newsMode.staged && !newsMode.newsBusy) {
				// A staged story is the same class of inline expansion:
				// Esc takes it back out (the panel keeps its ✕).
				newsMode.unpick();
			} else if (annotateMode.answerPop) {
				// The answer card has no close button: Esc fades it.
				annotateMode.closeAnswerPop();
			} else if (editingMsgId) {
				// An in-progress message edit cancels from anywhere,
				// including inside the prompt (capture phase pre-empts
				// the editor, which binds nothing to Esc).
				cancelMessageEdit();
			} else if (inEditor) {
				// ESC with the composer focused: drop the caret and
				// dismiss composer-adjacent overlays. Voice keeps playing
				// (it has its own toggle), but a live converse loop
				// stops — Esc is its off switch from anywhere below
				// the modals. Modals, search, and message edits keep
				// their earlier branches above.
				editor?.blur();
				if (converse !== "idle") dispatchConverse({ type: "toggle" });
				annotateMode.selMenu = null;
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
				annotateMode.selMenu = null;
				dismissSelPanels();
				inspectChar = null;
				openLangMenu = null;
				settingsOpen = false;
				shortcutsOpen = false;
				stopVoice();
				if (converse !== "idle") dispatchConverse({ type: "toggle" });
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
					escAnchor?.closest(".messages .rendered, .news-card-title")
				) {
					annotateMode.clearSelection();
				}
				// Scroll mode entered from a deactivated prompt steps
				// back out on Esc (prompt-entry Esc keeps scroll mode).
				if (focusMode === "scroll" && !scrollFromPrompt) exitScrollMode();
			}
		};

		const onKey = (event: KeyboardEvent) => {
			// An IME owns its keys mid-composition: Enter picks the
			// candidate and Esc drops the candidate list, never an app
			// action or a closed layer.
			if (isImeKey(event)) return;
			// An open language menu owns letters, arrows, and Enter.
			if (openLangMenu && langMenuKey(event)) {
				consumeEvent(event);
				return;
			}
			// The reader owns the keyboard while open (same fence as
			// the deck below): Space taps, arrows step, Esc closes.
			if (reader) {
				const readerKey = readerKeyAction({ ...keyFacts(event), repeat: event.repeat });
				if (readerKey === "pass") return;
				consumeEvent(event);
				if (readerKey === "close") closeReader();
				else if (readerKey !== "swallow") stepReader(readerKey);
				return;
			}
			// Flashcards own the keyboard while open; closed, the
			// shell chord opens them.
			if (
				flashcards.key({
					...keyFacts(event),
					repeat: event.repeat,
					onButton: closestFromTarget(event.target, ".deck button") !== null
				})
			) {
				consumeEvent(event);
				return;
			}
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
					event.preventDefault();
					restorePrompt();
					// The visibility flip flushes async: focusing now
					// would hit a still-hidden composer (a no-op), so
					// land once the tick makes it focusable again.
					void tick().then(() => enterEditMode());
					return;
				}
				if (idleAction === "swallow") {
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
				inShell: tauriBackendAvailable(),
				isMac,
				altGraph: event.getModifierState("AltGraph")
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
				// Fullscreen toggle: Ctrl+Cmd+F on the Mac, F11
				// elsewhere (⌘E / Ctrl+E edits now).
				// Claimed before find below, so the dual-modifier
				// chord never reads as Cmd/Ctrl+F.
				consumeEvent(event);
				void toggleFullscreen();
				return;
			}
			if (chord === "edit-newest") {
				// ⌘E pulls the newest own message into in-place
				// editing from anywhere — same gates as E (no-op
				// mid-send, a second press toggles back off). With
				// no own message it buzzes instead, like an
				// off-text speak chord.
				consumeEvent(event);
				const newest = newestUserMessageIndex(chat.messages);
				if (newest === null) {
					buzzNo();
					return;
				}
				editMessage(newest);
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
			if (chord === "capture-window") {
				// Screen-capture OCR from anywhere, editor included:
				// the flow gates on the settings checkbox and toasts
				// where no backend answers (browser preview).
				consumeEvent(event);
				void runCaptureFlow();
				return;
			}
			if (chord === "set-capture-area") {
				// Set-area from anywhere: the overlay gates on the
				// settings checkbox and toasts where no backend
				// answers (browser preview) — same flow as the
				// global chord, one path for both.
				consumeEvent(event);
				void openAreaOverlay();
				return;
			}
			const delScope = deleteScope({
				...keyFacts(event),
				inEditor: inEditor !== null,
				inEditable: isEditableTarget(event.target),
				hovered: hoveredIdx >= 0,
				hoverBadgeId: annotateMode.hoverBadgeId
			});
			if (delScope === "chat") {
				// ⇧⌘Delete drops the whole current chat (a blank one takes
				// its place, so the composer never strands) and resets the
				// voice language to the checked keyboard. Works from
				// anywhere, typing targets included.
				consumeEvent(event);
				dropChat(chat.id);
				editor?.focus();
				return;
			}
			if (delScope === "badge" && annotateMode.hoverBadgeId !== null) {
				// ⌘Delete over a hovered badge drops its annotation,
				// never the message underneath (same path as bare
				// Delete on the badge).
				consumeEvent(event);
				annotateMode.removeAnnotation(annotateMode.hoverBadgeId);
				return;
			}
			if (delScope === "message") {
				// ⌘Delete drops the hovered message, never the chat (Mac
				// Delete-key reports Backspace; forward-delete reports
				// Delete). Typing targets keep the plain chord for
				// line-kill habits, and with nothing hovered it no-ops.
				const target = chat.messages[hoveredIdx];
				if (target) {
					consumeEvent(event);
					stopAudioForMessage(target.id);
					deleteMessage(chatState, hoveredIdx);
					return;
				}
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
				hoverBadgeId: annotateMode.hoverBadgeId
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
				// newest end); ⇧⌘K steps up (older) — with ⌘↑ / ⌘↓
				// as shell aliases (same tokens). Works
				// sidebar-closed. Plain steps never take focus:
				// stepping is navigation — but a minted chat lands
				// in the prompt, ready to type.
				consumeEvent(event);
				stepChat(chrome === "step-chat-newer" ? 1 : -1, false, true);
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
			if (chrome === "prompt-zoom") {
				// ⌘[ / ⌘] resizes the prompt's text only (never the
				// messages): [ shrinks, ] grows. Shell only — the
				// browser keeps the chords for history.
				consumeEvent(event);
				adjustPromptScale(event.code === "BracketLeft" ? -0.1 : 0.1);
				return;
			}
			if (chrome === "prompt-width") {
				// ⇧⌘[ / ⇧⌘] widens/narrows the prompt only (never the
				// column): [ narrows, ] widens. Shell only — the
				// browser keeps the chords for tab switching.
				consumeEvent(event);
				adjustPromptWidth(event.code === "BracketLeft" ? -2 : 2);
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
			if (chrome === "delete-badge" && annotateMode.hoverBadgeId !== null) {
				// Shell Cmd+D over a hovered badge drops its
				// annotation, never the message underneath (same
				// path as bare Delete on the badge).
				event.preventDefault();
				annotateMode.removeAnnotation(annotateMode.hoverBadgeId);
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
			// fewer ancestor walks per keypress, not more. The hover
			// word resolves only for the A chords that read it (bare A
			// and Shift+A): caretRangeFromPoint on every keypress would
			// tax typing-adjacent keys for nothing.
			const shiftAOnly =
				event.key === "A" &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey;
			const bareAOnly =
				event.key === "a" &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey;
			const hoverHit =
				(bareAOnly || shiftAOnly) &&
				(hoveredIdx >= 0 || newsMode.news !== null) &&
				(window.getSelection()?.toString() ?? "") === ""
					? hoverWordRange()
					: null;
			const msgFacts = {
				...keyFacts(event),
				inEditor: inEditor !== null,
				inField: isFieldTarget(event.target),
				inEditable: isEditableTarget(event.target),
				inInteractive: isInteractiveTarget(event.target),
				inFieldOrFilter: isInspectFieldTarget(event.target),
				hasSelection: (window.getSelection()?.toString() ?? "") !== "",
				selInMessage: (() => {
					// The summoned menu opens under a stationary
					// cursor and steals :hover (clearing the hover
					// index) while the selection stands: a selection
					// in message text owns A with or without hover.
					try {
						const live = window.getSelection();
						if (!live || live.isCollapsed) return false;
						const anchor = live.anchorNode;
						const el =
							anchor instanceof Element
								? anchor
								: anchor?.parentElement;
						return !!el?.closest(".messages .rendered, .news-card-title");
					} catch {
						return false;
					}
				})(),
				hoverWord: hoverHit?.word ?? null,
				hoverHot: hoverHit !== null,
				hoverBadgeId: annotateMode.hoverBadgeId,
				hoveredIdx,
				escDownAt
			};
			// E with an answer card open rewords its annotation (the
			// card is the topmost layer, so it wins over hovered-row
			// E below; typing in any field keeps the key).
			const cardEdit = answerCardKeyAction({
				...keyFacts(event),
				cardOpen: annotateMode.answerPop !== null && !annotateMode.answerClosing,
				inField: isFieldTarget(event.target),
				inEditor: inEditor !== null,
				inEditable: isEditableTarget(event.target)
			});
			if (cardEdit === "edit-answer" && annotateMode.answerPop) {
				event.preventDefault();
				editOrangeAnnotation(annotateMode.answerPop.id);
				return;
			}
			// Shift+R over the open chat list reads a chat's title
			// (hovered row, else the walked one) before message keys.
			const speakRow = sidebarSpeakTarget({
				...keyFacts(event),
				listOpen: !settings.sidebarCollapsed,
				inField: isFieldTarget(event.target),
				hoveredRowId: previewChatId,
				walkedRowId: isSidebarTarget(event.target) ? chatState.activeChatId : null
			});
			const speakChat =
				speakRow === null ? null : chatState.chats.find((c) => c.id === speakRow);
			if (speakChat) {
				consumeEvent(event);
				const title = chatTitle(speakChat);
				void speakQuote(title, `chat-title:${speakChat.id}`, false, title);
				return;
			}
			const msgAction = messageKeyAction(msgFacts);
			if (msgAction === "annotate-selection") {
				// A live selection plus A: file and send at once, exactly
				// like a hovered word — the pill never opens (Shift+A
				// opens it empty for a typed note instead). The menu
				// never paints either: placeSelMenu only carries the
				// quote into annotate, then the state clears in the
				// same tick (Svelte batches — no flash).
				event.preventDefault();
				annotateMode.placeSelMenu();
				annotateMode.annotate("", true);
				annotateMode.selMenu = null;
				return;
			}
			if (msgAction === "annotate-hovered-instant") {
				// Hover a word, hit A: select it first, then file and
				// send at once — neither the pill nor the menu ever
				// opens. The decision already confirmed a word is
				// under the pointer; a stale range selects nothing
				// and files nothing (annotate guards the empty quote).
				if (hoverHit) {
					event.preventDefault();
					window
						.getSelection()
						?.setBaseAndExtent(
							hoverHit.node,
							hoverHit.start,
							hoverHit.node,
							hoverHit.end
						);
					annotateMode.placeSelMenu();
					annotateMode.annotate("", true);
					annotateMode.selMenu = null;
					return;
				}
			}
			if (msgAction === "annotate-empty") {
				// Shift+A opens the create box empty: a live selection
				// files as-is, otherwise the hovered word selects
				// itself first (same selection prelude, no "?" staged).
				if (msgFacts.hasSelection) {
					event.preventDefault();
					annotateMode.placeSelMenu();
					annotateMode.annotate("");
					return;
				}
				if (hoverHit) {
					event.preventDefault();
					window
						.getSelection()
						?.setBaseAndExtent(
							hoverHit.node,
							hoverHit.start,
							hoverHit.node,
							hoverHit.end
						);
					annotateMode.placeSelMenu();
					annotateMode.annotate("");
					return;
				}
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
			if (msgAction === "trim-hovered") {
				// T trims everything above the hovered assistant message:
				// the prefix hides behind a marker and folds into the
				// rolling summary (assistant messages only — the point
				// stays on screen as the new head).
				const target = chat.messages[hoveredIdx];
				if (!target || target.role !== "assistant") {
					flashToast("Hover an assistant message to trim above it.");
					return;
				}
				if (hoveredIdx <= 0) {
					flashToast("Nothing above to trim.");
					return;
				}
				event.preventDefault();
				void trimAbove(chat, hoveredIdx);
				return;
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
			if (msgAction === "delete-badge" && annotateMode.hoverBadgeId !== null) {
				// Bare Delete/Backspace on a hovered badge drops its
				// annotation (no modifier needed — the tiny target is
				// the authorization). Unknown ids (deleted mid-flight)
				// no-op inside annotateMode.removeAnnotation.
				event.preventDefault();
				annotateMode.removeAnnotation(annotateMode.hoverBadgeId);
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
			const sideAction = sidebarListAction({
				...keyFacts(event),
				listOpen: !settings.sidebarCollapsed,
				inSidebar,
				inField: isFieldTarget(event.target),
				inChatRow: isChatRowTarget(event.target)
			});
			if (sideAction === "walk-down" || sideAction === "walk-up") {
				// Walking switches to each chat (preview-as-you-go).
				event.preventDefault();
				const delta = sideAction === "walk-down" ? 1 : -1;
				const chats = sideVisibleChats();
				let from = chats.findIndex((c) => c.id === chatState.activeChatId);
				if (sideIdx >= 0 || isChatRowTarget(event.target)) {
					sideCursorChat(event.target);
					from = sideIdx;
				}
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
					!isChatRowTarget(event.target) &&
					resolveSidebarSpaceEnter(sideIdx, sideVisibleChats().length).kind ===
						"stay"
				) {
					enterEditMode();
				} else enterSideChat(event.target);
				return;
			}
			if (sideAction === "delete-chat") {
				// Delete drops the focused chat and lands on the one
				// below (or a fresh blank when the list empties).
				event.preventDefault();
				deleteSideChat(event.target);
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
				pulseLanded(selectedIdx);
				return;
			}
			if (scrollAction === "go-bottom") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(chat.messages.length - 1);
				pulseLanded(selectedIdx);
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
			const id = (badge.dataset.annBadge ?? "") as AnnotationId;
			// A hold-delete just fired for this badge (Android): the
			// trailing compatibility press is the gesture's end,
			// never a re-press — swallowing it keeps the deleted
			// badge's card shut.
			if (
				badgeHoldFired !== null &&
				badgeHoldFired.id === id &&
				Date.now() - badgeHoldFired.at < 1500
			)
				return;
			event.preventDefault();
			// A re-press toggles closed (cancel): saving first would
			// restart the fade the toggle is about to cancel.
			if (!(annPop && !annPopClosing && annPop.id === id)) saveAnnPop();
			// Same boundary as MessageBody's badge click: stamped ids.
			// The press point anchors the desktop edit menu; phones
			// edit in the composer and ignore it.
			annotateMode.openBadge(id, { x: event.clientX, y: event.clientY });
			annotateMode.lastBadgePress = { id, at: Date.now(), seq: mainPressSeq };
		};
		/**
		 * Click-off closes the annotations review (desktop): a press
		 * outside the pill/card unpins it. Presses inside .ann-wrap
		 * (pill toggle, quote jumps, row buttons) keep their own
		 * behavior; phones keep tap-driven flow and skip this.
		 */
		const dismissReview = (event: MouseEvent) => {
			if (event.button !== 0 || androidUI || !reviewOpen) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(".ann-wrap")) return;
			reviewOpen = false;
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
			// Native double-click rounds CJK boundaries
			// engine-dependently (塔 lands や): a point-anchored
			// CJK pick replaces it — other scripts keep the native
			// selection untouched.
			const cjk = cjkWordRangeAtPoint(event.clientX, event.clientY);
			if (cjk) {
				try {
					const pick = window.getSelection();
					pick?.removeAllRanges();
					pick?.addRange(cjk);
				} catch {
					// Native pick stands.
				}
			}
			const live = window.getSelection();
			if (live) lockSelectionToMessage(live, (n) => annotateMode.articleOf(n));
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
			// Word-select plus the menu only: a double-tap must never
			// scroll — dragging the view down to the action row
			// disoriented phone readers (the row stays where it is).
			annotateMode.placeSelMenu(event.clientX, event.clientY);
		};
		// No triple-click handler: native paragraph selection finalizes
		// on the third mouseup, where onSelectEnd already locks it to the
		// message and summons the menu.
		// Selection text at the last mousedown: a mouseup that changed
		// nothing started on blank space, so a stale highlight is dropped
		// instead of re-summoning the menu.
		let downSel = "";
		const snapSelection = (): void => {
			// A new press restarts any multi-click run: cancel its
			// pending menu summon (the run's own mouseup re-arms).
			if (multiClickMenuAt !== null) {
				clearTimeout(multiClickMenuAt);
				multiClickMenuAt = null;
			}
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
			const anchorArticle = annotateMode.articleOf(anchorNode);
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
			if (annotateMode.articleOf(live.anchorNode) === dragAnchorArticle) return false;
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
			// Badge presses never dismiss: their own open path summons
			// the readings panel for Han quotes (see openBadge), and
			// this listener runs after it in the same gesture.
			if (!target?.closest("[data-ann-badge]")) dismissSelPanels();
			selectingInMessage =
				event.button === 0 && !!target?.closest(".messages .rendered");
			offChatDragArmed =
				event.button === 0 && !target?.closest(".messages .rendered");
			lastGoodDragRange = null;
			containDragTo(selectingInMessage ? annotateMode.articleOf(target) : null);
		};
		const trimMessageDrag = (): void => {
			if (selectingInMessage) {
				const live = window.getSelection();
				if (live) {
					restoreDragSelection(live);
					trackDragSelection(live);
					lockSelectionToMessage(live, (n) => annotateMode.articleOf(n));
				}
				return;
			}
			clampOffChatDrag();
			// The readings overlays belong to one highlight: a changed
			// or cleared selection dismisses them (mid-drag leaves them
			// until release, like the menu's own paths).
			if (selPinyin || selFurigana) {
				const now = annotateMode.currentQuote();
				const anchor = selPinyin ?? selFurigana?.[0];
				if (!anchor) dismissSelPanels();
				// A pinned highlight (create/answer) collapses under
				// pill focus: emptiness alone never dismisses it, only
				// a mismatched new highlight (or submit/cancel/close).
				else if (!now) {
					if (!panelsPinned) dismissSelPanels();
				} else if (
					now.messageId !== anchor.messageId ||
					now.quote !== anchor.quote
				)
					dismissSelPanels();
			}
		};
		// Native OS menu in the prompt, across the settings panel,
		// and inside the annotation answer card: while a live
		// selection sits inside any of them, the Activity shows the
		// real OS menu (Copy / Cut / Paste) instead of the empty dummy
		// — selectable labels are only honest with a menu behind
		// them. Native fields hide their range from
		// window.getSelection(), so the focused field's own start/end
		// is read too. The select event covers field selections
		// where selectionchange never fires. Transitions only —
		// handle drags stay silent on the bridge.
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
				[promptEl, settingsEl, document.querySelector(".ann-answer")],
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
					annotateMode.articleOf(anchorNode) === annotateMode.articleOf(focusNode)
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
						annotateMode.articleOf(anchorNode) !== annotateMode.articleOf(focusNode) &&
						focusNode instanceof Text
					) {
						containDragTo(annotateMode.articleOf(focusNode));
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
				containDragTo(annotateMode.articleOf(focusNode));
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
			// News cards exempt: headline drags must reach the summon
			// below (the card's own click stands down on selections).
			if (
				target?.closest(
					".sel-menu, .ann-dock, .review, button, input, textarea"
				) &&
				!target?.closest(".news-open")
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
						// WebKit: clearing the selection on mouseup after a
						// field took focus destroys the just-placed caret —
						// later keystrokes dispatch yet never become text
						// (see mouseupKeepsSelection: clicks into editables
						// already moved the selection there, and presses
						// that keep field focus keep a live caret too).
						if (!mouseupKeepsSelection(event.target, document.activeElement)) {
							window.getSelection()?.removeAllRanges();
						}
						annotateMode.selMenu = null;
					} else if ((window.getSelection()?.toString() ?? "") === "") {
						annotateMode.selMenu = null;
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
				(event.detail <= 1 ||
					(event.detail >= 4 &&
						!target?.closest(".rendered, .news-card-title"))) &&
				!multiTapOwnsRelease(msgTapSeq, Date.now())
			) {
				// A plain click changed nothing: blank space, a collapsed
				// caret, or inside the old highlight (the engine collapses
				// that only after mouseup dispatches, so the stale text
				// still reads "selected" here — re-summoning off it is what
				// stranded the menu on a cleared highlight). Drop any stale
				// highlight and never re-summon. Multi-click sequences
				// (detail 2–3) keep the old path: their picks finalize
				// around these events. Quadruple-clicks inside message
				// text are exempt: the fourth press collapses the triple
				// pick before mouseup, which would misread as "nothing
				// changed" — onSelectEnd's paragraph override owns them.
				if (liveText !== "") live?.removeAllRanges();
				annotateMode.selMenu = null;
				return;
			}
			if (
				!dragged &&
				!target?.closest(".rendered") &&
				liveText !== "" &&
				liveText === downSel
			) {
				live?.removeAllRanges();
				annotateMode.selMenu = null;
				return;
			}
			onSelectEnd(event, event.clientX);
		};
		// Base-text char under a point: aid readings (pinyin ruby,
		// furigana .frb/.frt spans) split prose into elements, so the
		// caret can land on a wrapper or on the reading itself.
		// Readings never speak — resolve to the base char under the
		// point instead.
		function baseCharAtPoint(
			root: Element,
			x: number,
			y: number
		): { node: Text; index: number } | null {
			try {
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				let n: Node | null = null;
				while ((n = walker.nextNode())) {
					const textNode = n as Text;
					if (textNode.parentElement?.closest("rt, rp, .frt")) continue;
					const text = textNode.textContent ?? "";
					if (text.length === 0) continue;
					const nodeRect = document.createRange();
					nodeRect.selectNodeContents(textNode);
					const bounds = nodeRect.getBoundingClientRect();
					if (
						x < bounds.left - 2 ||
						x > bounds.right + 2 ||
						y < bounds.top - 2 ||
						y > bounds.bottom + 2
					)
						continue;
					for (let i = 0; i < text.length; i++) {
						try {
							const char = document.createRange();
							char.setStart(textNode, i);
							char.setEnd(textNode, i + 1);
							const rect = char.getBoundingClientRect();
							if (rect.width === 0 && rect.height === 0) continue;
							if (
								x >= rect.left - 2 &&
								x <= rect.right + 2 &&
								y >= rect.top - 2 &&
								y <= rect.bottom + 2
							)
								return { node: textNode, index: i };
						} catch {
							continue;
						}
					}
				}
			} catch {
				return null;
			}
			return null;
		}
		/** CJK scripts whose double-click (and caret) boundaries round
		engine-dependently: a click on 塔 can resolve the neighbor や. */
		const CJK_WORD_RE =
			/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

		/** True when the live message selection's on-screen span covers
		the point (same pad as rangeContainsPoint below): a right-click
		with a highlight reads the highlight only when the click lands
		inside it. WebKit word-selects on right-mousedown with its own
		breaker (ルーブル beside a 館 click); Chromium leaves no
		selection at all — so a highlight the click missed is the
		engine's neighbor pick, never the user's, and the word under
		the cursor wins instead. */
		function selectionHitsPoint(x: number, y: number): boolean {
			try {
				const live = window.getSelection();
				if (!live || live.rangeCount === 0 || live.isCollapsed)
					return false;
				return [...live.getRangeAt(0).getClientRects()].some(
					(rect) =>
						x >= rect.left - 2 &&
						x <= rect.right + 2 &&
						y >= rect.top - 2 &&
						y <= rect.bottom + 2
				);
			} catch {
				return false;
			}
		}
		/** True when the point lands inside the node's [start, end) screen span. */
		function rangeContainsPoint(
			node: Node,
			start: number,
			end: number,
			x: number,
			y: number
		): boolean {
			try {
				const span = document.createRange();
				const length = node.textContent?.length ?? 0;
				span.setStart(node, Math.min(start, length));
				span.setEnd(node, Math.min(end, length));
				return [...span.getClientRects()].some(
					(rect) =>
						x >= rect.left - 2 &&
						x <= rect.right + 2 &&
						y >= rect.top - 2 &&
						y <= rect.bottom + 2
				);
			} catch {
				return false;
			}
		}

		/**
		 * Point-anchored CJK word range: candidate segments around the
		 * caret, keeping the first whose on-screen rect actually
		 * contains the point — the click, not the rounding, decides.
		 * Null for non-CJK points (native selection stands).
		 */
		function cjkWordRangeAtPoint(x: number, y: number): Range | null {
			const at = document.elementFromPoint(x, y);
			const body =
				at instanceof Element ? at.closest(".messages .rendered") : null;
			if (!(body instanceof HTMLElement)) return null;
			const origins: Array<{ node: Text; offset: number }> = [];
			try {
				if (typeof document.caretRangeFromPoint === "function") {
					const pos = document.caretRangeFromPoint(x, y);
					const container = pos?.startContainer ?? null;
					if (
						container &&
						container.nodeType === Node.TEXT_NODE &&
						body.contains(container)
					) {
						origins.push({
							node: container as Text,
							offset: pos?.startOffset ?? 0
						});
					}
				}
			} catch {
				// Fall through to the per-char scan below.
			}
			const base = baseCharAtPoint(body, x, y);
			if (base && base.node !== origins[0]?.node)
				origins.push({ node: base.node, offset: base.index });
			for (const origin of origins) {
				const text = origin.node.textContent ?? "";
				const offsets = [
					origin.offset,
					origin.offset - 1,
					origin.offset + 1
				].filter(
					(off, i, all) =>
						off >= 0 && off <= text.length && all.indexOf(off) === i
				);
				for (const off of offsets) {
					const bounds = wordBoundsAt(text, off);
					if (!bounds) continue;
					const word = text.slice(bounds[0], bounds[1]);
					if (!word || !CJK_WORD_RE.test(word)) continue;
					if (rangeContainsPoint(origin.node, bounds[0], bounds[1], x, y)) {
						try {
							const range = document.createRange();
							range.setStart(origin.node, bounds[0]);
							range.setEnd(origin.node, bounds[1]);
							return range;
						} catch {
							continue;
						}
					}
				}
			}
			return null;
		}

		// Word under the cursor, or "" on open space / non-text.
		function wordUnderCursor(event: MouseEvent, body: Element): string {
			let node: Node | null = null;
			let offset = 0;
			try {
				if (typeof document.caretRangeFromPoint === "function") {
					const range = document.caretRangeFromPoint(
						event.clientX,
						event.clientY
					);
					node = range?.startContainer ?? null;
					offset = range?.startOffset ?? 0;
				}
			} catch {
				node = null;
			}
			// Element landing (ruby/span wrappers, split boundaries)
			// or a reading hit: resolve the base-text char under the
			// point. Readings (rt/rp/.frt) never count as text hits
			// either — the caret path below would speak the kana
			// instead of the kanji.
			if (
				!node ||
				node.nodeType !== Node.TEXT_NODE ||
				!body.contains(node) ||
				(node as Text).parentElement?.closest("rt, rp, .frt") !== null
			) {
				const hit = baseCharAtPoint(body, event.clientX, event.clientY);
				if (!hit) return "";
				node = hit.node;
				offset = hit.index;
			}
			const text = node.textContent ?? "";
			// Caret snapped past the text (open-space click resolving
			// to a node edge): only retry inside the char when the
			// point is actually over the text — far padding is message
			// space, not the edge word.
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
			// resolving past it) retry inside the char. Segmented
			// bounds, not maximal-run expansion: an isolated CJK word
			// inside an unspaced run must resolve to itself (没有,
			// not the whole clause) — same segmentation the hover
			// path uses.
			const bounds = wordBoundsAt(text, offset);
			if (!bounds) return "";
			let word = text.slice(bounds[0], bounds[1]);
			// CJK boundary rounding is engine-dependent (a click on 塔
			// can resolve the neighbor や): when the raw pick is CJK
			// but its rect misses the point, retry the adjacent
			// offsets and keep the first pick containing it — other
			// scripts keep the raw pick untouched.
			if (
				word &&
				CJK_WORD_RE.test(word) &&
				!rangeContainsPoint(
					node,
					bounds[0],
					bounds[1],
					event.clientX,
					event.clientY
				)
			) {
				word = "";
				for (const off of [offset - 1, offset + 1]) {
					if (off < 0 || off > text.length) continue;
					const retry = wordBoundsAt(text, off);
					if (!retry) continue;
					const candidate = text.slice(retry[0], retry[1]);
					if (!candidate || !CJK_WORD_RE.test(candidate)) continue;
					if (
						rangeContainsPoint(
							node,
							retry[0],
							retry[1],
							event.clientX,
							event.clientY
						)
					) {
						word = candidate;
						break;
					}
				}
			}
			return word;
		}
		// Desktop right-click reads aloud (the selection, else the word
		// under the cursor; open space reads nothing. A second
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
			if (androidUI && target?.closest(".messages .rendered, .news-card-title")) {
				event.preventDefault();
				if (annotateMode.currentQuote()) {
					annotateMode.placeSelMenu(event.clientX, event.clientY);
					touchMenuAt = Date.now();
				}
				return;
			}
			if (androidUI) return;
			const body = target?.closest(".messages .rendered, .news-card-title");
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
			// Controls and links inside messages stay silent — except
			// a headline pick, which reads like a message quote (a
			// bare card press falls through to the card menu below).
			if (target?.closest("button, input, textarea, a, summary")) {
				const pick = annotateMode.currentQuote();
				if (!pick?.story) return;
			}
			// Highlighted text wins — but only when the click lands
			// inside it (same per-quote language as the sel-menu
			// button). A live selection the click missed is the
			// engine's right-mousedown neighbor pick (see
			// selectionHitsPoint), never the user's, so the word
			// under the cursor beats it; open space with no word
			// keeps the old highlight read. When the highlight
			// contains Han it also shows readings for just the
			// highlight — pinyin in Chinese text, furigana in
			// Japanese (per-kanji runs, so mixed selections like
			// 咲き誇り map back) — speech always runs; the panel is
			// a silent extra. Like Inspect, a lone Han char reads
			// its locale from the surrounding sentence.
			const quoted = annotateMode.currentQuote();
			// A press that grew the highlight (a right-button
			// micro-drag extends the old range instead of replacing
			// it) is a fresh point pick, not a click inside a
			// deliberate selection: the point-anchored word below
			// wins over the expanded span.
			const expanded =
				quoted !== null && pressExpandedSelection(downSel, quoted.quote);
			const clickInSelection =
				quoted !== null &&
				!expanded &&
				selectionHitsPoint(event.clientX, event.clientY);
			const article = body.closest('article[id^="msg-"]');
			const msg = article
				? chat.messages[Number(article.id.slice(4))]
				: undefined;
			// Reader on: the click opens the big-word reader from the
			// sentence under the cursor (speakUnitAtPoint routes it).
			if (msg && !clickInSelection && settings.readerMode !== "off") {
				speakUnitAtPoint(event.clientX, event.clientY, "sentence");
				return;
			}
			if (msg && !clickInSelection) {
				const word = wordUnderCursor(event, body);
				if (word) {
					// Repoint the wash onto the clicked word so the
					// highlight always matches the audio: WebKit's
					// mousedown pick uses its own breaker (and Chromium
					// leaves nothing), so only the point-anchored CJK
					// range is trustworthy — other scripts keep the
					// engine's pick when it exists, else no wash at
					// all. Programmatic ranges summon no menu (the
					// selectionchange watcher stands down with none
					// open), and speech stays on the instant word path.
					const wordRange = cjkWordRangeAtPoint(
						event.clientX,
						event.clientY
					);
					try {
						const live = window.getSelection();
						if (wordRange) {
							live?.removeAllRanges();
							live?.addRange(wordRange);
						} else if (quoted) {
							live?.removeAllRanges();
						}
					} catch {
						// A disturbed selection keeps its wash; speech
						// still follows the point.
					}
					void speakQuote(word, msg.id, false, speechText(msg.content));
					// The repoint leaves a live highlight on the clicked
					// word: show its readings like the quoted branch
					// would below — a second right-click reads like the
					// first, panel included. Speech already ran above;
					// readingsForQuote only places the panel.
					const fresh = annotateMode.currentQuote();
					if (fresh?.messageId)
						void readingsForQuote({ ...fresh, messageId: fresh.messageId });
					return;
				}
			}
			if (quoted) {
				// 咲き誇り map back) — speech always runs; the panel is
				// a silent extra. Like Inspect, a lone Han char reads
				// its locale from the surrounding sentence. Speech
				// waits for the sentence-correct kana: the raw kanji
				// would read with default guesses.
				void (async () => {
					// Headlines skip readings (message-DOM panels have
					// nothing to place on) but still read aloud.
					const kana = quoted.messageId
						? await readingsForQuote({ ...quoted, messageId: quoted.messageId })
						: null;
					void speakQuote(
						kana ?? quoted.quote,
						selSpeakKey(quoted),
						false,
						quoted.context
					);
				})();
				return;
			}
			// No (matching) selection: a word under the cursor reads just
			// that word (same per-quote path as a selection); open
			// message space reads nothing — not a listen moment, so no
			// read starts.
			if (!msg) return;
			const word = wordUnderCursor(event, body);
			if (word) {
				void speakQuote(word, msg.id, false, speechText(msg.content));
				return;
			}
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
		// Window-capture availability arrives async (mac-only
		// build): the composer button rides it plus the settings
		// kill-switch, so phones and the preview never see it.
		void captureSupported().then((ok) => {
			canCapture = ok;
		});
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
		// OS-global capture chord (desktop.rs): the frontend runs the
		// capture→OCR→send pipeline off it. Null outside the shell;
		// the settings checkbox gates inside runCaptureFlow.
		let unlistenCapture: (() => void) | null = null;
		void listenGameCapture(() => {
			void runCaptureFlow();
		}).then((stop) => {
			unlistenCapture = stop;
		});
		// Set-area request (global ⇧⌘U, desktop.rs): the checkbox
		// gates like the capture chord; the picker waits on the
		// desktop Space and the user tabs back to draw.
		void listenAreaPickRequested(() => {
			void openAreaOverlay();
		});
		// Area-picker reports (the ⇧⌘U overlay): saves persist the
		// square the capture chord reuses, clears drop it, Esc
		// cancels silently with no event at all.
		void listenAreaPicked((pick: AreaPick) => {
			if (pick.clear) {
				settings.captureArea = null;
				saveSettingsNow();
				flashToast("Capture area cleared.");
				return;
			}
			if (pick.rect) {
				settings.captureArea = {
					x: Math.round(pick.rect.x),
					y: Math.round(pick.rect.y),
					width: Math.round(pick.rect.width),
					height: Math.round(pick.rect.height)
				};
				saveSettingsNow();
				flashToast("Capture area saved.");
			}
		});
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
				// Settled keyboard geometry re-lands open cards: the
				// open-time estimate strands them when the viewport
				// grew or shrank underneath (edit focus summons the
				// keyboard, badge taps dismiss it). Android only —
				// desktop re-places its own way.
				if (androidUI) {
					const openAnswer = annotateMode.answerPop;
					const openEdit = annPop;
					if (openAnswer) refitAndroidCard("answer", openAnswer.id);
					if (openEdit) refitAndroidCard("edit", openEdit.id);
				}
			}, 250);
		};
		window.visualViewport?.addEventListener("resize", onViewportResize);
		window.visualViewport?.addEventListener("scroll", onViewportResize);
		void listenMenuActions();
		void listenGameLine();
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
		/**
		 * Scroll re-anchor for pinned (create/answer) panels whose live
		 * highlight is gone (focus collapse, DOM surgery): every panel
		 * re-measures its own span in the document instead of stacking
		 * on one rect — an answer card's own scroll must not clear its
		 * readings. A vanished quote still dismisses.
		 */
		const reanchorSelPanels = (): void => {
			if (selFurigana) {
				let moved = false;
				const next = selFurigana.map((panel) => {
					const gtext = panel.runs.map((run) => run.text).join("");
					const qs = gtext ? panel.quote.indexOf(gtext) : -1;
					const rect =
						qs >= 0
							? rectForQuoteSpan(
									panel.messageId,
									panel.quote,
									panel.at,
									qs,
									qs + gtext.length
								)
							: screenRectForQuote(panel.messageId, panel.quote, panel.at);
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
			const anchor = screenRectForQuote(
				selPinyin.messageId,
				selPinyin.quote,
				selPinyin.at
			);
			if (!anchor) {
				dismissSelPanels();
				return;
			}
			const placed = panelXY(anchor);
			if (selPinyin.y !== placed.y || selPinyin.above !== placed.above)
				selPinyin = { ...selPinyin, ...placed };
		};
		const trackSelPinyin = (): void => {
			if (!selPinyin && !selFurigana) return;
			try {
				const live = window.getSelection();
				const range = live && live.rangeCount > 0 ? live.getRangeAt(0) : null;
				if (!range || range.collapsed || !document.contains(range.startContainer)) {
					// Unpinned panels die with the highlight; pinned ones
					// re-anchor (see above).
					if (!panelsPinned) {
						dismissSelPanels();
						return;
					}
					reanchorSelPanels();
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
			// Readings panels ride the same scroll/resize beats.
			trackReadingsPanels();
			if (!annotateMode.selMenu?.range) return;
			try {
				const { range } = annotateMode.selMenu;
				if (
					!document.contains(range.startContainer) ||
					!document.contains(range.endContainer)
				) {
					annotateMode.selMenu = null;
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
						annotateMode.selMenu.quote,
						androidUI,
						settings.inspectEnabled
					),
					fontScale: settings.fontScale
				});
				if (
					annotateMode.selMenu.x !== x ||
					annotateMode.selMenu.y !== y ||
					annotateMode.selMenu.left !== rect.left ||
					annotateMode.selMenu.w !== rect.width
				)
					annotateMode.selMenu = { ...annotateMode.selMenu, x, y, left: rect.left, w: rect.width };
			} catch {
				annotateMode.selMenu = null;
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
			promptGlide?.detach();
			promptGlide = null;
			document.removeEventListener("click", onPressHaptic);
			document.removeEventListener("input", onStepHaptic);
			window.visualViewport?.removeEventListener("resize", onViewportResize);
			window.visualViewport?.removeEventListener("scroll", onViewportResize);
			if (viewportTimer !== undefined) window.clearTimeout(viewportTimer);
			window.removeEventListener("focus", onWinFocus);
			// Never let invoke throw into teardown (three-runtime rule).
			try {
				unlistenCapture?.();
			} catch {
				// Already torn down.
			}
			unlistenCapture = null;
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
	data-hyphenate={settings.fontScale >= HYPHENATE_FONT_SCALE || null}
	style="--font-scale: {androidUI
		? Math.min(FONT_SCALE_MAX, settings.fontScale)
		: settings.fontScale}; --msg-font: {settings.fontScale}; --chat-width: {effectiveChatWidth(
		androidUI,
		settings.fontScale,
		settings.chatWidth ?? 36
	)}; --prompt-width: {effectivePromptWidth(
		androidUI,
		settings.fontScale,
		settings.chatWidth ?? 36,
		settings.promptWidth ?? PROMPT_WIDTH_BASE_REM
	)}; --prompt-font: {settings.promptScale ?? 1}; --annpop-scale: {settings.annPopScale ?? 1}; --msg-gap: {settings.messageGap ?? MESSAGE_GAP_DEFAULT}rem; --msg-line-height: {settings.lineHeight ?? LINE_HEIGHT_DEFAULT}; --ui-scale: {settings.uiScale ?? 1}; --ui-scale-inv: {1 / (settings.uiScale ?? 1)}"
	data-mac={(isMac && !androidUI) || null}
	data-titlebar={tauriBackendAvailable() && isMac && !androidUI ? "overlay" : null}
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
		renamingId={renamingChatId}
		bind:renameDraft
		bind:renameEl
		actions={{
			startRename,
			commitRename,
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
				sideIdx = sideVisibleChats().findIndex((c) => c.id === id);
				transitionToChat(id);
				settings.sidebarCollapsed = true;
				persistSettings();
				landFilterMatch(id, sideSearch);
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
		class:news={newsMode.news !== null}
		class:hide-messages={settings.hideMessages}
		class:hide-buttons={settings.hideButtons}
		class:plain-user={!settings.ownBubble}
		data-own-ink={settings.ownInk}
		class:hover-user={settings.hoverUserActions}
		class:hover-assistant={settings.hoverAssistantActions}
		class:scale-actions={settings.scaleActionsWithFont}
		class:alt={altHeld}
		onpointerdown={noteMainDown}
		onpointermove={noteMainMove}
		onclick={closeSettingsFromMain}
		ondblclick={gutterDoubleClick}
	>
		<!-- Reply-language pills render in `LangMenus.svelte` (hero call
		site in `ThreadView` below); the page keeps the open menu, the
		sheet anchor, the active code, and the behaviors. -->
		<Toasts
			{notices}
			bind:toastAction
			bind:errorToastAction
			android={androidUI}
		/>
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
		{#if find.open}
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
					pulseLanded(selectedIdx);
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
			trimIdx={trimPointIndex(viewChat)}
			onUndoTrim={() => undoTrim(viewChat)}
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
				// The open answer owns its quote's wash like the
				// pill does: moving off the badge must not clear
				// it while the card reads. The fade releases it
				// (closing reads null, like the pill).
				pillWashId(annotateMode.answerPop, annotateMode.answerClosing) ??
				promptAnnWashId() ??
				annotateMode.hoverBadgeId}
			sending={isSending(chatState, viewChat.id)}
			sendingChatId={chatState.sendingChatId}
			sendingPhase={replyPhase({
				sending:
					isSending(chatState, viewChat.id) ||
					nativeTurns.live.has(viewChat.id),
				fetching:
					(isSending(chatState, viewChat.id) &&
						hasFetchActive(chatState, viewChat.id)) ||
					nativeTurns.fetching.has(viewChat.id),
				started: hasReplyStarted(chatState, viewChat.id),
				tick: sendElapsed,
				nowMs: Date.now(),
				lastTokenMs: lastTokenAt.get(viewChat.id) ?? null
			})}
			{sendElapsed}
			waitingLabel={thinkingLabelFor(activeReplyCode ?? settings.replyLang)}
			{useMock}
			{openLangMenu}
			langMenuTyped={langTyped}
			{langMenuAnchor}
			{langMenusActions}
			newsPanel={newsMode.news}
			newsStaged={newsMode.staged}
			newsBusy={newsMode.newsBusy}
			newsImages={newsMode.newsImages}
			newsActions={newsMode.actions}
			flashcardsDue={flashcards.due}
			onFlashcards={() => flashcards.open()}
			bind:scrollBox
			bind:popOpen={refsPopOpen}
			bind:refsDraft={refsEditDraft}
			bind:refsBox={refsEditBox}
			actions={{
				noteScrolling,
				freezeScroll,
				releaseScroll,
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
				setHoverBadge: (id: string | null) => (annotateMode.hoverBadgeId = id),
				badgeClick: (id: AnnotationId, anchor: { x: number; y: number }) =>
					annotateMode.openBadgeClick(id, anchor),
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

		{#if (providerKeys.missing || (providerKeys.locked && !settingsOpen)) && !androidUI}
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

		{#if viewport.missed && !viewport.stick && viewChat.messages.length > 0}
			<!-- New reply text landed below a reader who scrolled up:
			the thread stays put, this offers the way down. -->
			<button
				type="button"
				class="jump-latest"
				transition:fade={{ duration: 160 }}
				onclick={jumpToLatest}>Jump to latest ↓</button
			>
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
			hasSelMenu={annotateMode.selMenu !== null}
			inspectQuote={annotateMode.selMenu?.quote ?? ""}
			inspectEnabled={settings.inspectEnabled}
			annotations={drafts.list}
			reviewOpen={reviewOpen}
			bind:highlightId={highlightAnnId}
			bind:pillEl={annPill}
			attachBusy={attachBusy}
			canMic={canMic}
			micEnabled={settings.micEnabled}
			canCapture={canCapture}
			captureEnabled={settings.captureEnabled}
			captureMenu={captureMenu}
			dictating={dictating}
			voiceOn={voiceOn()}
			speaking={speakingId !== null}
			conversePhase={converse}
			converseDisabled={providerKeys.locked && converse === "idle"}
			altKey={altm}
			replyLang={activeReplyLang}
			correctionOn={chat.correction ?? false}
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
				converse: () => toggleConverse(),
				captureToggle: () => toggleCaptureMenu(),
				captureAction: (source: CaptureOneShot) => runCaptureAction(source),
				wpToggle: () => {
					wpOpen = !wpOpen;
					buzzTap();
				},
				correctionToggle: () => toggleCorrection(),
				submit: (alt: boolean) => onSubmit(alt ? "stage" : "send"),
				menuPress: noteMenuPress,
				menuTouch: noteMenuBtnTouch,
				annotateTouch,
				speakTouch,
				inspectTouch,
				// Wrapped: Svelte hands the click event to a bare
				// reference, and the event would file as the note
				// ("[object PointerEvent]" in the composer).
				annotate: () => annotateMode.annotate(),
				speak: () => void speakSelection(),
				inspect: openInspect,
				review: {
					toggle: () => (reviewOpen = !reviewOpen),
					clearAll: clearAllAnnotations,
					quote: (ann: Annotation) => annotateMode.reviewQuoteClick(ann),
					copy: copyAnnotation,
					remove: (id: AnnotationId) => annotateMode.removeAnnotation(id),
					unpin: (id: AnnotationId) => annotateMode.unpinAnnotation(id),
					editOrange: editOrangeAnnotation
				}
			}}
		/>

		{#if captureStaged}
			<!-- Weak-capture overlay: the staged read waits for a
			check (Enter files, Esc dismisses + refocuses). The page
			keeps the staged text and both paths; the component owns
			the card, the input, and their surfaces. -->
			<CaptureOverlay
				text={captureStaged.text}
				confidence={captureStaged.confidence}
				actions={{
					confirm: (text: string) => confirmCaptureStaged(text),
					dismiss: () => dismissCaptureStaged()
				}}
			/>
		{/if}

		<!-- Speech errors render from `Toasts.svelte` (top notice,
		tap to dismiss); the banner below stays paged. -->
		</main>

	{#if annotateMode.selMenu && !previewing && !iosUI}
		<!-- Floating Annotate/Copy/Inspect menu: annotate-mode owns the
		state and verbs, the page keeps placement, drag, and
		idle-dismiss; SelMenu owns the buttons and surfaces. -->
		<SelMenu
			menu={annotateMode.selMenu}
			dragging={selMenuDragging}
			android={androidUI}
			inspectEnabled={settings.inspectEnabled}
			bind:menuEl={selMenuEl}
			actions={{
				press: noteMenuPress,
				dragStart: menuDragStart,
				dragMove: menuDragMove,
				dragEnd: menuDragEnd,
				enter: () => annotateMode.enterSelMenu(),
				leave: () => (annotateMode.selMenuHover = false),
				// Wrapped: Svelte hands the click event to a bare
				// reference, and the event would become the draft and
				// crash the pill's trim on render.
				annotate: () => annotateMode.annotate(),
				annotateInstant: () => {
					// Right-click Annotate: the "a" key path — file
					// and send at once, never the create box, never
					// the menu (clears in the same tick, no flash).
					// Re-read the live highlight when the stored quote
					// went missing (the key path re-places first); a
					// dead highlight still files nothing, as before —
					// the button's own press collapses it, so the
					// stored quote stays the primary source. The hold
					// ticks: the instant path skips annotate()'s own
					// phone tick, so without this the hold that filed
					// felt like nothing happened.
					if (!annotateMode.selMenu?.quote.trim()) annotateMode.placeSelMenu();
					buzzTap();
					annotateMode.annotate("", true);
					annotateMode.selMenu = null;
				},
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
				// Wrapped: a bare reference hands the click event
				// in as fromEnter, arming the anti-double-send
				// guard on every button save (only Enter sets it).
				save: () => saveAnnPop(),
				remove: (id: string) => {
					annotateMode.removeAnnotation(id);
					editor?.focus();
				},
				mic: () => void togglePillMic()
			}}
		/>
	{/if}

	{#if annotateMode.answerPop}
		<!-- Answer popup through AnnAnswer: annotate-mode owns open
		state and fade-out, the page keeps scroll tracking; the component owns
		the card and its surface only — the reply takes the whole
		card (rewording is E, approval is the badge plus/minus).
		Self-heals when its annotation is deleted or sent while open.
		No close button: click-off and Esc close it. -->
		{@const pop = annotateMode.answerPop}
		{@const answered = drafts.list.find((a) => a.id === pop.id)}
		{#if answered?.answer}
			<AnnAnswer
				answer={answered.answer}
				closing={annotateMode.answerClosing}
				x={pop.x}
				y={pop.y}
				width={pop.w}
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
		bind:settings
		{followVoice}
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
			},
			gameLine: () => void toggleGameLine()
		}}
	/>

	{#if androidUI && chatSwitcherOpen}
		<!-- Phone chat switcher: card plus mint/delete actions through
		the shared modal shell. The page owns chat state and the open
		flag; ChatSwitcher owns the card, actions, and surfaces. -->
		<ChatSwitcher
			title={chatTitle(activeChat(chatState) ?? { messages: [] })}
			position="{chatLabel(
				activeChat(chatState)?.createdAt ?? Date.now()
			)} · {chatState.chats.findIndex(
				(c) => c.id === chatState.activeChatId
			) + 1} / {chatState.chats.length}"
			openedAt={switcherOpenedAt}
			actions={{
				close: closeChatSwitcher,
				step: stepSwitcher,
				newChat: doNewChat,
				deleteActive: () => dropChat(chatState.activeChatId),
				search: () => {
					closeChatSwitcher();
					openSearch();
				}
			}}
		/>
	{/if}

	{#if reader}
		<ReaderView {reader} onEvent={stepReader} onClose={closeReader} />
	{/if}
	{#if flashcards.session}
		<FlashcardDeck
			session={flashcards.session}
			schedule={flashcards.schedule}
			total={flashcards.total}
			nextDue={flashcards.nextDue}
			now={flashcards.now}
			speaking={flashcards.speaking}
			actions={{
				flip: () => flashcards.step("flip"),
				speak: () => flashcards.speak(),
				again: () => flashcards.step("again"),
				good: () => flashcards.step("good"),
				dismiss: () => flashcards.step("dismiss"),
				exportAnki: () => void flashcards.exportAnki(),
				close: () => flashcards.close()
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
			flashcards={settings.flashcardsEnabled}
			bind:query={shortcutQuery}
			bind:inputEl={shortcutInputEl}
			closeTitle={tip(
				isMac ? "Close (⇧⌘/)" : "Close (Ctrl+Shift+/)",
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
			chatTitle={searchChatTitle}
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
	in tauri.conf.json; macOS only, so `data-titlebar="overlay"` marks
	the Mac shell: Windows and Linux keep a native titlebar and get the
	browser layout). The header clears them with left padding; the
	empty sidebar head indents by the same amount so the chat list
	starts at the same x. */
	.app[data-titlebar="overlay"] header {
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
		color: var(--danger);
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
	/* Same opt-in for the top room: the pair above grows with the
	text size but the body's 2.2rem headroom is fixed, so at large
	scales the buttons overlap the first line (worst in the raw
	source view, where code starts at the very top). The room grows
	with the same box height — 0.3rem offset + button + 0.6rem gap,
	which is exactly 2.2rem at 1x, so unscaled rendering is unchanged. */
	main.scale-actions :global(.ccez-math-body),
	main.scale-actions :global(.ccez-math-raw) {
		padding-top: calc(0.9rem + 1.3rem * min(var(--font-scale, 1), 4));
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
	/* The dim end of the cycle stays readable: at 0.2 the dots
	vanished mid-cycle and the wait read as stalled. */
	@keyframes tdot-pulse {
		0%,
		100% {
			opacity: 0.55;
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
	.jump-latest {
		position: absolute;
		left: 50%;
		bottom: calc(var(--tail-clear, 6rem) + 0.5rem);
		transform: translateX(-50%);
		z-index: 31;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 999px;
		padding: 0.4rem 0.9rem;
		background: #fff;
		background: var(--bg-raised);
		color: #1c1c1e;
		color: var(--ink);
		font: inherit;
		font-size: 0.8rem;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
		cursor: pointer;
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
	/* (The old translating-note .muted is gone with the separate
	request: unasked annotations hold steady blue, never a placeholder.) */
	/* .prompt rides --bg/--line/--line-hover/--focus now; no dark overrides needed. */
	/* Lang menus ride --ink/--strong/--line/--bg-raised/--bg-wash/--focus now. */
	/* .send-btn rides --invert/--invert-ink now. */
	/* Study-sheet screen hide moved with the markup to
	`StudySheet.svelte`; the print rules stay global in app.css. */
</style>
