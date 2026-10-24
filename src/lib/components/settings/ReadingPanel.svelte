<!-- Reading: how messages read. A live sample sits on top (the
settings sheet covers the chat on phones), and every size or spacing
is a stepper. -->
<script lang="ts">
	import {
		LINE_HEIGHT_DEFAULT,
		MESSAGE_GAP_DEFAULT,
		type AppSettings
	} from "$lib/settings";
	import {
		ANN_POP_LADDER,
		LINE_HEIGHT_LADDER,
		MESSAGE_GAP_LADDER,
		TEXT_SIZE_LADDER,
		trimNumber
	} from "$lib/settingSteps";
	import Stepper from "./Stepper.svelte";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
	}

	let { settings = $bindable() }: Props = $props();

	const percent = (v: number): string => `${Math.round(v)}%`;
	const pct = (scale: number | undefined): number =>
		Math.round((scale ?? 1) * 100);
</script>

<section id="settings-reading" aria-labelledby="reading-heading">
	<h2 id="reading-heading">Reading</h2>
	<!-- Live sample: the message font, spacing, gap, and own-message
	ink as they are now. Clipped, so giant sizes stay a preview. -->
	<div
		class="reading-preview"
		aria-hidden="true"
		data-own-ink={settings.ownInk}
		style="--pv-font: {settings.fontScale}; --pv-line: {settings.lineHeight ??
			LINE_HEIGHT_DEFAULT}; --pv-gap: {settings.messageGap ??
			MESSAGE_GAP_DEFAULT}rem"
	>
		<p class="pv-own">Ça va ?</p>
		<p>Oui, très bien, merci ! Et toi, tu as passé une bonne journée ?</p>
	</div>
	<Stepper
		typed
		label="Text size"
		ariaLabel="Text size percent"
		value={pct(settings.fontScale)}
		ladder={TEXT_SIZE_LADDER}
		format={percent}
		defaultValue={100}
		resetTitle="Reset to the default size"
		onChange={(v: number) => (settings.fontScale = v / 100)}
	/>
	<Stepper
		label="Line spacing"
		ariaLabel="Line spacing"
		value={settings.lineHeight ?? LINE_HEIGHT_DEFAULT}
		ladder={LINE_HEIGHT_LADDER}
		format={(v: number) => trimNumber(v)}
		defaultValue={LINE_HEIGHT_DEFAULT}
		resetTitle="Reset to the default line spacing"
		onChange={(v: number) => (settings.lineHeight = v)}
	/>
	<Stepper
		label="Gap between messages"
		ariaLabel="Gap size in rem"
		value={settings.messageGap ?? MESSAGE_GAP_DEFAULT}
		ladder={MESSAGE_GAP_LADDER}
		format={(v: number) => `${trimNumber(v)} rem`}
		defaultValue={MESSAGE_GAP_DEFAULT}
		resetTitle="Reset to the default gap"
		onChange={(v: number) => (settings.messageGap = v)}
	/>
	<Stepper
		typed
		label="Prompt text size"
		ariaLabel="Prompt text size percent"
		value={pct(settings.promptScale)}
		ladder={TEXT_SIZE_LADDER}
		format={percent}
		defaultValue={100}
		resetTitle="Reset to the default prompt size"
		onChange={(v: number) => (settings.promptScale = v / 100)}
	/>
	<Stepper
		typed
		label="Annotation popup size"
		ariaLabel="Annotation popup size percent"
		value={pct(settings.annPopScale)}
		ladder={ANN_POP_LADDER}
		format={percent}
		defaultValue={100}
		resetTitle="Reset to the default popup size"
		onChange={(v: number) => (settings.annPopScale = v / 100)}
	/>
	<label class="check">
		<input type="checkbox" bind:checked={settings.scaleActionsWithFont} />
		<span>Scale message icons with text size</span>
	</label>
</section>
