import { test, expect, type Page } from "./fixtures";
import { seedChat, toggleSidebar } from "./helpers";

/**
 * Listening drills through the app's backend (the `listen_*`
 * commands, stubbed on a mock shell): browse the learner's channel,
 * start a video, move past clip 1 and land on clip 2 at once, reveal with
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
	audio: {
		kind: "dub",
		lang: "fr-FR",
		itag: 139,
		track: "fr-FR.10",
		mime: "audio/mp4",
		auto: true
	},
	captions: { key: "a.fr", kind: "asr" }
};

/** Three spoken sentences (each past the 2.2 s clip minimum), one
 * word seg each, a pause between. */
function captions(): string {
	const sentence = (start: number, words: string[]) => ({
		tStartMs: start,
		dDurationMs: words.length * 600,
		segs: words.map((w, k) =>
			k === 0 ? { utf8: w } : { utf8: ` ${w}`, tOffsetMs: k * 600 }
		)
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
					for (let k = 0; k < s.length; k++)
						buf.setUint8(at + k, s.charCodeAt(k));
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
						return {
							name: "Learner Channel",
							url: seed.channel,
							videos: [row]
						};
					if (cmd === "listen_videos") return [seed.info];
					if (cmd === "listen_search") return [row];
					if (cmd === "listen_fetch") {
						// A spec can hold the video's fetch to catch it loading.
						const w = window as unknown as {
							__holdFetch?: boolean;
							__releaseFetch?: () => void;
						};
						if (w.__holdFetch)
							await new Promise<void>((resolve) => {
								w.__releaseFetch = () => {
									w.__holdFetch = false;
									resolve();
								};
							});
						return {
							info: seed.info,
							audio_mime: "audio/wav",
							captions: seed.captions,
							caption_kind: "asr",
							storyboard: null
						};
					}
					if (cmd === "listen_audio") return silentWav(12);
					if (cmd === "listen_video") {
						if (!(window as unknown as { __withVideo?: boolean }).__withVideo)
							throw new Error("listen-no-video");
						return silentWav(1);
					}
					// Launch-time calls the app tolerates failing.
					if (cmd === "keychain_get") return null;
					if (cmd === "keychain_set" || cmd === "keychain_delete") return null;
					if (cmd === "plugin:event|listen") return 1;
					throw new Error(`mock-shell: unhandled ${cmd}`);
				},
				transformCallback: (): number => 0,
				unregisterCallback: (): void => {}
			};
			(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ =
				shell;
		},
		{ info, captions: captions(), channel: CHANNEL }
	);
}

/** Every grading reply: a translation plus one note. */
const GRADE = {
	translation: "Hello everyone and welcome.",
	notes: [{ expr: "bienvenue", meaning: "welcome" }]
};

/** Translation requests the grading stub answered. */
let graded = 0;

test.beforeEach(async ({ page }) => {
	await mockListenShell(page);
	graded = 0;
	await page.route("http://grade.test/v1/chat/completions", (route) => {
		if (route.request().method() === "POST") graded++;
		return route.fulfill({
			headers: {
				"access-control-allow-origin": "*",
				"access-control-allow-headers": "*"
			},
			json: { choices: [{ message: { content: JSON.stringify(GRADE) } }] }
		});
	});
	await seedChat(page, [], "fr", {
		listenChannels: [{ url: CHANNEL, name: "Learner Channel" }],
		activeProviderId: "deepseek",
		providers: {
			deepseek: {
				baseUrl: "http://grade.test/v1",
				apiKey: "test-key",
				model: "stub",
				models: []
			}
		}
	});
	await page.goto("/");
	await expect(page.locator(".empty-state")).toBeVisible({ timeout: 60_000 });
});

