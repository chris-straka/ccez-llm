<!-- Voice: which voice reads, how fast and how loud, and the
big-word reader. Volumes are the only sliders (continuous, judged by
ear); speed steps in 0.05× rungs. -->
<script lang="ts">
	import {
		LISTEN_VOLUME_MAX,
		VOICE_SPEED_DEFAULT,
		type AppSettings
	} from "$lib/settings";
	import { VOICE_SPEED_LADDER, trimNumber } from "$lib/settingSteps";
	import type { VoiceLangFollow } from "$lib/voiceTiers";
	import ActionIcon from "../ActionIcon.svelte";
	import Slider from "./Slider.svelte";
	import Stepper from "./Stepper.svelte";
	import VoicePanel from "./VoicePanel.svelte";
	import SettingRow from "./SettingRow.svelte";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
		androidUI: boolean;
		followVoice?: VoiceLangFollow | null;
		/** Read a sample line with the current voice, speed and
		volume (or stop it); absent hides the row. */
		onTestVoice?: (() => void) | undefined;
		/** The sample is playing (the button reads Stop). */
		voiceTesting?: boolean;
	}

	let {
		settings = $bindable(),
		androidUI,
		followVoice = null,
		onTestVoice,
		voiceTesting = false
	}: Props = $props();

	const percent = (v: number): string => `${Math.round(v * 100)}%`;
</script>

<section id="settings-voice" aria-labelledby="voice-heading">
	<h2 id="voice-heading">Voice</h2>
	<VoicePanel bind:settings {androidUI} {followVoice} />
	{#if onTestVoice}
		<SettingRow name="Test voice">
			<button
				type="button"
				class="voice-test"
				aria-pressed={voiceTesting}
				onclick={onTestVoice}
			>
				<ActionIcon kind="speak" />
				{voiceTesting ? "Stop" : "Play sample"}
			</button>
		</SettingRow>
	{/if}
	<Stepper
		label="Voice speed"
		ariaLabel="Voice speed"
		value={settings.voiceSpeed ?? VOICE_SPEED_DEFAULT}
		ladder={VOICE_SPEED_LADDER}
		format={(v: number) => `${trimNumber(v)}×`}
		defaultValue={VOICE_SPEED_DEFAULT}
		resetTitle="Reset to normal speed"
		onChange={(v: number) => (settings.voiceSpeed = v)}
	/>
	<Slider
		label="Voice volume"
		ariaLabel="Voice volume percent"
		value={settings.voiceVolume}
		min={0}
		max={1}
		step={0.05}
		format={percent}
		defaultValue={1}
		resetTitle="Reset to full volume"
		onChange={(v: number) => (settings.voiceVolume = v)}
	/>
	<!-- Drill audio level, here rather than beside the clip so a stray
	click mid-drill never changes it. Up to 200%: dubbed tracks can run
	quieter than the voice. -->
	<Slider
		label="Video volume"
		ariaLabel="Video volume percent"
		value={settings.listenVolume}
		min={0}
		max={LISTEN_VOLUME_MAX}
		step={0.05}
		format={percent}
		defaultValue={1}
		resetTitle="Reset to full volume"
		onChange={(v: number) => (settings.listenVolume = v)}
	/>
	<SettingRow name="Big-word reader">
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
		{#snippet below()}
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
		{/snippet}
	</SettingRow>
</section>

<style>
	.voice-test {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		padding: 0.35em 0.85em;
		border: 1px solid var(--line-soft);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		transition: border-color 0.15s ease;
	}
	.voice-test:hover,
	.voice-test[aria-pressed="true"] {
		border-color: var(--accent);
	}
	.voice-test :global(svg) {
		width: 1.05em;
		height: 1.05em;
	}
</style>
