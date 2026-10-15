<script lang="ts">
	import {
		DARK_STYLES,
		LIGHT_STYLES,
		OWN_INK_CHOICES,
		pickSchemeStyle,
		type AppSettings,
		type DarkStyle,
		type LightStyle,
		type OwnInkChoice,
		type SchemeChoice,
		type SchemeSide,
		type ThemeMode
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
	/** Tile name and tooltip per style, per side. */
	const STYLE_META: {
		light: Record<LightStyle, [string, string]>;
		dark: Record<DarkStyle, [string, string]>;
	} = {
		light: {
			paper: ["Paper", "Plain white page"],
			mist: ["Mist", "Soft gray page with less glare"],
			sepia: ["Sepia", "Cream page and brown text for long reading"],
			contrast: ["Contrast", "High contrast: black text on white"]
		},
		dark: {
			graphite: ["Graphite", "Neutral gray"],
			ink: ["Ink", "True black with warm text"],
			warm: ["Warm", "Brown-tinted with parchment text"],
			contrast: ["Contrast", "High contrast: white text on black"]
		}
	};

	const choice = $derived<SchemeChoice>({
		theme: settings.theme,
		lightStyle: settings.lightStyle,
		darkStyle: settings.darkStyle
	});

	const MODE_LABELS: Record<ThemeMode, string> = {
		light: "Light",
		dark: "Dark",
		system: "System"
	};
	const MODES: readonly ThemeMode[] = ["light", "dark", "system"];
	const SIDE_LABELS: Record<SchemeSide, string> = {
		light: "Light",
		dark: "Dark"
	};

	/** Tile rows: a pinned theme shows its own side; following the
	system shows both, since the OS picks which one paints. */
	const sides = $derived<readonly SchemeSide[]>(
		settings.theme === "system" ? ["light", "dark"] : [settings.theme]
	);

	function stylesFor(side: SchemeSide): readonly (LightStyle | DarkStyle)[] {
		return side === "light" ? LIGHT_STYLES : DARK_STYLES;
	}

	function currentFor(side: SchemeSide): LightStyle | DarkStyle {
		return side === "light" ? settings.lightStyle : settings.darkStyle;
	}

	function meta(
		side: SchemeSide,
		style: LightStyle | DarkStyle
	): [string, string] {
		return side === "light"
			? STYLE_META.light[style as LightStyle]
			: STYLE_META.dark[style as DarkStyle];
	}

	function apply(next: SchemeChoice): void {
		settings.theme = next.theme;
		settings.lightStyle = next.lightStyle;
		settings.darkStyle = next.darkStyle;
	}
</script>

<section id="settings-look" aria-labelledby="look-heading">
	<h2 id="look-heading">Look</h2>
	<fieldset class="theme">
		<legend>Color scheme</legend>
		<div
			class="segmented scheme-side"
			role="radiogroup"
			aria-label="Light, dark, or system"
		>
			{#each MODES as mode (mode)}
				<button
					type="button"
					role="radio"
					aria-checked={settings.theme === mode}
					class:selected={settings.theme === mode}
					title={mode === "system" ? "Match the system appearance" : undefined}
					onclick={() => (settings.theme = mode)}>{MODE_LABELS[mode]}</button
				>
			{/each}
		</div>
		{#each sides as side (side)}
			{#if sides.length > 1}
				<span class="tiles-side" aria-hidden="true">{SIDE_LABELS[side]}</span>
			{/if}
			<!-- Each tile is a small painting of its style (raw preview
			hexes: the tokens only resolve for the active theme). -->
			<div
				class="theme-tiles"
				role="group"
				aria-label="{SIDE_LABELS[side]} style"
			>
				{#each stylesFor(side) as style (`${side}-${style}`)}
					<button
						type="button"
						class="theme-tile"
						data-tile="{side}-{style}"
						aria-pressed={currentFor(side) === style}
						title={meta(side, style)[1]}
						onclick={() => apply(pickSchemeStyle(choice, side, style))}
					>
						<span class="theme-preview" aria-hidden="true">
							<span class="tp-drawer"></span>
							<span class="tp-line tp-own"></span>
							<span class="tp-line"></span>
							<span class="tp-line tp-short"></span>
							<span class="tp-composer"></span>
						</span>
						<span class="theme-name">{meta(side, style)[0]}</span>
					</button>
				{/each}
			</div>
		{/each}
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
					onclick={() => (settings.ownInk = choice)}
					><span class="dot" data-choice={choice} aria-hidden="true"
					></span>{OWN_INK_LABELS[choice]}</button
				>
			{/each}
		</div>
	</fieldset>
	<label class="check">
		<input type="checkbox" bind:checked={settings.ownBubble} />
		<span>Background on my messages</span>
	</label>
</section>