test("News and Listen show on a new chat; with no language they ask for one", async ({
	page
}) => {
	// Same shell and channels, but a chat with no language yet.
	await seedChat(page, [], null, {
		listenChannels: [{ url: CHANNEL, name: "Learner Channel" }]
	});
	await page.reload();
	await expect(page.locator(".empty-state h1")).toBeVisible({
		timeout: 60_000
	});
	// Desktop: both ways in show before any pick.
	await expect(page.getByRole("tab", { name: "News" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "Listen" })).toBeVisible();
	await page.getByRole("tab", { name: "News" }).click();
	await expect(page.locator(".toast").first()).toContainText(
		"Pick a language first"
	);
	await expect(page.locator(".news-panel")).toHaveCount(0);
	// A pick only sets the language; Listen then opens in it.
	await page.locator('.lang-menu button:has-text("Europe")').click();
	await page
		.locator(".lang-list")
		.getByRole("menuitem", { name: "French" })
		.click();
	await expect(page.locator(".listen-panel")).toHaveCount(0);
	await page.getByRole("tab", { name: "Listen" }).click();
	await expect(page.locator(".listen-panel")).toContainText("Learner Channel");
});

test("a drill runs: show text, next clip at once, tally", async ({ page }) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	const panel = page.locator(".listen-panel");
	await expect(panel).toContainText("Learner Channel");
	const row = panel.locator(".video", { hasText: info.title });
	await expect(row).toContainText("French auto-dub");
	await row.click();

	// Clip 1 waits under its steps: Show text and Next, no guess field.
	const clips = page.locator(".clip");
	await expect(clips).toHaveCount(1, { timeout: 10_000 });
	await expect(clips.first()).toContainText("1 / 3");
	const step = (n: number, name: string) =>
		page.locator(`#msg-${n}`).getByRole("button", { name });
	await expect(step(0, "Show text")).toBeVisible();
	await expect(
		page.getByRole("textbox", { name: /what you hear/ })
	).toHaveCount(0);
	// The drill grabs no focus: single-letter keys stay free.
	await expect(step(0, "Next clip")).not.toBeFocused();

	// Next reveals clip 1 and shows clip 2 at once.
	await step(0, "Next clip").click();
	await expect(clips).toHaveCount(2);
	await expect(clips.nth(1)).toContainText("2 / 3");
	await expect(page.locator(".messages")).toContainText(
		"Bonjour à tous et bienvenue."
	);
	// Only the waiting clip has steps.
	await expect(step(0, "Next clip")).toHaveCount(0);

	// Show text puts clip 2's words up while it still waits; Next moves on.
	await step(1, "Show text").click();
	await expect(page.locator(".messages")).toContainText(
		"Nous parlons de la peste."
	);
	await expect(step(1, "Show text")).toHaveCount(0);
	await expect(clips).toHaveCount(2);
	await step(1, "Next clip").click();
	await expect(clips).toHaveCount(3);

	// The last Next ends the video: the tally.
	await step(2, "Next clip").click();
	const end = page.locator(".end");
	await expect(end).toContainText("End of the video");
	await expect(
		end.getByRole("button", { name: "Another video" })
	).toBeVisible();

	// Nothing translated on the way: the body stays the French, and
	// opening a clip's English asks for that clip alone.
	const first = page.locator("#msg-0");
	const english = first.getByRole("button", { name: "English" });
	await expect(english).toBeVisible();
	await expect(first).not.toContainText(GRADE.translation);
	expect(graded).toBe(0);
	await english.click();
	await expect(english).toHaveAttribute("aria-expanded", "true");
	await expect(first).toContainText(GRADE.translation);
	await expect(first).toContainText("welcome");
	expect(graded).toBe(1);
});

test("the search box searches on a typing pause; emptying it drops the results", async ({
	page
}) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	const panel = page.locator(".listen-panel");
	const search = panel.getByRole("searchbox", { name: "Search YouTube" });
	await search.fill("pakman");
	const results = panel.locator(".results");
	await expect(
		results.locator(".video", { hasText: info.title })
	).toBeVisible();
	await search.fill("");
	await expect(results).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Clear search" })).toHaveCount(
		0
	);

	// The × inside the box clears it the same way.
	await search.fill("pakman");
	await expect(
		results.locator(".video", { hasText: info.title })
	).toBeVisible();
	await panel.getByRole("button", { name: "Clear search" }).click();
	await expect(search).toHaveValue("");
	await expect(search).toBeFocused();
	await expect(results).toHaveCount(0);
	await expect(panel).toContainText("Learner Channel");
});

