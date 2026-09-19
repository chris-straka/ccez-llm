/**
 * CJK font-coverage inventory, mirroring the voice-tier inventory.
 * Detection is pure and unit-tested; the live probe needs a browser
 * (`document.fonts.check`) and degrades to "unknown" elsewhere.
 */

/** CJK scripts the app can identify in chat text. */
export type CjkScript = "zh" | "ja" | "ko";

export const CJK_LABEL: Record<CjkScript, string> = {
	zh: "Chinese (Han)",
	ja: "Japanese (kana)",
	ko: "Korean (Hangul)"
};

/** One sample glyph per script that is missing when the font is. */
export const CJK_SAMPLE: Record<CjkScript, string> = {
	zh: "漢",
	ja: "あ",
	ko: "한"
};

const KANA_RE = /[\u3040-\u309F\u30A0-\u30FF]/;

/**
 * CJK scripts present in `text`. Han without kana counts as Chinese
 * (same tie-break as the reading aids); kana forces Japanese; Hangul
 * adds Korean independently. Pure and unit-tested.
 */
export function scriptsInText(text: string): CjkScript[] {
	const scripts: CjkScript[] = [];
	if (KANA_RE.test(text)) scripts.push("ja");
	if (/\p{Script=Han}/u.test(text) && !KANA_RE.test(text)) scripts.push("zh");
	if (/\p{Script=Hangul}/u.test(text)) scripts.push("ko");
	return scripts;
}

export type FontStatus = "ok" | "missing" | "unknown";

/**
 * Probe one script's coverage. `check` is `document.fonts.check`
 * bound by the caller so this stays pure and unit-testable.
 */
export function probeScript(
	script: CjkScript,
	check: (font: string, text: string) => boolean
): FontStatus {
	try {
		return check("16px sans-serif", CJK_SAMPLE[script]) ? "ok" : "missing";
	} catch {
		return "unknown";
	}
}

/** Coverage for a set of scripts through one probe function. */
export function coverageFor(
	scripts: CjkScript[],
	check: (font: string, text: string) => boolean
): Record<CjkScript, FontStatus> {
	return {
		zh: scripts.includes("zh") ? probeScript("zh", check) : "unknown",
		ja: scripts.includes("ja") ? probeScript("ja", check) : "unknown",
		ko: scripts.includes("ko") ? probeScript("ko", check) : "unknown"
	};
}

/**
 * Live probe in the current webview. Outside a browser (SSR, tests)
 * every script reports "unknown" — never a throw, never a pass claim.
 */
export function probeFontCoverage(
	scripts: CjkScript[]
): Record<CjkScript, FontStatus> {
	const fonts =
		typeof document !== "undefined"
			? (
					document as Document & {
						fonts?: { check: (font: string, text: string) => boolean };
					}
				).fonts
			: undefined;
	if (!fonts || typeof fonts.check !== "function") {
		return { zh: "unknown", ja: "unknown", ko: "unknown" };
	}
	const check = fonts.check.bind(fonts);
	return coverageFor(scripts, check);
}

/**
 * Download nudge for scripts reporting "missing" — same pattern as
 * the voice-tier nudge (name the pane, not just "install fonts").
 * Null when nothing is known-missing. Pure and unit-tested.
 */
export function fontNudgeFor(
	status: Record<CjkScript, FontStatus>
): string | null {
	const missing = (Object.keys(status) as CjkScript[]).filter(
		(s) => status[s] === "missing"
	);
	if (missing.length === 0) return null;
	const names = missing.map((s) => CJK_LABEL[s]).join(", ");
	return (
		`Your system may be missing glyphs for ${names}, so those characters ` +
		`can show as boxes. macOS: System Settings → General → Language & Region → ` +
		`add the language to download its fonts. Windows: Settings → Time & language → ` +
		`Language & region → Add a language → install its supplemental fonts. ` +
		`Linux: install fonts-noto-cjk from your package manager.`
	);
}
