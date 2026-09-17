<script lang="ts">
	import {
		CHAT_WIDTH_DEFAULT,
		CHAT_WIDTH_MAX,
		CHAT_WIDTH_MIN,
		MESSAGE_GAP_DEFAULT,
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
	import VoicePanel from "./VoicePanel.svelte";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
		androidUI: boolean;
	}

	let { settings = $bindable(), androidUI }: Props = $props();
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
	const active = $derived(activeProviderSettings(settings));
	/** This model's thinking dial (native knob or prompt hints); hidden
	 * when a single level exists. Recomputes from the model field, so a
	 * newer/cheaper model id picks up its own dial as soon as it is typed. */
	const thinkingSupport = $derived(thinkingFor(settings.activeProviderId, active.model));
	const thinkingId = $derived(
		resolveThinkingId(thinkingSupport, settings.thinking[settings.activeProviderId])
	);
	function setThinking(id: string) {
		settings.thinking = { ...settings.thinking, [settings.activeProviderId]: id };
	}</script>

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
				<input type="checkbox" bind:checked={settings.scaleActionsWithFont} />
				Scale message icons with text size
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hideButtons} />
				Hide message buttons until tapped
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.showMessageButtons} />
				Show message buttons
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.ownBubble} />
				Enable background on my messages
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.inspectEnabled} />
				Show Inspect for single kanji/hanzi highlights
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.vibration} />
				Vibrate when messages send and arrive
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.replyNotifications} />
				Notify when replies finish in the background
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
				LLM messages
			</label>
		</fieldset>
		<label class="check">
			<input type="checkbox" bind:checked={settings.ownBubble} />
			Enable background on my messages
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.scaleActionsWithFont} />
			Scale message icons with text size
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.showMessageButtons} />
			Show message buttons
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.inspectEnabled} />
			Show Inspect for single kanji/hanzi highlights
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.replyNotifications} />
			Notify when replies finish in the background
		</label>
	{/if}	<VoicePanel settings={settings} androidUI={androidUI} />
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
				max={800}
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
				onpointerup={(e) => sliderRelease(e, () => (settings.messageGap = MESSAGE_GAP_DEFAULT))}
				oninput={(e) => {
					settings.messageGap = Number(e.currentTarget.value);
				}}
			/>
			<output style="min-width: 3.6rem;">{settings.messageGap ?? MESSAGE_GAP_DEFAULT} rem</output>
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
