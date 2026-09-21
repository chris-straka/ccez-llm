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

## Pile: S24 device pass (hardware in hand — S24 on USB + release APKs)

Unit + e2e cover the web-reachable halves; the items below need the
phone in hand. Verdicts so far came from adb (screenshots, logcat)
plus owner try-outs.

- [ ] New selection layout on device: Annotate+Copy bar, Speak+Inspect
      dock, ruby above the Han with the menu lifted, OS callout staying
      dead through handle drags.
- [ ] Double-tap word select (multi-tap wipe fix) + fold toggle off =
      inert strokes + mobile fold chevron on every row.
- [ ] ML Kit pill stays hidden on all-606; provider list otherwise intact.
- [ ] Share intent (ACTION_SEND -> draft) and API-key persistence across
      restarts (Keystore envelope; self-sign decision stands, no Play).
- [ ] Tap-marker edit flash when the OS keyboard resizes (prompt focus
      is preventScroll; anything left is the OS resize itself).
- [ ] Voices button spacing; system-voices auto element at startup;
      one-finger double-tap with an empty chat.

## Pile: TTS ear-check (Mac voices present)

- [ ] Mac Han voice switching (English/Chinese mixed readback) and
      S24 TTS voices by ear. Eddy/Flo zh_CN/zh_TW/ja_JP/ko_KR are
      installed on the dev Mac (AGENTS.md); ranking was never heard.

## Pile: Win/Linux device proof (still no hardware)

- [ ] Every shipped feature on Win/Linux: unit-tested contracts only
      (`platform.ts`, `updates.ts`, `langId.ts` + `langid.rs`,
      `secrets_*` fail-closed). No pass claims without the hardware.

## Pile: far goal

- [ ] Floating badge pins: position badges from quote range rects with
      no anchor spans, following scroll/resize/re-stamp and hiding
      while streaming. Gap parking (empty anchors on word boundaries)
      ships as the cheap version; full pins only if it stops being
      enough.

## Non-goals

- No app-build/agentic features. No cloud sync / sharing / plugins.

## Verify (per AGENTS.md)

`bun run check` + `bun run test` + `cargo check/test` + focused e2e per area;
full suite before push. Device-only paths: unit tests + honest unverified
notes, never pass claims.
