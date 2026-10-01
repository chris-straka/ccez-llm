# Ccez LLM — agent handoff

Tauri 2 + Svelte 5 (runes) + TypeScript BYOK chatbot with language-learner
aids. Desktop (macOS primary, Windows/Linux) plus Android from the same
codebase. The frontend owns UI and state; the Rust backend is thin and
privileged (Keychain, updater, native TTS/OCR/dictation, page fetch,
background turns).

## Repo map

- `src/routes/+page.svelte` — the app: state, effects, wiring (~13k lines
  of script; markup lives in components). See "Structural debt".
- `src/lib/components/` — markup + CSS for each surface (Composer,
  ThreadView, MessageArticle, NewsPanel, settings panels, …).
- `src/lib/*.ts` — pure, unit-tested logic, one concern per module:
  `chat.ts` (chat state + branded ids), `settings.ts`, `keybindings.ts`
  (key decisions), `annotations*.ts`, `reading.ts` / `furigana*.ts` /
  `pinyin.ts` (reading aids), `voice.ts` + `nativeTts.ts` (speech),
  `news.ts` (news feed), `tools.ts` + `fetchPage.ts` (model web lookup),
  `providers/` (OpenAI-compatible streaming + tool loop), `native*.ts`
  (Tauri bridges).
- `src-tauri/src/` — Rust commands. `turn.rs` runs the same turn loop
  natively (Android background turns) and must mirror the TypeScript
  provider; `page_text.rs` mirrors the `tools.ts` cleaners for it.
- `e2e/*.e2e.ts` — Playwright, seeded via `e2e/helpers.ts`.
- `scripts/` — release, dev-shell signing, data generators.
- `docs/` — everything that isn't README/AGENTS/TODO (index:
  `docs/README.md`).

## Commands

- `bun run dev` — browser-only preview at http://127.0.0.1:5200/. No Tauri
  APIs; everything must degrade cleanly here.
- `scripts/tauri-dev.sh` (`bun run tauri:dev`) — the only supported full
  shell launch on macOS. It builds, signs the binary with the local
  self-signed "Ccez Dev" cert so Keychain grants survive, then runs with
  `--no-watch`. Rust edits need Ctrl-C and relaunch. Click Always Allow
  (never Allow, never Deny) on the two Keychain items (`provider:muse`,
  `providers`). Never re-mint the "Ccez Dev" keypair. First build compiles
  ~400 crates.
- MCP driver sessions: `tauri-plugin-mcp-bridge` is debug-only and
  localhost-bound; it loads after a dev-shell relaunch. `start`, `status`,
  `stop` when done.
- `bun run test` (Vitest), `bun run check` (svelte-check strict),
  `bun run lint`, `bun run build`. Run them whenever needed, dev servers
  or not.
- Rust: `cd src-tauri && cargo test --lib` (CI runs `cargo check --locked`
  per target plus `cargo test --locked`).
- Spec-only changes (`e2e/`, `*.test.ts`) never touch the running app: say
  no restart is needed rather than implying one.

## Verification economy

- Iterate on the touched `*.test.ts`; full `bun run test` and `check` once
  at the end.
- Playwright: one invocation per file with combined `-g` patterns, then the
  whole file once. Batch files into one invocation. Every browser launch
  risks a login-keychain prompt for the user, so launches are budgeted: no
  probe specs, no re-runs "just to look", no parallel same-file runs. If
  prompts are firing, stop launching and say so.
- Stop the user's other `vite dev` / `tauri dev` shells before e2e (stale
  builds). Never stop another session's MCP server or browser unless its
  parent is dead; relay the fix instead.
- Read failures from the run that produced them; don't re-run for details.
- `git stash` attribution only when a failure plausibly relates to the
  change and blocks.

## Architecture rules (learned the hard way)

- Chat state is a plain object in `$state` with function updates
  (`chat.ts`). Class instances in `$state` never re-render.
- Never mutate a message in place: streaming replaces (`map` + local
  accumulator) because proxy signals capture values on first read.
- Reads that must subscribe need a synchronous read inside the render
  effect; async-only reads never subscribe.
- Keyboard shortcuts use a capture-phase listener (the editor swallows
  combos); guard on `event.code` (⌥R once produced `®`).
- Three runtimes for every Tauri call: shell, plain browser, jsdom. Guard
  with `tauriBackendAvailable()` (`secrets.ts`) or try/catch with a local
  fallback; dynamic-import plugins so node/jsdom never load them. Never let
  `invoke` throw into UI teardown.
- Two engines, one contract, kept in lockstep: the TS provider
  (`providers/openai-compat.ts`) and `turn.rs` share tool rounds, caps,
  error copy, and the `fetch_url` description. Change one, change both.