test("Space stops what plays from anywhere, plays the clip under the pointer, and Next lets a clip finish first", async ({
	page
}) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	await page.locator(".listen-panel .video", { hasText: info.title }).click();
	const clips = page.locator(".clip");
	await expect(clips).toHaveCount(1, { timeout: 10_000 });
	const first = clips.first();
	const pause = first.getByRole("button", { name: "Pause" });
	const scrub = first.getByRole("slider", { name: "Position in the clip" });
	// The first clip starts on its own (a new clip row never cuts it).
	await expect(pause).toBeVisible();
	await expect
		.poll(async () => Number(await scrub.inputValue()))
		.toBeGreaterThan(0.3);

	// Space pauses where it is, the pointer nowhere near the video.
	await page.mouse.move(2, 2);
	const box = page.locator(".prompt textarea").first();
	await box.press("Space");
	await expect(first.getByRole("button", { name: "Play clip" })).toBeVisible();
	const held = Number(await scrub.inputValue());
	await page.waitForTimeout(400);
	expect(Number(await scrub.inputValue())).toBe(held);
	await expect(box).toHaveValue("");

	// Over the player, Space resumes from there, not from the top.
	await first.locator(".controls").hover();
	await box.press("Space");
	await expect(pause).toBeVisible();
	expect(Number(await scrub.inputValue())).toBeGreaterThanOrEqual(held);

	// Next while it plays: clip 2 shows, clip 1 keeps playing, then
	// clip 2 follows on its own.
	await page
		.locator("#msg-0")
		.getByRole("button", { name: "Next clip" })
		.click();
	await expect(clips).toHaveCount(2);
	await expect(pause).toBeVisible();
	await expect(clips.nth(1).getByRole("button", { name: "Pause" })).toBeVisible(
		{ timeout: 6_000 }
	);
	await expect(first.getByRole("button", { name: "Play clip" })).toBeVisible();
});

test("clicking the picture plays and pauses; restart plays from the top", async ({
	page
}) => {
	await page.evaluate(() => {
		(window as unknown as { __withVideo: boolean }).__withVideo = true;
	});
	await page.getByRole("tab", { name: "Listen" }).click();
	await page.locator(".listen-panel .video", { hasText: info.title }).click();
	const first = page.locator(".clip").first();
	const screen = first.locator("button.screen");
	await expect(screen).toBeVisible({ timeout: 10_000 });
	const scrub = first.getByRole("slider", { name: "Position in the clip" });
	await expect(
		first.getByRole("button", { name: "Pause" }).first()
	).toBeVisible();
	await screen.click();
	await expect(first.locator(".controls button.play")).toHaveAttribute(
		"aria-label",
		"Play clip"
	);
	const held = Number(await scrub.inputValue());
	expect(held).toBeGreaterThan(0);
	await first.getByRole("button", { name: "Play from the start" }).click();
	await expect(first.locator(".controls button.play")).toHaveAttribute(
		"aria-label",
		"Pause"
	);
	expect(Number(await scrub.inputValue())).toBeLessThan(held);

	// r does the same from the keyboard, the pointer anywhere.
	await expect
		.poll(async () => Number(await scrub.inputValue()))
		.toBeGreaterThan(0.3);
	await screen.click();
	const paused = Number(await scrub.inputValue());
	await page.mouse.move(2, 2);
	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur()
	);
	await page.keyboard.press("r");
	await expect(first.locator(".controls button.play")).toHaveAttribute(
		"aria-label",
		"Pause"
	);
	expect(Number(await scrub.inputValue())).toBeLessThan(paused);
});

