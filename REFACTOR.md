# Refactor candidates (Sep 2026)

Standing constraint: `src/routes/+page.svelte` stays one file by explicit
decision (P23 in TODO.md). The refactors below extract logic into tested
modules — they never split the template for size alone.

## 1. Finish hollowing out `onKey` into `src/lib/keybindings.ts` (biggest win)

- `onKey` (`src/routes/+page.svelte:5424`) is ~1,400 lines; only the first
  branches (message keys, Space) are extracted so far (`keybindings.ts` is
  164 lines).
- Remaining inline guards all fit the established facts-snapshot →
  action-token shape: idle-restore allowlist, inspect `h`/`l` stepping,
  shortcuts-filter carve-out, Cmd+T, Cmd+P, the Escape ladder
  (`dismissEscape`), fullscreen-hold tracking.
- Each branch becomes a pure, unit-tested decision function; effects stay in
  the component. Keyboard logic is where guard-ordering bugs live, and this
  follows the "no new untested guard soup" rule.

### Remaining branch inventory (from the message-keys/Space/Delete slice)

Rough scope: ~19 extraction units in the chord/fullscreen/shift/zoom
list (12 chord table + 4 fullscreen/find + shift group + zoom +
shift-comma), plus the 5-branch scroll/sidebar cluster and the
idle-restore/inspect/filter items above — call it ~25 branches total,
Escape excluded (stays inline per below).

- Modifier-chord table, in current dispatch order: Cmd/Ctrl+Enter send
  (field carve-out), Ctrl+Alt+Arrows (provider/thinking cycle),
  Ctrl+Alt+N and Cmd/Ctrl+N (new chat; the Shift variant rides the plain
  branch), Ctrl+Alt+S (voice toggle), Cmd/Ctrl+B sidebar, Cmd/Ctrl+.
  and Cmd/Ctrl+, (settings panel), Cmd/Ctrl+1..0 (quick-lang; body checks
  the code exists first), Cmd+D on a hovered message (needs hoveredIdx,
  outside the editor, outside fields, AND the message still present —
  keep that target-exists check in the body), the summon chord
  (`isSummonHotkey` already extracted — rewire only), Ctrl+O pastes
  (fires only when `editor?.togglePastes()` succeeds).
- Fullscreen/find chords: Cmd+E and Ctrl+Cmd+F (claimed before find so the
  dual-modifier chord never reads as Cmd/Ctrl+F), Cmd/Ctrl+P (search
  palette toggle), Cmd/Ctrl+F (body splits on `shortcutsOpen`: modal
  filter focus vs find-bar toggle — keep the split in the body, extract
  only the chord match).
- Shift-modifier group (all physical `code`, one sub-dispatch):
  BracketLeft/Right (sidebar/settings), KeyH/KeyL (close-and-land
  variants), Slash (shortcuts modal), KeyJ/KeyK (step chat).
- Zoom chords (`=`/`+`/`-`/`_` with the Shift-widens-column variant) and
  Shift+Cmd+comma (both `,` and `<` spellings).
- Scroll/sidebar cluster: the `inSidebar` block (open list owns j/k/space/l
  with preview-as-you-go), the scroll-mode block (`focusMode`, `inFind`,
  bare j/k/u/d/space plus Ctrl+U/D half-page via `spaceFocusesEmptyPrompt`
  — already extracted), the shortcuts-modal scroll box, and the Cmd+T /
  Ctrl+G entries.
- Leave inline: the bare `Escape` → `dismissEscape(inEditor)` branch and
  the `escDownAt` stamp line — single-condition, extraction adds a hop
  for no decision value.
- Transcription hazards (learned on the first slice): several bodies have
  inner target-exists checks that fall through to later branches when the
  target is gone (F fold, E edit, A aids, M/N pins, Cmd+D) — keep them as
  `if (token === ...)` chains, never a switch. There are THREE field-guard
  spellings (`isFieldTarget`, `isEditableTarget`, and Shift+D's wider
  button/link selector): the facts snapshot must carry each one separately.
  M/N need no hover (center message); Esc+f needs neither hover nor editor.
- Follow-ups for later slices: converge the per-slice facts objects into
  one shared per-keydown context (built once, not one snapshot per
  cluster); move the Shift+D and shortcuts-filter selector literals into
  named `events.ts` predicates (`isInteractiveTarget`, `isFilterTarget`)
  beside `isFieldTarget`/`isEditableTarget`. Beyond the idle-restore
  allowlist above, the prompt-idle hide/show/park machine itself
  (`promptIdle`, `bootParked`, mount migration, focus/pointer listeners —
  24 `promptIdle` refs) wants the same decision/effect split.

## 2. Extract a speech controller (second-largest logic mass)

- Speech orchestration spans roughly `+page.svelte:3245–3620`
  (`startSpeech`, `speakReply`, `maybeSpeakReply`, `speakQuote`,
  `toggleMic`, `dictateNativeFirst`, plus `speakingId` /
  `speakingSelection` / `vocalized` / `voiceError` state).
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

## Deliberately not doing

- Splitting `+page.svelte` for size alone (decided against; nothing fixed so
  far was caused by size).
- Classes or method-bearing stores in `$state` (breaks re-render).
- Touching the Rust per-platform `tts`/`dictate`/`ocr` files without first
  verifying they actually duplicate logic — look-first, lower priority.
