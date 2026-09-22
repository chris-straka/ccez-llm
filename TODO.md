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

## Pile: Win/Linux device proof (still no hardware)

- [ ] Every shipped feature on Win/Linux: unit-tested contracts only
      (`platform.ts`, `updates.ts`, `langId.ts` + `langid.rs`,
      `secrets_*` fail-closed). No pass claims without the hardware.

## Pile: 0.5.3 remainder (mac app, 370% font size)

Every other 0.5.3 field note is closed in `DONE.md` (speech chords,
chat-step aliases, digit dual-mode, annotation sizing, TTS floor,
text-size uncap, furigana backdrop, shell Cmd+T). One stays open:

- [ ] Chat switching feels slow (2s down a chat, 1s up at 370% font).
      Storage ruled out: `selectChat` flips `activeChatId` only (no
      `persistChats`); per-switch sync work is draft/scroll filing
      (KBs of localStorage) plus a 500ms-debounced worker search
      reindex off the critical path. Render cost of the entering
      thread dominates — needs a device profile in the Mac client
      before any fix.

## Pile: Android in-app update install fails (reported on 0.5.2, Sep 2026)

- [ ] 0.5.2 sees the new version and downloads it, but Install errors:
      "installer did not start: Error invoking postMessage: Java
      exception was raised during method invocation." Likely the
      postMessage bridge call into the Activity (provider/FileUri or
      install-intent args) throwing before the installer starts —
      reproduce on the S24 with adb and read the full Java stack.

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
