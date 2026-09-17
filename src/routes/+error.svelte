<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/stores";
</script>

<!-- Dark-always crash page: it renders outside the themed app shell
(tokens unset, data-theme absent), so token-driven colors fall back
to the framework default — unstyled light. One theme only, and it is
dark like the app. -->
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
		background: #1c1c1e;
		color: #f2f2f7;
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
	}
	.crash a {
		color: inherit;
	}
</style>