- Voice: `SpeakCallbacks` in `voice.ts` fronts web `speechSynthesis` and
  native `AVSpeechSynthesizer` (`nativeTts.ts` + `tts.rs`). Progress
  arrives as `tts-word` / `tts-done` events tagged with an utterance id;
  always check the id so stale cancels can't reset newer speech.
- Apple frameworks from Rust go through `objc2` bindings only. No `.m`, no
  Swift sidecar (evaluated, rejected).
- No API downloads Apple voices. The app picks the best installed voice per
  locale (`AVSpeechSynthesisVoice.speechVoices()`, a registry, not a
  folder) and deep-links
  `x-apple.systempreferences:com.apple.preference.universalaccess`; UI copy
  prints the in-pane path: Accessibility → Read & Speak → System Voice →
  Manage Voices. Never write "Spoken Content" (pre-26 name).

## Conventions

- Settings: `settings.ts` (`defaultSettings`, `saveSettings`). Secrets go
  to the Keychain via `secrets.ts`, never into persisted settings.
- Types are compiler feedback: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, type-aware lint (`no-floating-promises`:
  `void` your promises), branded ids (`ChatId` / `ChatMsgId` /
  `AnnotationId`). Zod was rejected. TS stays on v6 until `svelte-check`
  allows v7.
- `@types/node` is never global (`types: []`); tooling imports `node:*`
  explicitly. The webview has no `process`.
- Tests sit next to code (`foo.test.ts`). Pure logic must import without
  Tauri or DOM. Vitest defaults to node; DOM tests start with
  `// @vitest-environment jsdom`. What jsdom can't see (layout, layers) is
  asserted on source (see `src/routes/actions-reveal.test.ts`).
- Two runners only: Vitest and Playwright. No Testing Library.
- Verification screenshots go in `.screenshots/` (gitignored).
- UI copy: plain prose, no emojis. Enter sends, Shift+Enter newline. No
  unsolicited notifications.
- Shortcuts menu (`desktopShortcuts()` in `+page.svelte`, registry in
  `shortcuts.ts`): entries stay pithy, `dd` copy has no parentheses (pinned
  by `e2e/shortcuts-modal.e2e.ts`). Deliberately removed, do not re-add:
  New line, Stage message, Scroll messages, Export chat, Translate
  selection, and the `· Enter cycles · repeat closes · 1 hit closes bare`,
  `· past newest mints one`, `· again stops` trailers. Phones show no `h2`.
- Rust: `cargo clippy` warnings exist in older modules; keep new code
  clippy-clean and `rustfmt`-formatted.
- Planning docs: `TODO.md` holds open work only; finished items move to
  `docs/DONE.md`, never deleted. Dated plans go in `docs/plans/`.

## Structural debt

`+page.svelte` script is the hotspot. Decompose it the `keybindings.ts`
way: pure decisions over an explicit facts snapshot in `src/lib`
(unit-tested, priority encoded inside), with state and effects left in the
component. New `onKey` branches follow that split, never new untested
guard soup. History and remaining candidates: `docs/design/refactor.md`.

## Source control

Standing authorization: commit and push as you go. Each finished unit of
work gets its own commit once its gates are green, pushed straight to
`origin/main`. Never batch unrelated work. Commit + push only: never
amend, rebase, force-push, tag, or release without an explicit ask in
that turn. Name files explicitly, never `git add -A`. One shared local
checkout: a commit is already on the user's disk, so never say "pull".

Never let git or a browser prompt for a password. The remote is HTTPS via
the `gh` token (`gh auth setup-git`); if a push would prompt, stop and
report. `gh` keeps its token in the login keychain, and a Homebrew
upgrade swaps the binary, so the old "Always Allow" no longer applies:
every push then prompts until the owner clicks Always Allow once for
the new `gh`. After a `brew upgrade` (check `ls -l /opt/homebrew/bin/gh`),
expect one prompt, ask the owner to click Always Allow, and hold pushes
until they confirm. Playwright Chromium launches with `--use-mock-keychain` (see
`playwright.config.ts`; same flag for any `/tmp` browser probe). The
bundled Chromium is ad-hoc-signed, so Always Allow never sticks to it;
prompts from `playwright-mcp` servers mean they launched without the flag
(stop stale ones, don't click through). Only system Chrome holds a lasting
grant.

## Environment (user's machine)

- macOS 26.6.2 (25G83). Accessibility → Vision lists "Read & Speak", not
  "Spoken Content". Speech → Live Speech is type-to-speak, not voice
  downloads.
- CJK voices are installed (`say -v '?'` lists Eddy/Flo for zh_CN, zh_TW,
  ja_JP, ko_KR), so multilingual read-aloud is verifiable locally.
- Android verification device: Samsung S24 (release APKs + adb).
- The user studies French and German (chats) and Japanese (Ace Attorney
  via BlueStacks, read through the capture-OCR chord).
