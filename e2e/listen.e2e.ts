import { test, expect, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Listening drills through the app's backend (the `listen_*`
 * commands, stubbed on a mock shell): browse the learner's channel,
 * start a video, guess clip 1 and land on clip 2 at once, reveal with
 * ⌘Enter, reach the tally. Grading goes to a stub provider whose replies
 * the spec serves, so translations land on the clips.
 */
const CHANNEL = "https://www.youtube.com/@learner-channel";
const VIDEO = "abcdefghijk";

const info = {
	id: VIDEO,
	title: "Une vidéo doublée",
	channel: "Learner Channel",
	channel_url: CHANNEL,
	duration: 12,
	thumbnail: "",
	original_lang: "en-US",
	audio: { kind: "dub", lang: "fr-FR", itag: 139, track: "fr-FR.10", mime: "audio/mp4", auto: true },
	captions: { key: "a.fr", kind: "asr" }
};

/** Three spoken sentences (each past the 2.2 s clip minimum), one
 * word seg each, a pause between. */
function captions(): string {
	const sentence = (start: number, words: string[]) => ({
		tStartMs: start,
		dDurationMs: words.length * 600,
		segs: words.map((w, k) => (k === 0 ? { utf8: w } : { utf8: ` ${w}`, tOffsetMs: k * 600 }))
	});
	return JSON.stringify({
		events: [
			sentence(0, ["Bonjour", "à", "tous", "et", "bienvenue."]),
			sentence(4000, ["Nous", "parlons", "de", "la", "peste."]),
			sentence(8000, ["Merci", "de", "votre", "attention."])
		]
	});
}

/** A shell whose `listen_*` commands answer from fixtures. */
async function mockListenShell(page: Page): Promise<void> {
	await page.addInitScript(
		(seed: { info: typeof info; captions: string; channel: string }) => {
			/** A short silent WAV: the drill only needs something decodable. */
			const silentWav = (seconds: number): ArrayBuffer => {
				const rate = 8000;
				const n = rate * seconds;
				const buf = new DataView(new ArrayBuffer(44 + n));
				const text = (at: number, s: string) => {
					for (let k = 0; k < s.length; k++) buf.setUint8(at + k, s.charCodeAt(k));
				};
				text(0, "RIFF");
				buf.setUint32(4, 36 + n, true);
				text(8, "WAVEfmt ");
				buf.setUint32(16, 16, true);
				buf.setUint16(20, 1, true);
				buf.setUint16(22, 1, true);
				buf.setUint32(24, rate, true);
				buf.setUint32(28, rate, true);
				buf.setUint16(32, 1, true);
				buf.setUint16(34, 8, true);
				text(36, "data");
				buf.setUint32(40, n, true);
				for (let k = 0; k < n; k++) buf.setUint8(44 + k, 128);
				return buf.buffer;
			};
			const row = {
				kind: "video",
				id: seed.info.id,
				title: seed.info.title,
				channel: seed.info.channel,
				channel_url: seed.channel,
				duration: 12,
				thumbnail: ""
			};
			const shell = {
				invoke: async (cmd: string): Promise<unknown> => {
					if (cmd === "listen_channel")
						return { name: "Learner Channel", url: seed.channel, videos: [row] };
					if (cmd === "listen_videos") return [seed.info];
					if (cmd === "listen_search") return [row];
					if (cmd === "listen_fetch")
						return {
							info: seed.info,
							audio_mime: "audio/wav",
							captions: seed.captions,
							caption_kind: "asr",
							storyboard: null
						};
					if (cmd === "listen_audio") return silentWav(12);
					// Launch-time calls the app tolerates failing.
					if (cmd === "keychain_get") return null;
					if (cmd === "keychain_set" || cmd === "keychain_delete") return null;
					if (cmd === "plugin:event|listen") return 1;
					throw new Error(`mock-shell: unhandled ${cmd}`);
				},
				transformCallback: (): number => 0,
				unregisterCallback: (): void => {}
			};
			(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = shell;
		},
		{ info, captions: captions(), channel: CHANNEL }
	);
}

/** Every grading reply: a translation plus one note. */
const GRADE = {
	translation: "Hello everyone and welcome.",
	notes: [{ expr: "bienvenue", meaning: "welcome" }]
};

test.beforeEach(async ({ page }) => {
	await mockListenShell(page);
	await page.route("http://grade.test/v1/chat/completions", (route) =>
		route.fulfill({
			headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
			json: { choices: [{ message: { content: JSON.stringify(GRADE) } }] }
		})
	);
	await seedChat(page, [], "fr", {
		listenChannels: [{ url: CHANNEL, name: "Learner Channel" }],
		activeProviderId: "deepseek",
		providers: {
			deepseek: { baseUrl: "http://grade.test/v1", apiKey: "test-key", model: "stub", models: [] }
		}
	});
	await page.goto("/");
	await expect(page.locator(".empty-state")).toBeVisible({ timeout: 60_000 });
});

test("a drill runs: guess, next clip at once, reveal, tally", async ({ page }) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	const panel = page.locator(".listen-panel");
	await expect(panel).toContainText("Learner Channel");
	const row = panel.locator(".video", { hasText: info.title });
	await expect(row).toContainText("French auto-dub");
	await row.click();

	// Clip 1 waits for a guess.
	const clips = page.locator(".clip");
	await expect(clips).toHaveCount(1, { timeout: 10_000 });
	await expect(clips.first()).toContainText("1 / 3");
	await expect(clips.first()).toContainText("Type what you hear");

	// A partly right guess: clip 2 shows at once, clip 1 is marked.
	const box = page.locator(".prompt textarea").first();
	await box.fill("bonjour a tous bienvenue");
	await box.press("Enter");
	await expect(clips).toHaveCount(2);
	await expect(clips.nth(1)).toContainText("2 / 3");
	// "a" for "à" counts as heard, spelled differently.
	await expect(clips.first().locator(".w.ok")).toHaveCount(3);
	await expect(clips.first().locator(".w.near")).toHaveText(["a"]);
	await expect(clips.first().locator(".w.missed")).toHaveText(["et"]);
	await expect(clips.first()).toContainText("4 of 5 words");
	await expect(page.locator(".messages")).toContainText("Bonjour à tous et bienvenue.");
	await expect(box).toHaveValue("");

	// ⌘Enter reveals clip 2 as a skip, dropping the half-typed guess.
	await box.fill("nous");
	await box.press("ControlOrMeta+Enter");
	await expect(clips).toHaveCount(3);
	await expect(clips.nth(1)).toContainText("Revealed");
	await expect(box).toHaveValue("");

	// The last guess ends the video: the tally, with the missed clip.
	await box.fill("merci de votre attention");
	await box.press("Enter");
	const end = page.locator(".end");
	await expect(end).toContainText("End of the video");
	await expect(end).toContainText("Nous parlons de la peste.");
	await expect(end.getByRole("button", { name: "Another video" })).toBeVisible();

	// Grading ran behind: the English folds under each clip, the body
	// stays the French.
	const first = page.locator("#msg-0");
	const english = first.getByRole("button", { name: "English" });
	await expect(english).toBeVisible({ timeout: 15_000 });
	await expect(first).not.toContainText(GRADE.translation);
	await english.click();
	await expect(english).toHaveAttribute("aria-expanded", "true");
	await expect(first).toContainText(GRADE.translation);
	await expect(first).toContainText("welcome");
});

