# Docs index

Root keeps what every session needs: `README.md` (what the app is),
`AGENTS.md` (how to work here), `TODO.md` (open work).

## Current

- `platforms/` — install, signing, and deploy notes: `mac.md`,
  `windows.md`, `linux.md`, `web-deploy.md`.
- `design/colors.md` — palette rules (pinned by
  `src/routes/color-tokens.test.ts`).
- `design/plugins.md` — Tauri plugin inventory and skipped candidates.
- `investigations/cjkdecomp-eval.md` — license and data verdict behind
  `src/lib/cjkdecomp-subset.generated.ts`.
- `archive/android-native` branch — the pre-Tauri-mobile Kotlin app
  (Sep 29 2026 snapshot). Resurrect with
  `git worktree add ../ccez-llm-android archive/android-native`.

## Frozen history (not maintained; may describe code that no longer exists)

`DONE.md`, `design/refactor.md`, `plans/*`,
`investigations/{focus-drop,tap-ghost-artifact,tap-ghost-log}.md`,
`platforms/{android-phone-bugs,android-voice}.md`. Git history keeps all
of these; they are candidates for deletion.
