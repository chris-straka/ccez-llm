<script lang="ts">
	import {
		asProviderId,
		builtin,
		getProviderDef,
		listProviders,
		createProvider,
		type ProviderId
	} from "$lib/providers/registry";
	import {
		maskKey,
		activeProviderSettings,
		CHAT_WIDTH_DEFAULT,
		CHAT_WIDTH_MAX,
		CHAT_WIDTH_MIN,
		PROMPT_IDLE_DEFAULT,
		type AppSettings
	} from "$lib/settings";
	import {
		draggedSliderPastTop,
		formatIdleTimeout,
		IDLE_SLIDER_BOTTOM,
		IDLE_SLIDER_TOP,
		idleSettingToSlider,
		idleSliderToSetting
	} from "$lib/chrome";
	import { thinkingFor, resolveThinkingId } from "$lib/providers/thinking";
	import { replyLanguageFor } from "$lib/languages";
	import { hydrateSecrets, tauriBackendAvailable } from "$lib/secrets";
	import { DEV_UPDATE_MESSAGE, updateRouteFor } from "$lib/updates";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { check } from "@tauri-apps/plugin-updater";
	import {
		nativeTtsSupported,
		nativeTtsLastError,
		friendlyNativeError,
		nativeVoices,
		openVoiceSettings
	} from "$lib/nativeTts";
	import { voicesForLang, allVoicesForLang, autoVoiceForLang } from "$lib/voiceTiers";
	import { currentPlatform } from "$lib/platform";
	import type { NativeVoice } from "$lib/nativeTts";
	import ActionIcon from "./ActionIcon.svelte";
	import { onMount } from "svelte";

	interface Props {
		settings: AppSettings;
		onClose: () => void;
		/** Opens the shortcuts modal (owned by the page). */
		onShortcuts: () => void;
		/** Active-chat token tally shown right of the heading. */
		tokensLabel?: string | null;
		/** Tooltip for the tally (exact total). */
		tokensTitle?: string | null;
		/** Phone UI: hover doesn't exist, so the hover toggles read as a note. */
		androidUI?: boolean;
		/** Double-tap the settings top: expand the window like the main
		top bar (the page owns the shell zoom). */
		onExpand?: (event: MouseEvent) => void;
		/** Update results ride the page toast (auto-dismiss, no layout
		shift) instead of an inline popup. Falls back to inline text
		when the page passes none. */
		onToast?: (message: string) => void;
	}

	let {
		settings,
		onClose,
		onShortcuts,
		tokensLabel = null,
		tokensTitle = null,
		androidUI = false,
		onToast,
		onExpand
	}: Props = $props();
	let updateStatus = $state("");
	let checkingUpdate = $state(false);
	let modelLoading = $state(false);
	let modelError = $state("");
	/** Staleness marker for installed builds (compile time via vite
	`define`, no declaration file needed via the guarded globalThis
	read). Dev builds show nothing: "dev · live" reads as noise at
	the bottom of the menu. */
	const buildStamp =
		((globalThis as unknown as { __BUILD_STAMP__?: string }).__BUILD_STAMP__ ?? "release");
	const appVersion =
		((globalThis as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ ?? "");
	const showStamp = !import.meta.env.DEV;

	/**
	 * Slider reset gestures (text size, chat width, idle timeout): only
	 * the inner reset buttons and an upward drag past the slider's top
	 * edge restore the default — label clicks never reset (they fight
	 * text selection and misfire on touch).
	 */
	let sliderPressY: number | null = null;
	function noteSliderPress(event: PointerEvent): void {
		sliderPressY = event.clientY;
	}
	function sliderRelease(event: PointerEvent, reset: () => void): void {
		const startY = sliderPressY;
		sliderPressY = null;
		if (startY != null && draggedSliderPastTop(startY, event.clientY)) reset();
	}
	/**
	 * Pull the provider's `/models` list into the Model picker's datalist.
	 * Best-effort: failures surface transiently and the field keeps working
	 * as free text.
	 */
	async function refreshModels() {
		modelError = "";
		if (!active.baseUrl.trim() || !active.apiKey.trim()) {
			modelError = "Enter a base URL and API key first.";
			setTimeout(() => (modelError = ""), 5000);
			return;
		}
		modelLoading = true;
		try {
			active.models = await createProvider(
			settings.activeProviderId,
			active,
			settings.customProviders
		).listModels();
		} catch (error) {
			modelError = error instanceof Error ? error.message : String(error);
			setTimeout(() => (modelError = ""), 5000);
		} finally {
			modelLoading = false;
		}
	}

	function maybeFetchModels() {
		if (active.apiKey.trim() && active.models.length === 0) void refreshModels();
	}
	/** Native macOS voice engine present (Tauri shell on macOS). */
	let nativeVoice = $state(false);
	/** Plain browser on a Mac: no inventory API, but download guidance applies. */
	let isMacBrowser = $state(false);
	/** Plain browser on Windows: same, with the Windows install path. */
	let isWindowsBrowser = $state(false);
	/** Tauri shell on Windows: the Rust opener is macOS-only, so the
	note carries the Windows path with no button. */
	let isWindowsShell = $state(false);
	/** Tauri shell on Linux: same, with the Linux note. */
	let isLinuxShell = $state(false);
	let voiceSetupError = $state("");
	/** Inventory probe failed (bridge error, not "no voices"): keep the toggle usable. */
	let voiceLoadError = $state("");
	/** Full installed inventory behind the voice picker. */
	let installedVoices = $state<NativeVoice[]>([]);
	let voicesLoaded = $state(false);
	/** Picker options follow the Latin-script voice language field. */
	const voiceLangTag = $derived(settings.voiceLang?.trim() || "en-US");
	/** Human language name for the empty-voice note (falls back to the tag). */
	const voiceLangName = $derived(
		replyLanguageFor(voiceLangTag)?.name ??
			replyLanguageFor(voiceLangTag.split("-")[0] ?? "")?.name ??
			voiceLangTag
	);
	const voiceOptions = $derived(voicesForLang(installedVoices, voiceLangTag));
	/** Android picker: no quality gate — Android has no premium/enhanced tiers. */
	const androidVoiceOptions = $derived(allVoicesForLang(installedVoices, voiceLangTag));
	/** The voice Auto would use next for the tag above (label only —
	the bridge stays authoritative at speak time). */
	const autoVoice = $derived(autoVoiceForLang(installedVoices, voiceLangTag, settings.nativeVoiceId));
	/* No appended category: Apple's registry names already carry it
	("Ava (Premium)"), and Siri's have none to repeat. */
	const autoLabel = $derived(autoVoice ? `Auto - ${autoVoice.name}` : "Auto");
	/* Study-fonts and lesson-audio sections were removed (lesson-audio
	froze the app): no per-script state lives here anymore. */
	// A picked voice never reads another language: when the tag moves on
	// from the saved pick, fall back to Auto instead of a blank field.
	$effect(() => {
		// Never wipe during load or bridge failure: on boot the restored
		// pick briefly matches an empty inventory, and a failed probe is
		// not evidence the voice is gone (speak time falls back to Auto).
		if (!voicesLoaded || voiceLoadError) return;
		const options = androidUI ? androidVoiceOptions : voiceOptions;
		if (settings.nativeVoiceId && !options.some((v) => v.id === settings.nativeVoiceId)) {
			settings.nativeVoiceId = null;
		}
	});
	/** Per-provider "replace key" mode; otherwise a stored key shows masked. */
	let editingKey: Record<string, boolean> = $state({});
	const inShell = tauriBackendAvailable();

	const allProviders = $derived(listProviders(settings.customProviders));
	const activeDef = $derived(getProviderDef(settings.activeProviderId, settings.customProviders));
	const activeCustom = $derived(
		settings.customProviders.some((p) => p.id === settings.activeProviderId)
	);
	const active = $derived(activeProviderSettings(settings));
	const showKeyField = $derived(!active.apiKey.trim() || editingKey[settings.activeProviderId]);

	/** Where "check for updates" goes: releases page, Tauri updater, or nowhere (web). */
	const updateRoute = $derived(updateRouteFor(androidUI === true, inShell, import.meta.env.DEV));

	/**
	 * Update result readout: the page toast when one is wired (it
	 * auto-dismisses and never shifts the settings layout), else the
	 * inline fallback below the button.
	 */
	function sayUpdate(message: string): void {
		if (onToast) onToast(message);
		else updateStatus = message;
	}
	async function checkUpdates() {
		checkingUpdate = true;
		const route = updateRoute;
		if (route.kind === "none") {
			// Web build: a redeploy updates the site, so there is nothing to check.
			sayUpdate("This web build updates with the site — nothing to check.");
			checkingUpdate = false;
			return;
		}
		if (route.kind === "releases") {
			// No Tauri auto-updater on Android: open the Releases page instead.
			try {
				if (tauriBackendAvailable()) {
					const { invoke } = await import("@tauri-apps/api/core");
					await invoke("plugin:opener|open_url", { url: route.url, with: null });
				} else {
					window.open(route.url, "_blank", "noopener");
				}
				sayUpdate("Grab the newest APK from the latest release page to update.");
			} catch {
				sayUpdate(`Couldn't open it automatically — get the newest APK at ${route.url}`);
			} finally {
				checkingUpdate = false;
			}
			return;
		}
		if (route.kind === "dev") {
			// Dev shells have no updater artifacts: explain instead of a fetch error.
			sayUpdate(DEV_UPDATE_MESSAGE);
			checkingUpdate = false;
			return;
		}
		try {
			const update = await check();
			sayUpdate(
				update
					? `Version ${update.version} is available — download it from the release page to install.`
					: "You're on the latest version."
			);
		} catch (error) {
			sayUpdate(
				`Updater unavailable: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			checkingUpdate = false;
		}
	}

	onMount(() => {
		// Pull Keychain keys into memory (Tauri shell); no-op elsewhere.
		// hydrateSecrets mutates the shared proxy, which is already reactive.
		void hydrateSecrets(settings);
		maybeFetchModels();
		// Browser voice-install guidance (no shell, so no inventory API
		// and no Rust opener): the OS-specific path below. Browsers
		// cannot install voices themselves.
		try {
			const { isMac, isWindows } = currentPlatform();
			isMacBrowser = !inShell && isMac;
			isWindowsBrowser = !inShell && !isMac && isWindows;
			isWindowsShell = inShell && !isMac && isWindows;
			isLinuxShell = inShell && !isMac && !isWindows;
		} catch {
			isMacBrowser = false;
			isWindowsBrowser = false;
			isWindowsShell = false;
			isLinuxShell = false;
		}
		void loadVoices();
		// Checkbox labels toggle on click — except when the click ends a
		// text selection: highlighting label text must not flip the box
		// (a plain click still toggles, including clicks straight on the
		// box itself, which never extend a selection). A vanilla capture
		// listener, so no per-label Svelte handler is needed.
		const keepSelectionWithoutToggle = (event: MouseEvent): void => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (!target.closest(".settings-panel label.check")) return;
			const selection = window.getSelection();
			if (selection && !selection.isCollapsed) event.preventDefault();
		};
		document.addEventListener("click", keepSelectionWithoutToggle, true);
		// Slider rows: the reset button is the row label's first
		// labelable descendant, so clicking the label text or row
		// would forward-activate the button and reset by accident.
		// Cancel that forwarded activation unless the click landed on
		// the button or slider itself (same capture pattern as above).
		const guardSliderLabel = (event: MouseEvent): void => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (!target.closest(".settings-panel label.slider-row")) return;
			if (target.closest("button, input")) return;
			event.preventDefault();
		};
		document.addEventListener("click", guardSliderLabel, true);
		return () => {
			document.removeEventListener("click", keepSelectionWithoutToggle, true);
			document.removeEventListener("click", guardSliderLabel, true);
		};
	});

	/**
	 * Voice inventory probe, extracted so fresh installs get picked up
	 * without reopening the app: runs on open and from the "check again"
	 * button under each picker. Never throws; failures land in
	 * voiceLoadError and keep the last good inventory.
	 */
	let refreshingVoices = $state(false);
	/**
	 * Last manual refresh outcome ("Found 2 new voices", "Voice list
	 * is up to date"): the re-check reads the same OS registry, so
	 * without this the button looks dead. Empty until the first
	 * manual refresh — the mount load stays silent.
	 */
	let voiceRefreshNote = $state("");
	async function loadVoices(announce = false): Promise<void> {
		refreshingVoices = true;
		if (announce) voiceRefreshNote = "";
		const before = installedVoices.length;
		try {
			const supported = await nativeTtsSupported();
			nativeVoice = supported;
			// A persisted "native" choice from another machine is meaningless here.
			if (!supported) {
				if (settings.voiceEngine === "native") settings.voiceEngine = "web";
				voiceLoadError = friendlyNativeError(nativeTtsLastError() ?? "Native speech is not available.");
				return;
			}
			const installed = await nativeVoices();
			const probeError = nativeTtsLastError();
			if (probeError) {
				// The bridge failed: say so, and keep a persisted "native"
				// choice alone — an empty inventory is not evidence of no voices.
				voiceLoadError = friendlyNativeError(probeError);
				voicesLoaded = true;
				return;
			}
			// macOS always reads with system voices (the engine picker is
			// gone): a persisted "web" choice from an older build flips
			// back silently. Android's pin lives in the page probe.
			if (!androidUI && settings.voiceEngine !== "native") settings.voiceEngine = "native";
			voiceLoadError = "";
			installedVoices = installed;
			// A picked voice that is no longer installed falls back to auto.
			if (settings.nativeVoiceId && !installed.some((v) => v.id === settings.nativeVoiceId)) {
				settings.nativeVoiceId = null;
			}
			voicesLoaded = true;
			if (announce) {
				const found = installed.length - before;
				voiceRefreshNote =
					found > 0
						? `Found ${found} new voice${found === 1 ? "" : "s"} — list updated.`
						: "Voice list is up to date.";
			}
		} finally {
			refreshingVoices = false;
		}
	}

	async function openVoiceSetup() {
		voiceSetupError = "";
		try {
			// Own Rust command (`open` CLI): no plugin scope to misconfigure.
			await openVoiceSettings();
		} catch (error) {
			// Persistent (no auto-clear): a failure must stay readable long
			// enough to copy. The manual path is in the note above.
			console.warn("Could not open System Settings:", error);
			voiceSetupError = "x";
		}
	}

	function switchProvider(id: ProviderId) {
		settings.activeProviderId = id;
		maybeFetchModels();
	}

	let customName = $state("");
	let customBaseUrl = $state("");
	let customModel = $state("");
	let customError = $state("");

	/** Cline-style: any OpenAI-compatible endpoint becomes a provider. */
	function addCustomProvider(): void {
		customError = "";
		const label = customName.trim();
		const baseUrl = customBaseUrl.trim().replace(/\/+$/, "");
		const model = customModel.trim();
		if (!label) {
			customError = "Give the provider a name.";
			return;
		}
		if (!/^https?:\/\/.+/i.test(baseUrl)) {
			customError = "Base URL must start with http(s)://.";
			return;
		}
		if (!model) {
			customError = "Enter a model id.";
			return;
		}
		const slug =
			label
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "") || "provider";
		const taken = new Set<string>(allProviders.map((p) => p.id));
		let id = `custom-${slug}`;
		let n = 2;
		while (taken.has(id)) id = `custom-${slug}-${n++}`;
		settings.customProviders = [
			...settings.customProviders,
			{ id: asProviderId(id), label, defaultBaseUrl: baseUrl, defaultModel: model, keyHint: "API key" }
		];
		settings.providers[id] = { baseUrl, apiKey: "", model, models: [] };
		customName = "";
		customBaseUrl = "";
		customModel = "";
		switchProvider(asProviderId(id));
	}

	function removeCustomProvider(): void {
		const id = settings.activeProviderId;
		if (!settings.customProviders.some((p) => p.id === id)) return;
		settings.customProviders = settings.customProviders.filter((p) => p.id !== id);
		delete settings.providers[id];
		switchProvider(builtin("muse"));
	}

	/** This model's thinking dial (native knob or prompt hints); hidden
	 * when a single level exists. Recomputes from the model field, so a
	 * newer/cheaper model id picks up its own dial as soon as it is typed. */
	const thinkingSupport = $derived(thinkingFor(settings.activeProviderId, active.model));
	const thinkingId = $derived(
		resolveThinkingId(thinkingSupport, settings.thinking[settings.activeProviderId])
	);
	function setThinking(id: string) {
		settings.thinking = { ...settings.thinking, [settings.activeProviderId]: id };
	}

	/**
	 * The header doubles as the window drag strip and the close target:
	 * mousedown starts a native drag (Tauri shell), while a plain click
	 * (no real pointer travel) closes the panel. The travel check keeps
	 * a drag that ends over the header from closing settings. Travel is
	 * measured in screen coordinates: during a native drag the window
	 * follows the cursor, so client coordinates barely move and would
	 * misread every drag as a click.
	 */
	let headDown: { x: number; y: number } | null = null;
	function dragHead(event: MouseEvent): void {
		if (event.button !== 0) return;
		headDown = { x: event.screenX, y: event.screenY };
		if (!tauriBackendAvailable()) return;
		try {
			getCurrentWindow().startDragging().catch((error: unknown) => {
				console.warn(
					"Window drag failed:",
					error instanceof Error ? error.message : String(error)
				);
			});
		} catch (error) {
			console.warn(
				"Window drag failed:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}
	let headCloseTimer: ReturnType<typeof setTimeout> | null = null;
	function closeFromHead(event: MouseEvent): void {
		const down = headDown;
		headDown = null;
		if (down && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5) return;
		// Single click closes on a short fuse: a double-tap cancels the
		// close and expands instead (same gesture split the main top bar
		// uses between click-drag and double-click zoom).
		if (headCloseTimer) clearTimeout(headCloseTimer);
		headCloseTimer = setTimeout(() => {
			headCloseTimer = null;
			onClose();
		}, 220);
	}
	function expandFromHead(event: MouseEvent): void {
		if (headCloseTimer) {
			clearTimeout(headCloseTimer);
			headCloseTimer = null;
		}
		onExpand?.(event);
	}
</script>

<div
	class="panel-head"
	data-tauri-drag-region
	role="button"
	tabindex="0"
	aria-label="Close settings"
	title="Close settings"
	onmousedown={dragHead}
	onclick={closeFromHead}
	ondblclick={expandFromHead}
	onkeydown={(e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onClose();
		}
	}}
>
	<h1>Settings</h1>
	{#if tokensLabel}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<span
			class="head-tokens"
			title={tokensTitle}
			onclick={(event) => event.stopPropagation()}
		>
			{tokensLabel}
		</span>
	{/if}
</div>

<section aria-labelledby="provider-heading">
	<h2 id="provider-heading">Model provider</h2>
	<div class="provider-row" role="radiogroup" aria-label="Active provider">
		{#each allProviders as def (def.id)}
			<button
				type="button"
				role="radio"
				aria-checked={settings.activeProviderId === def.id}
				class:selected={settings.activeProviderId === def.id}
				onclick={() => switchProvider(def.id)}
			>
				{def.label}
			</button>
		{/each}
	</div>
	{#if activeCustom}
		<p class="note">
			Custom provider.
			<button type="button" onclick={removeCustomProvider}>Remove {activeDef.label}</button>
		</p>
	{/if}
	<details class="note provider-add">
		<summary>Add a custom provider…</summary>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				addCustomProvider();
			}}
		>
			<label>
				Name
				<input
					type="text"
					required
					bind:value={customName}
					oninput={() => (customError = "")}
					placeholder="e.g. Kimi"
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			<label>
				Base URL
				<input
					type="url"
					required
					bind:value={customBaseUrl}
					oninput={() => (customError = "")}
					placeholder="https://api.example.com/v1"
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			<label>
				Model
				<input
					type="text"
					required
					bind:value={customModel}
					oninput={() => (customError = "")}
					placeholder="model-id"
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			{#if customError}<span class="hint" role="alert">{customError}</span>{/if}
			<button type="submit">Add provider</button>
		</form>
	</details>

	<label>
		Base URL
		<input type="url" bind:value={active.baseUrl} autocomplete="off" spellcheck="false" />
	</label>
	<label>
		Model
		<span class="model-row">
			<input
				type="text"
				list="model-list"
				bind:value={active.model}
				autocomplete="off"
				spellcheck="false"
			/>
			<button
				type="button"
				title="Fetch the model list from this base URL"
				disabled={modelLoading}
				onclick={() => void refreshModels()}
			>
				{modelLoading ? "…" : "Refresh"}
			</button>
		</span>
		<datalist id="model-list">
			{#each active.models as id (id)}<option value={id}></option>{/each}
		</datalist>
		{#if modelError}<span class="hint" role="alert">{modelError}</span>{/if}
	</label>
	{#if activeDef.keyless}
		<p class="key-state" role="status">No key needed — {activeDef.keyHint}.</p>
	{:else if showKeyField}
		<label>
			API key <span class="hint">{activeDef.keyHint}</span>
			<input
				type="password"
				bind:value={active.apiKey}
				autocomplete="off"
				spellcheck="false"
				onblur={() => (editingKey[settings.activeProviderId] = false)}
			/>
		</label>
	{:else}
		<p class="key-state" role="status">
			Key loaded: <code>{maskKey(active.apiKey)}</code>
			<button
				type="button"
				onclick={() => (editingKey[settings.activeProviderId] = true)}
			>
				Replace
			</button>
		</p>
	{/if}
	<p class="note">
		{#if inShell}
			Keys stay in this app's secured storage, never in a file.
		{:else}
			Keys stay on this machine, in this app's local storage.
		{/if}
	</p>
</section>

<section aria-labelledby="defaults-heading">
	<h2 id="defaults-heading">Defaults</h2>
	<label>
		System prompt
		<textarea rows="2" bind:value={settings.systemPrompt} spellcheck="false"></textarea>
	</label>
	{#if thinkingSupport.options.length > 1}
		<fieldset>
			<legend>Thinking level</legend>
			<div class="segmented thinking" role="radiogroup" aria-label="Thinking level">
				{#each thinkingSupport.options as option (option.id)}
					<button
						type="button"
						role="radio"
						aria-checked={thinkingId === option.id}
						class:selected={thinkingId === option.id}
						onclick={() => setThinking(option.id)}>{option.label}</button
					>
				{/each}
			</div>
		</fieldset>
	{/if}
	{#if androidUI}
		<fieldset>
			<legend>Messages</legend>
			<label class="check">
				<input type="checkbox" bind:checked={settings.overlayActions} />
				Switch message buttons to overlay menu
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.scaleActionsWithFont} />
				Scale message buttons with text size
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hideButtons} />
				Hide message buttons until tapped
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.ownBubble} />
				Enable background on my messages
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.inspectEnabled} />
				Show Inspect for single kanji/hanzi highlights
			</label>
		</fieldset>
	{:else}
		<!-- One row for both hover toggles: the label names the behavior once,
		each box names whose buttons it covers. Desktop-only (this branch),
		with the bubble toggle below the row. -->
		<fieldset class="hover-row">
			<legend>Show message buttons only on hover for:</legend>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hoverUserActions} />
				My messages
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hoverAssistantActions} />
				AI messages
			</label>
		</fieldset>
		<label class="check">
			<input type="checkbox" bind:checked={settings.ownBubble} />
			Enable background on my messages
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.scaleActionsWithFont} />
			Scale message buttons with text size
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.inspectEnabled} />
			Show Inspect for single kanji/hanzi highlights
		</label>
	{/if}
	{#if nativeVoice && androidUI}
		<!-- Android has exactly one engine (forced native on boot), so
		there is no heading and no pill to pick — just the voice
		choice itself. -->
		{#if voiceLoadError}
			<p class="note" role="alert">Couldn't load the voice list: {voiceLoadError}</p>
		{/if}
		{#if !voiceLoadError}
			{#if androidVoiceOptions.length > 0}
				<div class="voice-pick">
					<span class="voice-pick-label" id="system-voice-label-android"
						>System voice ({voiceLangTag})</span
					>
					<div class="voice-pick-row">
						<select
							value={settings.nativeVoiceId ?? ""}
							aria-labelledby="system-voice-label-android"
							onchange={(e) => {
								settings.nativeVoiceId = e.currentTarget.value || null;
							}}
						>
							<option value="">{autoLabel}</option>
							{#each androidVoiceOptions as option (option.id)}
								<option value={option.id}>
									{option.name}{option.lang.toLowerCase() === voiceLangTag.toLowerCase()
										? ""
										: ` · ${option.lang}`}
								</option>
							{/each}
						</select>
						<button
							type="button"
							class="voice-refresh"
							title={refreshingVoices ? "Checking…" : "Check for new voices"}
							aria-label={refreshingVoices ? "Checking for new voices" : "Check for new voices"}
							onclick={() => void loadVoices(true)}
							disabled={refreshingVoices}
						>
							<ActionIcon kind="rerun" />
						</button>
					</div>
				</div>
			{:else if voicesLoaded}
				<p class="note voice-note">
					No {voiceLangName} voices installed — Auto uses the system
					default. Install one in the system settings, then check
					again.
				</p>
			{/if}
		{/if}
		{#if voiceRefreshNote !== ""}
			<p class="note" role="status">{voiceRefreshNote}</p>
		{/if}
	{/if}
	{#if androidUI && !inShell}
		<label class="check">
			<input type="checkbox" bind:checked={settings.micEnabled} />
			Enable microphone dictation
		</label>
	{/if}
	{#if nativeVoice && !androidUI}
		<fieldset class="voice-engine">
			<legend>System voice</legend>
			<p class="note">
				Replies always read with macOS system voices (web voices
				only ever step in when the native bridge is unavailable).
				{#if isWindowsShell}
					To add voices on Windows: Settings → Time &amp;
					language → Speech → Manage voices → Add voices, then
					reload this page so the new voices appear.
				{:else if isLinuxShell}
					To add voices on Linux: install your desktop's
					speech engine (eSpeak via your package manager on most
					distros), then reload this page so the new voices appear.
				{:else if inShell}
					To install system voices, go to
					<button type="button" title="Open Accessibility settings" onclick={openVoiceSetup}>a11y</button>
					→ Read &amp; Speak → System Voice → ⓘ to install new system voices.
					{#if voiceSetupError}<span role="alert"> (couldn't open it automatically)</span>{/if}
				{:else}
					<!-- No shell, so no Rust opener: the browser branch
					below carries the OS-specific install path. -->
					To install system voices, see the browser guidance below.
				{/if}
			</p>
			{#if voiceLoadError}
				<p class="note" role="alert">Couldn't load the voice list: {voiceLoadError}</p>
			{/if}
			{#if !voiceLoadError}
				{#if voiceOptions.length > 0}
					<!-- Plain div + aria, not a <label>: label clicks yank focus
					into the select, which fights selecting this text. -->
					<div class="voice-pick">
						<span class="voice-pick-label" id="system-voice-label"
							>System voice ({voiceLangTag})</span
						>
						<div class="voice-pick-row">
							<select
								value={settings.nativeVoiceId ?? ""}
								aria-labelledby="system-voice-label"
								onchange={(e) => {
									settings.nativeVoiceId = e.currentTarget.value || null;
								}}
							>
								<option value="">{autoLabel}</option>
								{#each voiceOptions as option (option.id)}
									<option value={option.id}>
										{option.name}{option.lang.toLowerCase() === voiceLangTag.toLowerCase()
											? ""
											: ` · ${option.lang}`}
									</option>
								{/each}
							</select>
							<button
								type="button"
								class="voice-refresh"
								title={refreshingVoices ? "Checking…" : "Check for new voices"}
								aria-label={refreshingVoices ? "Checking for new voices" : "Check for new voices"}
								onclick={() => void loadVoices(true)}
								disabled={refreshingVoices}
							>
								<ActionIcon kind="rerun" />
							</button>
						</div>
					</div>
				{:else if voicesLoaded}
					<p class="note voice-note">
						No premium or enhanced voices installed for {voiceLangTag} — Auto uses your
						System Voice.
					</p>
				{/if}
			{/if}
			{#if voiceRefreshNote !== ""}
				<p class="note" role="status">{voiceRefreshNote}</p>
			{/if}
		</fieldset>
		{:else if inShell && voiceLoadError && !androidUI}
			<fieldset>
				<legend>Voice engine</legend>
				<p class="note" role="alert">System voices are unavailable: {voiceLoadError}</p>
			</fieldset>
		{:else if !inShell && !androidUI}
			<fieldset>
				<legend>Voice engine</legend>
				<p class="note">
					This browser preview can only use web voices — browsers
					cannot install voices themselves.
					{#if isMacBrowser}
						To download more voices on your Mac: System Settings →
						Accessibility → Spoken Content → System Voice → Manage
						voices, then reload this page.
					{:else if isWindowsBrowser}
						To add voices on Windows: Settings → Time &amp;
						language → Speech → Manage voices → Add voices, then
						reload this page so the browser picks them up.
					{:else}
						Chrome loads its voices over the network: stay online
						and reload this page so new voices appear (on a managed
						device an admin may have to allow them).
					{/if}
				</p>
				<label class="check">
					<input type="checkbox" bind:checked={settings.micEnabled} />
					Enable microphone dictation
				</label>
			</fieldset>
	{/if}

	<!-- Study-fonts and lesson-audio sections removed (lesson-audio
	froze the app): the inventory helpers stay in
	fontCoverage.ts and nativeTts.ts for their remaining callers. -->

	<div class="field">
		<span id="voice-lang-label">Voice language</span>
		<input
			type="text"
			aria-labelledby="voice-lang-label"
			bind:value={settings.voiceLang}
			placeholder="en-US"
			autocomplete="off"
			spellcheck="false"
			onchange={() => {
				// A typed locale is deliberate: restarts keep it.
				settings.voiceLangPinned = true;
			}}
		/>
	</div>
	<label class="slider-row">
		Text Size
		<button
			type="button"
			class="reset-width"
			title="Reset to the default size"
			onclick={() => (settings.fontScale = 1)}
		>(100%)</button>
		<span class="font-row">
			<input
				type="range"
				min="80"
				max={androidUI ? 400 : 800}
				step="5"
				value={Math.round(settings.fontScale * 100)}
				aria-label="Text size percent"
				onpointerdown={noteSliderPress}
				onpointerup={(e) => sliderRelease(e, () => (settings.fontScale = 1))}
				oninput={(e) => {
					settings.fontScale = Number(e.currentTarget.value) / 100;
				}}
			/>
			<output>{Math.round(settings.fontScale * 100)}%</output>
		</span>
	</label>
	{#if !androidUI}
	<label class="slider-row">
		Background opacity
		<button
			type="button"
			class="reset-width"
			title="Reset to fully opaque"
			onclick={() => (settings.bgOpacity = 1)}>(100%)</button
		>
		<span class="font-row">
			<input
				type="range"
				min="20"
				max="100"
				step="5"
				value={Math.round((settings.bgOpacity ?? 1) * 100)}
				aria-label="Background opacity percent"
				onpointerdown={noteSliderPress}
				onpointerup={(e) => sliderRelease(e, () => (settings.bgOpacity = 1))}
				oninput={(e) => {
					settings.bgOpacity = Number(e.currentTarget.value) / 100;
				}}
			/>
			<output>{Math.round((settings.bgOpacity ?? 1) * 100)}%</output>
		</span>
	</label>
	{/if}
	{#if !androidUI}
		<label class="slider-row">
			Chat width
			<button
				type="button"
				class="reset-width"
				title="Reset to the default width"
				onclick={() => (settings.chatWidth = CHAT_WIDTH_DEFAULT)}
				>({CHAT_WIDTH_DEFAULT})</button
			>
			<span class="font-row">
				<input
					type="range"
					min={CHAT_WIDTH_MIN}
					max={CHAT_WIDTH_MAX}
					step="1"
					value={settings.chatWidth ?? CHAT_WIDTH_DEFAULT}
					aria-label="Chat width in rem"
					onpointerdown={noteSliderPress}
					onpointerup={(e) => sliderRelease(e, () => (settings.chatWidth = CHAT_WIDTH_DEFAULT))}
					oninput={(e) => {
						settings.chatWidth = Number(e.currentTarget.value);
					}}
				/>
				<output style="min-width: 3.6rem;">{settings.chatWidth ?? CHAT_WIDTH_DEFAULT} rem</output>
			</span>
		</label>
	{/if}
	{#if !androidUI}
	<label class="slider-row">
		Hide prompt after idle
		<button
			type="button"
			class="reset-width"
			title="Reset to the default idle time"
			onclick={() => (settings.promptIdleSec = PROMPT_IDLE_DEFAULT)}
			>({formatIdleTimeout(PROMPT_IDLE_DEFAULT)})</button
		>
		<span class="font-row">
			<input
				type="range"
				min={IDLE_SLIDER_BOTTOM}
				max={IDLE_SLIDER_TOP}
				step="1"
				value={idleSettingToSlider(settings.promptIdleSec ?? PROMPT_IDLE_DEFAULT)}
				aria-label="Idle seconds before the prompt hides (bottom is always, top is never)"
				onpointerdown={noteSliderPress}
				onpointerup={(e) => sliderRelease(e, () => (settings.promptIdleSec = PROMPT_IDLE_DEFAULT))}
				oninput={(e) => {
					settings.promptIdleSec = idleSliderToSetting(Number(e.currentTarget.value));
				}}
			/>
			<output style="min-width: 3.6rem;">{formatIdleTimeout(settings.promptIdleSec ?? PROMPT_IDLE_DEFAULT)}</output>
		</span>
	</label>
	{/if}
</section>

<section aria-labelledby="color-scheme-heading">
	<h2 id="color-scheme-heading">Color scheme</h2>
	<fieldset class="theme">
		<div class="segmented" role="radiogroup" aria-label="Color scheme">
			<button
				type="button"
				role="radio"
				aria-checked={settings.theme === "system"}
				class:selected={settings.theme === "system"}
				title="Follow the system appearance"
				onclick={() => (settings.theme = "system")}>System</button
			>
			<button
				type="button"
				role="radio"
				aria-checked={settings.theme === "light"}
				class:selected={settings.theme === "light"}
				title="Always light"
				onclick={() => (settings.theme = "light")}>Light</button
			>
			<button
				type="button"
				role="radio"
				aria-checked={settings.theme === "dark"}
				class:selected={settings.theme === "dark"}
				title="Always dark"
				onclick={() => (settings.theme = "dark")}>Dark</button
			>
		</div>
	</fieldset>
</section>

<div class="keys-updates">
	<section aria-labelledby="keys-heading">
		<h2 id="keys-heading">{androidUI ? "Touch gestures" : "Keyboard shortcuts"}</h2>
		<button type="button" onclick={onShortcuts}>
			{androidUI ? "Show all gestures" : "Shortcuts"}
		</button>
	</section>

	<section aria-labelledby="updates-heading">
		<h2 id="updates-heading">Updates</h2>
		{#if updateRoute.kind === "none"}
			<p class="result">This web build updates with the site — nothing to check.</p>
		{:else}
			<button type="button" onclick={() => void checkUpdates()} disabled={checkingUpdate}>
				{checkingUpdate ? "Checking…" : "Check for updates"}
			</button>
			{#if updateStatus && !onToast}<p class="note" role="status">{updateStatus}</p>{/if}
		{/if}
	</section>
</div>

{#if showStamp}
	<p class="build-stamp">{appVersion ? `v${appVersion} · build ${buildStamp}` : `build ${buildStamp}`}</p>
{/if}

<style>
	/* The header is the close target and the window drag strip:
	chrome, not content — no text selection for the native drag
	region to fight over. Negative margins stretch it over the
	aside's own padding so the strip reaches the panel's top edge,
	and the gap down to the divider is padding (clickable, part of
	the header) rather than margin (clicks would fall through to
	the aside and drag nothing). Values mirror .settings-panel
	padding in +page.svelte. */
	.panel-head {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: -1.2rem -0.7rem 0;
		padding: 1.2rem 0.7rem 0.5rem;
		/* Default arrow like the main chat top bar: the whole strip
		closes on click, so no pointer finger. Buttons keep their own. */
		cursor: default;
		user-select: none;
		-webkit-user-select: none;
	}
	.panel-head h1 {
		font-size: 1.15rem;
		font-weight: 700;
		margin: 0;
	}
	/* Active-chat tally right of the heading: quiet and copyable, and
	clicking it must not close the panel like the rest of the strip. */
	.head-tokens {
		margin-left: auto;
		font-size: 0.75rem;
		color: #6e6e73;
		white-space: nowrap;
		user-select: text;
		-webkit-user-select: text;
		cursor: text;
	}
	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	:global(html[data-theme="dark"]) .head-tokens {
		color: #98989f;
	}
	.panel-head:focus-visible {
		outline: 2px solid #1c1c1e;
		outline-offset: 2px;
		border-radius: 4px;
	}
	input[type="checkbox"] {
		cursor: pointer;
		transition: box-shadow 0.15s ease;
	}
	input[type="checkbox"]:hover {
		box-shadow: 0 0 0 3px rgba(142, 142, 147, 0.45);
	}
	.font-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin-top: 0.55rem;
	}
	.font-row input[type="range"] {
		flex: 1;
		min-width: 0;
		margin-top: 0;
		padding: 0;
		accent-color: #1c1c1e;
		cursor: pointer;
	}
	.font-row output {
		font-size: 0.83rem;
		min-width: 3rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	section {
		border-top: 1px solid #e5e5ea;
		padding: 1.1rem 0;
	}
	/* Touch gestures and Updates form a 2x2 grid: headings share the
	top row, buttons share the row beneath. Sections go display:contents
	so their children place directly on the grid. */
	.keys-updates {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem 1.5rem;
		align-items: center;
		border-top: 1px solid #e5e5ea;
		padding: 1.1rem 0;
	}
	.keys-updates > section {
		display: contents;
	}
	.keys-updates > section:first-of-type > h2 {
		grid-area: 1 / 1;
		justify-self: center;
	}
	.keys-updates > section:first-of-type > button {
		grid-area: 2 / 1;
		justify-self: center;
		/* Short label now: never wrap onto a second line. */
		white-space: nowrap;
	}
	.keys-updates > section:last-of-type > h2 {
		grid-area: 1 / 2;
		justify-self: center;
	}
	.keys-updates > section:last-of-type > button {
		grid-area: 2 / 2;
		justify-self: center;
	}
	.keys-updates h2 {
		margin: 0;
	}
	.keys-updates .result {
		grid-area: 3 / 2;
		justify-self: center;
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		font-weight: 650;
		margin: 0 0 0.9rem;
	}
	label,
	.field,
	.voice-pick {
		display: block;
		font-size: 0.87rem;
		font-weight: 550;
		margin-bottom: 0.9rem;
	}
	/* The picker hangs below the install note with room to breathe, then
	hands off tightly to Voice language (the fieldset adds its own 0.9rem). */
	.voice-pick {
		margin-top: 0.9rem;
		margin-bottom: 0.4rem;
	}
	.voice-pick-label {
		display: block;
		margin-bottom: 0.35rem;
	}
	/* Refresh rides on the picker row (beside the select, never a
	paragraph of its own): a borderless ghost icon, so neither theme
	can clash with it. Fixed square, never stretched. */
	.voice-pick-row {
		display: flex;
		gap: 0.2rem;
		align-items: center;
	}
	.voice-pick-row select {
		flex: 1 1 auto;
		min-width: 0;
		width: auto;
		margin-top: 0;
	}
	.voice-refresh {
		flex: none;
		align-self: center;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: none;
		color: #6e6e73;
		cursor: pointer;
		transition: color 0.15s ease;
	}
	.voice-refresh:hover:not(:disabled) {
		color: #1c1c1e;
	}
	.voice-refresh:disabled {
		cursor: default;
		opacity: 0.55;
	}
	.voice-refresh > :global(svg) {
		height: 1rem;
		width: 1rem;
	}
	:global(html[data-theme="dark"]) .voice-refresh {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .voice-refresh:hover:not(:disabled) {
		color: #f2f2f7;
	}
	/* Native select chrome (Aqua in the shell) sizes itself, so the
	picker would never match the text field: draw it as a twin with a
	chevron in the project's line-icon style instead. */
	.voice-pick select {
		appearance: none;
		-webkit-appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236e6e73' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.7rem center;
		padding-right: 2rem;
		cursor: pointer;
	}
	details.note summary {
		cursor: pointer;
	}
	details.note {
		margin-top: 0.55rem;
	}
	/* Element-qualified: the `.note` margin shorthand below ties at
	   class specificity but comes later, so a bare class loses and the
	   gap collapses to zero. */
	details.note.provider-add {
		margin-bottom: 1rem;
	}
	.provider-add form {
		margin-top: 0.75rem;
	}
	.provider-add form button {
		margin-top: 0.5rem;
	}
	input[type="url"],
	input[type="text"],
	input[type="password"],
	select,
	textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin-top: 0.3rem;
		padding: 0.5rem 0.6rem;
		font: inherit;
		font-weight: 400;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		background: #fff;
		color: inherit;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	input[type="url"]:hover,
	input[type="text"]:hover,
	input[type="password"]:hover,
	select:hover,
	textarea:hover {
		border-color: #8e8e93;
	}
	/* iOS zooms into text fields under 16px on focus: floor phone
	fields at 16px so tapping one never re-scales the sheet. The
	ancestor gate keeps every desktop size exactly as-is. */
	:global(.app[data-android]) input[type="url"],
	:global(.app[data-android]) input[type="text"],
	:global(.app[data-android]) input[type="password"],
	:global(.app[data-android]) textarea {
		font-size: max(16px, 1em);
	}
	input[type="url"]:focus,
	input[type="text"]:focus,
	input[type="password"]:focus,
	select:focus,
	textarea:focus {
		border-color: #1c1c1e;
		outline: none;
	}
	.hint {
		font-weight: 400;
		color: #6e6e73;
		overflow-wrap: anywhere;
	}
	.build-stamp {
		margin: 1rem 0 0;
		font-size: 0.75rem;
		color: #6e6e73;
		text-align: center;
	}
	.model-row {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.3rem;
	}
	.model-row input {
		margin-top: 0;
		flex: 1;
		min-width: 0;
	}
	.model-row button {
		flex-shrink: 0;
		/* Fixed floor: "…" must not reflow the row while refreshing. */
		min-width: 4.6rem;
		text-align: center;
		font-size: 0.81rem;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
		padding: 0.2rem 0.7rem;
		color: inherit;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease,
			opacity 0.15s ease;
	}
	.model-row button:not(:disabled):hover {
		border-color: #1c1c1e;
	}
	.model-row button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.note {
		font-size: 0.84rem;
		color: #6e6e73;
		margin: 0.2rem 0 0;
		/* Long error strings must wrap, never shove the panel sideways. */
		overflow-wrap: anywhere;
	}
	.note button {
		font: inherit;
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
		background: none;
		border: 0;
		cursor: pointer;
		padding: 0;
		transition: color 0.15s ease;
	}
	.note button:hover {
		color: #1c1c1e;
	}
	/* Empty-inventory note: breathing room below before the next
	control, and a quiet inline re-check action in the same voice. */
	.voice-note {
		margin-bottom: 0.9rem;
	}
	.key-state {
		font-size: 0.87rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.key-state code {
		font-family: ui-monospace, monospace;
	}
	.key-state button {
		font-size: 0.81rem;
		border: 1px solid #c7c7cc;
		border-radius: 6px;
		background: #fff;
		cursor: pointer;
		padding: 0.2rem 0.6rem;
		color: inherit;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.key-state button:hover {
		border-color: #1c1c1e;
	}
	.provider-row,
	.segmented {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	/* Thinking pills sit centered; the theme row keeps a tighter
	footprint now that its heading carries the label. */
	.segmented.thinking {
		justify-content: center;
	}
	.theme {
		margin-bottom: 0.3rem;
	}
	.theme .segmented {
		margin-bottom: 0.5rem;
	}
	.provider-row button,
	.segmented button {
		padding: 0.3rem 0.65rem;
		font: inherit;
		font-size: 0.81rem;
		white-space: nowrap;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
		color: inherit;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease,
			opacity 0.15s ease;
	}
	.provider-row button.selected,
	.segmented button.selected {
		border-color: #1c1c1e;
		background: #1c1c1e;
		color: #fff;
	}
	.provider-row button:not(.selected):not(:disabled):hover,
	.segmented button:not(.selected):not(:disabled):hover {
		border-color: #1c1c1e;
	}
	.segmented button:disabled {
		background: #f3f3f4;
		border-color: #e5e5ea;
		color: #aeaeb2;
		cursor: not-allowed;
		opacity: 1;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0 0 0.9rem;
	}
	/* The voice engine block carries the tallest stack (segmented + note
	+ picker): a breath more room before Voice language. */
	.voice-engine {
		margin-bottom: 1.2rem;
	}
	/* Hover toggles share one legend row instead of repeating the label. */
	.hover-row {
		display: flex;
		gap: 1.2rem;
		margin-bottom: 0.55rem;
	}
	.hover-row legend {
		margin-bottom: 0.6rem;
	}
	legend {
		font-size: 0.87rem;
		font-weight: 550;
		padding: 0;
		margin-bottom: 0.4rem;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 400;
		cursor: pointer;
	}
	/* Stacked checkboxes share one vertical rhythm whether they sit
	in a fieldset or straight in the section: the box-to-text gap
	above stays 0.5rem everywhere. */
	.check + .check {
		margin-top: 0.55rem;
	}
	/* The hover toggles really share one row (the legend names the
	behavior once); the stacked rhythm above stays out of the row. */
	fieldset.hover-row {
		display: flex;
		gap: 1.25rem;
		align-items: center;
	}
	fieldset.hover-row .check + .check {
		margin-top: 0;
	}
	.reset-width {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		cursor: pointer;
		color: inherit;
	}

	section > button {
		padding: 0.45rem 1rem;
		font: inherit;
		font-size: 0.87rem;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
		color: inherit;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease,
			opacity 0.15s ease;
	}
	section > button:not(:disabled):hover {
		border-color: #1c1c1e;
	}
	section > button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.result {
		font-size: 0.87rem;
		padding: 0.6rem 0.8rem;
		border-radius: 8px;
		background: #e6f4ea;
		overflow-wrap: anywhere;
	}
	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	:global(html[data-theme="dark"]) .panel-head:focus-visible {
		outline-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) section {
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) input[type="url"],
	:global(html[data-theme="dark"]) input[type="text"],
	:global(html[data-theme="dark"]) input[type="password"],
	:global(html[data-theme="dark"]) select,
	:global(html[data-theme="dark"]) textarea,
	:global(html[data-theme="dark"]) .provider-row button,
	:global(html[data-theme="dark"]) .segmented button,
	:global(html[data-theme="dark"]) .key-state button,
	:global(html[data-theme="dark"]) section > button {
		background: #1c1c1e;
		border-color: #48484a;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .provider-row button:not(.selected):not(:disabled):hover,
	:global(html[data-theme="dark"]) .segmented button:not(.selected):not(:disabled):hover,
	:global(html[data-theme="dark"]) .key-state button:hover,
	:global(html[data-theme="dark"]) section > button:not(:disabled):hover,
	:global(html[data-theme="dark"]) .note button:hover {
		border-color: #aeaeb2;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) input[type="url"]:hover,
	:global(html[data-theme="dark"]) input[type="text"]:hover,
	:global(html[data-theme="dark"]) input[type="password"]:hover,
	:global(html[data-theme="dark"]) select:hover,
	:global(html[data-theme="dark"]) textarea:hover {
		border-color: #636366;
	}
	:global(html[data-theme="dark"]) .voice-pick select {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23aeaeb2' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		/* The dark field `background` shorthand above resets repeat and
		position: re-assert or the 10px chevron tiles into zigzag. */
		background-repeat: no-repeat;
		background-position: right 0.7rem center;
	}
	:global(html[data-theme="dark"]) input[type="url"]:focus,
	:global(html[data-theme="dark"]) input[type="text"]:focus,
	:global(html[data-theme="dark"]) input[type="password"]:focus,
	:global(html[data-theme="dark"]) select:focus,
	:global(html[data-theme="dark"]) textarea:focus {
		border-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .font-row input[type="range"] {
		accent-color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .model-row button {
		background: #1c1c1e;
		border-color: #48484a;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .model-row button:not(:disabled):hover {
		border-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .provider-row button.selected,
	:global(html[data-theme="dark"]) .segmented button.selected {
		background: #f2f2f7;
		border-color: #f2f2f7;
		color: #1c1c1e;
	}
	:global(html[data-theme="dark"]) .segmented button:disabled {
		background: #2c2c2e;
		border-color: #38383a;
		color: #636366;
	}
	:global(html[data-theme="dark"]) .hint,
	:global(html[data-theme="dark"]) .note,
	:global(html[data-theme="dark"]) .build-stamp {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .result {
		background: #12351f;
	}
</style>
