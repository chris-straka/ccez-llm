<script lang="ts">
	import {
		CHAT_WIDTH_DEFAULT,
		CHAT_WIDTH_MAX,
		CHAT_WIDTH_MIN,
		PROMPT_WIDTH_BASE_REM,
		MESSAGE_GAP_DEFAULT,
		LINE_HEIGHT_DEFAULT,
		LINE_HEIGHT_MAX,
		LINE_HEIGHT_MIN,
		VOICE_SPEED_DEFAULT,
		VOICE_SPEED_MAX,
		VOICE_SPEED_MIN,
		MESSAGE_GAP_MAX,
		MESSAGE_GAP_MIN,
		PROMPT_IDLE_DEFAULT,
		activeProviderSettings,
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
	import type { VoiceLangFollow } from "$lib/voiceTiers";
	import VoicePanel from "./VoicePanel.svelte";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
		androidUI: boolean;
		/** Follow-chat voice target (page pill state); omitted in
		unit renders, where the voice panel falls back. */
		followVoice?: VoiceLangFollow | null;
		/** Game-line toggle (page opens/closes the window). */
		gameLineToggle: () => void;
	}

	let {
		settings = $bindable(),
		androidUI,
		followVoice = null,
		gameLineToggle
	}: Props = $props();
	/**
	 * Slider reset gestures (text size, prompt size, chat width,
	 * prompt width, idle timeout): only
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
	const active = $derived(activeProviderSettings(settings));
	/** This model's thinking dial (native knob or prompt hints); hidden
	 * when a single level exists. Recomputes from the model field, so a
	 * newer/cheaper model id picks up its own dial as soon as it is typed. */
	const thinkingSupport = $derived(
		thinkingFor(settings.activeProviderId, active.model)
	);
	const thinkingId = $derived(
		resolveThinkingId(
			thinkingSupport,
			settings.thinking[settings.activeProviderId]
		)
	);
	function setThinking(id: string) {
		settings.thinking = {
			...settings.thinking,
			[settings.activeProviderId]: id
		};
	}
</script>

