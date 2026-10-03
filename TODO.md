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

- `e2e/settings-focus.e2e.ts` "enter on the active chat skips the
  crossfade" fails on main (0 view transitions after `j`, expected 1);
  predates the 2026-10-02 session (fails with its changes reverted).

## Non-goals

- No app-build/agentic features. No cloud sync / sharing / plugins.
