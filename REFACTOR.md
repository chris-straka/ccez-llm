# Refactor candidates (Sep 2026)

Standing constraint: `src/routes/+page.svelte` stays one file by explicit
decision (P23 in TODO.md). The refactors below extract logic into tested
modules — they never split the template for size alone.

## 1. Hollow out `onKey` into `src/lib/keybindings.ts` (biggest win, substantially complete)

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
- Still inline by decision, not by omission: the unselected-scroll
  intent glide (guard + extracted call is the finished shape —
  extracting further would just rename the intent object), the summon
  body (one effect behind an extracted chord), the fold/cut/delete
  lookups (one line each, no logic to pin). Only new dispatcher
  branches are unwritten — they follow the established split, no new
  guard soup.
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
- The prompt-idle machine contributes its guard chains (`src/lib/idle.ts`:
  `shouldHideForAlways`, `shouldIdleHide`, `idleTapAction` with the
  press-guard order, plus click-control/math/tap-overlay predicates) —
  timers, press tracking, focus effects, and flag clearing stay in the
  component verbatim. The remaining machine (ticker wiring, mount
  migration, boot-park correction) is lifecycle, not decisions.
- Follow-ups for later slices: the three Space answers
  (`promptIdleKeyAction`, the `scrollEnterAction` bare-Space note,
  `spaceFocusesEmptyPrompt`) could converge into one Space dispatcher;
  the boot-park correction is three lines with no decision worth
  pinning — leave it.

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
- Status: language steps and the start-failure banner (`startSpeechError`)
  extracted and tested; the engine pick, wake-lock timing, fallback
  retry, and stale-cancel guards stay inline. A controller here is an
  inversion of control, not an extraction — the remaining orchestration
  verifies by ear/device, so it belongs in its own session with hardware
  and a user at the loop.

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
- Status: partially sliced. The hotkey-side toggle math moved to
  `message-actions.ts`, and the offer computation is now shared:
  `offeredLocalAids` / `aidDisplayText` live in `reading.ts` beside
  the detection primitives (hotkeys, render, and vocalize call one
  definition). The speech language steps moved the same way
  (`latinFallback` / `messageSpeechLang` / `speechAttemptable` /
  `speechLangsFor` in `voice.ts`, call sites pass engine/fallback/
  inventory explicitly). What remains is the render-path unification
  and the engine-agnostic controller, which need streaming-careful
  redesign and ears respectively — not slicing.

## 4. Domain-slice the `$state` scatter (small, incremental)

- The page holds dozens of `$state` declarations across annotations,
  search/find, sideview browser, scroll-hold, and inspect overlay.
- Follow the `src/lib/chat.ts` pattern (plain objects + function updates,
  never classes in `$state`): group into domain slices (search/palette,
  annotation UI, sideview) with updater functions.
- No behavior change; stops unrelated domains from sharing
  effect-subscription accidents.
- Pilots shipped: the find bar is one `FindState` object (`src/lib/find.ts`
  with `emptyFind` + the tested `stepFindCursor` cycle math); the search
  palette is one `PaletteState` object (`src/lib/palette.ts` with
  `emptyPalette` — open/query/hits/busy/cursor, timers/els/store stay
  out). Resets stay field-by-field where the original preserved a field
  (palette close keeps the cursor, reopen resets it). The annotation
  pill contributes its save/cancel/blur matrix instead of a grouping
  (`src/lib/annPop.ts`: pending-vs-fresh-vs-existing, empty-draft
  cancel) — the full pop/badge/review/timer grouping stays put as too
  wide for a blind slice. The sideview panel is one `SideviewState`
  object (open/address/error/hosted/fallback/drag appended to the
  existing shell-bridge module, plus the tested `draggedWidth` sign);
  viewport caches and shell orchestration stay out. Shell dock/refusal
  paths verify on device only — the fallback strip is e2e-pinned.

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

## 6. New candidates (Sep 14 review — second pass, a–c done, d open)

- Send/edit/retry controller (mirrors §1). `doSend` (3597) / `resend`
  (3693) / `onSubmit` (3731) plus the edit/retry tail (`retryFailed`,
  `rerunFrom`, `editMessage`, `resetInlineEdit`, `cancelMessageEdit`,
  `saveMessageEdit`, `commitMessageEdit`, `onInlineImagePasted`,
  `insertInlineImageMarkers`, ~3597–3950) mix guards (`canSubmit`,
  `sendGuardUntil`, `editingMsgId`, missing-provider, `annPop` close,
  idle-blur) with effects (`sendMessage` / `resendLast` in `chat.ts`
  already own the streaming). Extract decision functions over a facts
  snapshot (facts → action token, effects in the component) exactly like
  `keybindings.ts` — the guard order is the contract to pin.
  (DONE — `src/lib/submit.ts`: `submitAction` / `sendAction` /
  `editMessageAction` / `commitEditTarget` + `submit.test.ts`;
  `onSubmit` / `doSend` / `editMessage` / `commitMessageEdit` hollowed,
  effects inline.)
- Scroll/viewport state object (extends §4 + `scrollkeys.ts` math).
  `noteScrolling` / `scrollToBottom` / `scrollAfterRender` / `jumpTo` /
  `scrollToViewCursor` / `scrollChatBy` / `scrollChatTop` /
  `scrollChatBottom` / `scrollHoveredEdge` (~3989–4230) own timers,
  rAF handles, and viewport caches inline, while `scrollkeys.ts`
  already owns the pure math (`halfPageDy`, `indexAtViewportLine`,
  `stepScrollTop`, `holdIsTap`, velocities). Group the timers/handles/
  caches into one `ViewportState` object (follow the `FindState` /
  `PaletteState` / `SideviewState` pilots) — stops scroll effects from
  sharing subscription accidents with unrelated domains.
  (DONE — `src/lib/viewport.ts` held as `$state(emptyViewport())`;
  `nearBottom` / `STICK_PX` moved to `scrollkeys.ts`; glide supersede
  uses a `holdSeq` generation because `$state` proxies break identity
  checks.)
