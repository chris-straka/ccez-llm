<script lang="ts">
	import {
		OWN_INK_CHOICES,
		THEME_TILES,
		pickThemeTile,
		setFollowSystem,
		themeTileState,
		type AppSettings,
		type OwnInkChoice,
		type SchemeChoice,
		type ThemeTile
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
	const TILE_LABELS: Record<ThemeTile, string> = {
		light: "Light",
		graphite: "Graphite",
		ink: "Ink",
		warm: "Warm"
	};
	const TILE_TITLES: Record<ThemeTile, string> = {
		light: "Light theme",
		graphite: "Neutral gray dark theme",
		ink: "True black dark theme, warm text",
		warm: "Brown-tinted dark theme, parchment text"
	};

	const choice = $derived<SchemeChoice>({
		theme: settings.theme,
		darkStyle: settings.darkStyle
	});

	function apply(next: SchemeChoice): void {
		settings.theme = next.theme;
		settings.darkStyle = next.darkStyle;
	}

	/** OS scheme for the follow switch; jsdom has no matchMedia. */
	function systemDark(): boolean {
		return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
	}
</script>

<section aria-labelledby="color-scheme-heading">
	<h2 id="color-scheme-heading">Color scheme</h2>
	<fieldset class="theme">
		<!-- Each tile is a small painting of its theme (raw preview
		hexes: the tokens only resolve for the active theme). While
		following the system, Light reads Day and the chosen dark
		style reads Night. -->
		<div class="theme-tiles" role="group" aria-label="Color scheme">
			{#each THEME_TILES as tile (tile)}
				{@const state = themeTileState(choice, tile)}
				<button
					type="button"
					class="theme-tile"
					data-tile={tile}
					data-state={state}
					aria-pressed={state !== "idle"}
					title={TILE_TITLES[tile]}
					onclick={() => apply(pickThemeTile(choice, tile))}
				>
					<span class="theme-preview" aria-hidden="true">
						<span class="tp-drawer"></span>
						<span class="tp-line tp-own"></span>
						<span class="tp-line"></span>
						<span class="tp-line tp-short"></span>
						<span class="tp-composer"></span>
					</span>
					<span class="theme-name">{TILE_LABELS[tile]}</span>
					<span class="theme-when"
						>{state === "day" ? "Day" : state === "night" ? "Night" : ""}</span
					>
				</button>
			{/each}
		</div>
		<label class="check">
			<input
				type="checkbox"
				checked={settings.theme === "system"}
				onchange={(event) =>
					apply(
						setFollowSystem(choice, event.currentTarget.checked, systemDark())
					)}
			/>
			<span>Follow the system</span>
		</label>
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
