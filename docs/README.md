# Docs index

Root keeps what every session needs: `README.md` (what the app is),
`AGENTS.md` (how to work here), `TODO.md` (open work).

## Current

- `platforms/` — install, signing, and deploy notes: `mac.md`,
  `windows.md`, `linux.md`, `ios.md` (Simulator CI + Android parity),
  `web-deploy.md`.
- `design/colors.md` — palette rules (pinned by
  `src/routes/color-tokens.test.ts`).
- `design/plugins.md` — Tauri plugin inventory and skipped candidates.
- `design/listening.md` — listening drills: the loop, the yt-dlp
  pipeline, and the clip server for phone and web.
- `investigations/cjkdecomp-eval.md` — license and data verdict behind
  `src/lib/cjkdecomp-subset.generated.ts`.
- `archive/android-native` branch — the pre-Tauri-mobile Kotlin app
  (Sep 29 2026 snapshot). Resurrect with
  `git worktree add ../ccez-llm-android archive/android-native`.

