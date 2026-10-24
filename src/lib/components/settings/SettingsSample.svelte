<!-- Live sample: the message font, spacing, gap, and own-message ink
as they are now, in the current theme. Clipped, so giant sizes stay a
preview. Reading shows it on top on phones; the desktop window pins
it over the whole scroll. -->
<script lang="ts">
	import {
		LINE_HEIGHT_DEFAULT,
		MESSAGE_GAP_DEFAULT,
		type AppSettings
	} from "$lib/settings";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
	}

	let { settings }: Props = $props();
</script>

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
