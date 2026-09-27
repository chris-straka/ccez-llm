<script lang="ts">
	import {
		OWN_INK_CHOICES,
		type AppSettings,
		type OwnInkChoice
	} from "$lib/settings";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
	}

	let { settings = $bindable() }: Props = $props();
	/** Swatch labels (total: a future `custom` choice fails here until labeled). */
	const OWN_INK_LABELS: Record<OwnInkChoice, string> = {
		pink: "Pink",
		blue: "Blue",
		green: "Green",
		amber: "Amber",
		purple: "Purple",
		white: "White",
		off: "Off"
	};
</script>

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
	<fieldset>
		<legend>My message color</legend>
		<div
			class="segmented swatches"
			role="radiogroup"
			aria-label="My message color"
		>
			{#each OWN_INK_CHOICES as choice (choice)}
				<button
					type="button"
					role="radio"
					aria-checked={settings.ownInk === choice}
					class:selected={settings.ownInk === choice}
					title={choice === "off"
						? "No color on my messages"
						: `Color my messages ${choice}`}
					onclick={() => (settings.ownInk = choice)}><span
						class="dot"
						data-choice={choice}
						aria-hidden="true"
					></span>{OWN_INK_LABELS[choice]}</button
				>
			{/each}
		</div>
	</fieldset>
</section>