test("emptying the search box drops the results", async ({ page }) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	const panel = page.locator(".listen-panel");
	const search = panel.getByRole("searchbox", { name: "Search YouTube" });
	await search.fill("pakman");
	await search.press("Enter");
	const results = panel.locator(".results");
	await expect(results.locator(".video", { hasText: info.title })).toBeVisible();
	await search.fill("");
	await expect(results).toHaveCount(0);
	await expect(panel).toContainText("Learner Channel");
});

test("Space pauses and resumes mid-clip; answering lets the clip finish first", async ({ page }) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	await page.locator(".listen-panel .video", { hasText: info.title }).click();
	const clips = page.locator(".clip");
	await expect(clips).toHaveCount(1, { timeout: 10_000 });
	const first = clips.first();
	const pause = first.getByRole("button", { name: "Pause" });
	const scrub = first.getByRole("slider", { name: "Position in the clip" });
	// The first clip starts on its own (a new clip row never cuts it).
	await expect(pause).toBeVisible();
	await expect.poll(async () => Number(await scrub.inputValue())).toBeGreaterThan(0.3);

	// Space pauses where it is; the playhead holds.
	const box = page.locator(".prompt textarea").first();
	await box.press("Space");
	await expect(first.getByRole("button", { name: "Play clip" })).toBeVisible();
	const held = Number(await scrub.inputValue());
	await page.waitForTimeout(400);
	expect(Number(await scrub.inputValue())).toBe(held);
	await expect(box).toHaveValue("");

	// Space again resumes from there, not from the top.
	await box.press("Space");
	await expect(pause).toBeVisible();
	expect(Number(await scrub.inputValue())).toBeGreaterThanOrEqual(held);

	// A guess while it plays: clip 2 shows, clip 1 keeps playing, then
	// clip 2 follows on its own.
	await box.fill("bonjour");
	await box.press("Enter");
	await expect(clips).toHaveCount(2);
	await expect(pause).toBeVisible();
	await expect(clips.nth(1).getByRole("button", { name: "Pause" })).toBeVisible({ timeout: 6_000 });
	await expect(first.getByRole("button", { name: "Play clip" })).toBeVisible();
});

test("outside the composer: S slows the hovered clip, A with nothing hovered reveals", async ({ page }) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	await page.locator(".listen-panel .video", { hasText: info.title }).click();
	const clips = page.locator(".clip");
	await expect(clips).toHaveCount(1, { timeout: 10_000 });
	const box = page.locator(".prompt textarea").first();
	await box.fill("bonjour");
	await box.press("Enter");
	await expect(clips).toHaveCount(2);
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

	await page.locator("#msg-0").hover();
	await page.keyboard.press("s");
	await expect(clips.first().locator(".slow.on")).toBeVisible();
	await expect(clips).toHaveCount(2);

	await page.mouse.move(2, 2);
	await page.keyboard.press("a");
	await expect(clips).toHaveCount(3);
	await expect(clips.nth(1)).toContainText("Revealed");
});
