import { describe, it, expect, vi } from "vitest";
import { captureScreenToFile, type ScreenStreamLike } from "./screenCapture";

describe("captureScreenToFile", () => {
	function stream(stops: number[] = []): ScreenStreamLike {
		return { getVideoTracks: () => [{ stop: () => void stops.push(1) }] };
	}

	it("wraps the grabbed frame as a screenshot file and stops tracks", async () => {
		const stops: number[] = [];
		const getDisplayMedia = vi.fn(async () => stream(stops));
		const grabFrame = vi.fn(
			async () => new Blob(["frame"], { type: "image/png" })
		);
		const file = await captureScreenToFile(getDisplayMedia, grabFrame);
		expect(file).toBeInstanceOf(File);
		expect(file.name).toBe("screenshot.png");
		expect(file.type).toBe("image/png");
		expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false });
		expect(grabFrame).toHaveBeenCalledOnce();
		expect(stops).toHaveLength(1);
	});

	it("still stops tracks when the grab fails, then rethrows", async () => {
		const stops: number[] = [];
		const getDisplayMedia = vi.fn(async () => stream(stops));
		const grabFrame = vi.fn(async () => {
			throw new Error("no frame");
		});
		await expect(
			captureScreenToFile(getDisplayMedia, grabFrame)
		).rejects.toThrow("no frame");
		expect(stops).toHaveLength(1);
	});

	it("propagates permission dismissals for the caller to swallow", async () => {
		const denied = new DOMException("denied", "NotAllowedError");
		await expect(
			captureScreenToFile(
				vi.fn(async () => {
					throw denied;
				}),
				vi.fn()
			)
		).rejects.toBe(denied);
	});
});
