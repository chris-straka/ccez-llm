import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * The foreground-service notice is title-only ("Reply coming…"): the
 * body line was explicitly unwanted, so this pins its absence in
 * TurnSvc. Asserts on source: the notice only exists on hardware
 * (release service plus the shade).
 */
function turnSvc(): string {
	return readFileSync(
		new URL(
			"../../src-tauri/gen/android/app/src/main/java/studio/ccez/app/TurnSvc.kt",
			import.meta.url
		),
		"utf8"
	);
}

describe("android turn notice", () => {
	it("keeps the title and carries no body text", () => {
		const source = turnSvc();
		expect(source).toContain("Reply coming…");
		expect(source).not.toContain("setContentText");
	});
});

/**
 * Leaving the app mid-turn is silent: the shade notice already says
 * the reply keeps working and the ready ping owns the background, so
 * the visibility handler carries no haptic on the way out. Asserts
 * on source: backgrounding only exists on hardware.
 */
function onVisibleBody(): string {
	const source = readFileSync(new URL("../routes/+page.svelte", import.meta.url), "utf8");
	const start = source.indexOf("const onVisible");
	expect(start).toBeGreaterThan(-1);
	const end = source.indexOf("\n\t\t};", start);
	expect(end).toBeGreaterThan(start);
	return source.slice(start, end);
}

describe("android reply ping", () => {
	it("stays title-only with no body text", () => {
		const source = readFileSync(
			new URL("../../src-tauri/src/turn.rs", import.meta.url),
			"utf8"
		);
		expect(source).toContain('.title("Reply ready")');
		expect(source).not.toContain("finished while you were away");
	});
});

describe("android notice tap", () => {
	it("retargets a content intent at the claiming turn's chat", () => {
		const source = turnSvc();
		expect(source).toContain("setContentIntent");
		expect(source).toContain("OPEN_CHAT_ACTION");
		expect(source).toContain("OPEN_CHAT_EXTRA");
		expect(source).toContain("FLAG_IMMUTABLE");
	});
});

describe("android service observability", () => {
	it("logs every claim, post, and failure instead of swallowing", () => {
		const source = turnSvc();
		expect(source).toContain("CcezTurns");
		expect(source).toContain("notice posted");
		expect(source).toContain("keeperStart failed");
		expect(source).toContain("keeperStop failed");
		expect(source).toContain("notice post failed");
	});
});

describe("android background silence", () => {
	it("returns from the hidden branch with no haptic", () => {
		const body = onVisibleBody();
		expect(body).toContain('if (document.visibilityState !== "visible") return;');
		expect(body).not.toContain("hapticBeatAsync");
		expect(body).not.toContain("buzzBeat");
		expect(body).not.toContain("buzzTap");
	});
});