- Slice `SettingsPanel.svelte` (1,666 lines, ~15 functions — it is
  template/style-heavy, not logic-heavy) and extract the page theme
  style (~3,858 lines, `<style>` at 8304–12161, theme tokens as
  `:global(html)` light/dark + print + android overrides +
  reduced-motion). Provider/voice/appearance/update sections become
  sub-panels; theme tokens move to `app.css`. Unlike the banned
  `+page` split, component splits already happened (`MessageBody`,
  `SettingsPanel` itself) — this continues that line. Mechanical, zero
  behavior change, and it should improve HMR invalidation.
  (DONE — `src/lib/components/settings/` holds `Provider` / `Defaults` /
  `Voice` / `Appearance` / `Updates` panels + shared `panels.css`
  mechanically scoped under `.settings-inner`; theme tokens + print
  sheet moved to `src/app.css`; component dark overrides deliberately
  stay co-located.)
- Unify the attachment intake pipeline. `intake.ts` (317 lines) mixes
  three unrelated intakes (screen capture, launch-queue/file split,
  chat-export/markdown download) while `attachments.ts` (image
  downscale, markers) + `attachExtract.ts` (pdf/docx) + `chat.ts`
  `apiContent` (text fences, multimodal parts) form the file →
  marker → API-payload chain across four files. Goal: one intake —
  file → `Attachment` → marker → payload — with screen/launch/export
  split back into their own modules. Smaller than §§2–3; needs care
  around the marker/edit interplay.
  (DONE — `intake.ts` keeps the shared kernel
  (`isPermissionDismissal`, `dropFilesFromDataTransfer`); screen
  capture → `screenCapture.ts`, launches → `launchFiles.ts`, export →
  `chatExport.ts`, tests split per file, 18/18 green.)

## 7. New candidates (third pass — all smaller than §§1–3, not started)

- Split render-math out of `render.ts` (729 lines). The math cluster
  (`extractMath` through `mathHtml`, ~135–430: placeholder codec,
  preview/copy text, LaTeX fence de-duping, HTML emission) is
  self-contained against the thoughts/sources prologue (19–65),
  `sanitize` + `renderInto` (455–573), paste folds (574–637), and
  `htmlToText` + shiki highlight (639–710). New `render-math.ts` with
  the placeholder codec as its tested contract. Medium; the remaining
  file is still multi-concern but each cluster is small enough to leave.
  (DONE — `src/lib/render-math.ts` owns the placeholder codec,
  preview/copy text, fence de-duping, `mathHtml`, plus the two emission
  helpers it needs (`escapeHtml`, `CODE_COPY_GLYPH`) so the dep runs one
  way; `render.ts` re-exports `escapeHtml` for existing callers;
  `MessageBody` imports math fns from `render-math`; tests split per
  file, 50/50 green.)
- Unified notice/banner queue. Five one-off error states each own a
  flag plus (sometimes) a timer: `attachError`, `vocalizeError`,
  `voiceError` + `voiceErrorTimer`, `toast` + `toastTimer` in the page,
  `updateStatus` / `modelError` in `SettingsPanel`. One tiny queue
  (message, kind, timeout; updater results ride it instead of the
  `onToast` prop) removes the timer bookkeeping duplication. Small.
  (DONE — `src/lib/notices.ts`: one slot per visual kind
  (inline/banner/voice/toast) with a `holdSeq`-style generation, so a
  stale timer can never clear a newer notice and no `clearTimeout`
  bookkeeping remains; `ProviderPanel.modelError`'s bare-setTimeout
  race fixed the same way. `updateStatus`/`onToast` left alone — a
  sticky note with no timer, nothing to unify.)
- Extension-per-file split of `editor.ts` (878 lines). The pure
  paste/fold math is already extracted (`pasteSpans`,
  `pasteToggleAction`, `sendPasteFolds`, `trimPasteTail`); what remains
  is CodeMirror wiring in three interleaved groups — paste-collapse
  extensions, fence fold/copy/run widgets, theme + `createPromptEditor`.
  One file per group, shared `StateEffect`s in a fourth. Small-medium;
  mostly import reshuffling, low decision value per line moved.
  (DONE — `editorEffects.ts` (5 shared effects), `editorPaste.ts`
  (paste wiring + its pure math, moved together for cohesion),
  `editorFences.ts`, `editorTheme.ts`; `editor.ts` keeps
  `createPromptEditor` + the public surface via re-exports, so the
  page, `textarea-editor`, and tests keep their import paths.)

Looked at and deliberately not adding: the Rust per-platform
`tts_*`/`dictate_*`/`ocr_*` files each implement the same command
surface (`supported`/`speak`/`stop`/`voices`) — that is the intended
`#[cfg]`-gated architecture, not duplication. `ChatSearchStore` is a
class but correctly held in a plain `let`, never `$state`.
Splitting `chat.ts` streaming (`sendMessage`/`streamAssistantReply`)
from state CRUD would churn the one module that already follows the
target pattern for no tested gain.

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
  idle trio, command chords, chrome cluster, sidebar/scroll-enter/modal,
  scroll-mode, unselected-scroll, message-actions, keyFacts convergence,
  events predicates; §4 find/palette pilots + annPop matrix; §5 new
  candidates; Keychain bundle fix; §§2-3 marked design-stage)
