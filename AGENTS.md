# Ccez LLM — agent handoff

Tauri 2 + Svelte 5 (runes) + TypeScript BYOK chatbot with language-learner
aids. Desktop (macOS primary, Windows/Linux) plus Android from the same
codebase, and a static web build. The frontend owns UI and state; the Rust
backend is thin and privileged (Keychain/Keystore, updater, native
TTS/OCR/dictation, page fetch, Android background turns).

## Repo map

- `src/routes/+page.svelte` — the app: state, effects, wiring (~13k lines
  of script; markup lives in components). See "Structural debt".
- `src/lib/components/` — markup + CSS per surface (Composer, ThreadView,
  MessageArticle, NewsPanel, settings panels, …).
- `src/lib/*.ts` — pure, unit-tested logic, one concern per module.
  `src/lib/*.svelte.ts` — domain controllers that own their `$state`
  (`annotate-mode`, `news-mode`, `annotation-drafts`).
- `src/lib/providers/` — OpenAI-compatible streaming + tool loop.
- `src-tauri/src/` — Rust commands. `turn.rs` runs the same turn loop
  natively (Android background turns) and must mirror the TypeScript
  provider; `page_text.rs` mirrors the `tools.ts` cleaners for it.
- `e2e/*.e2e.ts` — Playwright, seeded via `e2e/helpers.ts`.
- `scripts/` — release, dev-shell signing, data generators.
- `docs/` — platform notes and standing design decisions (index:
  `docs/README.md`).

## Commands

- `bun run dev` — browser-only preview at http://127.0.0.1:5200/. No Tauri
  APIs; everything must degrade cleanly here.
- `scripts/tauri-dev.sh` (`bun run tauri:dev`) — the only supported full
  shell launch on macOS: builds, signs with the local self-signed
  "Ccez Dev" cert (never re-mint it), runs with `--no-watch`. Rust edits
  need Ctrl-C and relaunch. Debug builds keep keys in the gitignored
  `src-tauri/.dev-secrets.json`, so rebuilds don't hit the Keychain.
- MCP driver sessions: `tauri-plugin-mcp-bridge` is debug-only,
  desktop-only, localhost-bound; it loads after a dev-shell relaunch.
- `bun run test` (Vitest), `bun run check` (svelte-check strict),
  `bun run lint`, `bun run build`.
- Rust: `cd src-tauri && cargo test --lib` (CI runs `cargo check --locked`
  per target plus `cargo test --locked`).
- Web: `bun run build:web` → `build/`. Cloudflare Pages project
  `personalized-llm-client` builds `main` on push and serves
  https://llm.ccez.uk (`docs/platforms/web-deploy.md`).

## Verification economy

- Iterate on the touched `*.test.ts`; full `bun run test` and `check` once
  at the end.
- Playwright: one invocation per file with combined `-g` patterns, then the
  whole file once; batch files into one invocation. No probe specs, no
  re-runs "just to look", no parallel same-file runs.
- Stop the user's other `vite dev` / `tauri dev` shells before e2e (stale
  builds). Never stop another session's MCP server or browser unless its
  parent is dead.
- Read failures from the run that produced them; don't re-run for details.
- Spec-only changes (`e2e/`, `*.test.ts`) never touch the running app: say
  no restart is needed.
- Device-only paths (Android, Windows, Linux): unit tests plus an honest
  "unverified on device" note, never a pass claim. Android verifies on the
  owner's Samsung S24 (release APKs + adb).

## Architecture rules (learned the hard way)

