# Docs index

Root keeps only what every session needs: `README.md` (what the app is),
`AGENTS.md` (how to work here), `TODO.md` (open work). Everything else
lives here, by kind.

- `DONE.md` — archive of finished stages (moved out of `TODO.md`, never
  deleted). Paths inside are as written at the time.
- `platforms/` — per-OS install, signing, and device notes: `mac.md`,
  `windows.md`, `linux.md`, `web-deploy.md`, `android-voice.md`,
  `android-phone-bugs.md`.
- `design/` — standing decisions with their reasons: `colors.md` (palette
  rules, pinned by `src/routes/color-tokens.test.ts`), `plugins.md` (Tauri
  plugin inventory), `refactor.md` (extraction history and candidates).
- `investigations/` — case files for hard bugs and evaluations:
  `tap-ghost-artifact.md` + `tap-ghost-log.md` (Android paint ghost),
  `focus-drop.md` (closed 2026-10-01: desktop focus drops fixed,
  owner-verified gone on Mac, probe removed), `cjkdecomp-eval.md`.
- `plans/` — dated plans of record. Finished plans stay as history.