test("keys: S slows the hovered clip, A shows the text, a moves on", async ({
	page
}) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	await page.locator(".listen-panel .video", { hasText: info.title }).click();
	const clips = page.locator(".clip");
	await expect(clips).toHaveCount(1, { timeout: 10_000 });
	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur()
	);
	await page.mouse.move(2, 2);
	await page.keyboard.press("a");
	await expect(clips).toHaveCount(2);

	await page.locator("#msg-0").hover();
	await page.keyboard.press("s");
	await expect(clips.first().locator(".slow.on")).toBeVisible();
	await expect(clips).toHaveCount(2);

	await page.mouse.move(2, 2);
	await page.keyboard.press("Shift+A");
	await expect(page.locator(".messages")).toContainText(
		"Nous parlons de la peste."
	);
	await expect(clips).toHaveCount(2);
	await page.keyboard.press("a");
	await expect(clips).toHaveCount(3);
});

test("the composer is a chat: a question reads against the heard clips", async ({
	page
}) => {
	const bodies: string[] = [];
	page.on("request", (r) => {
		if (r.url().startsWith("http://grade.test/") && r.method() === "POST")
			bodies.push(r.postData() ?? "");
	});
	await page.getByRole("tab", { name: "Listen" }).click();
	await page.locator(".listen-panel .video", { hasText: info.title }).click();
	const clips = page.locator(".clip");
	await expect(clips).toHaveCount(1, { timeout: 10_000 });
	await page
		.locator("#msg-0")
		.getByRole("button", { name: "Next clip" })
		.click();
	await expect(clips).toHaveCount(2);
	const box = page.locator(".prompt textarea").first();
	await box.fill("what does bienvenue mean?");
	await box.press("Enter");
	// Sent as a chat turn, never graded as a guess: clip 2 still waits.
	await expect(page.locator("article.user")).toContainText(
		"what does bienvenue mean?"
	);
	await expect(
		page.locator("#msg-1").getByRole("button", { name: "Next clip" })
	).toBeVisible();
	await expect
		.poll(() => bodies.find((b) => b.includes("Listening drill on the video")))
		.toBeTruthy();
	const body =
		bodies.find((b) => b.includes("Listening drill on the video")) ?? "";
	expect(body).toContain("Bonjour à tous et bienvenue.");
	// Clip 2 waits: its words never reach the model.
	expect(body).not.toContain("Nous parlons de la peste.");
});

test("annotating while a clip plays never reads the quote over it", async ({
	page
}) => {
	await page.addInitScript(() => {
		const w = window as unknown as { __spoke: number };
		w.__spoke = 0;
		const synth = window.speechSynthesis;
		const voice = {
			name: "Thomas",
			lang: "fr-FR",
			localService: true,
			default: true,
			voiceURI: "Thomas"
		};
		Object.defineProperty(synth, "getVoices", {
			value: () => [voice],
			configurable: true
		});
		Object.defineProperty(synth, "speak", {
			value: () => {
				w.__spoke++;
			},
			writable: true,
			configurable: true
		});
	});
	await page.reload();
	await expect(page.locator(".empty-state")).toBeVisible({ timeout: 60_000 });
	await page.getByRole("tab", { name: "Listen" }).click();
	await page.locator(".listen-panel .video", { hasText: info.title }).click();
	const clips = page.locator(".clip");
	await expect(clips).toHaveCount(1, { timeout: 10_000 });
	await page
		.locator("#msg-0")
		.getByRole("button", { name: "Next clip" })
		.click();
	await expect(clips).toHaveCount(2);
	// Clip 1 is still playing (clip 2 waits for it).
	await expect(
		clips.first().getByRole("button", { name: "Pause" })
	).toBeVisible();
	const body = page.locator("#msg-0 .rendered");
	await body.scrollIntoViewIfNeeded();
	const rect = await body.boundingBox();
	if (!rect) throw new Error("clip body has no box");
	await page.mouse.dblclick(rect.x + 20, rect.y + rect.height / 2);
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.waitForTimeout(300);
	expect(
		await page.evaluate(
			() => (window as unknown as { __spoke: number }).__spoke
		)
	).toBe(0);
	await expect(page.getByText("No voice for this language.")).toHaveCount(0);
});

