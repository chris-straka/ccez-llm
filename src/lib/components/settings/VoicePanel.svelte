<script lang="ts">
	import type { AppSettings } from "$lib/settings";
	import { replyLanguageFor } from "$lib/languages";
	import { tauriBackendAvailable } from "$lib/secrets";
	import { currentPlatform } from "$lib/platform";
	import {
		nativeTtsSupported,
		nativeTtsLastError,
		friendlyNativeError,
		nativeVoices,
		openVoiceSettings,
		type NativeVoice
	} from "$lib/nativeTts";
	import {
		voicesForLang,
		allVoicesForLang,
		autoVoiceForLang
	} from "$lib/voiceTiers";
	import ActionIcon from "../ActionIcon.svelte";
	import { onMount } from "svelte";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
		androidUI: boolean;
	}

	let { settings, androidUI }: Props = $props();
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
	const androidVoiceOptions = $derived(
		allVoicesForLang(installedVoices, voiceLangTag)
	);
	/** The voice Auto would use next for the tag above (label only —
	the bridge stays authoritative at speak time). */
	const autoVoice = $derived(
		autoVoiceForLang(installedVoices, voiceLangTag, settings.nativeVoiceId)
	);
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
		if (
			settings.nativeVoiceId &&
			!options.some((v) => v.id === settings.nativeVoiceId)
		) {
			settings.nativeVoiceId = null;
		}
	});
	const inShell = tauriBackendAvailable();
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
				voiceLoadError = friendlyNativeError(
					nativeTtsLastError() ?? "Native speech is not available."
				);
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
			if (!androidUI && settings.voiceEngine !== "native")
				settings.voiceEngine = "native";
			voiceLoadError = "";
			installedVoices = installed;
			// A picked voice that is no longer installed falls back to auto.
			if (
				settings.nativeVoiceId &&
				!installed.some((v) => v.id === settings.nativeVoiceId)
			) {
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
	onMount(() => {
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
	});
</script>

{#if nativeVoice && androidUI}
	<!-- Android has exactly one engine (forced native on boot), so
		there is no heading and no pill to pick — just the voice
		choice itself. -->
	{#if voiceLoadError}
		<p class="note" role="alert">
			Couldn't load the voice list: {voiceLoadError}
		</p>
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
								{option.name}{option.lang.toLowerCase() ===
								voiceLangTag.toLowerCase()
									? ""
									: ` · ${option.lang}`}
							</option>
						{/each}
					</select>
					<button
						type="button"
						class="voice-refresh"
						title={refreshingVoices ? "Checking…" : "Check for new voices"}
						aria-label={refreshingVoices
							? "Checking for new voices"
							: "Check for new voices"}
						onclick={() => void loadVoices(true)}
						disabled={refreshingVoices}
					>
						<ActionIcon kind="rerun" />
					</button>
				</div>
			</div>
		{:else if voicesLoaded}
			<p class="note voice-note">
				No {voiceLangName} voices installed — Auto uses the system default. Install
				one in the system settings, then check again.
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
			Replies always read with macOS system voices (web voices only ever step in
			when the native bridge is unavailable).
			{#if isWindowsShell}
				To add voices on Windows: Settings → Time &amp; language → Speech →
				Manage voices → Add voices, then reload this page so the new voices
				appear.
			{:else if isLinuxShell}
				To add voices on Linux: install your desktop's speech engine (eSpeak via
				your package manager on most distros), then reload this page so the new
				voices appear.
			{:else if inShell}
				To install system voices, go to
				<button
					type="button"
					title="Open Accessibility settings"
					onclick={openVoiceSetup}>a11y</button
				>
				→ Read &amp; Speak → System Voice → ⓘ to install new system voices.
				{#if voiceSetupError}<span role="alert">
						(couldn't open it automatically)</span
					>{/if}
			{:else}
				<!-- No shell, so no Rust opener: the browser branch
					below carries the OS-specific install path. -->
				To install system voices, see the browser guidance below.
			{/if}
		</p>
		{#if voiceLoadError}
			<p class="note" role="alert">
				Couldn't load the voice list: {voiceLoadError}
			</p>
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
									{option.name}{option.lang.toLowerCase() ===
									voiceLangTag.toLowerCase()
										? ""
										: ` · ${option.lang}`}
								</option>
							{/each}
						</select>
						<button
							type="button"
							class="voice-refresh"
							title={refreshingVoices ? "Checking…" : "Check for new voices"}
							aria-label={refreshingVoices
								? "Checking for new voices"
								: "Check for new voices"}
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
		<p class="note" role="alert">
			System voices are unavailable: {voiceLoadError}
		</p>
	</fieldset>
{:else if !inShell && !androidUI}
	<fieldset>
		<legend>Voice engine</legend>
		<p class="note">
			This browser preview can only use web voices — browsers cannot install
			voices themselves.
			{#if isMacBrowser}
				To download more voices on your Mac: System Settings → Accessibility →
				Spoken Content → System Voice → Manage voices, then reload this page.
			{:else if isWindowsBrowser}
				To add voices on Windows: Settings → Time &amp; language → Speech →
				Manage voices → Add voices, then reload this page so the browser picks
				them up.
			{:else}
				Chrome loads its voices over the network: stay online and reload this
				page so new voices appear (on a managed device an admin may have to
				allow them).
			{/if}
		</p>
		<label class="check">
			<input type="checkbox" bind:checked={settings.micEnabled} />
			Enable microphone dictation
		</label>
	</fieldset>
{/if}
