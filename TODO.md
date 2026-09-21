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
- Cmd+T browser removed (owner request, Sep 2026): the chord, sideview
  webview, fallback strip, width setting, and shortcut row are gone;
  Cmd+T returns to the OS/browser.

## Pile: Win/Linux device proof (still no hardware)

- [ ] Every shipped feature on Win/Linux: unit-tested contracts only
      (`platform.ts`, `updates.ts`, `langId.ts` + `langid.rs`,
      `secrets_*` fail-closed). No pass claims without the hardware.

## Pile: maybe later (only if troublesome)

- [ ] Chats-sidebar swipe misfires on downward scrolls: directional
      lock (predominantly-horizontal past a minimum distance) or
      edge-started swipes. Owner call — implement only if it keeps
      happening.

## Non-goals

- No app-build/agentic features. No cloud sync / sharing / plugins.

## Verify (per AGENTS.md)

`bun run check` + `bun run test` + `cargo check/test` + focused e2e per area;
full suite before push. Device-only paths: unit tests + honest unverified
notes, never pass claims.