test("a channel's videos fold by its chevron or hover + F, and stay folded", async ({
	page
}) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	const channel = page.locator(".listen-panel .channel", {
		hasText: "Learner Channel"
	});
	const videos = channel.locator(".video", { hasText: info.title });
	await expect(videos).toBeVisible();

	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur()
	);
	await channel.hover();
	await page.keyboard.press("f");
	await expect(videos).toHaveCount(0);
	await expect(
		channel.getByRole("button", { name: "Show Learner Channel's videos" })
	).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1"))
		)
		.toContain('"folded":true');

	await channel
		.getByRole("button", { name: "Show Learner Channel's videos" })
		.click();
	await expect(videos).toBeVisible();
});

test("Listen titles follow the text size; its controls stay put", async ({
	page
}) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	const panel = page.locator(".listen-panel");
	const title = panel.locator(".video-title").first();
	const search = panel.locator(".search input");
	await expect(title).toBeVisible();
	const px = async (el: typeof title) =>
		parseFloat(await el.evaluate((n) => getComputedStyle(n).fontSize));
	const base = await px(title);
	const control = await px(search);
	await page.evaluate(() =>
		document
			.querySelector<HTMLElement>(".app")
			?.style.setProperty("--font-scale", "2")
	);
	await expect.poll(() => px(title)).toBeCloseTo(base * 2, 1);
	expect(await px(search)).toBe(control);
});

test("big text wraps the channel list instead of cutting it short", async ({
	page
}) => {
	await page.setViewportSize({ width: 1000, height: 1300 });
	await page.getByRole("tab", { name: "Listen" }).click();
	const panel = page.locator(".listen-panel");
	await expect(panel.locator(".video-title").first()).toBeVisible();
	await page.evaluate(() =>
		document
			.querySelector<HTMLElement>(".app")
			?.style.setProperty("--font-scale", "3.7")
	);
	const layout = await panel.evaluate((el) => {
		const box = (s: string) => el.querySelector(s)!.getBoundingClientRect();
		const name = el.querySelector(".channel-name")!;
		const thumb = box(".video .thumb");
		const text = box(".video .video-text");
		const fold = box(".channel-head .fold svg");
		return {
			clipped: name.scrollWidth > name.clientWidth + 1,
			stacked: text.top >= thumb.bottom - 1,
			fold: fold.height,
			name: parseFloat(getComputedStyle(name).fontSize)
		};
	});
	expect(layout.clipped).toBe(false);
	// The thumbnail sits above its title once the two can't share a row.
	expect(layout.stacked).toBe(true);
	// The fold arrow keeps pace with the name, not the fixed controls.
	expect(layout.fold).toBeGreaterThan(layout.name * 0.5);
	await panel.screenshot({
		path: ".screenshots/listen-big-text.png",
		animations: "disabled"
	});
});

