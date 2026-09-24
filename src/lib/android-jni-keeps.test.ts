import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Release-only JNI keeps: every Rust bridge resolves its Kotlin
 * methods by exact name at runtime, invisible to R8's reference
 * graph, and release minification is on (debug is not). The missing
 * "Reply coming…" notice, the turn-settle NoSuchMethodError app kill,
 * and the fail-soft on-device probe that kept listing ML Kit on
 * unsupported hardware all traced to keeps that named
 * Tts/Secrets/Dictation but not TurnSvc/OnDevice/Update — green
 * everywhere except the release build on hardware. This pins each
 * bridge's keep alongside the Rust call site that needs it, so a
 * future bridge (or a dropped keep) fails here instead.
 */
const BRIDGES = [
	{ rs: "tts_android.rs", kt: "Tts" },
	{ rs: "secrets_android.rs", kt: "Secrets" },
	{ rs: "dictation.rs", kt: "Dictation" },
	{ rs: "turn_service.rs", kt: "TurnSvc" },
	{ rs: "ondevice.rs", kt: "OnDevice" },
	{ rs: "update_android.rs", kt: "Update" }
] as const;

function proguardRules(): string {
	return readFileSync(
		new URL(
			"../../src-tauri/gen/android/app/proguard-rules.pro",
			import.meta.url
		),
		"utf8"
	);
}

function rustBridge(name: string): string {
	return readFileSync(
		new URL(`../../src-tauri/src/${name}`, import.meta.url),
		"utf8"
	);
}

describe("android JNI keeps", () => {
	it("keeps every Kotlin bridge object Rust reaches by name", () => {
		const rules = proguardRules();
		for (const { rs, kt } of BRIDGES) {
			// The call site resolves this exact class at runtime
			// (loadClass in nativeInit), so the keep below is load-bearing.
			expect(
				rustBridge(rs),
				`${rs} no longer names studio.ccez.app.${kt}`
			).toContain(`studio.ccez.app.${kt}`);
			expect(
				rules,
				`missing -keep for studio.ccez.app.${kt} (called from ${rs})`
			).toMatch(
				new RegExp(`-keep class studio\\.ccez\\.app\\.${kt} \\{`)
			);
		}
	});
});
