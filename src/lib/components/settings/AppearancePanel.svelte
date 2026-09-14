<script lang="ts">
	import type { AppSettings } from "$lib/settings";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
	}

	let { settings }: Props = $props();
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
</section>
