import { defineConfig } from "@playwright/test";
// Explicit import (never global `process`): see vite.config.js.
import process from "node:process";

// E2E_PORT isolates parallel checkouts/agents: each suite gets its own dev
// server instead of sharing (and killing) port 5213 via reuseExistingServer.
const PORT = Number(process.env.E2E_PORT ?? 5213);

export default defineConfig({
	testDir: "e2e",
	// Vitest's default include would also grab *.spec.ts, so e2e specs
	// use *.e2e.ts and are invisible to `bun run test`.
	testMatch: "**/*.e2e.ts",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	// Every spec file is independent (seedChat seeds per-test via
	// addInitScript; no spec reads another's localStorage), so files run
	// in parallel. Tests within one file stay serial (one page at a time).
	fullyParallel: true,
	// Half the cores: the suite boots one dev server per shard, and
	// workers beyond ~50% only contend on cold Vite compile (seen as
	// flakes, never signal). A percentage tracks any machine (local
	// 8-core, CI 4-core) without per-host tuning.
	workers: "50%",
	// Sharding across machines/runners: give EVERY shard its own port so
	// two shards never share (and kill) one dev server, e.g.
	//   E2E_PORT=5221 bunx playwright test --shard=1/2
	//   E2E_PORT=5222 bunx playwright test --shard=2/2
	// Parallel checkouts on one box follow the same rule (one E2E_PORT
	// per agent/suite; 5213 stays the default for a lone run).
	// One retry absorbs cold-compile flakes (two workers contending on the
	// first Vite compile can exceed the timeout once, then pass warm).
	// Persistent failures still fail twice, so retries never hide signal.
	retries: 1,
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: "retain-on-failure"
	},
	projects: [
		{ name: "chromium", use: { browserName: "chromium" } },
		// Shell-engine coverage: the Tauri app is WebKit (WKWebView),
		// which fires selectionchange on body swaps where Chromium stays
		// silent — the Annotate menu strand only reproduced there.
		// Scoped to the selection spec (no clipboard perms, which are
		// Chromium-only); everything else stays Chromium-only.
		{
			name: "webkit",
			use: { browserName: "webkit" },
			// Field-typing regressions are WebKit-only (the mouseup
			// caret wipe Chromium never sees); sel-menu stays for its
			// selectionchange coverage.
			testMatch: ["**/sel-menu.e2e.ts", "**/scroll-field.e2e.ts"]
		}
	],
	webServer: {
		command: `bun run dev -- --port ${PORT} --strictPort`,
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
