# Ccez LLM — agent handoff

Tauri 2 + Svelte 5 (runes) + TypeScript desktop chatbot (macOS). BYOK chat with
language-learner aids. Frontend owns UI/state; Rust backend is thin and
privileged (Keychain, updater, native TTS).

## Commands

- `bun run dev` — browser-only preview at http://127.0.0.1:5200/ (no Tauri APIs;
  everything must degrade cleanly here).
- `bun run tauri dev` — full shell: Vite on :1420 + Rust backend + app window.
  Use this when touching `src-tauri/` or Tauri invokes. First build compiles
  ~400 crates; be patient.
- Dev Keychain (macOS): unsigned relinks get a fresh code identity, so the
  shell re-prompts once per Keychain item on every backend rebuild — and
  no watcher can close that race (the app hits the Keychain before any
  poll re-signs). `scripts/tauri-dev.sh` is the only supported launch:
  it builds first, signs the fresh binary with the persistent local
  self-signed "Ccez Dev" cert (login keychain, dev machine only, never
  committed), then runs with `--no-watch` so no mid-session rebuild
  disturbs the identity. Rust edits need Ctrl-C plus relaunch. Click
  Always Allow, never Allow (Allow is single-use and repeats every
  launch). Deny never sticks — each new access re-prompts, so
  deny-clicking loops forever; quit the app instead and Always Allow
  on relaunch (2 items: `provider:muse`, `providers`). Re-minting the
  "Ccez Dev" keypair voids old grants (same name, new identity), so
  never re-mint once grants exist. `scripts/sign-dev-binary.sh`
  remains for manual use.
- MCP driver sessions (see the running app like the user does):
  `tauri-plugin-mcp-bridge` is debug-only and localhost-bound, so it
  never ships — but it only loads after a dev-shell relaunch. Attach
  with a driver `start`, verify with `status`, `stop` when done.
- `bun run test` — Vitest, colocated `*.test.ts`. Safe anytime.
- Spec-only changes (`e2e/`, `*.test.ts`) never touch the running app:
  no restart, reload, or rerun needed — say so instead of implying one.
- `bun run check` / `lint` / `build` — run `svelte-kit sync` and/or invalidate
  HMR. Per owner instruction (Sep 2026): run these whenever needed, dev
  servers or not — no idle batching.

## Verification economy (slow gates, run once)

- Unit: run only the touched `*.test.ts` while iterating; full `bun run test`
  once at the end.
- `check`: once at the end, not after every edit.
- Playwright: one invocation per file with combined `-g` patterns for every
  new/affected test in it, then the full file once at the end. Never one
  single-test invocation after another — each pays the dev-server wait again.
  Batch across files too (multiple files in one invocation, separate ports
  only for parallel runs): every fresh browser launch risks a login-keychain
  password prompt for the user, so launches are budgeted — no probe specs,
  no re-runs to "just look", no parallel same-file runs. When prompts are
  already firing, stop launching entirely and say so.
- Read failure output from that same run (list reporter prints the error);
  don't re-run just to collect details.
- Pristine-tree attribution (`git stash` + rerun) only when a failure
  plausibly relates to the change and blocks; no throwaway debug specs when
  reasoning plus one targeted run can answer it.

## Architecture rules (learned the hard way)

- Chat state is a plain object in `$state` with function updates
  (`src/lib/chat.ts`). Class instances in `$state` never re-render — do not use
  them for UI state.
- Never mutate a message object in place: Svelte proxy signals capture values
  on first read, so streaming updates must replace (`map` + local accumulator).
- Keyboard shortcuts need a capture-phase listener — CodeMirror swallows combos
  (see the `event.code` guards; ⌥R once produced `®`).
- Reads that must subscribe need a synchronous read inside the render effect;
  async-only reads never subscribe (annotation badge marks).
- Every Tauri call must work in three runtimes: Tauri shell, plain browser dev,
  and jsdom tests. Guard with `tauriBackendAvailable()` (see `src/lib/secrets.ts`)
  or try/catch with a local fallback. Never let `invoke` throw into UI teardown.
- Voice has two engines behind one callback contract (`SpeakCallbacks` in
  `src/lib/voice.ts`): web `speechSynthesis` and native `AVSpeechSynthesizer`
  (`src/lib/nativeTts.ts` + `src-tauri/src/tts.rs`, macOS-only, `#[cfg]`-gated
  with stubs elsewhere). Progress returns as `tts-word` / `tts-done` window
  events tagged with a per-utterance id — always check the id, stale cancels
  must not reset newer speech.
- Apple frameworks from Rust go through `objc2` generated bindings only. No
  Objective-C (`.m`), no Swift sidecar: both were evaluated and rejected (same
  engine underneath, worse bundling/signing story). See `src-tauri/src/tts.rs`.
- There is no API that downloads Apple voices. The app picks the best
  _installed_ voice per locale and deep-links System Settings to the
  Accessibility pane
  (`x-apple.systempreferences:com.apple.preference.universalaccess`)
  for the rest — sub-anchors are swallowed by System Settings, so UI copy
  must always print the in-pane path. Premium quality requires voices
  downloaded in Accessibility → Read & Speak → System Voice → Manage
  Voices ("Spoken Content" was the pre-26 name).
- Installed-voice inventory is `AVSpeechSynthesisVoice.speechVoices()`, a
  system registry — not a folder scan. There is no user-visible voice
  directory to display.

## Source control

