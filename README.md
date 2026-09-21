# Ccez LLM

A private BYOK chatbot for everyday questions, with built-in language-learner aids — Tauri 2 on macOS/Windows/Linux with a touch-first Android UI, Svelte 5
runes + TypeScript frontend, and a thin Rust backend (Keychain, updater,
native TTS). No accounts, no cloud sync, no agents: keys stay on-device,
chats stay local.

## What it does

- **Chat, minus the clutter.** Multiple chats in a sidebar with
  timestamp labels, branch-from-here, rerun, message fold/delete/edit,
  collapsible pastes, image + text attachments with token estimates,
  and a waypoint strip for long threads.
- **Language-learner aids.** Auto-detected Chinese pinyin, Japanese
  furigana, and Arabic tashkeel (hover + A toggles, M shows pinyin, N
  shows furigana, hover peeks); highlight anything to annotate it, and
  the note folds into the next query. The selection menu reads the
  highlight aloud with a readings popup.
- **Speech throughout.** Voice readback with word tracking, per-sentence
  voice matching (Latin reads Italian, Sanskrit Hindi until dedicated
  voices exist; highlights keep one voice across sentence fragments),
  word-level reads, dictation, and macOS system voices
  with downloadable-voice inventory.
- **Touch UI (Android).** Bottom-sheet chat list, swipe right (or two
  fingers) to open it, two-finger swipe to step chats, long-press
  selection with an in-app Annotate/Copy bar and Speak/Inspect dock —
  the OS text menu stays out of the way except inside the main prompt,
  which keeps its native Copy/Cut/Paste. Tap-to-reveal message modes
  and light/dark/system themes.
- **Image text.** The OCR button reads pasted or attached images into
  selectable text: native Vision/WinRT recognition on desktop, an
  offline-cached fallback elsewhere that detects the image's own script
  (Japanese, Chinese, Russian, Arabic, Hindi, …) instead of assuming
  the reply language.
- **Study sheets.** Export or print the visible chat as a study sheet.
- **Providers.** Muse Spark and DeepSeek out of the box, custom
  OpenAI-compatible endpoints, per-key models, thinking-level control.

## Engineering

- Frontend owns UI/state (plain `$state` objects, never classes);
  streaming replaces message objects instead of mutating them.
- Every Tauri call degrades cleanly across three runtimes: Tauri shell,
  plain browser, jsdom tests.
- Colocated Vitest unit tests plus a Playwright e2e suite
  (seeded, desktop + mobile viewports); `svelte-check` strict and
  type-aware lint gate the tree.

`TODO.md` is the working checklist, `DONE.md` the archive of finished work.

Known-good revert points: gap parking `18dab6e` (Sep 2026) — annotation
badges park in word gaps; fade re-fire `5437c7c`.
