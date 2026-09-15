# Ccez LLM — DONE (archive of finished stages)

Moved here from `TODO.md` so the working file holds open work only.
History is preserved, newest last within each section. The full verbatim
requests behind old items live in git history (`PROMPT.md`, `PLAN.md`, …).

## Snapshot from the TODO header at archive time
# Ccez Studio — TODO (single source of truth)

Merged 2026-09-12 from `PROMPT.md` + `PROMPT2.md` (raw request logs) +
`PLAN.md` (decisions/stages) + `PLAN2.md` (working pile) + `TODO.md`.
Those files are deleted; history lives in git. Done items were dropped —
what's below is all remaining work. Spec is `README.md`; agent handoff
(commands, gates, architecture) is `AGENTS.md`.

Bots: checkboxes are terse on purpose. The full verbatim request behind any
item lives in the deleted logs — recover with:
`git show HEAD~1:PROMPT.md`, `git show HEAD~1:PROMPT2.md`,
`git show HEAD~1:PROMPT3.md`, `git show HEAD~1:PLAN.md`,
`git show HEAD~1:PLAN2.md`, or the pre-merge `TODO.md` at the same ref.
Composer/message items pair with screenshots under `imgs/`. When picking up
an item, expand it with acceptance criteria first; don't guess.
## Shipped (condensed — detail in git log)

S0 scaffold -> S1 providers/keys -> S2 core chat/prompt/vim -> S3 messages/code/
paste-collapse/thoughts -> S4 annotation/translate -> S5 reading aids (OFF
default) -> S6 voice (+AVSpeech mac bridge, +Android TTS, +multilingual) ->
S7 desktop polish/updater/icon/keychain -> R2 chrome -> R3 layout (46rem,
sidebars) -> R4 behavior (pins->top-posts, header) -> R5 submit -> R6 composer ->
Batch P (shell detect, traffic geometry, voice bar, readback ranking,
annotation matching, pills, menus) -> Night3 (tray, langid, scroll glide,
textai spec, v0.2.2 CI fixes, release pipeline per-arch DMGs). v0.2.5 tag
cut; release chain outcome still unconfirmed (see Now).

## Now (in progress)

- [x] Annotation draft restore on return is broken — fix first.
      Accept: 1 unsent draft (`.prompt-tools .ann-wrap`, see
      `imgs/annotation_textbox_filled.png`) in chat A survives New chat and is
      back (exactly 1, not duplicated) on return to A; S4 contract holds
      (select → comment → wrapped into next query).
- [x] `e2e/annotation-chat-scope.e2e.ts` failing — fix.
      Accept: `bunx playwright test e2e/annotation-chat-scope.e2e.ts` green —
      B's composer starts at 0 `.ann-wrap`, A restores to 1.
- [x] Confirm v0.2.5 rename/verify/publish outcome (`gh release view v0.2.5`).
      (Confirmed Sep 2026: DRAFT by github-actions, all per-arch assets present + latest.json; verify -> publish -> prune -> rename chain NOT run yet.
      Publish is a deliberate release action — still pending an explicit go.)
- [x] Review + resolve the moderate Dependabot alert on the default branch
      (flagged at push time, 2026-09-12). (Triaged on work/stream-chrome2:
      glib RUSTSEC-2024-0429 via tauri->gtk 0.18 — no safe solo bump, solver
      rejects, upstream not on gtk 0.9; documented in Cargo.toml, Linux-only,
      no app code touches glib. Cargo 59/59 green. Revisit on Tauri gtk-0.9.)

## Pile: waypoint + sidebar chrome (added Sep 2026, user pile-on)

- [x] Waypoint jump icon in the main text prompt must not appear on desktop
      or web (the far-right waypoint control already covers it there).
      (Done on work/merge-batch 62e56f1; `waypoint-sidebar.e2e.ts` 5/5 green at b3cc2d5.)
- [x] Far-right waypoint overlay opens at the MIDDLE option, not the top.
      (Done on work/merge-batch 62e56f1; `waypoint-sidebar.e2e.ts` 5/5 green at b3cc2d5.)
- [x] After jumping via a waypoint option, hovering outside the overlay
      closes it.
      (Done on work/merge-batch 62e56f1; `waypoint-sidebar.e2e.ts` 5/5 green at b3cc2d5.)
- [x] Space with nothing selected always focuses the main text prompt
      (never selects the top chat).
      (Done on work/merge-batch 62e56f1; `resolveSidebarSpaceEnter` unit +
      `waypoint-sidebar.e2e.ts` green at b3cc2d5.)
- [x] Sidebar message counter caps at two digits: 99+ past 99 messages.
      (Done on work/merge-batch 62e56f1; `waypoint-sidebar.e2e.ts` 5/5 green at b3cc2d5.)
- [x] Export button must not shift on hover (layout shift).
      (Done on work/merge-batch 62e56f1; `waypoint-sidebar.e2e.ts` 5/5 green at b3cc2d5.)
- [x] Sidebar X button: smaller button (same size as export), larger X
      glyph; the saved space goes left of the export button.
      (Done on work/merge-batch 62e56f1; `waypoint-sidebar.e2e.ts` 5/5 green at b3cc2d5.)

## Pile: composer

- [x] Idle-hide: main prompt hides on inactivity; image bubble must hide too.
      Click / `i` / Enter / left-click-on-non-button / mobile tap brings it back
      immediately. Mobile default timeout = never (always visible). Only hide
      when the prompt (or its backdrop) actually occludes text; the backdrop
      hiding the text must go away with it.
- [x] Composer text overlaps counter pill cluster (padding fix).
      (Done on work/stream-composer2: remeasure first-line reservation;
      composer-tools "clears the tools cluster" e2e green.)
- [x] Composer code block: typing triple-backtick changes nothing until
      Shift+Enter commits the block; empty fence assumes text; no nesting;
      3x Shift+Enter exits. (Done on work/stream-composer2; fence e2e green.)
