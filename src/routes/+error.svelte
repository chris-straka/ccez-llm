<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/stores";
</script>

<!-- Themed crash page: the framework default is unstyled light, which
reads as black-on-dark-grey sludge inside the dark app. Tokens ride
<html data-theme> set by the main page, so both themes read here. -->
<main class="crash">
	<h1>Something broke ({$page.status})</h1>
	<p>{$page.error?.message ?? "An unexpected error interrupted the chat."}</p>
	<p><a href={resolve("/")}>Back to the chat</a></p>
</main>

<style>
	.crash {
		min-height: 100dvh;
		box-sizing: border-box;
		padding: 3rem 1.5rem;
		background: #fff;
		background: var(--bg, #fff);
		color: #1c1c1e;
		color: var(--ink, #1c1c1e);
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
	}
	.crash a {
		color: inherit;
	}
</style>
