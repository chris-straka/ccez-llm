// Read and change the app's settings from a terminal. The desktop app
// mirrors its settings to settings.json in its data folder (keys
// blanked) and applies an edit there within a second, or on its next
// launch when it is closed (src-tauri/src/settings_file.rs).
// Usage:
//   bun scripts/settings.ts [--dev] get [key]       whole file, or one value
//   bun scripts/settings.ts [--dev] set <key> <value>
// Keys take dots for nesting (providers.openai.model). A value is read
// as JSON when it parses (true, 1.5, "x", [..]) and as text otherwise;
// it must keep the type the setting has. --dev targets "Ccez LLM Dev".
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const [cmd, key, ...rest] = args.filter((a) => a !== "--dev");
const id = dev ? "studio.ccez.app.dev" : "studio.ccez.app";

function dataDir(): string {
	if (platform() === "darwin")
		return join(homedir(), "Library", "Application Support", id);
	if (platform() === "win32")
		return join(
			process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
			id
		);
	return join(
		process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
		id
	);
}

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

const file = join(dataDir(), "settings.json");
if (!existsSync(file))
	fail(`No ${file} yet: open the app once (a build with the settings file).`);
const settings = JSON.parse(readFileSync(file, "utf8")) as Record<
	string,
	unknown
>;

/** The object holding a dotted key's last part, and that part. */
function locate(path: string): [Record<string, unknown>, string] {
	const parts = path.split(".");
	const last = parts.pop()!;
	let at: unknown = settings;
	for (const p of parts) {
		at = (at as Record<string, unknown> | undefined)?.[p];
		if (!at || typeof at !== "object") fail(`No setting ${path}`);
	}
	const holder = at as Record<string, unknown>;
	if (!(last in holder)) fail(`No setting ${path}`);
	return [holder, last];
}

function kind(v: unknown): string {
	return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}

if (cmd === "get") {
	const value = key ? locate(key)[0][locate(key)[1]] : settings;
	console.log(
		typeof value === "string" ? value : JSON.stringify(value, null, "\t")
	);
} else if (cmd === "set" && key && rest.length > 0) {
	const text = rest.join(" ");
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		value = text;
	}
	const [holder, last] = locate(key);
	const before = holder[last];
	// A text setting takes the text as typed ("4" stays "4").
	if (typeof before === "string") value = text;
	if (before !== null && kind(before) !== kind(value))
		fail(`${key} is a ${kind(before)}, not a ${kind(value)}`);
	holder[last] = value;
	const tmp = `${file}.cli.tmp`;
	writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
	renameSync(tmp, file);
	console.log(`${key}: ${JSON.stringify(before)} → ${JSON.stringify(value)}`);
} else {
	fail("usage: bun scripts/settings.ts [--dev] get [key] | set <key> <value>");
}
