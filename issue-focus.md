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
2. Extension interference in the owner's browser — DEAD 2026-09-16:
   `tauri dev` shell reproduces, and the shell has no extensions.
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

## Resolution (fix slot, 2026-09-16 — reproduced in-harness, fixed)

Root cause (app-side, proven): two key-dispatch decisions had no field
guard, so hotkeys fired from inside native text fields:

1. `scrollModeAction` (`src/lib/keybindings.ts`) exempted only the
   composer (`.cm-content`/`.ta-input`) + find bar. With
   `focusMode === "scroll"` (stuck after find-cycling/Ctrl+G — nothing
   clears it on field focus), typing j/k/d/u/g/G/Ctrl+G in settings
   inputs, selects, or the EDIT card was swallowed (d→half-jump,
   j/k→step), and i/Enter yanked focus into the composer via
   `enterEditMode`. Pre-fix probe: "dijk"→"jk", "dudg"→"g".
2. `sidebarListAction` matched ANY `<aside>`, settings panel included.
   With the chats list open, j/k/l/Space/Delete/Backspace in a settings
   field walked/entered/deleted chats (l/Space yanked focus the same
   way). Pre-fix probe: "jkl"→"".

Fix: `inField: isFieldTarget(event.target)` wired into both tails
(one line each), guards inside the pure decisions, unit cases in
`src/lib/keybindings.test.ts`, committed `e2e/scroll-field.e2e.ts`
(3 tests, green). Full unit 959 green, lint clean, scrollkeys.e2e.ts
4 smooth-scroll timing failures proven pre-existing by pristine-tree
rerun (fail identically stashed). `bun run check` still 8 errors, all
in untouched editor*.ts (duplicated @codemirror versions — the queued
`overrides` cleanup).

