/**
 * Build and open the debug app bundle `scripts/drive.ts` drives: a
 * separate "Ccez LLM Dev" app (its own identifier, so its own data and
 * WebKit store, never the installed app's chats or keys), with no
 * link scheme (the installed app keeps ccez-llm:// links) and no
 * updater (it never replaces itself with a release). `open -g` starts
 * it behind the front app, so it never takes focus.
 *
 *   bun scripts/drive-app.ts          build if needed, then open
 *   bun scripts/drive-app.ts --build  rebuild first
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const APP = "src-tauri/target/debug/bundle/macos/Ccez LLM Dev.app";
const config = {
	identifier: "studio.ccez.app.dev",
	productName: "Ccez LLM Dev",
	// No signed update files: this copy never updates.
	bundle: { createUpdaterArtifacts: false },
	plugins: {
		"deep-link": { desktop: { schemes: [] }, mobile: [] },
		updater: { active: false }
	}
};

if (process.argv.includes("--build") || !existsSync(APP))
	execFileSync(
		"bunx",
		[
			"tauri",
			"build",
			"--debug",
			"--bundles",
			"app",
			"--config",
			JSON.stringify(config)
		],
		{ stdio: "inherit" }
	);
// Opening a running app sends it a reopen, which brings its window
// forward (focus_main): never open it twice.
let running = false;
try {
	running =
		execFileSync("pgrep", ["-f", `${APP}/Contents/MacOS/`], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"]
		}).trim() !== "";
} catch {
	// pgrep exits 1 when nothing matches: not running.
}
if (running) {
	console.log("Ccez LLM Dev is already running; quit it first to relaunch");
	process.exit(0);
}
execFileSync("open", ["-g", APP], { stdio: "inherit" });
console.log(
	`opened ${APP} in the background; drive it with bun scripts/drive.ts`
);
