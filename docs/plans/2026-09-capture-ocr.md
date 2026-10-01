## Capture-any-window OCR loop

## Goal

Capture text from any on-screen window with one global keypress and land it
in the composer as an explain-this message, without leaving the current app.

## Success Criteria

- Pressing the capture chord while any app (game, browser, emulator) is
  focused OCRs the saved (or frontmost) window and auto-sends a "what does
  this mean" message with the recognized text quoted — no picker, no
  staging. A low-confidence read stages in the type-in overlay instead so
  garbage never burns a round trip.
- Composer capture button opens a source menu with three static
  actions — fullscreen, window (OS hover-tint picker), area (OS
  crosshair). The global chord keeps the saved/frontmost source.
- Settings has an enable checkbox (default on): off unregisters the global
  chord and hides the composer button.
- Everything degrades cleanly in browser preview and jsdom per the
  three-runtime rule.

## Context And Current Facts

- OCR already exists end to end: `ocr_supported` / `ocr_recognize` in
  `src-tauri/src/ocr.rs` (Vision on macOS, WinRT on Windows, Tesseract on
  Linux, stubs elsewhere), consumed via `src/lib/nativeOcr.ts`. Nothing to
  build here. `OcrOutput` already carries mean line confidence.
- In-app capture exists but needs focus: `src/lib/screenCapture.ts` drives
  `getDisplayMedia` into the attachments path. It cannot fire while another
  app is focused — that gap is the whole project.
- Global-hotkey infra exists: `tauri-plugin-global-shortcut` is already a
  dependency and `install_summon_hotkey` in `src-tauri/src/desktop.rs`
  (⌘/Ctrl⇧Space toggle) is the exact pattern to copy.
- Shortcut registry lives in `src/lib/shortcuts.ts`, pinned by
  `shortcuts.test.ts` and `e2e/shortcuts-modal.e2e.ts` — any new row must
  update both.
- `screencapture -l<windowid>` captures one window with no new
  dependencies (verified via local `screencapture -h`); `-m` fullscreen is
  the fallback.

## Constraints And Non-goals

- Rust stays thin and privileged per architecture rules; new macOS bridging
  uses `objc2` generated bindings only (same as `tts.rs`), no Swift sidecar.
- V1 shows a small type-in overlay card with the staged message (no
  auto-send; Enter sends). Main-window summon stays as the deep-dive
  fallback.
- Non-goals: watch/poll mode, region select, remappable chords, auto-send,
  Android-side capture, capture parity beyond macOS (other platforms get
  `unsupported` stubs).

## Key Decisions

- Capture via `screencapture` CLI from two new commands — `list_windows`
  (id, owner, title, frontmost order, own app excluded) and
  `capture_window(id)` — not ScreenCaptureKit: zero new crates, and the
  window list doubles as the source menu model. ScreenCaptureKit is the
  fallback if CLI latency proves visible.
- Chord: `CommandOrControl+Shift+O` (O for OCR), registered globally in
  `desktop.rs` and mirrored in-app through the `keybindings.ts` facts
  snapshot. Nothing in `shortcuts.ts` uses ⇧⌘O; macOS reserves ⌘Shift+3/4/5
  and ⌘Space, not O. In-game collision is unverified and becomes a
  validation step.
- Auto-send by default, stage on low confidence: captures are short and
  BYOK spend is negligible, so clean reads send immediately with the
  template ("what does this mean" + quoted text). Mean line confidence
  below threshold stages the type-in overlay instead (Enter sends, Esc
  hides); a setting can force always-stage later.
- Enable checkbox in Settings (default on): the global chord registers
  only while enabled, and the composer capture button hides while off.
  Nothing fires until the user presses the chord or the button, so the
  Screen Recording prompt appears on first capture, never at launch.
- OCR hint comes from the chat's reply language (`recognition_languages`
  already maps fr/de/es/it/ja/zh/yue/ko/en): the learner's target language
  is the best prior for what is on screen. Low mean confidence still stages
  the message but flags it for a second look.
- Privacy shape: pixels never leave the device — Vision runs on-device and
  only the recognized text is sent to the provider. Say so in the UI copy.

## Recommended Approach

Three units in order: (1) Rust window listing + capture commands with
cargo-tested source picking, plus the settings enable checkbox and the
capture TS bridge; (2) global chord plus in-app mirror wiring capture
through OCR into auto-send (stage only on low confidence), with the
shortcuts registry and test updates; (3) composer capture button with the
window/fullscreen source menu persisted in settings, plus the staged
overlay card for low-confidence reads (Enter sends, reply speaks back via
native TTS). Main-window summon is the fallback path.

## Work Plan

1. Rust `list_windows` (owner, title, id; excludes own windows) and
   `capture_window(id)` (`screencapture -l<id> -x -o` to temp PNG, bytes
   back); `unsupported` stubs off-macOS; pure shaping helpers unit-tested
   with `cargo test`.
2. Chord wiring: `install_capture_hotkey` beside the summon installer
   emitting a `game-capture` window event; frontend listener resolves the
   saved source (or frontmost non-app window on first run), runs capture,
   then existing `ocr_recognize` with the chat reply language as hint, then
   stages the overlay draft with a low-confidence flag when warranted;
   in-app mirror in `keybindings.ts`; new `shortcuts.ts` row plus
   `shortcuts.test.ts` and e2e spec updates.
3. Type-in overlay card + composer button: overlay shows the staged text
   with a one-line input (Esc hides and returns focus, Enter sends, reply
   speaks back via native TTS); composer button keeps the window/fullscreen
   source menu, last pick in `defaultSettings`/`saveSettings`; browser
   preview keeps the existing `getDisplayMedia` path with an in-page card.

## Validation Plan

- `cargo test` for the pure helpers; touched `*.test.ts` while iterating,
  full `bun run test` and `bun run check` once at the end.
- Manual on the dev shell (`scripts/tauri-dev.sh` relaunch, since
  `src-tauri/` changes): first capture prompts Screen Recording once, menu
  lists the BlueStacks window by name, chord fires with the game focused and
  performs no game action, staged text matches the on-screen line (French
  line with an fr-hint check), source pick persists across relaunch.
- Highest-risk check: the Screen Recording prompt copy and first-run default
  (frontmost window guess) — both verified on device, never assumed.

## Risks / Rollback

- Stylized game fonts misread: mitigated by staging (user sees text before
  tokens burn) plus the low-confidence flag.
- Saved source gone (window closed) falls back to the frontmost non-app
  window with a notice, not a throw.
- A failed hotkey registration logs and leaves the in-app chord working
  (same contract as summon).
- Rollback is chord removal plus command stubs; no data migrates, settings
  key simply goes unused.

## Open Questions

None blocking. Assumptions: fixed chord in v1; overlay card is v1 (type-in,
staged, no auto-send); true macOS fullscreen Spaces can't be floated over,
so windowed-maximized is the supported game setup.
