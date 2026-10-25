import { test as base, expect } from "@playwright/test";

export * from "@playwright/test";

/**
 * Chromium reports a ResizeObserver that settles over more than one
 * frame as an error event; it is benign (layout settles next frame)
 * and fires from third-party layout as much as ours.
 */
const BENIGN = /ResizeObserver loop/;

/**
 * Every spec imports `test` from here: an uncaught page error fails
 * the test at teardown. A throw inside a Svelte update aborts that
 * update partway (a Retry-time state_unsafe_mutation once did) while
 * the assertions around it still pass, so nothing else catches it.
 */
export const test = base.extend<{ pageErrors: string[] }>({
	pageErrors: [
		async ({ page }, use) => {
			// Speech never reaches the speakers: the Mac's engine read
			// every spec aloud, and headless Chromium on Linux has none
			// and fails each utterance at once. The specs assume a
			// silent accept (a reading stays "playing" until stopped).
			await page.addInitScript(() => {
				const synth = window.speechSynthesis;
				if (synth)
					Object.defineProperty(synth, "speak", {
						value: () => {},
						// Specs still assign their own spies.
						writable: true,
						configurable: true
					});
			});
			const errors: string[] = [];
			page.on("pageerror", (error) => {
				if (!BENIGN.test(error.message)) errors.push(error.message);
			});
			// WebKit names no module in "Importing a module script
			// failed": the failed requests say which one (CI only
			// hits it, now and then).
			const failed: string[] = [];
			page.on("requestfailed", (request) => {
				failed.push(
					`${request.url()} (${request.failure()?.errorText ?? "failed"})`
				);
			});
			await use(errors);
			const detail = errors.some((e) => /module script/.test(e))
				? [...errors, ...failed.map((f) => `request failed: ${f}`)]
				: errors;
			expect(detail, "uncaught page errors").toEqual([]);
		},
		{ auto: true }
	]
});