<section aria-labelledby="defaults-heading">
	<h2 id="defaults-heading">Defaults</h2>
	<label>
		System prompt
		<textarea rows="2" bind:value={settings.systemPrompt} spellcheck="false"
		></textarea>
	</label>
	{#if thinkingSupport.options.length > 1}
		<fieldset>
			<legend>Thinking level</legend>
			<div
				class="segmented thinking"
				role="radiogroup"
				aria-label="Thinking level"
			>
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
				<input type="checkbox" bind:checked={settings.scaleActionsWithFont} />
				<span>Scale message icons with text size</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hideButtons} />
				<span>Show message buttons only when tapped</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.foldOnSwipe} />
				<span>Enable fold on swipe</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.showMessageButtons} />
				<span>Enable message buttons</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.ownBubble} />
				<span>Enable background on my messages</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.inspectEnabled} />
				<span>Enable inspect for han characters</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.flashcardsEnabled} />
				<span>Enable flashcards</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hapticsEnabled} />
				<span>Enable haptic feedback</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.replyNotifications} />
				<span>Enable notifications</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.micEnabled} />
				<span>Enable microphone dictation</span>
			</label>
		</fieldset>
	{:else}
		<!-- One row for both hover toggles: the label names the behavior once,
		each box names whose buttons it covers. Desktop-only (this branch),
		with the bubble toggle below the row. -->
		<fieldset class="hover-row">
			<legend>Show message buttons on hover for:</legend>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hoverUserActions} />
				<span>My messages</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hoverAssistantActions} />
				<span>LLM messages</span>
			</label>
		</fieldset>
		<label class="check">
			<input type="checkbox" bind:checked={settings.ownBubble} />
			<span>Enable background on my messages</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.scaleActionsWithFont} />
			<span>Scale message icons with text size</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.showMessageButtons} />
			<span>Enable message buttons</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.inspectEnabled} />
			<span>Enable inspect for han characters</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.flashcardsEnabled} />
			<span>Enable flashcards</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.replyNotifications} />
			<span>Enable notifications</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.micEnabled} />
			<span>Enable microphone dictation</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.captureEnabled} />
			<span>Enable screen-capture OCR (global shortcut + composer button)</span>
		</label>
		<label class="check">
			<input
				type="checkbox"
				bind:checked={settings.gameLine}
				onchange={() => gameLineToggle()}
			/>
			<span>Game line overlay (last capture with furigana + translation)</span>
		</label>
	{/if}
	<VoicePanel bind:settings {androidUI} {followVoice} />
	<label class="slider-row">
		Voice speed
		<button
			type="button"
			class="reset-width"
			title="Reset to normal speed"
			onclick={() => (settings.voiceSpeed = VOICE_SPEED_DEFAULT)}
			>({VOICE_SPEED_DEFAULT}×)</button
		>
		<span class="font-row">
			<input
				type="range"
				min={VOICE_SPEED_MIN}
				max={VOICE_SPEED_MAX}
				step="0.05"
				value={settings.voiceSpeed ?? VOICE_SPEED_DEFAULT}
				aria-label="Voice speed"
				onpointerdown={noteSliderPress}
				onpointerup={(e) =>
					sliderRelease(e, () => (settings.voiceSpeed = VOICE_SPEED_DEFAULT))}
				oninput={(e) => {
					settings.voiceSpeed = Number(e.currentTarget.value);
				}}
			/>
			<output style="min-width: 3.6rem;"
				>{(settings.voiceSpeed ?? VOICE_SPEED_DEFAULT).toFixed(2)}×</output
			>
		</span>
	</label>
	<fieldset>
		<legend>Big-word reader</legend>
		<div class="segmented" role="radiogroup" aria-label="Big-word reader">
			{#each [["off", "Off"], ["follow", "Follows the voice"], ["tap", "Tap for next"]] as const as [mode, label] (mode)}
				<button
					type="button"
					role="radio"
					aria-checked={settings.readerMode === mode}
					class:selected={settings.readerMode === mode}
					onclick={() => (settings.readerMode = mode)}>{label}</button
				>
			{/each}
		</div>
		{#if settings.readerMode !== "off"}
			<div class="segmented" role="radiogroup" aria-label="Words at a time">
				{#each [[1, "1 word"], [2, "2"], [3, "3"], [0, "Auto"]] as const as [n, label] (n)}
					<button
						type="button"
						role="radio"
						aria-checked={settings.readerWords === n}
						class:selected={settings.readerWords === n}
						onclick={() => (settings.readerWords = n)}>{label}</button
					>
				{/each}
			</div>
		{/if}
	</fieldset>
	<!-- Study-fonts and lesson-audio sections removed (lesson-audio
	froze the app): the inventory helpers stay in
	fontCoverage.ts and nativeTts.ts for their remaining callers. -->

	<!-- The language picker lives inside VoicePanel above on every
	platform now: every tag on offer names an installed voice, so
	nothing needs typing. -->
	<label class="slider-row">
		Text Size
		<button
			type="button"
			class="reset-width"
			title="Reset to the default size"
			onclick={() => (settings.fontScale = 1)}>(100%)</button
		>
		<span class="font-row">
			<input
				type="range"
				min="80"
				max={2000}
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
	<!-- Interface size commits on change, not input: the drawer it
	sits in zooms with the value, so live updates would resize the
	panel under the dragging thumb. No drag-up reset either: the
	release-time change commit lands after pointerup and would
	overwrite the gesture — the (100%) button resets. -->
	<label class="slider-row">
		Interface size
		<button
			type="button"
			class="reset-width"
			title="Reset to the default interface size"
			onclick={() => (settings.uiScale = 1)}>(100%)</button
		>
		<span class="font-row">
			<input
				type="range"
				min="100"
				max="250"
				step="10"
				value={Math.round((settings.uiScale ?? 1) * 100)}
				aria-label="Interface size percent"
				onchange={(e) => {
					settings.uiScale = Number(e.currentTarget.value) / 100;
				}}
			/>
			<output>{Math.round((settings.uiScale ?? 1) * 100)}%</output>
		</span>
	</label>
	<label class="slider-row">
		Prompt text size
		<button
			type="button"
			class="reset-width"
			title="Reset to the default prompt size"
			onclick={() => (settings.promptScale = 1)}>(100%)</button
		>
		<span class="font-row">
			<input
				type="range"
				min="80"
				max={2000}
				step="5"
				value={Math.round((settings.promptScale ?? 1) * 100)}
				aria-label="Prompt text size percent"
				onpointerdown={noteSliderPress}
				onpointerup={(e) => sliderRelease(e, () => (settings.promptScale = 1))}
				oninput={(e) => {
					settings.promptScale = Number(e.currentTarget.value) / 100;
				}}
			/>
			<output>{Math.round((settings.promptScale ?? 1) * 100)}%</output>
		</span>
	</label>
	<label class="slider-row">
		Annotation popup size
		<button
			type="button"
			class="reset-width"
			title="Reset to the default popup size"
			onclick={() => (settings.annPopScale = 1)}>(100%)</button
		>
		<span class="font-row">
			<input
				type="range"
				min="10"
				max={200}
				step="5"
				value={Math.round((settings.annPopScale ?? 1) * 100)}
				aria-label="Annotation popup size percent"
				onpointerdown={noteSliderPress}
				onpointerup={(e) => sliderRelease(e, () => (settings.annPopScale = 1))}
				oninput={(e) => {
					settings.annPopScale = Number(e.currentTarget.value) / 100;
				}}
			/>
			<output>{Math.round((settings.annPopScale ?? 1) * 100)}%</output>
		</span>
	</label>
	{#if !androidUI}
		<label class="slider-row">
			Prompt width
			<button
				type="button"
				class="reset-width"
				title="Reset to the default prompt width"
				onclick={() => (settings.promptWidth = PROMPT_WIDTH_BASE_REM)}
				>({PROMPT_WIDTH_BASE_REM})</button
			>
			<span class="font-row">
				<input
					type="range"
					min={CHAT_WIDTH_MIN}
					max={CHAT_WIDTH_MAX}
					step="1"
					value={settings.promptWidth ?? PROMPT_WIDTH_BASE_REM}
					aria-label="Prompt width in rem"
					onpointerdown={noteSliderPress}
					onpointerup={(e) =>
						sliderRelease(e, () => (settings.promptWidth = PROMPT_WIDTH_BASE_REM))}
					oninput={(e) => {
						settings.promptWidth = Number(e.currentTarget.value);
					}}
				/>
				<output style="min-width: 3.6rem;"
					>{settings.promptWidth ?? PROMPT_WIDTH_BASE_REM} rem</output
				>
			</span>
		</label>
	{/if}
	<label class="slider-row">
		Gap size
		<button
			type="button"
			class="reset-width"
			title="Reset to the default gap"
			onclick={() => (settings.messageGap = MESSAGE_GAP_DEFAULT)}
			>({MESSAGE_GAP_DEFAULT})</button
		>
		<span class="font-row">
			<input
				type="range"
				min={MESSAGE_GAP_MIN}
				max={MESSAGE_GAP_MAX}
				step="0.05"
				value={settings.messageGap ?? MESSAGE_GAP_DEFAULT}
				aria-label="Gap size in rem"
				onpointerdown={noteSliderPress}
				onpointerup={(e) =>
					sliderRelease(e, () => (settings.messageGap = MESSAGE_GAP_DEFAULT))}
				oninput={(e) => {
					settings.messageGap = Number(e.currentTarget.value);
				}}
			/>
			<output style="min-width: 3.6rem;"
				>{settings.messageGap ?? MESSAGE_GAP_DEFAULT} rem</output
			>
		</span>
	</label>
	<label class="slider-row">
		Line spacing
		<button
			type="button"
			class="reset-width"
			title="Reset to the default line spacing"
			onclick={() => (settings.lineHeight = LINE_HEIGHT_DEFAULT)}
			>({LINE_HEIGHT_DEFAULT})</button
		>
		<span class="font-row">
			<input
				type="range"
				min={LINE_HEIGHT_MIN}
				max={LINE_HEIGHT_MAX}
				step="0.05"
				value={settings.lineHeight ?? LINE_HEIGHT_DEFAULT}
				aria-label="Line spacing"
				onpointerdown={noteSliderPress}
				onpointerup={(e) =>
					sliderRelease(e, () => (settings.lineHeight = LINE_HEIGHT_DEFAULT))}
				oninput={(e) => {
					settings.lineHeight = Number(e.currentTarget.value);
				}}
			/>
			<output style="min-width: 3.6rem;"
				>{(settings.lineHeight ?? LINE_HEIGHT_DEFAULT).toFixed(2)}</output
			>
		</span>
	</label>
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
					onpointerup={(e) =>
						sliderRelease(e, () => (settings.chatWidth = CHAT_WIDTH_DEFAULT))}
					oninput={(e) => {
						settings.chatWidth = Number(e.currentTarget.value);
					}}
				/>
				<output style="min-width: 3.6rem;"
					>{settings.chatWidth ?? CHAT_WIDTH_DEFAULT} rem</output
				>
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
					value={idleSettingToSlider(
						settings.promptIdleSec ?? PROMPT_IDLE_DEFAULT
					)}
					aria-label="Idle seconds before the prompt hides (bottom is always, top is never)"
					onpointerdown={noteSliderPress}
					onpointerup={(e) =>
						sliderRelease(
							e,
							() => (settings.promptIdleSec = PROMPT_IDLE_DEFAULT)
						)}
					oninput={(e) => {
						settings.promptIdleSec = idleSliderToSetting(
							Number(e.currentTarget.value)
						);
					}}
				/>
				<output style="min-width: 3.6rem;"
					>{formatIdleTimeout(
						settings.promptIdleSec ?? PROMPT_IDLE_DEFAULT
					)}</output
				>
			</span>
		</label>
	{/if}
</section>
