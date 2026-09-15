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
- FTS5 parked (IndexedDB not proven slow). Win/Linux/Android device proof
  needs real hardware — unit tests + honest unverified notes, never pass claims.
- P23 (`+page.svelte` component split) stays its own future task.
- Ghost features: user believes all fixed — verify, then drop this item.
- Cmd+T browser removed (owner request, Sep 2026): the chord, sideview
  webview, fallback strip, width setting, and shortcut row are gone;
  Cmd+T returns to the OS/browser.

## Pile: platform + release (needs hardware) (needs hardware)

- [ ] Win/Linux/Android device proof for every shipped feature.
      (Status Sep 2026, stream-platform: unit-tested contracts only —
      `platform.ts` x31, `updates.ts` x5, `langId.ts` x4 + `langid.rs` x3,
      `secrets_android` fail-closed/prefs-key, android e2e specs pin the
      web-reachable end states with device-only halves marked inside.
      No hardware in this harness: no pass claims, ever.)
- [ ] Samsung S24 pass (Annotate overflow ordering, tap-to-reveal ghost).
      (Blocked Sep 2026: no S24 hardware. `android-share`/`android-touch`
      e2e run under an SM-S921B UA + 412x915 viewport but cover the
      browser-reachable halves only.)
- [ ] System TTS ear-check on real hardware.
      (Blocked Sep 2026: voice quality needs ears on device. Native
      inventories ship per platform — `tts.rs` + `tts_android.rs` +
      `tts_linux.rs` + `tts_windows.rs` — but ranking was never heard.)
- [ ] Android: signing config / Play-vs-self-sign decision; share intent
      (ACTION_SEND text -> chat draft); Keystore fallback for API keys (keyring
      v3 = in-memory mock on Android, nothing persists). Verify current status.
      (Status Sep 2026, stream-platform: DECIDED self-sign — `release.yml`
      header records it (upload-keystore via CI secrets, APK from the
      Releases page, no Play, no Apple Developer account). Share intent
      SHIPS (manifest SEND filter + `MainActivity.handleSend` ->
      `annotate-external` prefill; PROCESS_TEXT alias alongside). Keystore
      fallback SHIPS (`Secrets.kt` AES/GCM envelope + `secrets_android.rs`,
      fail-closed without init, unit-tested). Device verify blocked.)
- [ ] On-device Gemma via MediaPipe LLM Inference (sanctioned Kotlin
      exception); provider gating contract already ships + unit-tested.
      (Report-only Sep 2026, stream-platform — NOT built per DO LAST:
      `visibleProviderIds` in `platform.ts` lists `local-gemma` only on
      offline Android and hides it elsewhere; `platform.test.ts` pins all
      six gating cases. Nothing registers `local: true` yet — no bridge.)

## Pile: input + sidebar + shortcuts + extras (from PROMPT3) (needs hardware)

- [ ] Android: voices button needs top/bottom spacing; system-voices auto
      element missing at startup; "build release" should read "Version";
      one-finger double-tap opens the sidebar when the chat is empty.
      (Blocked Sep 2026, stream-platform: all four need a real Android
      device to see/verify — untouched. Voice/chrome areas belong to
      sibling streams; coordinate before changing.)

## Pile: desktop composer reports (needs owner observables)

- [ ] Badge edit loses focus "soon after" opening (desktop). Not
      reproduced Sep 2026: the edit box holds focus for 2.4s+ in both
      Chromium and WebKit, composer parked or open. Park machinery was
      proven unable to steal popover focus. Needed: idle-hide setting,
      sidebar open/closed, what was focused before the click, exact
      delay, whether a reply lands mid-edit.
- [ ] Attach/voice buttons shift apart a tiny amount after the summon
      rise (desktop). Not reproduced Sep 2026: zero shift across six
      configs (Chromium/WebKit, DPR 1/2, short/long chats, with/without
      annotations, mic on/off, first and second summon, frame-by-frame
      traces of attach/voice/pill/prompt rects). Needed: window size,
      chat-width slider, font scale, sidebar state, annotation count,
      whether it also happens keyboard-summoned with the mouse untouched.

## Non-goals

- No app-build/agentic features. No cloud sync / sharing / plugins.

## Verify (per AGENTS.md)

`bun run check` + `bun run test` + `cargo check/test` + focused e2e per area;
full suite before push. Device-only paths: unit tests + honest unverified
notes, never pass claims.
