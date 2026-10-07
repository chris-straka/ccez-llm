import process from "node:process";
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
			// Headless Chromium on Linux has no speech engine and fails
			// every utterance at once; the specs assume the Mac's silent
			// accept (a reading stays "playing" until stopped).
			if (process.platform === "linux")
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
			await use(errors);
			expect(errors, "uncaught page errors").toEqual([]);
		},
		{ auto: true }
	]
});
