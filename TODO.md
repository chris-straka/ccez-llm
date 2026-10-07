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