- Chat state is a plain object in `$state` with function updates
  (`chat.ts`). Class instances in `$state` never re-render (a `.svelte.ts`
  controller is a plain `const` whose fields are runes — that's fine).
- Never mutate a message in place: streaming replaces (`map` + local
  accumulator) because proxy signals capture values on first read.
- Reads that must subscribe need a synchronous read inside the effect;
  async-only reads never subscribe.
- Keyboard shortcuts use a capture-phase listener (the editor swallows
  combos); guard on `event.code` (⌥R once produced `®`).
- Three runtimes for every Tauri call: shell, plain browser, jsdom. Guard
  with `tauriBackendAvailable()` (`secrets.ts`) or try/catch with a local
  fallback; dynamic-import plugins so node/jsdom never load them. Never let
  `invoke` throw into UI teardown.
- Secure-storage keys arrive asynchronously after first paint
  (`hydrateSecrets`); anything that judges "no key" must wait for it.
- Two engines, one contract, kept in lockstep: the TS provider
  (`providers/openai-compat.ts`) and `turn.rs` share tool rounds, caps,
  error copy, and the `fetch_url` description. Change one, change both.
- Voice: `SpeakCallbacks` in `voice.ts` fronts web `speechSynthesis` and
  native engines (`nativeTts.ts` → `tts.rs` AVSpeechSynthesizer on Mac,
  `tts_android.rs` on Android, whose WebView has no `speechSynthesis` at
  all). Progress arrives as `tts-word` / `tts-done` events tagged with an
  utterance id; always check the id so stale cancels can't reset newer
  speech.
- Apple frameworks from Rust go through `objc2` bindings only. No `.m`, no
  Swift sidecar.
- No API downloads Apple voices. The app picks the best installed voice per
  locale and deep-links
  `x-apple.systempreferences:com.apple.preference.universalaccess`; UI copy
  prints the in-pane path: Accessibility → Read & Speak → System Voice →
  Manage Voices. Never write "Spoken Content" (pre-26 name).

## Conventions

- Settings: `settings.ts` (`defaultSettings`, `loadSettings`). Secrets go
  through `secrets.ts` (Keychain / Android Keystore / encrypted
  localStorage on web), never into persisted settings. Never commit
  `src-tauri/.dev-secrets.json`.
- Types are compiler feedback: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, type-aware lint (`no-floating-promises`:
  `void` your promises), branded ids (`ChatId` / `ChatMsgId` /
  `AnnotationId`). TS stays on v6 until `svelte-check` allows v7.
- `@types/node` is never global (`types: []`); tooling imports `node:*`
  explicitly. The webview has no `process`.
- Tests sit next to code (`foo.test.ts`). Pure logic must import without
  Tauri or DOM. Vitest defaults to node; DOM tests start with
  `// @vitest-environment jsdom`. Two runners only: Vitest and Playwright.
  Test behavior, not source text: a source-string assertion is only for
  what neither jsdom nor Playwright can observe.
- Verification screenshots go in `.screenshots/` (gitignored).
- UI taste: minimalist, animated, quiet. Plain prose, no emojis, no
  unsolicited notifications or badges. Enter sends, Shift+Enter newline.
  Honor `prefers-reduced-motion`. Text size must reach very large scales
  (an owner's relative needs giant type): never narrow the size range.
- Shortcuts menu (`desktopShortcuts()` in `+page.svelte`, registry in
  `shortcuts.ts`): entries stay pithy, `dd` copy has no parentheses (pinned
  by `e2e/shortcuts-modal.e2e.ts`). Deliberately removed, do not re-add:
  New line, Stage message, Scroll messages, Export chat, Translate
  selection, and the `· Enter cycles · repeat closes · 1 hit closes bare`,
  `· past newest mints one`, `· again stops` trailers. Phones show no `h2`.
- Rust: keep new code clippy-clean and `rustfmt`-formatted (older modules
  still carry warnings).
- `TODO.md` holds open work only. Delete items when they ship; the commit
  message is the record. Comments describe the code as it is, never which
  plan or audit section produced it.

## Structural debt

`+page.svelte` script is the hotspot. Decompose it two ways: pure
decisions over an explicit facts snapshot in `src/lib/*.ts` (the
`keybindings.ts` way, unit-tested), and domain state plus its effects
into a `src/lib/*.svelte.ts` controller when one domain is mutated from
many places. Markup keeps moving into components. New `onKey` branches
follow that split, never new untested guard soup.

## Source control

Standing authorization: commit and push as you go. Each finished unit of
work gets its own commit once its gates are green, pushed straight to
`origin/main`. Never batch unrelated work. Tag and cut releases via
`scripts/release.ts` without asking, picking the bump from the changes
(features since the last tag → minor, fixes only → patch), gates green
first. Never amend, rebase, or force-push without an explicit ask in that
turn. Name files explicitly, never `git add -A`. One shared local
checkout: a commit is already on the user's disk, so never say "pull".

Never let git or a browser prompt for a password. The remote is HTTPS via
the `gh` token; if a push would prompt, stop and report. Keychain dialogs
during a session almost always come from the dev app, not git: check with
`/usr/bin/log show --last 1h --predicate 'process == "securityd" AND
eventMessage CONTAINS "displaying keychain prompt"'` (zsh shadows `log`).
Playwright Chromium launches with `--use-mock-keychain`
(`playwright.config.ts`; same flag for any ad-hoc browser probe), so a
prompt from a Playwright browser means something launched without it.

## Owner context

- Studies French and German (chats) and Japanese (Ace Attorney via
  BlueStacks, read through the capture-OCR chord). CJK voices are
  installed locally (`say -v '?'`), so multilingual read-aloud is
  verifiable on the Mac.
