import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Shell fullscreen pin: toggleFullscreen in +page.svelte drives the
 * Tauri window through getCurrentWindow().isFullscreen() /
 * setFullscreen(), and Tauri 2 gates every window command behind an
 * explicit capability permission. A trimmed capability list once made
 * the fullscreen chord (Ctrl+Cmd+F) die with zero feedback, while
 * the browser path kept passing — so this pins the shell path's
 * permissions here.
 */
function capabilities(): { permissions: string[] } {
	const raw = readFileSync(
		new URL("../../src-tauri/capabilities/default.json", import.meta.url),
		"utf8"
	);
	return JSON.parse(raw) as { permissions: string[] };
}

describe("tauri capabilities", () => {
	it("grants the window fullscreen getter and setter", () => {
		const { permissions } = capabilities();
		expect(permissions).toContain("core:window:allow-is-fullscreen");
		expect(permissions).toContain("core:window:allow-set-fullscreen");
	});
});
