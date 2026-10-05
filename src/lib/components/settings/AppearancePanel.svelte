<script lang="ts">
	import {
		DARK_STYLES,
		LIGHT_STYLES,
		OWN_INK_CHOICES,
		pickSchemeSide,
		pickSchemeStyle,
		setFollowSystem,
		type AppSettings,
		type DarkStyle,
		type LightStyle,
		type OwnInkChoice,
		type SchemeChoice,
		type SchemeSide
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

	/** Which side's tiles show while following the system (the OS
	owns the scheme then, so the toggle only browses). Opens on the
	side that is showing. */
	let browsed: SchemeSide = $state(
		document.documentElement.dataset["theme"] === "dark" ? "dark" : "light"
	);
	const side = $derived<SchemeSide>(
		settings.theme === "system" ? browsed : settings.theme
	);
	const styles = $derived<readonly (LightStyle | DarkStyle)[]>(
		side === "light" ? LIGHT_STYLES : DARK_STYLES
	);
	const current = $derived(
		side === "light" ? settings.lightStyle : settings.darkStyle
	);

	function meta(style: LightStyle | DarkStyle): [string, string] {
		return side === "light"
			? STYLE_META.light[style as LightStyle]
			: STYLE_META.dark[style as DarkStyle];
	}

	function apply(next: SchemeChoice): void {
		settings.theme = next.theme;
		settings.lightStyle = next.lightStyle;
		settings.darkStyle = next.darkStyle;
	}

	function pickSide(next: SchemeSide): void {
		browsed = next;
		apply(pickSchemeSide(choice, next));
	}

	/** OS scheme for the follow switch; jsdom has no matchMedia. */
	function systemDark(): boolean {
		return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
	}
</script>

<section aria-labelledby="color-scheme-heading">
	<h2 id="color-scheme-heading">Color scheme</h2>
	<fieldset class="theme">
		<div class="segmented scheme-side" role="radiogroup" aria-label="Light or dark">
			{#each ["light", "dark"] as const as option (option)}
				<button
					type="button"
					role="radio"
					aria-checked={side === option}
					class:selected={side === option}
					onclick={() => pickSide(option)}
					>{option === "light" ? "Light" : "Dark"}</button
				>
			{/each}
		</div>
		<!-- Each tile is a small painting of its style (raw preview
		hexes: the tokens only resolve for the active theme). -->
		<div class="theme-tiles" role="group" aria-label="{side === 'light' ? 'Light' : 'Dark'} style">
			{#each styles as style (`${side}-${style}`)}
				<button
					type="button"
					class="theme-tile"
					data-tile="{side}-{style}"
					aria-pressed={current === style}
					title={meta(style)[1]}
					onclick={() => apply(pickSchemeStyle(choice, side, style))}
				>
					<span class="theme-preview" aria-hidden="true">
						<span class="tp-drawer"></span>
						<span class="tp-line tp-own"></span>
						<span class="tp-line"></span>
						<span class="tp-line tp-short"></span>
						<span class="tp-composer"></span>
					</span>
					<span class="theme-name">{meta(style)[0]}</span>
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