- [x] Pasted-text tag: Ctrl+O expands/collapses all text in the tag (Muse
      Code style) — grey shade, not a code block, no own background.
      (Done on work/stream-composer3: prompt-focused Ctrl+O expands every
      `[Pasted content N chars]` tag, repeat re-collapses via remembered
      spans; falls through to the thoughts toggle with no tags; marker
      restyled grey with no background/border. `editor.test.ts` x12 +
      `intake.e2e.ts` 8/8 green, incl. the `[Pasted image]` tag tests.)
- [x] Image pill <-> `[Pasted image]` tag two-way removal (removing one removes
      the other). (Done on work/stream-composer2; intake e2e green.)
- [x] Paste-image flow: say `[Pasted image]`, no leading newline, cursor one
      space after. (Done on work/stream-composer2.)
- [x] IMG pill: align with composer, no left/right spill, scroll when many.
      (Done on work/stream-composer2.)
- [x] Clear attachment pills on send. (Done on work/stream-composer2;
      "send clears pills and files a chip" e2e green.)
- [x] Image.png/paperclip icon sizes track font size.
      (Done on work/stream-composer2.)
- [x] Image cards replace pills: thumbnail preview + footer (tokens,
      icon copy button, OCR, X). (Done on work/stream-composer2; intake e2e
      "image cards" green.)
- [x] Icon-only copy buttons everywhere (reuse message-button copy logo).
      (Done on work/stream-composer3: full sweep found exactly one text
      button left — the translate-result Copy — now the shared copy glyph
      with an accessible name; message rows, per-annotation buttons,
      fence bars, attachment cards already icon-only. New
      `copy-buttons.test.ts` x3 + `composer-tools.e2e.ts` 9/9 green.)
- [x] Sent-message attachment chip above the message, left of annotation marker.
      (Done on work/stream-composer2; chip e2e green.)
- [x] ESC with composer focused unfocuses everything.
      (Done on work/stream-composer2; "ESC drops focus" e2e green.)
- [x] Fenced-code input box revival (shelved): fencelang + Shift+Enter
      auto-close, language bar w/ Collapse/Copy glyphs, per-lang highlight,
      triple-Shift+Enter exits, Enter inside = newline, Cmd+Enter sends.
      (Revived Sep 2026 on work/s3-leftover with no editor surgery: the
      parked WebKit/Tauri block bugs are avoided by design — only the two
      fence bar lines become widgets, body rows stay real text so the
      caret/IME always sit on text (`src/lib/fences.ts` pure parser +
      `editor.ts` fence widgets). Verified `fences.test.ts` x11 +
      `editor.test.ts` x12 + `e2e/fence.e2e.ts` 6/6 green. Deliberate
      deltas from the old spec: the triple-Shift+Enter exit collapsed to
      a single Shift+Enter on an empty body, and plain Enter inside a
      fence still sends (newline is Shift+Enter; Cmd+Enter sends). Native
      WebKit/Tauri-shell behavior unverified here — e2e runs Chromium.)

## Pile: messages + rendering

- [x] `$$` display math not rendering — fix. (Verified Sep 2026 on
      work/stream-rendering: `extractMath` + KaTeX path in `src/lib/render.ts`
      already handles `$$…$$`; `render.test.ts` x32 + all 6 `e2e/latex.e2e.ts`
      pass unmodified. No code change needed.)
- [x] Inline `$math$` rendering (display fences already work).
      (Done Sep 2026 on work/stream-rendering: `extractMath` in
      `src/lib/render.ts` now pairs single `$…$` with price/join guards —
      opener needs non-space after + non-alnum before, closer needs non-space
      before + non-alnum after, spans containing a bare `$` stay literal,
      `$$`/fences/code-spans/escapes untouched; same inline chrome + copy
      path as `\(…\)`, so no `+page.svelte` change needed.)
- [x] Math chrome: no fold/copy/math labels; bar-click folds; body-click
      copies + toast; chevron + TeX preview.
      (Done Sep 2026 on work/stream-annotation2: display math renders a fold
      bar (chevron + truncated TeX preview, keyboard-operable button) with no
      labels; bar-click folds via `data-folded`, body-click copies TeX with a
      "Copied" toast (skipped while a selection is live); inline math renders
      bare. Unit-locked in `render.test.ts`; behavior pinned in `latex.e2e.ts`.)
- [x] AI code fences: no copy/fold buttons; language logos if cheap.
      (Done Sep 2026 on work/stream-annotation2: code head is a language-label
      fold bar with no buttons (bar-click folds via `data-folded`, body-click
      copies code with a "Copied" toast, skipped while selecting); logos
      dropped as not cheap — no glyph set exists and Shiki already colors
      blocks apart. Heads strip from quotes like math. Unit-locked in
      `render.test.ts` + `annotations-dom.test.ts`; behavior pinned in
      `message-code.e2e.ts`, `textai.e2e.ts` assertion updated.)
- [x] Right-click on latex/code folds must never start TTS.
      (Fold heads are buttons, so the restored desktop `contextmenu` speak
      path skips them by its button guard — silence specs in `latex.e2e.ts`
      + `message-code.e2e.ts` still green after the Sep 2026 restore.)
- [x] Right-click (even empty space) must never start audio.
      (Empty space has no `.rendered` ancestor and blank clicks resolve to
      no word, so both stay silent — `sel-menu.e2e.ts` still green after
      the Sep 2026 restore. REVERSED in part Sep 2026: right-click on
      message text speaks again (selection first, else hovered word) with
      the native menu unblocked — pinned by `right-click-speak.e2e.ts`.
      Sep 2026 (post-merge-batch): word path restored per user call as
      selection > word-under-cursor > open-message-space reads whole
      message; true empty space (no `.rendered` ancestor) stays silent.)