test("the clip in play shows the video, centered; others keep a still", async ({
	page
}) => {
	await page.addInitScript(() => {
		(window as unknown as { __withVideo: boolean }).__withVideo = true;
	});
	await page.reload();
	await expect(page.locator(".empty-state")).toBeVisible({ timeout: 60_000 });
	await page.getByRole("tab", { name: "Listen" }).click();
	await page.locator(".listen-panel .video", { hasText: info.title }).click();
	const clips = page.locator(".clip");
	await expect(clips).toHaveCount(1, { timeout: 10_000 });
	const screen = clips.first().locator(".screen video");
	await expect(screen).toBeVisible({ timeout: 10_000 });
	await expect(screen).toHaveJSProperty("muted", true);
	const [clipBox, screenBox] = await Promise.all([
		clips.first().boundingBox(),
		clips.first().locator(".screen").boundingBox()
	]);
	const mid = (b: { x: number; width: number }) => b.x + b.width / 2;
	expect(Math.abs(mid(clipBox!) - mid(screenBox!))).toBeLessThan(2);
	// One player card the width of the column (unless the window is
	// too short for that): the controls sit under the picture, and the
	// picture leaves room for the steps above the composer.
	const fit = await page.evaluate(() => {
		const clip = document.querySelector(".clip.open")!;
		const column = clip.getBoundingClientRect();
		const screen = clip.querySelector(".screen")!.getBoundingClientRect();
		const bar = clip.querySelector(".controls")!.getBoundingClientRect();
		const capped = screen.height >= window.innerHeight * 0.6 - 1;
		return {
			joined: Math.abs(bar.top - screen.bottom) < 1,
			tall: screen.height <= window.innerHeight * 0.6 + 1,
			wide: capped || Math.abs(screen.width - column.width) < 1
		};
	});
	expect(fit).toEqual({ joined: true, tall: true, wide: true });
	// Moving on: the new clip carries the picture, the answered one not.
	await page
		.locator("#msg-0")
		.getByRole("button", { name: "Next clip" })
		.click();
	await expect(clips).toHaveCount(2);
	await expect(clips.nth(1).locator(".screen video")).toBeVisible();
	await expect(clips.first().locator(".screen")).toHaveCount(0, {
		timeout: 10_000
	});
});

test("a video loads in the background: a new chat meanwhile is free, and the drill lands in its own chat", async ({
	page
}) => {
	await page.evaluate(() => {
		(window as unknown as { __holdFetch: boolean }).__holdFetch = true;
	});

	await page.getByRole("tab", { name: "Listen" }).click();
	const row = page.locator(".listen-panel .video", { hasText: info.title });
	await row.click();
	await expect(row).toContainText("Loading…");

	await page.keyboard.press("Control+Alt+KeyN");
	// The new chat has no language: no browse screen, nothing loading.
	await expect(page.locator(".listen-panel")).toHaveCount(0);
	// The fetch is held once the mock has it; then let it through.
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					typeof (window as unknown as { __releaseFetch?: () => void })
						.__releaseFetch
			)
		)
		.toBe("function");
	await page.evaluate(() =>
		(window as unknown as { __releaseFetch: () => void }).__releaseFetch()
	);
	// The drill lands in the chat it was started from, named for its video.
	await expect(
		page.locator("aside:not(.settings-panel)").getByText(info.title)
	).toBeVisible({ timeout: 10_000 });
	await expect(page.locator(".clip")).toHaveCount(0);
	await toggleSidebar(page);
	await page
		.locator("aside:not(.settings-panel)")
		.getByText(info.title)
		.click();
	await expect(page.locator(".clip")).toHaveCount(1);
});

test("the shown text marks the word sounding as the clip plays", async ({
	page
}) => {
	await page.getByRole("tab", { name: "Listen" }).click();
	await page.locator(".listen-panel .video", { hasText: info.title }).click();
	const clips = page.locator(".clip");
	await expect(clips).toHaveCount(1, { timeout: 10_000 });
	await page.mouse.move(2, 2);
	await page.keyboard.press("Shift+A");
	await expect(page.locator(".messages")).toContainText("Bonjour à tous");
	// Clip 1 played on arrival; once it's done, play it again from 0 s
	// (its words start every 0.6 s).
	const play = clips.first().getByRole("button", { name: "Play clip" });
	await expect(play).toBeVisible({ timeout: 10_000 });
	await play.click();
	const marked = () =>
		page.evaluate(() => {
			const h = CSS.highlights.get("clip-word");
			const range = h ? [...h][0] : undefined;
			return range instanceof Range ? range.toString() : null;
		});
	const often = { timeout: 5_000, intervals: [50] };
	await expect.poll(marked, often).toBe("tous");
	await expect.poll(marked, often).toBe("bienvenue.");
});
