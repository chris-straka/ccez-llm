import { Buffer } from "node:buffer";
import { test, expect, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Listening drills through the clip-server path (the phone and web
 * route): browse the learner's channel, start a video, guess clip 1
 * and land on clip 2 at once, reveal with "?", reach the tally. The
 * server is faked at the network layer; the mock provider's grading
 * isn't JSON, so translations fail into "Try again".
 */
const SERVER = "http://clip.test";
const CHANNEL = "https://www.youtube.com/@learner-channel/videos";
const VIDEO = "abcdefghijk";

const info = {
	id: VIDEO,
	title: "Une vidéo doublée",
	channel: "Learner Channel",
	channel_url: CHANNEL,
	duration: 12,
	thumbnail: "",
	original_lang: "en-US",
	audio: { kind: "dub", lang: "fr-FR", format_id: "139-4", ext: "m4a", auto: true },
	captions: { key: "fr-orig", kind: "asr" }
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

/** A short silent WAV: the drill only needs something decodable. */
function silentWav(seconds: number): Buffer {
	const rate = 8000;
	const n = rate * seconds;
	const buf = Buffer.alloc(44 + n);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + n, 4);
	buf.write("WAVEfmt ", 8);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(rate, 24);
	buf.writeUInt32LE(rate, 28);
	buf.writeUInt16LE(1, 32);
	buf.writeUInt16LE(8, 34);
	buf.write("data", 36);
	buf.writeUInt32LE(n, 40);
	buf.fill(128, 44);
	return buf;
}

async function fakeServer(page: Page): Promise<void> {
	const cors = { "access-control-allow-origin": "*" };
	await page.route(`${SERVER}/v1/**`, async (route) => {
		const url = new URL(route.request().url());
		const json = (body: unknown) => route.fulfill({ headers: cors, json: body });
		switch (url.pathname) {
			case "/v1/channel":
				return json({
					name: "Learner Channel",
					url: CHANNEL,
					videos: [
						{ kind: "video", id: VIDEO, title: info.title, channel: info.channel, channel_url: CHANNEL, duration: 12, thumbnail: "" }
					]
				});
			case "/v1/videos":
				return json([info]);
			case "/v1/fetch":
				return json({ info, audio_mime: "audio/wav", captions: captions(), caption_kind: "asr", storyboard: null });
			case "/v1/audio":
				return route.fulfill({ headers: { ...cors, "content-type": "audio/wav" }, body: silentWav(12) });
			default:
				return route.fulfill({ status: 404, headers: cors, json: { error: "listen-http-404" } });
		}
	});
}

test.beforeEach(async ({ page }) => {
	await fakeServer(page);
	await seedChat(page, [], "fr", {
		listenServer: SERVER,
		listenChannels: [{ url: CHANNEL, name: "Learner Channel" }]
	});
	await page.goto("/");
	await expect(page.locator(".empty-state")).toBeVisible({ timeout: 60_000 });
});

test("a drill runs: guess, next clip at once, reveal, tally", async ({ page }) => {
	await page.getByRole("button", { name: "Listen in French" }).click();
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

	// "?" on an empty composer reveals clip 2 as a skip.
	await box.press("?");
	await expect(clips).toHaveCount(3);
	await expect(clips.nth(1)).toContainText("Revealed");

	// The last guess ends the video: the tally, with the missed clip.
	await box.fill("merci de votre attention");
	await box.press("Enter");
	const end = page.locator(".end");
	await expect(end).toContainText("End of the video");
	await expect(end).toContainText("Nous parlons de la peste.");
	await expect(end.getByRole("button", { name: "Another video" })).toBeVisible();

	// Grading runs behind (the mock's reply isn't JSON): retry offered.
	await expect(clips.first()).toContainText("Try again", { timeout: 15_000 });
});
