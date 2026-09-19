# Tap-to-reveal ghost artifact — case file

Device-only paint artifact: tapping a message to reveal its action buttons
paints a dead, unselectable, viewport-fixed copy of message content over the
composer region. No DOM behind it (proven on-device). Open since the
hide-buttons feature shipped; survives one mitigation attempt.

## Status

- 2026-09-09: NOT reproducible on the physical phone (SM-S921W) — the
  reporter cannot trigger it there despite repeated tries, new chats
  included. Ghost is emulator-only (software GL tiles), consistent with
  the flipped-tile evidence. Case closed pending any phone repro; the
  Android textarea composer stays as the safer path regardless.
  OPEN. Root cause unconfirmed. Leading theory: keyboard-hide viewport resize

* row-open layout shift strand a stale region in the root layer tile grid;
  nothing repaints the viewport bottom in a short chat, so it sticks until the
  row-close fade repaints.

## Symptom variants (all same bug — dead buttons, fixed, short chats only)

- Tail text + row (09:25/09:32): assistant's last line + its row.
- Truncated mid-word + row under toolbar (09:39): `Give me one sentence
abou`, composer icons overlapping it.
- Near-sentence-start cut (10:56): starts around an em-dash — pixel clip,
  not a text boundary (splitter never splits on dashes; no sentence UI).
- Row-only, no text (11:53): assistant row duplicated, blank above it.

## Hard evidence

- Tail string occurs ONCE in `innerText` (device console).
- Layers panel: only `#document` root layer + 2 scrollbar layers. No ghost
  layer exists — stale root-tile region, not a stuck layer.
- `.cm-content` measures HEALTHY (40px) with the row closed; collapse is
  strictly co-temporal with row-open.
- Ghost dies with the 3s row auto-close AND with re-tap-to-shut.
- Long/scrollable chats never show it; landscape never showed it.
- `will-change: opacity` exists only on desktop hover rows — no app-side
  layer promotion on the touch path.
- A `Touch event handler` slow-scroll region sits at the viewport bottom.

## Eliminated (don't re-derive)

Duplicate `<article>` / double-send / edit-mode misfire / tooltip
`::after` / positioned clone / viewport width / `hideButtons` alone /
sentence segmentation / read-aloud panel / app drag images
(`armMessageDrag` is selection-trimming) / waypoint (not rendered in short
chats). `shownActionsId` drives only an opacity attribute — nothing renders
conditionally on tap state.

## Fix log

- 2026-09-07 — Android gets a plain-textarea composer
  (`src/lib/textarea-editor.ts`, same `PromptEditor` interface; wired in
  `+page.svelte` behind the existing `androidUI` flag). No measurement
  cache (collapse gone by construction), no compositor layer (ghost region
  gets normal repaints). Drops: typing-coloring, undo history, paste
  collapsing. Keeps: Enter-to-send, image attach, annotations, all prompt
  buttons. Pending: on-device tap test.
- `f00b998` tap-reveal double-rAF `remeasure()` — FAILED on device.
  Lesson: editor-rect repaint doesn't clear it; the tile sits outside the
  editor box (toolbar zone) or remeasure doesn't invalidate it.

## Device protocol (chrome://inspect, debug build)

1. `querySelectorAll('article').length` + tail-string occurrences.
2. `activeElement`, `visualViewport.height/innerHeight`, `.cm-content` rect.
3. Elements: toggle any style on `.prompt` — vanishes = stale tile.
4. Layers panel: stray layer over composer?
5. Fresh chat, keyboard never opened, tap — no ghost = keyboard trigger.
6. Rendering → Paint flashing while tapping — composer region must flash;
   flashing-but-stuck = driver bug, no-flash = invalidation gap (ours).
   (2026-09-07: reporter confirmed Paint flashing is ON in the emulator's
   Rendering tab; Layout shift regions still OFF — tick it too. RESULT:
   tapping a message flashes green ONLY on the tapped message; the ghost
   region at the bottom NEVER flashes. Verdict: invalidation gap — our
   code never asks that spot to repaint. Fixable on our side.)

- 2026-09-09: emulator screenshot shows the ghost TEXT rendered UPSIDE
  DOWN ("What would you like to try out today?" flipped 180°) while the
  ghost buttons below it are upright. Grep proves our code has no flip
  transform (only a -90° icon rotation). A half-flipped fragment is not
  producible by DOM/CSS — it is a misoriented compositor tile, which also
  explains dead buttons + no green flash. Stuck-picture theory confirmed;
  remaining question is what triggers the bad tile (row fade + smooth
  scroll still prime suspects).

7. Console, ghost up — manual invalidate, clears = automatable cure:
   `P('.prompt').style.opacity='0.999'` then back over two rAFs.
8. Settings: turn the hide-buttons toggle OFF (rows always visible, no
   fade) and tap — no ghost = the opacity transition is implicated.

## Open questions

- Does #7 clear it? (Decides the next fix's shape.)
- Does #8 implicate the row fade?
- Why does the row-close fade repaint reach the composer region?
