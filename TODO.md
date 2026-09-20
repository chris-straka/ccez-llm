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
- [ ] On-device Gemma via ML Kit GenAI Prompt API (AICore/Gemini Nano);
      provider gating contract already ships + unit-tested. (Verdict Sep
      2026, corrected: the first spike picked MediaPipe LLM Inference,
      but it is in maintenance mode and the owner's S24 is on the
      AICore supported list — ML Kit it is. Foundation SHIPS
      (`src/lib/ondevice/` seam + `ondevice.rs`/`OnDevice.kt` bridge +
      Gradle dep, 34 seam tests + clamp test green; keyless, Gemma-pill
      only, settings picker shows live readiness). WIRED (owner-approved
      Sep 2026): `local-gemma` resolves to `OnDeviceChatProvider`
      (one-shot stream, flattened prompt, short-copy errors toast via
      the normal error slot). SHIPPED Sep 2026 (owner-approved
      follow-ups): mount probe hides the Gemma radio on unsupported
      Android hardware (`onDeviceUnsupported` + panel verdict, cached
      across opens); settings note shows whole-MB downloaded-so-far
      while downloading (the API reports no total, so no percent is
      fabricated) with a 3s re-probe that terminal states stop;
      `PromptEditor` contract lives in `textarea-editor.ts` (`editor.ts`
      is a pure barrel, dead `createPromptEditor` alias gone); mic/ann
      seating rides `:has()` alone (JS classes removed). NATIVE BUILD
      FIXES Sep 2026 (v0.4.7/v0.4.8 Android legs were red): `ondevice.rs`
      JString by-value fix, dep pinned to genai-prompt beta3 (beta4's
      Kotlin 2.3 metadata needs KGP 2.3, which Tauri's own bundled
      script rejects — upstream tauri#15694, unreleased), KGP 2.2.21,
      minSdk 26 (ML Kit requires it), `kotlinOptions` -> `compilerOptions`
      DSL, `DownloadStatus`/`FeatureStatus` imports corrected to
      `genai.common`, beta3 response read via `candidates.first text`.
      Rust android-target check + kotlinc both compile locally. STILL
      NEEDS the S24 install + device run: unsupported/wrong-device
      paths are covered by unit tests + honest unverified notes only.
      `visibleProviderIds` lists `local-gemma` only on offline Android
      and hides it elsewhere; `platform.test.ts` pins all six gating
      cases.)

## Pile: input + sidebar + shortcuts + extras (from PROMPT3) (needs hardware)

- [ ] Android: voices button needs top/bottom spacing; system-voices auto
      element missing at startup; one-finger double-tap opens the sidebar
      when the chat is empty. ("build release" stamp fixed in tree Sep 2026:
      the old vite `define` globals never reached the Svelte bundle, so every
      release build printed the fallback; version/stamp now ride import.meta.env
      defaulted from package.json — needs an on-device install past v0.4.6 to
      confirm. Blocked Sep 2026, stream-platform: the rest need a real Android
      device to see/verify — untouched. Voice/chrome areas belong to
      sibling streams; coordinate before changing.)

## Pile: annotation + Android follow-ups (from Sep 2026 batch)

Left over from the sent-refs/middle-drag/Android batch (shipped as v0.4.4):
verified in unit tests + e2e where the harness can reach, open where it
cannot (no Android hardware here).

- [ ] Verify Annotate/Speak/Inspect entries in the Android native text
      menu on a real device build. (Status Sep 2026: manifest aliases +
      Rust bridge + frontend routing all present and unit-covered; the
      entries never surfaced in the reporter's build — needs an
      installed device build to confirm, nothing to change blind.)
- [ ] Desktop j/k/u/d scroll smoothness under key repeat. (Status Sep
      2026: physics already smooth animated steps with velocity
      coalescing; left untouched — reporter suspected their mouse.
      Revisit only with a repro on known hardware.)
- [ ] Tap-marker edit viewport flash when the OS keyboard resizes.
      (Status Sep 2026: prompt focus is preventScroll and the quote
      now scrolls keyboard-aware into the upper view first; any
      remaining flash is the OS resize itself.)
- [ ] Enter-at-tag newline report: pressing Enter with the caret at a
      paste tag's end allegedly inserts a newline instead of sending.
      (Status Sep 2026: not reproducible — both composer Enter paths
      send unconditionally, and a regression test pins send-after-tag.
      Needs the reporter's exact key/caret sequence.)
- [ ] Tag-only message dash report: image-only sends allegedly render
      `-`. (Status Sep 2026: no dash code path found anywhere; a probe
      shows no dash, and sends now store image literals so tag-only
      turns are never content-empty. Needs a screenshot of where the
      dash appears.)
- [ ] Floating badge pins (far goal): position badges from quote range
      rects with no anchor spans, following scroll/resize/re-stamp and
      hiding while streaming. (Status Sep 2026: gap parking ships the
      cheap version — empty anchors on word boundaries, zero fence
      issues for spaced scripts; floating pins remain the full fix,
      needed only if gap parking stops being enough.)

## Pile: +page.svelte component split (reopened Sep 2026)

`src/routes/+page.svelte` is ~19k lines (script ~11.7k with ~300
functions, markup ~2.4k, style ~4.9k). Sequence: land the in-flight
turns work first (it touches the same file), then split outside-in —
self-contained overlays first (shortcuts modal, search palette,
settings panel), message/composer core last (shared `$state` must move
behind a small store/props contract, not prop-drilling soup). Keep the
`keybindings.ts` hollowing going in parallel.

- [ ] Split `+page.svelte` outside-in per the sequence above, with the
      repo gates green at each step (`bun run check` + `bun run test` +
      focused e2e per extracted area).

## Non-goals

- No app-build/agentic features. No cloud sync / sharing / plugins.

## Verify (per AGENTS.md)

`bun run check` + `bun run test` + `cargo check/test` + focused e2e per area;
full suite before push. Device-only paths: unit tests + honest unverified
notes, never pass claims.
