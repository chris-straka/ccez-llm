# Tap-to-reveal on mobile duplicates message tail + collapses composer

## Symptoms (Samsung S24, Android app WebView, dark theme, `hideButtons` ON)
1. Tap a message (user's own AND assistant's) to reveal its action buttons.
2. The tapped message's row opens correctly, BUT a second fragment appears
   pinned above the composer showing **only the message's last line(s)**
   **plus a second copy of that message's action buttons**.
3. The composer text box collapses at the same time (tools row remains,
   `.cm-content` ~0 height); may recover on reload, may flicker while the
   LLM streams.
4. Whole-message duplication was reported earlier ("I see the same message
   twice") but current screenshots show the tail-only variant.

## Decisive observations from screenshots
- Shot A (09:25): user msg `test` shows user action row (copy/check/pencil/
  trash). Below the assistant reply sits the tail fragment: last line
  `What would you like to do?` + assistant action row
  (speaker/refresh/pencil/trash).
- Shot B (09:32): assistant msg tapped (cursor on its row): full two-line
  reply + row visible mid-screen, AND the same last line + row repeated at
  the bottom; composer input box gone.
- So: the duplicate is the message's LAST LINE(S), not the whole message,
  and it affects both roles. Any theory must explain **tail-only**.
- UPDATE (09:39, light theme — bug is theme-independent): tapping a
  THREE-PARAGRAPH message does NOT trigger it; a fresh short exchange
  (one sentence each) DOES. Trigger is length-dependent: short content
  (fits viewport, `.messages` does not scroll) breaks, long content does
  not. This implicates scroll-dependent paths (`scrollIntoView`,
  scroll-anchoring, sticky) over message-count/state paths.
- UPDATE: the ghost text is TRUNCATED mid-word (`Give me one sentence
  abou`) and rendered UNDERNEATH the composer's own toolbar icons
  (paperclip/speaker/keyboard overlap it). So the ghost lives IN THE
  COMPOSER REGION, clipped by the composer's collapsed input box.
- UPDATE (decisive): NONE of the ghost fragment's buttons work. The ghost
  is NOT a live `<article>` — it is a non-interactive bitmap: a paint /
  compositor artifact, not a state/DOM duplication.
- UPDATE: ghost text is NOT selectable (long-press selects nothing) — pure
  bitmap, no DOM node behind it. Rotating to landscape + tapping does NOT
  reproduce (full relayout clears it; also wider viewport). Short chats
  have no scrollbar, so the scroll-repaint test needs 4+ messages first.
- Waypoint EXONERATED: the nav only renders when `points.length > 3`, so
  in the 2-message chats where the ghost appears it is not even in the
  DOM. Its menu items are plain label buttons (no action rows) and
  `visibility:hidden` until opened. Correlation (waypoint appears as chats
  grow) is just the scrollability threshold, not causation.
- CONFIRMED pattern: once the chat is long enough to scroll (waypoint
  visible), the bug stops appearing entirely. Artifact needs a
  non-scrollable list — scrolling repaints clean. This is now the
  strongest discriminator: short/no-scroll = ghost, scrollable = clean.
- Ghost LIFECYCLE is bound to the row: it does NOT outlive the 3s row
  auto-close, and re-tapping the message shut kills it too. So the
  artifact lives exactly as long as the row's open state — it is created
  with the open paint and invalidated with the close, never independent.
- `will-change: opacity` exists only on the DESKTOP hover rows
  (`main.hover-user/hover-assistant`); the touch hide-buttons path has no
  layer promotion of its own — the stale layer, if any, is the WebView's
  doing, not ours.
- Em-dash alignment (10:56 ghost starts near a "–") checked and ELIMINATED
  as a text-logical boundary: `splitSentences` (`src/lib/voice.ts`)
  splits on `.!?…` only, never on dashes, and no sentence-segmented text
  overlay exists anywhere (no karaoke/read-aloud panel; `speaking-sel`
  only recolors `::selection`). Like the mid-word "abou" clip, the cut
  lands on PIXEL position, not a text unit — consistent with a bitmap,
  not a node.
- Shared-lifecycle grep (answering "the buttons + collapse + ghost must be
  one node"): NOTHING renders conditionally on the tap state.
  `shownActionsId` drives only `data-actions-open` (a CSS opacity flip);
  `hoveredIdx` feeds keyboard shortcuts only. So the linkage is a shared
  TRIGGER with synchronized paint invalidation, not a shared node — stop
  hunting nodes.
- Unified theory (untested): tap steals editor focus → GBoard hides →
  visualViewport resize → composer remeasure race (collapse) + stale tile
  over the composer region (ghost). The row's close fade repaints and
  clears the tile — which is why the ghost's life matches the row's life
  without any DOM bond. Predicts: no ghost when the keyboard was never
  open; collapse on keyboard-hide even without taps.
- Mitigation shipped (unverified on device): tap-reveal now settles a
  double-rAF `editor?.remeasure()` after paint — same settle the send
  paths use. Aims to heal the collapse and repaint away the tile before
  it sticks. Device verdict needed: ghost still sticks? collapse gone?
  (Note: `armMessageDrag`/`trimMessageDrag` are selection-trimming,
  not drag images — no app-side drag-image mechanism exists.)
- ON-DEVICE PROOF (chrome://inspect, emulator/phone WebView): tail-string
  occurs ONCE in `innerText`, and the Layers panel shows NO ghost layer —
  only `#document` (root scroller, single 10.4MB layer) plus two
  `accelerated scrollbar` layers. The ghost is a stale region in the ROOT
  layer's tile grid, not a stuck composited layer: invalidation (not layer
  management) is the whole game. Bonus: a `Touch event handler` slow
  scroll region sits at the viewport bottom (composer area).
- `.cm-content` measured HEALTHY (40px) with the row closed — collapse is
  strictly co-temporal with row-open, healed on close (by the close fade
  repaint and/or the shipped remeasure).
- Mitigation FAILED: with `f00b998` on device the ghost still sticks —
  the editor-rect repaint from `remeasure()` does not clear it. The stale
  tile must sit (at least partly) outside the editor box (toolbar zone),
  or a remeasure alone doesn't invalidate it.
- 11:53 variant: ROW-ONLY ghost — the assistant action row duplicated at
  the bottom with NO message text above it (earlier variants showed tail
  text + row). The tile captures whatever painted last in that region.
- Emulator `Created/Destroyed VkInstance` log lines are Vulkan init
  noise — meaningless for this bug, ignore.

## Ruled out (with proof)
- **Second `<article>` / re-sent message**: trusted `touchscreen.tap` on
  WebView-UA Chromium (412/360/320px wide) keeps `article` count at 2 and
  the reply text occurs exactly once in `document.body.innerText`. No
  `sendMessage` path fires on tap (tap target is `.rendered`, send path
  requires composer text + is streaming/empty-guarded).
- **CSS `content: attr(...)` clone**: only tooltip `::after`s
  (`content: attr(data-tip)`, gated on `:hover`/`:focus-visible`) exist;
  `data-tip` values are short hints ("Copy"), never message text.
- **Positioned clone/overlay**: all `position: fixed/absolute` selectors
  audited (aside, modal-veil, lang chips, waypoints, ann popups, toast,
  voice-error, sel-menu, tooltips, send-btn, prompt-tools) — none renders
  message text.
- **Viewport width**: 360px and 320px trusted-tap probes are clean.
- **`hideButtons` setting**: with it OFF, tapping just focuses; reporter
  confirms bug needs the hide/reveal path (`.actions.open` / tap-to-reveal).
- **Duplicate `<article>` / double-send**: ghost buttons are DEAD — a real
  duplicate's buttons would work. Lab single-send also yields exactly 1
  user + 1 assistant article. No second node exists.
- **Edit-mode misfire** (`editMessage` loads own text into the composer):
  fits own-message ghosts, but the 09:32 ghost shows ASSISTANT text and
  edit mode refuses non-user roles. Dead buttons kill it too.
- **App CSS layer promotion**: only `translateZ(0)` (`.lang-chip`) and one
  `will-change: opacity` exist — nothing on messages/composer that would
  cache a stale layer by itself.
- **Tauri shell misconfiguration** (2026-09-07, read directly): manifest has
  no `hardwareAccelerated="false"` (HW accel on by default), no transparent
  window background in `tauri.conf.json`, Tauri v2 current, no custom
  WebView settings in `src-tauri/src/*.rs`. The shell is vanilla.
- **Vite/HMR, Tailwind**: build-time only; nothing at runtime that rasterizes.

## Prime suspects (unchecked on device — artifact-first ordering)
1. **Stale compositor tile after tap-triggered smooth-scroll**: tap opens
   the row; `scrollIntoView`/`scrollToBottom` (`block:start`, smooth) runs
   while the row's layout shift is still settling. Short chats (no scroll
   room, `scrollHeight == clientHeight`) give the scroll nowhere to go, so
   a mid-animation paint of the message's tail sticks at the viewport
   bottom over the collapsed composer — and is never invalidated because
   nothing else repaints that region. Long chats scroll normally, so no
   artifact. Check `jumpTo` (~line 1905) and `scrollToBottom` callers in
   `src/routes/+page.svelte`, plus `visualViewport` resize /
   `keyboardOpen` composer-height handling.
2. **Tap `focus()` + GBoard resize racing the composer re-measure**: tap
   focuses something (message `tabindex`? editor `focus()`?), the keyboard
   resizes the WebView, and the composer's cached zero-height line boxes
   (see the `remeasure()` settle comments in `doSend`/`resend`) leave the
   toolbar painted over the messages region with a stale message bitmap
   beneath it.
3. **Touch drag-image / text-selection ghost**: a tap that the WebView
   interprets as the start of a selection/drag captures a bitmap of the
   message + row; if the gesture is cancelled oddly the bitmap persists.
   Dead buttons fit perfectly. Check `user-select` handling and any
   `dragstart`/`selectstart` listeners.

## Repro in this repo (all clean on desktop Chromium — the bug is device-only)
```bash
# trusted tap, mobile UA, narrow widths; prints article count/geometry/dupes
bunx playwright test e2e/android-touch.e2e.ts
```
Probes used `page.touchscreen.tap()` on `article .rendered` with seeded
history. Synthetic `TouchEvent`s do NOT reach the Svelte handlers — only
trusted taps count.

## What is needed to close this
1. **Repro length rule**: seed ONE short user+assistant exchange (fits the
   viewport, no scroll), trusted-tap the message body. Long/multi-screen
   chats do not reproduce — do not test with those.
2. **Ghost-vs-repaint test (on device, no tools needed)**: while the ghost
   is visible, scroll the chat list. Ghost scrolls WITH the messages =
   stuck layer in the scroll container (suspect 1). Ghost stays FIXED or
   vanishes = overlay/compositor tile or cancelled drag-image (suspects
   2–3). Optional confirm via `chrome://inspect`: `querySelectorAll(
   'article').length` should equal the real message count.
3. If state bug: add `page.touchscreen.tap` Playwright test asserting
   `article` count and tail-string occurrences stay at seed values after tap.
