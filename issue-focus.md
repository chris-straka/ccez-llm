# Focus-drop issue log (open, owner-reported)

## Symptoms (owner, macOS app AND browser preview)

Clicking into a text field: the caret blinks for a small instant, then
focus is gone (lands on nothing — typing produces text nowhere).
Clicking back in flashes focus and drops it again.

Drops: annotation EDIT card, composer placeholder text and everything
right of it, provider Base URL, Model, all add-custom-provider fields,
System prompt, voice language select.
Holds: prompt floor click (below the placeholder), `cmd+f` find bar,
annotation CREATE box, all buttons/menus (Save/Cancel/Delete work).

Notes: idle slider sits on Always (the app default). Reproduces on a
fresh launch, first annotation. Selecting existing text first avoids
the drop (typing overwrites fine). Fast typing can sneak one character
in before the drop.

## Environment

macOS 26.6.2, Tauri shell (WKWebView) + `bun run dev` browser
preview.

## Reproduction attempts (all HOLD — bug not reproduced in harness)

Seeded harness (`bunx playwright test`, own E2E_PORT each):

- `e2e/annotations.e2e.ts` "badge edit keeps focus after open and
  re-click" (committed, fd077ad): badge click, 800ms wait, re-click,
  800ms wait — focused throughout, Chromium.
- `/tmp/focus-probe/probe.e2e.ts` (scratch, kept): document-level
  focusin/focusout log around badge open + re-click. Chromium AND
  Playwright WebKit: exactly one `out:DIV.cm-content->TEXTAREA` +
  `in:TEXTAREA`, nothing after — also with a typed comment, mouse
  wandering across the message (wash repaints), and ALWAYS hide
  (`promptIdleSec: -1`, prompt booting parked).
- `/tmp/focus-probe/empty.e2e.ts`: empty chat + ALWAYS, click
  composer center — `down` (not prevented) + `in:DIV.cm-content`,
  holds.
- `/tmp/focus-probe/settings.e2e.ts`: ALWAYS, `Meta+,`, click first
  settings textarea — focused, typed "Q" lands in the box.
- `/tmp/focus-probe/sel.e2e.ts`: bare `removeAllRanges()` and the
  full mousedown-preventDefault + programmatic-focus + mouseup-
  `removeAllRanges` sequence in WebKit — focus holds in both.
- Real composer path with the new dep tree: `intake.e2e.ts` "long
  paste collapses to a tag; Ctrl+O expands and re-collapses" green
  headless (covers the mixed CodeMirror copies).

## Ruled out (with evidence)

- Keybindings hollowing incomplete: no — all dispatch decisions are
  pure tested functions; remaining raw reads are effects.
- Origin-chat routing regressions: no — both send sites share
  `resolveSendCompletion`, resets gated on `stillHere`.
- Cast-cleanup tail: finished — the only survivors are narrow
  platform boundaries.
- `removeAllRanges()` as the stealer: innocent bare and in-mouseup
  in harness WebKit.
- Idle ticker / ALWAYS mode alone: probe holds with `-1` seeded.
- Morph/stale-binding (third-party theory): the failing flow is
  seconds after save — a fresh mount with a fresh binding and two
  focus attempts, not the 160ms morph window.
- Settings object replacement remounting inputs: no reassignment
  exists — persistence serializes via `$state.snapshot`.
- Updates panel / `$bindable` edits: committed 62afbad, check 0/0,
  lint clean, 959 unit green; edits are ownership markers + a
  route gate, no runtime behavior change.
- CodeMirror duplicate copies (state/view .4/.11 nested under
  lint/autocomplete/lang-html/lang-css after the dep update):
  intake e2e green on the real path; `overrides` cleanup still
  queued for an idle window, then commit the lockfile (currently
  modified, uncommitted).

## Audit round 2 (global handlers, all read)

- Every window/document mousedown, mouseup, click, focusin/focusout
  handler read end to end (`onBadgePress`, `dismissReview`,
  `clickGuardsPass`, `armMessageDrag`, `snapSelection`,
  `preserveMessageHighlight`, `noteDownPoint`, `onMouseUp` incl. the
  control early-return + `onSelectEnd` tail, `onIdleClick`,
  `onFocusIn`, `onFocusInIdle`/`onFocusOutIdle`, `trimMessageDrag`,
  `clampOffChatDrag`, `restoreDragSelection`, parking `$effect`).
  No global mousedown `preventDefault`, no global blur/focus, no
  state-object replacement on click paths.
