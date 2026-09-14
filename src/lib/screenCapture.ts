/**
 * Screen capture intake: one screen frame into the attachments path.
 *
 * Split out of `intake.ts` (REFACTOR §6): `screenshotCaptureAvailable`
 * gates the UI, `captureScreenToFile` orchestrates with everything
 * injected (unit-tested in node), and only `grabVideoFrame` needs a
 * live browser (video + canvas). Dismissals propagate — callers stay
 * silent via `isPermissionDismissal` from `./intake`.
 */
/** Minimal stream shape: only the tracks we must stop after capture. */
export interface ScreenStreamLike {
	getVideoTracks(): { stop(): void }[];
}

/** True when screen capture can work in this runtime. */
export function screenshotCaptureAvailable(): boolean {
	try {
		const media = (navigator as Navigator & {
			mediaDevices?: { getDisplayMedia?: unknown };
		}).mediaDevices;
		return typeof media?.getDisplayMedia === "function";
	} catch {
		return false;
	}
}

/**
 * Capture one screen frame into a PNG File for the attachments path.
 * Tracks stop in `finally`, so a grab failure never leaves the
 * OS capture indicator on. Platform dismissals (Abort/NotAllowed)
 * propagate — callers stay silent via `isPermissionDismissal`.
 */
export async function captureScreenToFile<S extends ScreenStreamLike>(
	getDisplayMedia: (constraints: { video: boolean; audio: boolean }) => Promise<S>,
	grabFrame: (stream: S) => Promise<Blob>
): Promise<File> {
	const stream = await getDisplayMedia({ video: true, audio: false });
	try {
		const blob = await grabFrame(stream);
		return new File([blob], "screenshot.png", { type: blob.type || "image/png" });
	} finally {
		for (const track of stream.getVideoTracks()) {
			try {
				track.stop();
			} catch {
				// One stuck track must not break cleanup of the rest.
			}
		}
	}
}

/**
 * Real frame grabber: draws the live capture stream's first frame to
 * a canvas and resolves a PNG blob. Browser-only (needs video +
 * canvas); rejected grabs propagate to the caller.
 */
export function grabVideoFrame(stream: MediaStream): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.muted = true;
		const done = (error?: unknown): void => {
			video.srcObject = null;
			video.remove();
			if (error !== undefined) {
				reject(
					error instanceof Error ? error : new Error("Couldn't capture that frame.")
				);
			}
		};
		video.onloadeddata = () => {
			video.play().catch((error: unknown) => done(error));
		};
		video.onplaying = () => {
			try {
				const canvas = document.createElement("canvas");
				canvas.width = Math.max(1, video.videoWidth);
				canvas.height = Math.max(1, video.videoHeight);
				const ctx = canvas.getContext("2d");
				if (!ctx) {
					done(new Error("Canvas 2D unavailable"));
					return;
				}
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
				video.pause();
				canvas.toBlob((blob) => {
					if (blob) resolve(blob);
					else done(new Error("Couldn't capture that frame."));
				}, "image/png");
			} catch (error) {
				done(error);
			}
		};
		video.onerror = () => done(new Error("Couldn't read the capture stream."));
		video.srcObject = stream;
	});
}
