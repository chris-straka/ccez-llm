# Ccez LLM

A private BYOK desktop + mobile chatbot for everyday questions, with built-in language-learner aids — a Tauri 2 app (macOS) with a touch-first Android UI, Svelte 5
runes + TypeScript frontend, and a thin Rust backend (Keychain, updater,
native TTS). No accounts, no cloud sync, no agents: keys stay on-device,
chats stay local.

## What it does

- **Chat, minus the clutter.** Multiple chats in a sidebar with
  timestamp labels, branch-from-here, rerun, message fold/delete/edit,
  collapsible pastes, image + text attachments with token estimates,
  and a waypoint strip for long threads.
- **Language-learner aids.** Auto-detected Chinese pinyin, Japanese
  furigana, and Arabic tashkeel (⇧⌘A toggles, hover peeks); highlight
  anything to annotate it, and the note folds into the next query.
  Right-clicking a highlight reads it aloud with a readings popup.
- **Speech throughout.** Voice readback with word tracking, per-sentence
  voice matching (Latin reads Italian, Sanskrit Hindi until dedicated
  voices exist; highlights keep one voice across sentence fragments),
  word-level reads, dictation, and macOS system voices
  with downloadable-voice inventory.
- **Touch UI (Android).** Bottom-sheet chat list, edge swipes, two-finger
  swipe to step chats, long-press selection with an Annotate menu under
  the system toolbar, hide-until-tapped message mode, and light/dark/
  system themes.
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