Owner forks closed 2026-09-16 (no re-probe needed, don't reopen):
TextEdit types fine (OS-level ruled out); `tauri dev` shell reproduces
(extension fork dead — no extensions in WKWebView; shell repro current).
Residual, NOT claimed fixed: composer placeholder-vs-floor split
(onMouseUp `removeAllRanges` theory, unprobed) and the invisible-focus
confound (`.ann-pop textarea:focus { outline: none }`). Owner probes
(isConnected/count) still wanted only if symptoms persist post-fix.

## Proposal (second half: WebKit mouseup caret-kill — proven in-harness 2026-09-16)

The Resolution fix covers hotkey-letter swallowing (scroll-stuck /
list-open, Chromium-reproducible). A second, independent killer
remains, proven on current code (post-65a8af8) in Playwright WebKit:
`onMouseUp` (`+page.svelte`, the `.cm-content, ..., button, input,
textarea` branch) calls `window.getSelection()?.removeAllRanges()`
unconditionally on every plain mouseup there. In WebKit that call,
landing right after a field gains focus, destroys the just-placed
caret: focus holds (`activeElement` correct, `hasFocus` true),
trusted keydown/keypress dispatch with `defaultPrevented=false`
(incl. `charCode`), but no `beforeinput`/`input` ever fires — for
ANY key, not just hotkey letters. Chromium keeps field and window
selections separate, so it is immune: every Chromium probe holds.

Evidence (scratch probes under `/tmp/focus-repro/`, nothing
committed; matrix green in Chromium, red in WebKit on same seeds):
bare page types fine in both engines; app page (even empty chat,
mouse-only, no settings, no Meta) fails in WebKit for native
inputs, the CodeMirror composer, AND a fresh `<input>` appended to
`document.body`. `fill()` and `execCommand("insertText")` work, so
bindings/state are fine. Bare page + one `removeAllRanges()` after
click reproduces it exactly (focus held, caret 0,0, typed `""`;
control without the call types `"AB"`). Pre-Sep-14 code (`b47d785`)
fails identically — not this week's edits. DOM writes during
keydown (sync + microtask) do NOT break it; no `beforeinput`
listeners exist in `src`; computed editing CSS identical across
engines (`-webkit-user-modify=read-only` in both).

Why distinct from the Resolution fix: probes typed Q/W/A/B/hello
(no hotkey path touches those), ran with `focusMode=edit` +
sidebar collapsed (neither precondition present), and passed in
Chromium. Decisive: the composer (`.cm-content`) was ALREADY exempt
from both hotkey paths yet drops — key dispatch cannot explain it;
the mouseup wipe hits `.cm-content` directly. This half also
explains the drop/hold table end to end: EDIT textarea, composer,
all settings inputs match the wipe selector and lack the exemption
→ drop; CREATE box (`.ann-dock` exempt), find bar (`.find-bar` not
in selector), prompt floor (not in selector) skip it → hold;
select-then-type drags skip via `endedDrag` → hold; fast typing
races mouseup → one char sneaks in.

Proposed edit (in the `if (!endedDrag)` branch — skip the wipe
where the browser already moved the selection, i.e. the new caret):
```ts
if (!endedDrag) {
    // WebKit: clearing the selection after focusing a field kills
    // the just-placed caret — later keystrokes never become text.
    // Clicks into editables already moved the selection, so wipe
    // only for non-editable targets (buttons, review chrome).
    if (!target?.closest(".cm-content, input, textarea, select, [contenteditable]")) {
        window.getSelection()?.removeAllRanges();
    }
    selMenu = null;
}
```
Consider also gating on `document.activeElement` outside an
editable, for mousedown-`preventDefault` button presses that keep
field focus (ann-pop mic/save): their mouseup currently wipes the
kept caret. Regression pin must run in WebKit (the webkit project
currently matches only sel-menu; Chromium cannot see this bug):
click each field, `keyboard.type`, assert value — assert TYPED
TEXT, not just focus (the old sel probe was green-but-wrong: it
checked `activeElement`, which holds throughout). Loose end: the
native voice `<select>` is not in the wipe selector — if it still
drops after this fix, that is a third wrinkle, not this one.

## Next (owner)

1. Owner runs the focusmon snippet (doc-level focusin/focusout +
   mousedown + 250ms activeElement poll + focusout stack) in a
   reproducing browser window and pastes the `[focusmon]` lines.
2. Private-window repro: MOOT — extension fork dead (shell reproduces).
3. OS-vs-app fork: ANSWERED 2026-09-16 — TextEdit fine, app-only.
4. Post-drop Tab probe (asked, pending): Tab after a drop reveals
   the hidden focus (composer jump = focus was body).
5. If (1) shows `focusin` then `focusout ... -> BODY`: silent reset
   — suspect 1. If it shows the field itself yet typing dies:
   key-swallowing, not focus — suspect the capture key dispatcher.

## Second-agent findings (2026-09-16, read-only + /tmp probes, no source edits)

Harness verification (Always `promptIdleSec: -1` + non-empty chat,
harness Chromium, scratch configs under /tmp — repo untouched):
- Settings Base URL (panel opened via Meta+,): single `in:INPUT`,
  no focusout, `QZX` lands in value. HOLDS.
- Composer placeholder (summoned via `i`, clicked): single
  `in:DIV.cm-content`, `hi` lands. HOLDS.
- Badge edit (drag-select → Annotate → type → Enter → badge click →
  re-click → type): single `in:TEXTAREA`, `c1e2` lands. HOLDS.
- Meta+, needs a readiness wait (pressed right after goto never
  opens the panel — key listener not attached yet); panel then
  reads `closed`+`inert` and inputs are off-canvas. Probe artifact,
  not app behavior.

Coverage gap found: `e2e/helpers.ts seedChat` hardcodes
`promptIdleSec: 0`, so the committed badge-focus test (fd077ad)
ran with idle-hide OFF — never covered the owner's Always setup.
(Scratch Always probes + `e2e/scroll-field.e2e.ts` now cover it.)

Guard gaps flagged → implemented by fix slot as 65a8af8
(`inField` into `scrollModeAction` + `sidebarListAction` tails):
- `scrollModeAction` had no field guard (stuck `focusMode` ate
  j/k/d/u/g/G/Ctrl+G in fields; i/Enter yanked to composer).
- `sidebarListAction` matched ANY `<aside>`: settings-panel fields
  counted as `inSidebar`, so list-open j/k/l/Space/Delete/Backspace
  walked/entered/deleted chats from inside settings inputs.
- Keydown probe (`edafafafasdf`, all `defaultPrevented=false`) is
  consistent: it contained no sidebar keys, and `d` showed scroll
  was not stuck at that moment — the untested keys were j/k/l/Space.

Ruled out (read, no probe needed): message hotkeys
(`messageKeyAction` fully guards inField/inEditable/inInteractive);
no `dd` handler exists anywhere; `resetDraftExtras` only runs on
chat switch; summon chord needs 3 modifiers; `dragWindow` excludes
fields; composer `onDocChange` only flips `hasText`; settings inputs
never persist per keystroke; settings aside is a sibling of `main`
(`closeSettingsFromMain` innocent); Rust side has no
click-triggered focus path (global shortcut needs
CommandOrControl+Shift+Space; `focus_main` on explicit gestures only).

Residuals (real, neither explains repeated Base URL drops):
- save/cancel/remove focuses the composer after unmounting the
  card; composer parked-hidden → `focus()` no-ops → focus to BODY
  (transient, post-close papercut; needs visibility guard/fallback).
- Keychain hydration can flip `showKeyField` under a focused,
  empty API-key input → node detaches mid-typing (fresh-launch
  window, API-key field only).
- Unprobed: `onMouseUp` early-branch `removeAllRanges()` on
  `.cm-content` clicks (destroys just-placed caret; harness
  self-heals, placeholder-vs-floor split matches exactly);
  invisible edit-card focus ring (`outline: none` over
  `border: 0; background: none`).

Open: (a) confirm fix is live in owner's runtime (full dev-server
restart — stale HMR would replay the old bug exactly); (b) if drops
persist post-fix, type the alphabet slowly in Base URL and report
exactly which letters die (hotkey letters = tails still firing =
fix not live; all letters + caret held = sub-app key eating);
(c) badge-edit morph path (`bind:this` staleness on mid-fade
re-open) — next dig, never probed (audit cleared it by reasoning).