- [x] Copy toasts: latex copy shows toast; wording is "Copied" everywhere
      (not "Copied as plain text").
      (Done Sep 2026 on work/stream-annotation2: message copy now toasts
      "Copied" (the button tooltip keeps describing the plain-text mode);
      math/code body-copy already toast "Copied" via `onToast`. Locked by
      `actions-reveal.test.ts` + the latex/message-code toast specs.)
- [x] Message with ONLY annotations renders as en-dash + annotation marker
      above, same font size as text, and stays unfolded. Message copy excludes
      annotations; each annotation copies on left-click in either overlay
      (icon-only button, no text).
      (Done Sep 2026 on work/stream-annotation2: refs-only rendering (em-dash
  - count pill, unfolded) already held; message copy now redacts the baked
    block via `redactedCopyText` (refs-only falls back to the quotes, never
    ""); both overlays gained an icon-only copy button (`copyAnnotation`:
    quote + comment). Unit-locked in `annotations.test.ts`; pinned in
    `annotations.e2e.ts`.)
- [x] Thinking text uses the current chat font size.
      (Verified Sep 2026 on work/stream-annotation2: `.ccez-thoughts` reads
      `calc(0.92rem * var(--font-scale, 1))`, the same size as chat text;
      pinned by the `thoughts scale with font size` spec in
      `message-code.e2e.ts`. No code change needed.)
 - [x] Code Run button + model-version bump + Cloudflare-domain hosting (later).
      (Code Run DONE Sep 2026 on work/h2-coderun: local Run button on assistant
      code blocks Code-Runner-style — `run_code` Tauri command (PATH-resolved
      python3/node/bun/bash/ruby/deno, per-run temp cwd, 10s kill, 64 KiB cap,
      no shell/network; browser/jsdom gets a disabled-with-reason note, unknown
      labels an honest no-runner note. `coderun.test.ts` x8 + `code-run.e2e.ts`
      4/4 + `message-code.e2e.ts` 6/6 green. Model bump: NOT needed — the
      `local-gemma` pin is already the floating `gemma4:latest`, verified present
      locally (`ollama list`: gemma4:latest = e4b 9.6GB). Hosting DONE Sep 2026:
      Pages project `personalized-llm-client` (repo-linked, `npm run build:web`
      → `build/`) already serves production at https://llm.cstraka.dev —
      verified live via API + HTTP fetch; every main push auto-deploys.)
- [x] Character components overlay for Han text (offline table already in
      `src/lib/radicals.ts`): needs a better name than "Radicals"; returns to the
      selection menu only after LaTeX + code rendering above; no release UI until then.
      Open question: offline dictionary for radical/stroke/Unihan — what source,
      how big? (Inspect currently reports unavailable offline.)
      (Done Sep 2026 on work/h1-han: overlay named "Character components",
      sel-menu button "Parts"; kana = Japanese else Chinese default with a
      JP/中文 toggle. REVISED Sep 2026 per user rule — Annotate travels
      alone except single-Han-char highlights, whose only friend is Inspect:
      Parts button + multi-char overlay removed (Inspect already shows
      components for single chars, toggle included); `han-parts.e2e.ts`
      deleted, `inspect.e2e.ts` pins Annotate-alone + single-kana-alone.
      Dict decision landed Sep 2026 — both bundled: Unihan readings+meanings
      (`src/lib/unihan.generated.ts`, 20,936 entries / 1.19MB, Unicode
      license notice embedded, regen via `bun run unihan`; hand-table
      definitions keep priority, Unihan is fallback + always-on readings)
      and cjk-decomp splits (`src/lib/cjkdecomp-subset.generated.ts`,
      3078 Joyo+top-Hanzi resolved-L1 entries / 72KB, MIT data choice with
      attribution header, regen via the cjkdecomp-subset script; hand
      TABLE stays authoritative on conflict, e.g. 電 keeps 日乚土 not
      雨电). cjkvi-ids rejected (GPLv2 via CHISE); cjk-decomp evaluated in
      `docs/cjkdecomp-eval.md` (36/57 agree; mismatches are Mainland-typeface
      finer-grain modeling — documented caveat on fallback chars). `radicals`
      + `inspect` suites pin hand-wins + fallback + honest-null. The open
      question above is answered: Unihan for readings/meanings, cjk-decomp
      subset for splits. REVISED again Sep 2026 per user call — the 57 hand
      entries are deleted as arbitrary (they were common characters, never
      Kangxi radicals): splits come solely from the vendored subset, so
      漢 shows 氵廿中夫 and 電 shows Mainland 雨电 now. Then the inspect
      TABLE (hand strokes+glosses) went the same way + `radicals.ts` folded
      into `inspect.ts` (sole consumer): stroke counts (kTotalStrokes) and
      Kangxi radicals (kRSUnicode + embedded 214-char map, 辵→辶 display
      form) now come from Unihan too — card shows Strokes + Radical rows
      (mdbg-shaped: 通 = 10画, 辶 + 7, verified). Caveat recorded in tests:
      Unihan counts follow the Kangxi/traditional convention (漢 = 14,
      Japanese shinjitai counts 13). No release UI claims.)

## Pile: annotation

- [x] Marker must not split words in half for text selection.
      (Verified Sep 2026 on work/stream-annotation2: `snapSelectionToWordEdges`
      runs in `onSelectEnd` before the menu reads the quote, CJK exempt;
      unit-locked in `annotations-dom.test.ts`, e2e `mid-word drags snap out
to whole words` in `annotations-ux.e2e.ts`. No code change needed.)
- [x] Create-annotation textbox centers over the selection when the selection
      is smaller than the box; current position for larger selections. Annotate
      open-button stays at selection end near cursor.
      (REOPENED Sep 2026: the `annotations-ux.e2e.ts:48` narrow/wide spec fails
      deterministically on main and predates stream-annotation2 (bisected to
      before its base) — the earlier "verified" was wrong; needs a real fix.
      Fixed Sep 2026: `popWidth(fresh)` measures the 19rem fresh card instead
      of the nominal 384px; `annotations-ux.e2e.ts` 7/7 green.)
- [x] Hovering a previous message's annotation count scales with font size.
      (Done Sep 2026 on work/stream-annotation2: `.ann-refs-pill` reads
      `var(--font-scale, 1)` like badges; locked in `annotations-ux.test.ts`.)
- [x] Empty annotations get "?" inserted so the AI knows I'm confused.
      (REOPENED Sep 2026: `annotations-ux.e2e.ts:125` fails — after Enter no
      `article.user` appears; predates stream-annotation2 (bisected to before
      its base). Unit half holds; the send path needs a real fix.
      Fixed Sep 2026, two halves: (1) `onSubmit` no longer lets a fading-out
      (`annPopClosing`) pill own Enter — the 500ms time guard still eats a bare
      double-Enter; (2) the spec force-hovers the refs pill (the open card
      covers it by design) and pins the card's opacity transition to prove a
      genuine open before asserting the baked "?". 7/7 green.)
- [x] Click-hold off-chat then drag into chat must not highlight above the
      current line; dragging off-screen must not highlight everything above.
      (Verified Sep 2026 on work/stream-annotation2: `armMessageDrag` arms on
      off-chat press, `trimMessageDrag` clamps on every selectionchange via
      `clampDragAnchorToFocusLine`/`lineStartOffset` (unit-locked); wiring
      locked in `annotations-ux.test.ts`. No code change needed.)
- [x] Overlay edit: save button hover-in must animate like hover-out; Enter
      saves (no newline); textarea styling pass (near-black — confirm or fix).
      (REOPENED Sep 2026: `annotations-ux.e2e.ts:169` fails deterministically;
      predates stream-annotation2 (bisected to before its base). Unit half
      holds; needs a real fix.
      Fixed Sep 2026: transition symmetry pinned in `annotations-ux.test.ts`,
      spec measures the dark field while the edit is open; 7/7 green.)
- [x] Annotation pencil hover: glow color, not disappear.
      (Done Sep 2026 on work/stream-annotation2: `.review-pencil:hover` glows
      accent-blue with a drop-shadow (symmetric transition on the base rule)
      instead of going ink; locked in `annotations-ux.test.ts`.)
- [x] Math annotation: normalize selection to whole equation; clear stale wash.
      (Done Sep 2026 on work/stream-annotation2: `currentQuote` expands
      math-internal picks over the equation body via `equationBodyOf`
      (both ends must sit in one equation); `quoteFragmentText` drops
      `.ccez-math-head` chrome; the re-stamp unwraps the stale fragment
      wash with every other mark. Unit-locked in `annotations-dom.test.ts`.)
- [x] Undecided: new chats show one past annotation + AI answer (no expletives,
      trash-can delete, disappears after first message, "What can I do for you?"
  - 3s pause). Decide/build or drop.
    (Decided Sep 2026 on work/stream-annotation2: DROP. A faked past
    annotation is either real chat content (pollutes provider context and
    baked-block parsing) or a lying mock; delete + vanish-after-first-message
    is fiddly one-time state, and the empty hero already teaches the blank
    slate. Revisit only with a real first-run cue, never a fake history.)

## Pile: reading aids + voice

- [x] Pinyin/furigana: script-segment detection (no pinyin on Japanese words).
      Line gating (kana lines never reach the engine) plus an engine-level
      kana bail in `pinyinRuby`, same kana class as the classifier.
      Accept: `pinyinBlock`/`pinyinRuby` unit tests + ruby-wrap
      "pinyin stays off Japanese lines" e2e green.
- [x] Pinyin hover flicker: reserve annotation space up front (visibility, not
      layout). Fixed by construction: `aid-space` leading reserves ruby's room
      whenever a local aid is offered (MessageBody), readings are absolute
      overlay (`.frt`) + native ruby, hover previews only cached kinds
      (`isFuriganaCached` gate, never fetch on hover).
      Accept: furigana-hover e2e (hover fetches nothing, boxes stable) +
      furigana pin bbox e2e green.
- [x] Furigana offset further left on macOS desktop. `data-mac` (already on
      `.app`) scopes `.frt` to the iOS pull (-8px): Range-ink measurement on
      macOS showed readings ~5px right of their kanji at -2px, ~0.6px at -8px.
      Accept: ruby-wrap wrap test measures ink (<2px) on mac, boxes (<4px)
      elsewhere — 6/6 green.
- [x] Message-button icons scale with the text-size setting (pill buttons
      already do; logos/icons don't).
      (Done Sep 2026 on work/stream-voice2: `.action-glyph` holds 1.05rem
      by default; the `scaleActionsWithFont` opt-in now grows it with the
      text buttons (`main.scale-actions .actions .icon-btn .action-glyph`).
      Pinned in `actions-reveal.test.ts`.)
- [x] Per-segment TTS voices for mixed-language messages (same-voice fallback
      today).
      (Verified Sep 2026 on work/stream-voice2, no change: already shipped
      (`f820daf`) — `speechLangsFor` routes each sentence sync, `speakReply`
      speaks via `speakMultilingual`/`speakNativeMulti`; unit-locked in
      `voice.test.ts`/`nativeTts.test.ts`, behavior pinned in
      `ios-voice`/`native-voice-fallback` e2e.)
- [x] Single-kanji inspect: hovering/selecting exactly one CJK char shows an
      Inspect button -> modal with mdbg-like info (stroke order, radical, unihan;
      skip Cantonese).
      (Verified Sep 2026 on work/stream-voice2, no change: already shipped
      (`c4e688a`) — `shouldShowInspect` gates the button, overlay shows
      components/count/definition + a labeled schematic stroke-step preview
      (`hasStrokePaths: false` until KanjiVG vector data lands); settings
      gate `inspectEnabled`; `inspect.e2e.ts` green.)
- [x] Voice readback: per-chat setting, not global.
      (Done Sep 2026 on work/stream-voice2: `Chat.voice: boolean | null`
      override in `chat.ts` (`chatVoiceReadback`/`setChatVoice`, null
      follows the `settings.voice` default, loader heals pre-override
      stores); toggle/shortcut/button all write the visible chat only;
      `settings.ts` untouched. Unit-locked in `chat.test.ts`.)
- [x] Thinking-level change mid-thinking applies to next request (confirm/ensure).
      (Confirmed Sep 2026 on work/stream-voice2, pin test only: the page
      evaluates `activeThinkingId(settings)` synchronously per send/resend
      and the provider bakes the captured string into that request's body,
      so a mid-flight change can't touch the in-flight call; same-instance
      two-send pin in `openai-compat.test.ts`.)
- [x] Mic button on macOS: user doesn't care — NO ACTION.
      (Verified Sep 2026 on work/stream-voice2: intentionally untouched —
      `toggleMic`/`dictateOnce` paths unchanged, `mic-toggle.e2e.ts` green.)

## Pile: scroll + navigation + chrome

- [x] j/k hold: smooth scrolling must start immediately, no initial tiny jump
      (d/u same; d/u scroll faster). (Done on work/stream-chrome2:
      scrollkeys e2e pins JK/DU glide velocities with no discrete jump.)
- [x] `gg` with nothing selected -> top; `G` (shift+g) with nothing selected
      -> bottom. (scrollkeys e2e green.)
- [x] `z` scrolls to top of hovered message; `Z` to bottom.
      (scrollkeys e2e green.)
- [x] Shift+Cmd+Plus/Minus adjusts chat width. ("shift-meta-plus widens
      the chat column" chrome e2e green.)
- [x] Chat width configurable past 80rem.
      (Verified Sep 2026 on work/w1-waypoint: `CHAT_WIDTH_MAX` = 120 in
      `src/lib/settings.ts`, settings slider `max={CHAT_WIDTH_MAX}`, no
      80rem remnant anywhere; keyboard chords clamp to the same max.)
- [x] Own messages stop drifting right past AI width.
      (Verified Sep 2026 on work/w1-waypoint: `article.user` shrink-wraps
      with `margin-right` docking its edge to the assistant column
      (`min(85%, chat-width)`), so own messages never drift right past
      AI width on narrow windows.)
- [x] Fresh-install defaults: own-message background OFF; message buttons
      hover-only for both me and AI.
      (Verified Sep 2026 on work/w1-waypoint: `defaultSettings` has
      `ownBubble: false`, `hoverUserActions: true`,
      `hoverAssistantActions: true` — fresh installs already match.)
- [x] Option for message buttons scaling with font size (verify current state;
      create-annotation box scaling with font size also unverified — check both).
      (Verified Sep 2026 on work/w1-waypoint: `scaleActionsWithFont`
      setting + `main.scale-actions` rules scale buttons/glyphs with text
      size (default OFF). Annotation review card checked: fixed rem sizes,
      consistent with all other UI chrome (prompt 16px fixed, palette,
      settings) — no change, scaling it alone would break chrome rhythm.)
- [x] Sliders: dragging up resets to default — decide keep/fix. Only the
      inner buttons (100%, 36 rem, 6s) reset — label clicks must not. Inactivity
      slider tops at 10s; max reads "never" (never hides).
      (Decided + done on work/stream-chrome2: drag-up resets, label clicks
      keep ("chat-width label text keeps the value" e2e), idle tops at 10s
      with "never"; settings-panel e2e green.)
- [x] Sidebar: animated slide + opaque background (no see-through).
      (Verified Sep 2026 on work/w1-waypoint: drawers are `position: fixed`
      with solid `var(--bg)`, box-shadow + border, and 0.22s transform/width
      transitions both ways — slide reads on open and close, no transparency.)
- [x] Header: remove top-right buttons; rebrand Ccez Studio -> Ccez LLM
      (UI strings only). (Done on work/stream-chrome2; "top bar shows text"
      chrome e2e green. Residual: one "Ccez Studio" in the sleep-block
      reason string — system-facing, not UI copy.)
- [x] Language buttons: nudge down + fade until hover (mac); submenu
      languages alphabetical; submenus not jammed against the prompt.
      ("empty-state language buttons sit clear of the hero" e2e green.)
- [x] Fullscreen ESC: tap blurs/dismisses only; 2s hold exits. (Tap + hold
      dismissal pinned by scrollkeys Escape e2e, green.)
- [x] Remove screenshot-to-chat (Shot); keep paste + OCR.
      ("screenshot-to-chat is gone, paste still takes images" e2e green;
      one history comment still mentions Shot.)
- [x] Export: icon-only button per sidebar chat row, left of delete; drop
      header button. ("sidebar row export downloads markdown" e2e green.)
- [x] Idle-hide: skip when chat empty or content shorter than viewport.
      ("empty chat never hides" + "short thread keeps the composer" e2e green.)
- [x] Settings checkbox gap inconsistency (find + fix).
      (Verified Sep 2026 on work/w1-waypoint: already fixed —
      `.check + .check` gives stacked boxes one 0.55rem rhythm in and out
      of fieldsets, with the in-row hover toggles explicitly zeroed.)
- [x] Remove CJK font + lesson-audio settings sections (lesson-audio froze app).
      (Done on work/stream-chrome2: "settings show no study-fonts or
      lesson-audio sections" voice-data e2e green.)
- [x] Keychain re-prompt: stable self-signed identity for dev rebuilds.
      (Decision Sep 2026, stream-platform: ad-hoc dev binaries change
      identity every rebuild, so the Keychain ACL re-prompts. Fix is a
      persistent local self-signed "Ccez Dev" code-signing cert (Keychain
      Access -> Certificate Assistant) + `codesign -s` on the dev binary;
      never commit the identity. Done Sep 2026 on work/s3-leftover:
      code-side identity locked — `KEYCHAIN_SERVICE` exported from
      `src/lib/secrets.ts`, mirrored doc on Rust `KEYCHAIN_SERVICE`, and
      `secrets.test.ts` pins frontend == Rust == bundle identifier plus
      the frozen `secretAccount` format (9/9 green, eslint clean); no
      +page.svelte change needed. Still needs a real Mac rebuild cycle
      to confirm no re-prompt — device cycles unverifiable here.)
- [x] Updater in dev: explain unavailable instead of fetch error.
      (Done Sep 2026 on work/stream-platform: `updateRouteFor` gains an
      isDev leg returning a `dev` route; the settings updater path shows a
      plain explanation in dev shells. `updates.test.ts` x5 pass.)

## Pile: search + sideview

- [x] Search palette: DOM focus follows highlight; ESC moves input->list;
      j/k navigate results. (Done on work/stream-chrome2: "ESC moves focus",
      "j/k walk results", "Enter jumps" search e2e green.)
- [x] Cmd+P: native focus order must match highlighted message; Tab/Shift-Tab
      must match arrow-key target; ESC then j/k/arrows scroll results.
      (Verified Sep 2026 on work/w1-waypoint: `focusSearchHit` moves DOM
      focus onto the highlighted `.search-hit` on every j/k/arrow step, so
      Tab continues natively from the highlight; first ESC moves
      input→list, second closes; `search.e2e.ts` covers ESC/j-k/Enter.)
- [x] Sideview -> plain Browser: rename research->browser; shortcut-only
      (drop toggle button); no Google Translate framing anywhere near it; better
      error handling; edge-drag resize with memorized size; Cmd+T from the prompt
      unfocuses into the browser search bar; single tab preferred (if tabs, then
      Shift+Cmd+[ / ] switches; note Shift+Cmd+H/L taken).
      (Done work/stream-chrome: Cmd+T = single-tab Browser everywhere except over
      selected message text, where it keeps the S4 translate-lookup; selection
      trigger untouched. Engines gone -> address bar (DuckDuckGo home, bare hosts
      get https, else web search); width memorized in settings.sideviewWidthPx
      280-720; shell refusal surfaces an error line instead of silent fallback.
      Shell dock + shell edge-drag still hand-verify in tauri dev.)

## Pile: sending + OCR

- [x] Per-chat concurrent sending (global sending lock -> per-chat) so one
      thinking chat doesn't block asking in another. (Done on
      work/stream-composer2: per-chat lock in `chat.ts`, `chat.test.ts`
      unit green.)
- [x] OCR: investigate Chinese-paragraph miss; errors surface as red toasts.
      (Done on work/stream-composer2: backend learner default; ocr.e2e
      green.)

## Pile: platform + release (needs hardware)

## Pile: input + sidebar + shortcuts + extras (from PROMPT3)

- [x] Remove the Mac menu-bar logo entirely (doesn't look good, not wanted).
      (Done in Wave 0.1 checkpoint: tray builds only on Windows/Linux now;
      the Dock owns Show/Quit on macOS.)
- [x] Submit button: drop pinned language buttons from the top bar; replace
      the submit arrow with the emoji, centered vertically + horizontally.
      (Verified Sep 2026: 📨 emoji send already on main, no pinned lang
      buttons in the top bar — no change needed.
      REVERSED Sep 2026 per user: the button shows ↑ with no language and
      the language flag while one is set (replacing 📨 entirely); the
      top-left pill is gone, its click-to-clear replaced by the menu
      toggle (same as the number-key repeat). Pinned by
      `send-button.e2e.ts`.)
- [x] Own-message background breaks at large font sizes — fix.
      (Done Sep 2026 on work/pile-submit: radius/padding track
      `min(var(--font-scale, 1), 2)`; `user-bubble.e2e.ts` green.)
- [x] Shortcuts modal: first entry is "Shortcuts show/hide" ("Toggle shortcuts
      menu"); fold new keyboard/right-click tricks in pithy, no paren spam.
      (Done Sep 2026 on work/pile-shortcuts: Send/Focus/New-chat/Edit rows
      added, stale Speak rows out, parens de-spammed;
      `shortcuts-modal.e2e.ts` 2/2 green.)
- [x] Middle-click opens the shortcuts modal.
      (Verified Sep 2026: `onMiddleClick` + auxclick listener already on
      main, modal lists it first — no change needed.)
- [x] Settings checkboxes: text highlightable without toggling; click still
      toggles.
      (Verified Sep 2026: `keepSelectionWithoutToggle` capture listener in
      SettingsPanel already implements exactly this — no change needed.)
- [x] Cmd+F finds text in the current chat, cycling hits like a browser.
      (Done on work/stream-chrome2: "Ctrl+F finds text, Enter cycles hits"
      search e2e green.)
- [x] Clicking a chat in the sidebar closes the sidebar. Cmd+Shift+H opens it;
      j/k then starts from the current chat, not the top.
      (Verified Sep 2026: pick closes the list and lands in the prompt,
      `sideIdx` anchors j/k — already on main, proven by
      `sidebar-topbar.e2e.ts`; no change needed.)
- [x] Double-tap on non-button chat-sidebar areas closes it. Double-tap on the
      settings-sidebar top expands the window like the main top bar.
      (Verified Sep 2026: aside ondblclick guard + panel-head zoomWindow
      already on main — no change needed.)
- [x] Main chat top shows traffic lights and nothing else; prompt/backdrop must
      never cut off top messages (only window bounds clip text).
      (Done Sep 2026 on work/pile-sidebar: app-title removed, header is an
      empty drag strip; find bar moved in-flow; chrome + sidebar-topbar
      16/16 green. Sep 2026 follow-up: the reply-language pill left the
      header too (flag now lives on the send button) — the strip paints
      nothing (static, transparent, verified live) and keeps only drag,
      zoom, and traffic-light clearance.)
- [x] Settings menu shows the build version (or "dev" in dev).
      (Status Sep 2026, stream-platform: release builds already stamp
      `v{version} · build {stamp}` in SettingsPanel; dev hides the stamp
      deliberately ("dev · live reads as noise" — prior decision). Confirm
      that stands or restyle; no code changed.
      Confirmed Sep 2026: stamp + dev-hide both present in code — stands.)
- [x] Annotations are leaking across chats — each chat (incl. its prompt) owns
      its annotations. (Related: annotation-scope e2e under Now.)
      Accept: deleting a background chat leaves the active composer's drafts +
      attachments untouched; deleting the active chat lands on its neighbor
      with that neighbor's drafts restored and the deleted id pruned from
      `ccez-studio-annotations-v1`.
- [x] LaTeX annotation behavior: selecting equations double-highlights and
      stale highlights persist. Decide the interaction (partial-equation highlight
      would help) or constrain it deliberately.
      (Decided on work/stream-chrome2: partial-equation pick snaps to the
      whole equation ("partial equation pick snaps" latex e2e green).)
- [x] Selection: never highlight bullet points (Ctrl+A includes them today;
      mid-text leftward drags eat text but leave bullets). Lean on native web
      selection behavior where possible. (Done on work/stream-chrome2:
      "list-item selection excludes the bullet marker" sel-menu e2e green.)
- [x] langid dead code (MIN_WORDS/MIN_SCORE/STOP_WORDS/is_cjk/
      is_latin_word_char/identify_lang_offline): remove or wire up — decide, don't
      carry warnings.
      (Decided Sep 2026 on work/stream-platform: WIRED UP, kept —
      `tts_identify_lang` calls it off-Apple, every helper is used; the
      blanket `allow(dead_code)` narrowed to an Apple-only `cfg_attr` so
      the module still compiles (and tests) on the dev host.)
- [x] Offline AI fallback: when offline, Gemma becomes its own
      settings option replacing the DeepSeek/Muse bubbles; auto-switch back on
      reconnect. Android via MediaPipe; Mac via the user's existing Ollama (audit
      installs, pick the right model for an M4 mini, remove cruft, wire in).
      (Done Sep 2026: `local-gemma` built-in (Ollama `gemma4:latest` on this
      16GB M4 mini), keyless providers end-to-end (registry, settings
      defaults, no-auth headers, panel hint instead of key field), offline
      parks cloud providers on Gemma and reconnect restores only what the
      drop parked (`offline.ts`, unit + `offline-fallback.e2e.ts` green,
      live Ollama completion verified). Android MediaPipe leg still needs a
      real device. Model cruft (55GB, e.g. qwen3:30b 18GB, dup qwen3.5 tags)
      listed, nothing deleted — removals are the user's call.)

## Pile: s1-suites (work/s1-suites)
- Merged e2e suites (sel-menu+ios, android+touch+share, voice+error+native+ios, furigana+hover+ruby, annotations+ux, chrome-misc one-liners); 9 specs removed, merged files green on E2E_PORT=5231 except 3 failures also failing on HEAD (chrome idle-hide, annotation badge re-press + review note-labels).

## Refactors (Sep 2026, main)
- [x] Platform-cast cleanup: `src/lib/web-apis.d.ts` declares the DOM-lib-missing
      APIs (launchQueue, save picker, Tauri internals, speech recognition,
      CSS.highlights/Highlight, build stamps); ~20 `as unknown as` repeats
      deleted. One `closestFromTarget` helper in `events.ts` collapses ~35
      `as HTMLElement` repeats; stale casts (import.meta.env,
      EditorView.composing, mediaDevices) and five settings delete-casts
      (via `dropRetiredKeys`) go. Check 0/0, 780 unit green.
- [x] Key-dispatch decisions out of `onKey` into `src/lib/keybindings.ts`
      (`messageKeyAction`/`spaceKeyAction`/`deleteChatScope`, 13 unit tests):
      11 guard soups become token checks, bodies verbatim. Priority inside
      (Esc+f-over-fold, M/N needing no hover, X yielding to rich editors).
      aid-actions/fold-preview/row-hide e2e green; 4 prompt.e2e.ts failures
      reproduce on the pristine tree (pre-existing). Remaining ~19 `onKey`
      branches (modifier chords, scroll/sidebar clusters) still inline —
      next slice when wanted.

## Failure triage + gates (Sep 14, main)
- [x] Stale specs retargeted, real regressions fixed: latex/message-code
      fold tests now pin right-click toggle (ae72137's contract);
      keybindings j/Down at newest returns enter-edit (Sep-8 j-exits
      contract, park-bottom removed); staging test wakes the boot park;
      settings test tracks systemLocale. Pre-existing suite fully green.
- [x] Attachment strip unburied: floating-composer clearance moved from
      scroller padding to main padding (pills/preview/error clickable,
      composes with the Android safe-area inset). Intake pill X e2e green.
- [x] Gates green: 896 unit, svelte-check 0/0 (vite skew contained with
      a self-removing ts-expect-error), eslint clean (`.muse/` ignored,
      e2e/scripts project coverage, all real findings fixed).
- [x] Small slice: `readingsOnly` → `reading.ts` with inert-output unit
      tests backing the overlay `{@html}` disable. No-big-refactors
      verdict recorded (occurrence math already extracted; §§2–3 parked
      on hardware/ears).

## Composer frosted + annotation dismiss (Sep 15, main)
- [x] Badge edit lost focus on Tab: the comment box blur-saved on any
      blur, so Tab onto Delete closed the card. Departure blurs still
      save/cancel; in-card moves are ignored (relatedTarget). Tab-order
      e2e green in Chromium + WebKit.
- [x] Sent-refs card dismiss: click toggled only. Now Escape (ladder,
      below review) and outside pointerdown (capture) close it; pill
      cursor default → pointer. Dismiss e2e green in Chromium + WebKit.
- [x] Composer frosted: card 75%-capped color-mix + 18px backdrop blur
      (webkit prefix first), thread reserve moved from main padding to
      in-scroller padding so mid-thread text bleeds through (main-level
      could only shrink the scroller — nothing ever showed through);
      strip/preview/error keep a binary main lift. Tail/bleed/glass e2e
      green in Chromium + WebKit, bleed verified on a real render.
- [x] Attach/voice post-rise shift: owner-confirmed gone after the
      frosted composer landed (ten headless probes had measured zero
      throughout; likely a subpixel settle the translucency masks).
- [x] Composer opaque by default + desktop-only Composer transparency
      slider (`composerOpacity`, clamped 0.2–1, glass class only below
      full opacity so the blur costs nothing when off). Opaque-default,
      slider-apply/reset, and settings-clamp tests green.
- [x] Desktop rise honors Reduce Motion (was covered only on phones):
      card + strip transitions go none under the query. Emulation e2e
      green in Chromium + WebKit.
- [x] Traffic lights hover-reveal (macOS): overlay-titlebar buttons
      fade to 0 at rest via button-relative tracking areas, back on
      hover, forced visible in fullscreen; pure `target_alpha` unit
      tests, cargo check/clippy/test green. Pixels await owner eyes.
- [x] Prompt slide "lost" (Sep 15 report): not a regression — 0748feb
      only added the reduce-motion query (base ramps untouched, proven
      by a new no-preference-durations e2e). Instant summon = the OS
      Reduce Motion switch left on from the experiment + the desktop
      rise now honoring it. Devtools Rendering emulation suffices for
      experiments, no system change needed.
- [x] Whole-window Transparency dead (Sep 15 report): the color math
      was innocent (probed real Chromium: color-mix preserves hue) —
      the opaque `<html>` root capped the slider, and on a mismatched
      OS/app theme it read as darkening. --bg-alpha now syncs onto
      documentElement, the themed root + settings drawer + modal ride
      it (bubbles/menus/inputs stay opaque); wry already runs a
      transparent webview, so wallpaper should show. New root-thinning
      e2e (alpha reaches html, hue steady vs opaque baseline) green.
- [x] Traffic lights fade-in-never-out + ghost move + no cursor (Sep 15
      report): three causes, one package. (1) Tracking areas must never
      hang off NSButtons — NSControl rebuilds them on state change, so
      the fade-in ate its own exit events; hover is now recomputed from
      live button geometry on every mouse move (local monitor, blocks
      via the objc2-app-kit block2 feature) + a content-view enter/exit
      refresh, change-only fades, Reduce-Motion snap. Pure hit-test
      units added. (2) The HTML veil sat at the stale (12,14) spot
      while the lights had moved to (20,26) in 2409f3c with no noted
      reason — veil removed (a web patch can never fade native chrome
      anyway), position restored to (12,14); veil e2e replaced with an
      absence guard. Buttons are never repositioned or overlaid, so
      stock hover glyphs + arrow cursor are untouched. macOS module
      compile-checked for real (aarch64-apple-darwin check green —
      Linux-only check is what let the exit bug ship); 68 cargo tests,
      clippy clean for the file. Hover pixels + seat position await
      owner eyes on next launch.

## Android message chrome + reply signals (Sep 15, main)
- [x] `bun run tauri:dev` package script for the sign wrapper (was
      shell-file-only).
- [x] Button-scaling toggle owns the gaps: the list gap, pair margin,
      and tail spacer rode raw font-scale while the toggle touched only
      button sizes. Base is now fixed; the scaled rules live under
      `main.scale-actions`. Real-layout android e2e (off < 20px,
      on > 2x off at 400%) green; stylesheet unit tests rewritten to
      the opt-in contract.
- [x] Fold chevron off mobile rows (swipe folds, body tap unfolds).
- [x] Review card `note:` labels are now `-`, and the note reads italic
      `#c7c7cc` like a sent annotation's comment. Hyphen/style e2e green.
- [x] Annotation deletes thump the shared delete beat (inside
      `removeAnnotation`, all paths).
- [x] Phone chat goes full-bleed at fontScale >= 3.6
      (`effectiveChatWidth` pure helper + unit tests + --chat-width e2e).
- [x] Mid-stream chat switch no longer misattributes: first-token/done
      thumps fire only while the origin chat is still open, and the
      completion read + background ping use the origin chat's message
      (the live `chat` pointed at the new thread). Verdict: no, the new
      chat should not thump for the old one's reply. (Untouched
      follow-up noticed: the shared composer/draft resets in the same
      completion block still run after a switch.)
- [x] Reply-finished notification when backgrounded + opt-out checkbox
      ("Notify when replies finish in the background", default on, both
      branches): infra already pinged on full receipt; added the setting
      gate on the ping and the send-time permission ask. Checkbox
      persistence e2e green. (d)/(f) wiring has no committed test:
      hardware-gated, pure beat/gate logic already unit-tested.

## Dev Keychain silence (Sep 15, main)
- [x] Mass password prompts in dev: every unsigned `tauri dev` rebuild
      ships a fresh code identity, so macOS re-prompted once per
      Keychain item (bundle + legacy migration touches ≈ the reported
      5 dialogs) on every backend round — not tests (nothing in the
      gates reaches the login Keychain) and not retry-spam (prompts
      are per-item ACL checks). Hooked up the documented "Ccez Dev"
      workflow for real: persistent local self-signed Code Signing
      cert created in the login keychain (openssl, codeSigning EKU;
      key material deleted after import), `scripts/sign-dev-binary.sh`
      re-signs `src-tauri/target/debug/ccez-llm` (proven live on the
      real binary: signs + verifies), `scripts/tauri-dev.sh` launches
      with launch-time signing. `codesign -s` resolves the identity
      even though `find-identity` declines to list it. One round of
      Always Allow per item now sticks across rebuilds; mid-session
      Rust relinks need a re-sign. AGENTS.md + secrets.ts pointer
      updated. No committed test (shell wrapper + machine-local cert;
      verification is the live sign/verify smoke, re-runnable).
