# Refactor candidates (Sep 2026)

Standing constraint: `src/routes/+page.svelte` stays one file by explicit
decision (P23 in TODO.md). The refactors below extract logic into tested
modules — they never split the template for size alone.

## 1. Hollow out `onKey` into `src/lib/keybindings.ts` (biggest win, in progress)

- `onKey` (in `src/routes/+page.svelte`) dispatches through extracted
  decision functions in `src/lib/keybindings.ts` (unit-tested in
  `keybindings.test.ts` — the suite grows with every slice, so no count
  here).
- Extracted so far (facts-snapshot → action-token, effects in the
  component, bodies as `if (token === ...)` chains never a switch):
  `messageKeyAction`, `spaceKeyAction`, `deleteChatScope` (first slice);
  `promptIdleKeyAction` (idle-restore allowlist + hidden-keystroke swallow
  combined — both walked the same `.prompt` editor selector, so one fact
  serves both; local `idleRestoreKey`/`swallowHiddenKeystroke` deleted),
  `inspectStepAction` (`h`/`l`), `shortcutsFilterBlocksKey` (filter
  carve-out); `commandChord` (Cmd+T browser, Cmd+P palette, Cmd+E /
  Ctrl+Cmd+F fullscreen, Cmd+F find with the `shortcutsOpen` split kept in
  the body, Ctrl+O pastes, Cmd+Enter send with the field carve-out kept in
  the body, Ctrl+Alt+Arrows provider/thinking cycle, both N spellings
  merged to one `new-chat` body, Ctrl+Alt+S voice); `chromeChord` (shift
  group, zoom with the Shift-widens derivation kept in the body, both
  comma spellings, Cmd+B / `.` / `,` merged to shared tokens, quick-lang
  with the `QUICK_LANG_CODES` lookup kept in the body via the shared
  `quickLangIndexForKey`, meta-only hover-gated Cmd+D with the
  target-exists check kept in the body); `sidebarListAction` (walk/enter/
  delete-chat), `scrollEnterAction` (Ctrl+G entry), `modalScrollAction`
  (modal j/k/u/d with the box lookup and half-page sizing kept in the body);
  `scrollModeAction` (step/park/go-top/go-bottom/half-jump/half-glide/
  enter-edit/scroll-toggle with `lastGAt` updates, the lone-g arm, and the
  position/hold effects kept in the body — j/k/i/Enter carry no modifier
  guards, matched verbatim).
- Every target read in the handler now goes through a named `events.ts`
  predicate (`isPromptEditorTarget`, `isComposerTarget`, `isFilterTarget`,
  `isFindBarTarget`, `isSidebarTarget`, `isPromptTarget`,
  `isInteractiveTarget`, `isInspectFieldTarget`, `isSpaceInteractiveTarget`,
  `isIdleOwnedTarget`, `isScrollEnterOwnedTarget` beside `isFieldTarget` /
  `isEditableTarget`) — no selector literals left except the one
  element-valued walk `dismissEscape` needs. The idle and Ctrl+G
  owned-stage spellings differ on purpose (summary + language menu) and
  stay separate predicates, pinned apart in `events.test.ts`.
- Message-key body effects live in `src/lib/message-actions.ts`
  (`toggleAidKinds` toggle-all math, `toggleSingleAid` with the
  unoffered-null contract, `canEditMessage` own-message gate over
  structural rows): the A/M/N/E bodies keep target resolution,
  offer computation, and fall-through; the M/N kind comes from the
  token now, never a re-read key. Fold/cut/delete lookups stay inline
  (one line each, no logic to pin).
- Still inline: the unselected-scroll intent glide (the jump and
  empty-enter branches are extracted via `unselectedScrollAction`; the
  `lastGAt` + rAF-hold dispatch keeps its guard and extracted
  `unselectedScrollIntent` call), the summon body (`isSummonHotkey`
  already wired).
- Leave inline: the bare `Escape` → `dismissEscape(inEditor)` branch and
  the `escDownAt` stamp line — single-condition, extraction adds a hop
  for no decision value.
- Transcription hazards (learned across slices, still binding): every
  condition is the handler's verbatim guard — no narrowed re-spelling
  (Ctrl+O ignores meta/shift, the T chord ignores alt/shift, shifted
  arrows still walk the sidebar, CapsLock "B" still toggles it). Bodies
  with inner target-exists checks fall through when the target is gone
  (F fold, E edit, A aids, M/N pins, Cmd+D, modal box) — `if` chains,
  never a switch. The target spellings live exactly once each as named
  `events.ts` predicates — the facts snapshot carries the booleans, never
  the selectors.
- Every facts snapshot spreads the shared `keyFacts(event)` base (key,
  code, modifiers) instead of repeating the literal — the six fields
  cannot drift between slices. Full per-keydown context (target
  booleans included) stays per-slice: one mega-context would couple
  every decision function to every other for no tested gain.
