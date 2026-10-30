import { test, expect, type Page } from "./fixtures";
import { seedChat, toggleSidebar } from "./helpers";

/**
 * Music chats through the app's backend (`listen_videos`,
 * `listen_song`, `listen_song_audio`, stubbed on a mock shell): the
 * front page's music button turns the empty chat into a player, a
 * pasted YouTube link plays at once on loop, and the chat saves its
 * song.
 */
const ID = "1f583cw0FOk";
const LINK = `https://www.youtube.com/watch?v=${ID}`;
/** A stand-in thumbnail: a soft gradient, so screenshots read. */
const THUMB =
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b2f63"/><stop offset="1" stop-color="#c0573f"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/></svg>'
	);

async function mockMusicShell(page: Page): Promise<void> {
	await page.addInitScript(
		(seed: { id: string; thumb: string }) => {
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
			const video = {
				id: seed.id,
				title: "SUM-80 (OST Sumathi Theme)",
				channel: "Thalapathy Krrish Music",
				channel_url: "",
				duration: 78,
				thumbnail: seed.thumb,
				original_lang: null,
				audio: null,
				captions: null
			};
			const shell = {
				invoke: async (cmd: string): Promise<unknown> => {
					if (cmd === "listen_videos") return [video];
					if (cmd === "listen_search")
						return [{ kind: "video", ...video, channel_url: "" }];
					if (cmd === "listen_song") return "audio/wav";
					if (cmd === "listen_song_audio") return silentWav(12);
					if (cmd === "listen_video") throw new Error("listen-no-video");
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
		{ id: ID, thumb: THUMB }
	);
}

test("the music button makes the chat a player that loops a pasted link", async ({
	page
}) => {
	await seedChat(page, []);
	await mockMusicShell(page);
	await page.goto("/");
	const music = page.getByRole("tab", { name: "Music" });
	await expect(music).toBeVisible({ timeout: 60_000 });
	await music.click();
	const box = page.getByRole("searchbox", { name: "Find a song" });
	await expect(box).toBeVisible();
	await box.fill(LINK);
	await box.press("Enter");
	const player = page.locator(".music .player");
	await expect(player.locator(".title")).toHaveText(
		"SUM-80 (OST Sumathi Theme)"
	);
	await expect(
		player.getByRole("button", { name: "Pause" }).last()
	).toBeVisible();
	await expect(player.getByRole("button", { name: "Loop" })).toHaveAttribute(
		"aria-pressed",
		"true"
	);
	// The full player stands in for the top bar.
	await expect(page.locator(".music-bar")).toHaveCount(0);
	await expect
		.poll(() => player.locator(".clock").first().textContent())
		.not.toBe("0:00");
	// The chat is saved as a music chat with its song (the seed
	// re-runs on reload, so the store is read directly).
	const saved = await page.evaluate(
		() =>
			JSON.parse(localStorage.getItem("ccez-llm-chats-v1") ?? "[]") as {
				music?: { song: { id: string } | null };
			}[]
	);
	expect(saved[0]?.music?.song?.id).toBe("1f583cw0FOk");
});

test("the bar shows the song in other chats and its title goes back to the player", async ({
	page
}) => {
	await seedChat(page, []);
	await mockMusicShell(page);
	await page.goto("/");
	await page.getByRole("tab", { name: "Music" }).click({ timeout: 60_000 });
	const box = page.getByRole("searchbox", { name: "Find a song" });
	await box.fill(LINK);
	await box.press("Enter");
	await expect(page.locator(".music .player .title")).toBeVisible();
	await page.keyboard.press("Meta+KeyN");
	const bar = page.locator(".music-bar");
	await expect(bar).toBeVisible();
	await expect(page.locator(".music .player")).toHaveCount(0);
	await bar.getByRole("button", { name: /Open .*'s chat/ }).click();
	await expect(page.locator(".music .player .title")).toHaveText(
		"SUM-80 (OST Sumathi Theme)"
	);
	await expect(bar).toHaveCount(0);
});

test("deleting the music chat stops its song and takes the bar away", async ({
	page
}) => {
	await seedChat(page, []);
	await mockMusicShell(page);
	await page.goto("/");
	await page.getByRole("tab", { name: "Music" }).click({ timeout: 60_000 });
	const box = page.getByRole("searchbox", { name: "Find a song" });
	await box.fill(LINK);
	await box.press("Enter");
	await expect(page.locator(".music .player .title")).toBeVisible();
	await page.keyboard.press("Meta+KeyN");
	await expect(page.locator(".music-bar")).toBeVisible();
	await toggleSidebar(page);
	const sidebar = page.locator("aside").first();
	await expect(sidebar).not.toHaveClass(/collapsed/);
	// The music chat is the first row (the new one sits below it).
	const row = sidebar.locator('[data-chat-id="e2e-chat"]');
	await row.hover();
	await row
		.locator("..")
		.locator('button[aria-label="Delete chat"]')
		.first()
		.click();
	await expect(page.locator(".music-bar")).toHaveCount(0);
	const saved = await page.evaluate(
		() =>
			JSON.parse(localStorage.getItem("ccez-llm-music-v1") ?? "{}") as {
				song?: unknown;
			}
	);
	expect(saved.song).toBeNull();
});
