/**
 * Sheets that open from Settings and render at page level (outside
 * the zoomed panel), so the page can stack them and give them Escape
 * first. The dictionary manager keeps its flag in dictionary.svelte.ts.
 */

/** Settings → Licenses is open. */
export const licensesView = $state({ open: false });

/**
 * An Android update the background check already downloaded: Settings'
 * button offers its install straight away.
 */
export const readyApk = $state({ version: "", path: "" });