- Follow-ups for later slices: beyond the idle-restore allowlist above, the prompt-idle
  hide/show/park machine itself (`promptIdle`, `bootParked`, mount
  migration, focus/pointer listeners) wants the same decision/effect
  split. Next concrete slices: the message-key body effects
  (`message-actions.ts`, see §5) and the unselected-scroll bodies; the
  three Space answers (`promptIdleKeyAction`, the `scrollEnterAction`
  bare-Space note, `spaceFocusesEmptyPrompt`) could converge into one
  Space dispatcher afterwards.

## 2. Extract a speech controller (second-largest logic mass)

- Speech orchestration spans the `startSpeech` / `speakReply` /
  `maybeSpeakReply` / `speakQuote` / `toggleMic` / `dictateNativeFirst`
  cluster in `+page.svelte` (plus `speakingId` / `speakingSelection` /
  `vocalized` / `voiceError` state).
- The two engines already share one callback contract (`SpeakCallbacks` —
  web in `src/lib/voice.ts`, native in `src/lib/nativeTts.ts`), but the page
  does the conducting: utterance ids, stale-cancel guards, quiet-vs-loud
  paths.
- New `src/lib/speech.ts`: engine-agnostic controller (pick engine, queue,
  per-utterance id checks, progress callbacks). Page keeps only UI flags.
- Also the best place to catch stale-cancels-newer-speech bugs in a unit
  test instead of by ear.

## 3. Unify the reading-aids pipeline

- Aid logic is scattered across `reading.ts`, `pinyin.ts`, `furigana.ts`,
  `furiganaRuby.ts`, `aidLoading.ts`, `annHighlights.ts`, plus inline page
  helpers (`pinnedKinds`, `aidSeenKey`, `latinFallback`,
  `messageSpeechLang`, `speechLangsFor`).
- Language detection is re-derived at several layers (`ttsLangFor` /
  `replyLangFor` / `messageSpeechLang`).
- Goal: one pipeline — per message, compute kinds → ruby HTML → speech lang
  once. Removes real duplication, not just moved code. Medium-large; needs
  care since aids interact with streaming replaces.

## 4. Domain-slice the `$state` scatter (small, incremental)

- The page holds dozens of `$state` declarations across annotations,
  search/find, sideview browser, scroll-hold, and inspect overlay.
- Follow the `src/lib/chat.ts` pattern (plain objects + function updates,
  never classes in `$state`): group into domain slices (search/palette,
  annotation UI, sideview) with updater functions.
- No behavior change; stops unrelated domains from sharing
  effect-subscription accidents.

## 5. New candidates (from the Sep 2026 slices)

- Message-key body effects (`toggleHoverAids`-style pin/unpin-all,
  center-message pin, fold/edit/cut/delete dispatch) still walk
  `viewChat.messages` / `chat.messages` inline behind the tokens. A
  tested `message-actions.ts` (pure target resolution + pin-toggle math,
  effects in the component) would finish §1's tail — needs care since
  aids interact with streaming replaces.
- `saveSettingsNow` fans out to every settings save; `persistSecrets` is
  now bundle-cached and skips unchanged saves, so the fan-out is cheap —
  no coalescing work needed unless a save path starts doing real I/O.
- The secrets bundle is one opaque string: the Rust `keychain_*`
  commands and the Android `Secrets.kt` path needed no changes and want
  none (per-platform files stay look-first, per above).

## Shipped alongside (not a refactor — user-facing bug)

- 2026-09-14: macOS Keychain asked "allow" once per provider on every
  hydrate and every settings save (`persistSecrets` rewrote all keys
  unconditionally). Now one `providers` bundle item holds every key
  (canonical JSON, legacy per-provider items migrate once then delete
  best-effort), and persists/hydrates track the last-known bundle so an
  unchanged save touches no Keychain item at all. A pre-hydrate save
  never clobbers a stored bundle with emptiness. `secrets.test.ts`
  pins bundle round-trip, write-skip, migration, and the race guard.
  The `secretAccount` format freeze still holds (legacy reads depend on
  it). No Rust changes — the commands already take opaque accounts.

## Deliberately not doing

- Splitting `+page.svelte` for size alone (decided against; nothing fixed so
  far was caused by size).
- Classes or method-bearing stores in `$state` (breaks re-render).
- Touching the Rust per-platform `tts`/`dictate`/`ocr` files without first
  verifying they actually duplicate logic — look-first, lower priority.

## Agent sessions

- 2026-09-13 — Muse Code: `01a09c11-282a-7023-9e5a-8461b7164df8`
- 2026-09-14 — Muse Code: `01a09eb5-5649-73b2-a57e-19838c9b74d6` (§1 slices:
  idle trio, command chords, chrome cluster, sidebar/scroll-enter/modal;
  §5 new candidates; Keychain bundle fix)
