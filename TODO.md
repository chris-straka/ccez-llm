# Ccez LLM — TODO (open work only)

Spec is `README.md`; how to work here is `AGENTS.md`. Delete items when
they ship — the commit is the record.

## Standing decisions

- Free forever, offline-first, BYOK, no paid accounts or services
  (OS-native speech/OCR).
- Every OS supports every feature (macOS/Windows/Linux; Android where
  mobile). Windows/Linux are unverified on hardware.
- FTS5 search parked (IndexedDB not proven slow).

## Open

- Owner notes of 2026-10-24, still open:
  - Settings as a centered window on desktop: groups listed on the
    left, one group at a time, a live sample on Reading, Look and
    Layout. Chats as a centered switcher (search, grouped by date,
    preview) instead of the sidebar; it replaces the search palette.
  - Simpler shortcuts: with the prompt unfocused, Shift+J/K switch
    chats, Shift+H/L open the left and right panels, Shift+? opens the
    shortcuts list; update that list (add R reply and E reword on an
    open answer).
  - A dotted underline under selected text in an open word card,
    seen in the Mac shell only (not reproduced in WebKit headless).

- Owner feedback batch of 2026-10-13: `PLAN.md` (annotations, selection,
  speech, chats, layout, news/video). Work rows off there.

- Drill word timing beyond the Mac: `listen_heard` answers
  `listen-heard-unsupported` on Android, Windows and Linux, so their
  drills keep the pause times. Android's own recognizer next (owner,
  2026-10-23), behind the same command and `heard::chunk_bounds`.

- OpenCode Zen outside Android: its API sends no CORS headers, so the
  web build and the desktop webview can't send to it (the model list
  already loads from Rust via `list_models`). Desktop sends from Rust,
  and maybe a proxy for the web, wait on the owner's pick (Decisions,
  2026-10-07).
- OpenCode Zen beyond /chat/completions: Zen serves GPT, Grok, and
  Muse Spark on `/responses`, Claude and most Qwen on `/messages`,
  Gemini on `/models/{id}`, and Jev on `/systemone`. The picker hides
  them (`src/lib/providers/zen.ts`) until the engines (TS provider and
  `turn.rs`) speak those formats.

## Non-goals

- No app-build/agentic features. No cloud sync / sharing / plugins.
