import { parseSettings, type AppSettings } from "./settings";

/**
 * Settings from the command line: the app mirrors its settings to
 * settings.json (keys blanked) and applies edits made there
 * (`scripts/settings.ts`, `settings_file.rs`). Pure.
 */

/** Launch-only state: every launch resets it, so a file still holding
 * the last run's value is never an edit. */
const LAUNCH_ONLY = ["voice", "sidebarCollapsed"] as const;

/** The settings as written to the file: keys blank, never on disk. */
export function settingsForFile(settings: AppSettings): string {
	const providers: AppSettings["providers"] = {};
	for (const [id, conf] of Object.entries(settings.providers))
		providers[id] = { ...conf, apiKey: "" };
	return JSON.stringify({ ...settings, providers });
}

/** JSON with object keys sorted, so key order never reads as a change. */
function stable(value: unknown): string {
	return JSON.stringify(value, (_key, v: unknown) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
						a.localeCompare(b)
					)
				)
			: v
	);
}

/**
 * The settings fields a file edit changes, checked and clamped like a
 * stored copy (loadSettings), or null when the file says nothing new
 * or isn't settings. Live keys and launch-only state stay as they are.
 */
export function settingsFileEdit(
	raw: string,
	live: AppSettings
): Partial<AppSettings> | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		return null;
	const next = parseSettings(raw);
	for (const [id, conf] of Object.entries(next.providers))
		next.providers[id] = { ...conf, apiKey: live.providers[id]?.apiKey ?? "" };
	const changed: Record<string, unknown> = {};
	const liveRecord = live as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(next)) {
		if ((LAUNCH_ONLY as readonly string[]).includes(key)) continue;
		if (stable(value) !== stable(liveRecord[key])) changed[key] = value;
	}
	return Object.keys(changed).length > 0 ? changed : null;
}
