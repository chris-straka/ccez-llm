# Ccez LLM — TODO (only open work)

Finished stages live in `DONE.md` (archive) — check items off by moving
them there, never by deleting. Spec is `README.md`; agent handoff
(commands, gates, architecture) is `AGENTS.md`.

## Goal + constraints

macOS desktop chatbot (BYOK: DeepSeek + Muse Spark): clean chat with
highlight-to-comment annotation, language-learner reading aids,
type-then-it-talks voice, vim-flavored prompt editing. Android rides the
same codebase via the Tauri mobile target.

- Free forever, offline-first, personal modern devices only, no paid accounts.
- Every OS supports every feature (macOS/Windows/Linux; Android where mobile).
- Commit + push when allowed.

## Standing decisions

- OS-native speech/OCR (no paid services). Per-arch DMGs, serialized
  single-writer release chain (verify -> publish -> prune -> rename).
- rAF scroll glide; per-chat draft scoping.
- FTS5 parked (IndexedDB not proven slow). Win/Linux device proof
  still needs real hardware; Android verifies on the S24 (release
  APKs + adb) — unit tests + honest unverified notes elsewhere,
  never pass claims.
- Ghost features: user believes all fixed — verify, then drop this item.

## Pile: 0.5.3 remainder (mac app, 370% font size)

Every other 0.5.3 field note is closed in `DONE.md` (speech chords,
chat-step aliases, digit dual-mode, annotation sizing, TTS floor,
text-size uncap, furigana backdrop, shell Cmd+T). One stays open:

- [ ] Chat switching feels slow (2s down a chat, 1s up at 370% font).
      Profiled Sep 2026 in Chromium (scratch server, seeded
      30-message threads): Shiki re-highlighted every code block on
      every mount (~0.4s JS on code-heavy threads) — now cached per
      (lang, code) in `render.ts`, so repeat switches replay.
      Residual: ~0.4s render/layout baseline per thread, plus
      whatever the release WebKit client adds at 370% with real
      data — still needs Mac-client confirmation before more fixes.

## Pile: Android in-app update install fails (reported on 0.5.2, Sep 2026)

- [ ] 0.5.2 sees the new version and downloads it, but Install errors:
      "installer did not start: Error invoking postMessage: Java
      exception was raised during method invocation." Likely the
      postMessage bridge call into the Activity (provider/FileUri or
      install-intent args) throwing before the installer starts —
      reproduce on the S24 with adb and read the full Java stack.

## Non-goals

- No app-build/agentic features. No cloud sync / sharing / plugins.

## Verify (per AGENTS.md)

`bun run check` + `bun run test` + `cargo check/test` + focused e2e per area;
full suite before push. Device-only paths: unit tests + honest unverified
notes, never pass claims.
