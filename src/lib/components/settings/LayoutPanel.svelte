<!-- Layout: column widths (sliders, judged by eye against the live
chat), interface zoom, and the prompt's idle hide (steppers). Phones
size the column themselves, so only Interface size shows there. -->
<script lang="ts">
	import {
		CHAT_WIDTH_DEFAULT,
		CHAT_WIDTH_MAX,
		CHAT_WIDTH_MIN,
		PROMPT_IDLE_DEFAULT,
		PROMPT_WIDTH_BASE_REM,
		type AppSettings
	} from "$lib/settings";
	import { formatIdleTimeout } from "$lib/chrome";
	import { IDLE_LADDER, UI_SIZE_LADDER, idleRank } from "$lib/settingSteps";
	import Slider from "./Slider.svelte";
	import Stepper from "./Stepper.svelte";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
		androidUI: boolean;
	}

	let { settings = $bindable(), androidUI }: Props = $props();

	const rem = (v: number): string => `${Math.round(v)} rem`;
	/** "always" / "5 s" / "never", capitalized as a value. */
	const idleLabel = (v: number): string => {
		const text = formatIdleTimeout(v);
		return text.charAt(0).toUpperCase() + text.slice(1);
	};
</script>

<section id="settings-layout" aria-labelledby="layout-heading">
	<h2 id="layout-heading">Layout</h2>
	{#if !androidUI}
		<Slider
			label="Chat width"
			ariaLabel="Chat width in rem"
			value={settings.chatWidth ?? CHAT_WIDTH_DEFAULT}
			min={CHAT_WIDTH_MIN}
			max={CHAT_WIDTH_MAX}
			step={1}
			format={rem}
			defaultValue={CHAT_WIDTH_DEFAULT}
			resetTitle="Reset to the default width"
			onChange={(v: number) => (settings.chatWidth = v)}
		/>
		<Slider
			label="Prompt width"
			ariaLabel="Prompt width in rem"
			value={settings.promptWidth ?? PROMPT_WIDTH_BASE_REM}
			min={CHAT_WIDTH_MIN}
			max={CHAT_WIDTH_MAX}
			step={1}
			format={rem}
			defaultValue={PROMPT_WIDTH_BASE_REM}
			resetTitle="Reset to the default prompt width"
			onChange={(v: number) => (settings.promptWidth = v)}
		/>
	{/if}
	<!-- The sheet zooms with this value, so it steps: a slider thumb
	would slide out from under the pointer mid-drag. -->
	<Stepper
		label="Interface size"
		ariaLabel="Interface size percent"
		value={Math.round((settings.uiScale ?? 1) * 100)}
		ladder={UI_SIZE_LADDER}
		format={(v: number) => `${Math.round(v)}%`}
		defaultValue={100}
		resetTitle="Reset to the default interface size"
		onChange={(v: number) => (settings.uiScale = v / 100)}
	/>
	{#if !androidUI}
		<Stepper
			label="Hide prompt after idle"
			ariaLabel="Idle seconds before the prompt hides"
			value={settings.promptIdleSec ?? PROMPT_IDLE_DEFAULT}
			ladder={IDLE_LADDER}
			rank={idleRank}
			format={idleLabel}
			defaultValue={PROMPT_IDLE_DEFAULT}
			resetTitle="Reset to the default idle time"
			onChange={(v: number) => (settings.promptIdleSec = v)}
		/>
	{/if}
</section>
