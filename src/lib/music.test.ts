// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MusicPlayer, youtubeVideoId, type Song } from "./music.svelte";
import type { ListenBackend } from "./listenBackend";

const SONG: Song = {
	id: "1f583cw0FOk",
	title: "Une chanson",
	channel: "Quelqu'un",
	thumbnail: ""
};

function backend(more: Partial<ListenBackend> = {}): ListenBackend {
	const never = () => new Promise<never>(() => {});
	return {
		search: never,
		channel: never,
		videos: never,
		fetch: never,
		audio: never,
		envelope: never,
		video: never,
		heard: never,
		song: () => Promise.resolve("audio/mp4"),
		songAudio: () => Promise.resolve(new ArrayBuffer(8)),
		...more
	};
}

describe("youtubeVideoId", () => {
	it("reads the id out of every kind of YouTube link", () => {
		for (const link of [
			"https://www.youtube.com/watch?v=1f583cw0FOk",
			"youtube.com/watch?v=1f583cw0FOk&list=RD1f583cw0FOk",
			"https://youtu.be/1f583cw0FOk?si=abc",
			"https://m.youtube.com/watch?v=1f583cw0FOk",
			"https://music.youtube.com/watch?v=1f583cw0FOk",
			"https://www.youtube.com/shorts/1f583cw0FOk",
			"https://www.youtube.com/embed/1f583cw0FOk",
			"1f583cw0FOk"
		])
			expect(youtubeVideoId(link), link).toBe("1f583cw0FOk");
	});

	it("leaves searches and other sites alone", () => {
		expect(youtubeVideoId("chanson française")).toBeNull();
		expect(youtubeVideoId("https://vimeo.com/watch?v=1f583cw0FOk")).toBeNull();
		expect(youtubeVideoId("https://www.youtube.com/@channel")).toBeNull();
	});
});

describe("MusicPlayer", () => {
	beforeEach(() => {
		localStorage.clear();
		URL.createObjectURL = vi.fn(() => "blob:song");
		URL.revokeObjectURL = vi.fn();
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
	});

	it("plays a song on loop and remembers it, paused, for next time", async () => {
		const player = new MusicPlayer();
		player.connect(() => backend());
		await player.play(SONG);
		expect(player.status).toBe("playing");
		expect(player.loop).toBe(true);
		const next = new MusicPlayer();
		expect(next.song).toEqual(SONG);
		expect(next.status).toBe("paused");
		expect(next.loop).toBe(true);
	});

	it("keeps the loop choice and forgets a stopped song", async () => {
		const player = new MusicPlayer();
		player.connect(() => backend());
		await player.play(SONG);
		player.setLoop(false);
		expect(new MusicPlayer().loop).toBe(false);
		player.close();
		expect(player.song).toBeNull();
		expect(new MusicPlayer().song).toBeNull();
	});

	it("says why a song can't play", async () => {
		const web = new MusicPlayer();
		await web.play(SONG);
		expect(web.status).toBe("error");
		expect(web.error).toBe("Listening runs in the app, on your Mac or phone.");
		const app = new MusicPlayer();
		app.connect(() =>
			backend({ song: () => Promise.reject(new Error("listen-no-track")) })
		);
		await app.play(SONG);
		expect(app.error).toBe("That video has no sound to play.");
	});

	it("a newer pick wins over a song still loading", async () => {
		let land: () => void = () => {};
		const player = new MusicPlayer();
		player.connect(() =>
			backend({
				song: (id) =>
					id === SONG.id
						? new Promise((resolve) => {
								land = () => resolve("audio/mp4");
							})
						: Promise.resolve("audio/mp4")
			})
		);
		const first = player.play(SONG);
		const other = { ...SONG, id: "abcdefghijk", title: "Autre" };
		await player.play(other);
		land();
		await first;
		expect(player.song?.title).toBe("Autre");
		expect(player.status).toBe("playing");
	});
});