Standing authorization: commit and push as you go, without waiting
for review — the user has granted this once for all future turns.
Each finished unit of work gets its own commit the moment its gates
are green, pushed straight to `origin/main` in the same motion; never
batch unrelated work into one commit and never sit on green work.
Scope is commit + push only:
never amend, rebase, force-push, tag, or cut a release without an
explicit ask in that turn. Name committed files explicitly, never
`git add -A`. One shared local checkout: a commit is already on the
user's disk, so never say "pull" — report it as in place.
Credentials: the user hates typing passwords — git must never prompt
interactively. The remote stays HTTPS authed through the `gh` token
(`gh auth setup-git`, osxkeychain-backed). If a push would prompt,
stop and report instead of asking for a password.
Automation browsers must never touch the login keychain either:
Playwright Chromium launches with `--use-mock-keychain` (see
`playwright.config.ts`; same flag for any `/tmp` browser probe),
or every fresh profile pops a password prompt per launch. The
bundled Chromium builds are ad-hoc-signed, so Always Allow can
never stick to them — spamming it does nothing; Deny re-prompts
forever. Prompts from `playwright-mcp` servers mean those servers
launched without the flag (stale ones get stopped, not clicked
through). The only prompt-proof browser is a Google-signed one
(system Chrome channel), which holds an Always Allow grant.

## Conventions

- Settings: `src/lib/settings.ts` (`defaultSettings`, `saveSettings`); secrets
  go to Keychain via `src/lib/secrets.ts`, never into persisted settings.
- Types are load-bearing compiler feedback, not decoration: `strict` plus
  `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (every index and
  optional is guilty until proven defined), type-aware `recommendedTypeChecked`
  lint (`no-floating-promises` enforces the `void`-your-promises convention),
  and branded ids (`ChatId` / `ChatMsgId` / `AnnotationId` in `chat.ts` /
  `annotations.ts`) so a chat id can never be passed as a message id. Zod was
  evaluated and rejected (runtime errors, not compiler feedback; boundaries
  already narrow by hand). TS stays at v6 until `svelte-check` peers allow v7.
- `@types/node` is install-but-never-global (`tsconfig` `types: []`): tooling
  imports it explicitly from `node:*`. Frontend code must never see a global
  `process` — it doesn't exist in the webview.
- Dev-only macOS icon fix lives in `src-tauri/src/dev_icon.rs`
  (`#[cfg(all(target_os = "macos", debug_assertions))]`): `tauri dev` runs
  unbundled, so the switcher tile comes from raw `.icns` bytes reporting
  512pt — the watcher swaps a 128pt tile after Tauri's own lands. Release
  bundles are unaffected (IconServices picks the right rep).
- Tests live next to code (`foo.test.ts`); pure logic must be importable without
  Tauri or DOM (extract `sentenceAtOffset`-style pure helpers to test them).
- Two runners, no more: colocated Vitest (`bun run test`) and Playwright
  (`bun run test:e2e`, specs in `e2e/*.e2e.ts`, seeded via `e2e/helpers.ts`,
  invisible to Vitest by extension). No Testing Library, no other frameworks.
- Vitest environment is node by default; files needing DOM opt in with a
  `// @vitest-environment jsdom` first line. What jsdom can't see (layout,
  layers), assert on source instead (see `actions-reveal.test.ts`, which
  reads `+page.svelte`'s `<style>`).
- Agent-captured verification screenshots go in `.screenshots/` (gitignored),
  never the repo root.
- UI copy: plain prose, no emojis. Enter sends, Shift+Enter newline.
- Shortcuts menu (`desktopShortcuts()` in `src/routes/+page.svelte`): entries
  stay pithy, `dd` copy never carries parentheses (pinned by
  `e2e/shortcuts-modal.e2e.ts`). These rows were deliberately removed —
  do not re-add them: New line, Stage message, Scroll messages, Export
  chat, Translate selection, and the `· Enter cycles · repeat closes ·
1 hit closes bare`, `· past newest mints one`, `· again stops`
  trailers. Phones show no `h2` (the filter owns the head row).
- Spec history: `README.md` (what), `PLAN.md` (full plan), `TODO.md` (open
  work only — finished stages move to `DONE.md`, never deleted).

## Environment (user's machine)

- macOS 26.6.2 (build 25G83). System Settings → Accessibility has NO
  "Spoken Content" entry — the Vision section lists "Read & Speak"
  instead, and downloadable voices live under Read & Speak → System
  Voice → Manage Voices. Speech → Live Speech is type-to-speak, NOT
  where voices download. Never write "Spoken Content" in UI copy.
- CJK TTS voices are installed on this machine (`say -v '?'` lists
  Eddy/Flo for zh_CN, zh_TW, ja_JP, ko_KR): multilingual read-aloud
  is verifiable locally, and missing-voice failures elsewhere are
  the device's gap, not the app's.

## Known structural debt

- `src/routes/+page.svelte` markup is decomposed (13 components own
  their markup/CSS; page owns state/behavior/wiring, ~13.5k lines).
  Script-level decomposition follows the `keybindings.ts` pattern:
  pure decisions over explicit facts snapshots in lib (unit-tested),
  state and effects stay in the component.
  The `onKey` dispatcher is being hollowed out branch by branch into
  `src/lib/keybindings.ts`: decisions are pure functions over an explicit
  facts snapshot (unit-tested, priority encoded inside), effects stay in the
  component. New dispatcher branches follow that split — no new untested
  guard soup in `onKey`. Testing Library stays deferred:
  test pure logic and bridge contracts with colocated Vitest instead.