- Stuck invisible `.ann-pop.closing` eating clicks: killed by
  inspection — `.closing` has no `pointer-events: none`, BUT no path
  strands it (`settleAnnPop` always resets `closing=false`; open
  during fade morphs back to visible). No probe needed.
- `exitScrollMode` / iOS-sidebar `activeElement.blur()` calls are
  scoped to their gestures, not global.
- Sidebar-dismiss caret landing (tick `editor.focus`) is guarded by
  the control allowlist + `promptIdle`; not global.

## Standing suspects

1. System-WebKit selection/focus coupling newer than the harness
   build (e.g. `restoreSelection`'s `setBaseAndExtent` during the
   edit-flow re-stamp) — needs the doc-level focusin/out log from
   the failing browser to confirm or kill.
2. Extension interference in the owner's browser (find bar and
   programmatic focuses survive; native-focus paths die) — needs
   the private-window test.
3. Persisted-state poison (real chats/annotations/drafts vs seeds)
   — needs a state export or a bisect against seed shapes.

## This session (chat probes, owner live browser)

- Doc-level focusin/focusout around badge-edit open: exactly one
  `focusin TEXTAREA`, no `focusout` after. DOM focus lands and stays
  (matches harness probe).
- activeElement sampler (250ms, 8s) on badge click: BODY x5, then
  TEXTAREA solid to the end. No steal, no blur in the edit card.
- `.ann-pop textarea:focus` is `outline: none` over
  `border: 0; background: none` — zero visible focus cue. The edit
  card "drop" is consistent with invisible focus, not lost focus.
- Keydown probe in Base URL ("edafafafasdf"): every key reaches
  INPUT with `defaultPrevented=false` — the capture dispatcher is
  innocent for plain letters.
- Input-event probe: insertions DO fire and values grow
  (`.../f`, `f`, `ff`; screenshot shows `ff` persisted). Chars land
  intermittently; spam-click racing sneaks them in.
- No `beforeinput` listeners anywhere; no readonly flags in
  components. FIELD_SELECTOR covers input/textarea/select;
  scrollModeAction only consumes j/k/g/G/i/Enter/u/d/Ctrl+G and
  exempts composer + find — plain letters should type even with
  Always on.
- Open: focus timeline in Base URL *with typing* (drop on click or
  on first keystroke?); node-identity check for input remount;
  focusout destination if it fires.
- Screenshot session (owner Brave @ :1420, edit card open): badge
  mousedown `prev=true`, one `focusin TEXTAREA`, `POLL BODY ->
  TEXTAREA`, then seven textarea mousedowns `prev=false` with NO
  `focusout` and NO further POLL change. Focus holds through
  repeated clicks — no steal visible. Combined with "typing does
  nothing", the fork is now: node swap (focused node detached,
  reports as activeElement, eats keys silently) vs keystroke
  eating with focus genuinely held.
- Pending owner probe (no timing needed, run while broken):
  `document.activeElement.isConnected` +
  `document.querySelectorAll(".ann-pop textarea").length`.
  Detached-or-2 = swap hunt (what re-creates the textarea);
  attached-and-1 = key-path hunt (keydown logging).

## Next (owner)

1. Owner runs the focusmon snippet (doc-level focusin/focusout +
   mousedown + 250ms activeElement poll + focusout stack) in a
   reproducing browser window and pastes the `[focusmon]` lines.
2. Private-window repro: REFUSED by owner ("would never matter") —
   extension/state fork stays open instead.
3. OS-vs-app fork (asked, pending): do text fields work in other
   Mac apps right now? Broken everywhere = OS-level (restart /
   Accessibility), not a patch.
4. Post-drop Tab probe (asked, pending): Tab after a drop reveals
   the hidden focus (composer jump = focus was body).
5. If (1) shows `focusin` then `focusout ... -> BODY`: silent reset
   — suspect 1. If it shows the field itself yet typing dies:
   key-swallowing, not focus — suspect the capture key dispatcher.
