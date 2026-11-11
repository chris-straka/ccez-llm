# Owner notes, 2026-11-10 (from ccez-keeps)

Work these off and delete each when it ships.

- Annotating a word with punctuation after it enlarges everything being
  annotated (no punctuation: normal size).
- Scrolling a web page in the browser pane leaves after-images (the Moscow
  Times page drew its headline and buttons twice): `docs/feedback/2026-11-10/browser-scroll-afterimage.jpg`.
- The star wouldn't save "déçu" ("I already have it saved?"):
  `docs/feedback/2026-11-10/star-decu.jpg`. Same for inquiétant, lugubre,
  menaçant, maléfique (italic words in an answer; owner tried each):
  `docs/feedback/2026-11-10/star-italic-words.jpg`.
- No globe button at the top right.
- Video/channel list: text sizes all over the place ("a cluster
  disaster"); the videos tab wants another icon, music the current
  YouTube icon, the YouTube tab a cinema emoji:
  `docs/feedback/2026-11-10/channels-text-scaling.jpg`.
- Clips: S on a clip with a YouTube video picked doesn't flip the play
  button, and the start of the loop looks wrong. Owner wants a deep dive
  on this part (bugs, and maybe a newer way to do it).
- Phone, annotation reply: the Reply field covers the passage and the
  word's badge; the main prompt shows behind it and shouldn't:
  `docs/feedback/2026-11-10/phone-reply-covers-text.jpg`.
- Phone: the chat header's "1 / 1" should stay on one line:
  `docs/feedback/2026-11-10/phone-header-wrap.jpg`.
- Notes flickered in ccez-keeps while switching to ccez-llm with
  cmd+shift+enter; maybe the ccez-keys Mac app (it asks Chromium apps for
  accessibility, which can make them repaint).

# Annotations faster (owner, 2026-11-10: "Do all those things")

1. Cards ready before A: when a reply or article loads, ask in the
   background for the rarer words not known (a few per paragraph); and on
   hover (desktop), start the hovered word's card after a short dwell.
2. Two Muse requests at once: a short "meaning here" at low thinking
   (shows first, ~2-3 s) and the full card.
3. The full card at low thinking if its quality holds (time and compare).
4. Cards kept by sense: the same word in the same sense comes back at
   once (the dictionary or Apple's model checks the sense).

# Next (owner, 2026-11-10): Apple's model, an agent API, cards in layers

Agreed with the owner; work in this order, deleting each part when it ships.

Done 2026-11-10: the "Apple (on-device)" provider (`providers/registry.ts`,
keyless, `http://127.0.0.1:11546/v1`), served by ccez-apple-llm
(`~/SWE/ccez-apple-llm`, private: Apple Intelligence's on-device model as an
OpenAI-compatible endpoint, launchd `uk.ccez.apple-llm` on z and y8, this
Mac and the tailnet only). A Mac that goes offline parks on it
(`offline.ts`). Released in v0.68.1. Not yet checked: a full chat through
the app's own screen.

1. **Agent API: built 2026-11-10** (`src-tauri/src/agent.rs`, `src/lib/agent.ts`,
   `scripts/llm.ts`): `bun scripts/llm.ts [--dev] status | ask "…"
[--provider id] [--whole] | annotate "quote" [--in "sentence"] [--lang]
| lookup "word" --lang | settings …`. A Unix socket in the app's data
   folder, mode 0600 (Mac and Linux; Windows not yet). Not in a release yet.
   Left: point the phone's Apple provider at z over the tailnet with it.
   **Found while testing (open), 2026-11-10:**
   - A Muse word card takes ~24 s (annotationAnswer run outside the app
     with the owner's key: "to step back, retreat", card ok). Notes ask
     with no thinking level, so Muse thinks at "medium" over the long
     card prompt. That is the slowness the owner feels: try `low` for
     cards (time it), and the layers below matter more than thought.
   - Through the dev app, the same annotate never came back and the
     socket's 3-minute limit (`agent.rs` BETWEEN) didn't fire either: find
     why (a blocked reply thread?) before trusting long `llm` calls.
     Short calls work: `ask`, `ask --whole`, `lookup`, the dictionary card.
   - The dev app's first failures were its old Muse key (replaced with
     the owner's; restart the dev app after changing keys).
   - The instant dictionary card works (~5 ms through `annotate`); the
     owner doesn't see it: check when the UI shows a partial card.
     The dev keys file (`src-tauri/.dev-secrets.json`) is plain JSON,
     gitignored, as the owner wants.
2. **Cards in layers, one word.** (a) The dictionary card at once (facts:
   base, gender, reading, symbols, star). The owner says it no longer shows
   first: check with `llm annotate` whether the instant card
   (`reading.ts` `showInstant`, `onPartial`) still fires, and fix. (b) In
   about half a second, Apple's one line on top: what the word means in
   this sentence (the provider "apple", or ccez-apple-llm on z from a
   phone; skipped when unreachable). Facts never come from Apple's model
   (it gets gender wrong). (c) Muse's card replaces both, keeping the
   dictionary's facts (as now). An earlier card of the same word only
   stands in when neither (a) nor (b) has anything.
3. **Cards in layers, several words.** (a) At once: the device's own
   offline translation of the phrase (ML Kit on Android, Apple's
   Translation via the shell on the Mac) and short dictionary glosses of
   the harder words ("faire face à" → face up to · face (n.) · à). (b)
   About a second: Apple's line on the idiomatic sense ("here: to
   confront"). (c) Muse's explanation as now; the phrase star as now.
4. **The star missing** on a finished French word card (owner's screenshot
   2026-11-10, "reculer"): it should hang outside the card whenever the card
   has a language (`+page.svelte` `onToggleStar`).

Card content (labels, what a line says) goes to the owner first (memory:
llm-word-card-content-proposals); the layering above is agreed.

# Owner feedback, 2026-10-13 (from ccez-keeps notes)

The owner wrote these as notes in ccez-keeps through 2026-10-13 and asked
for them to live here instead; the notes were trashed once copied. Work
them off like `TODO.md` items: delete a row when it ships (the commit is
the record). Screenshots the owner attached are in
`docs/feedback/2026-10-13/`. Wording is the owner's, lightly trimmed.

## Annotations (A, the overlay, badges)

- Right-clicking a highlight with several kanji: the tinted kanji read as
  dropped from the highlight (the tint colour replaces the selection
  colour on them; `right-click-kanji-furigana-overlap.jpg`). The popups
  no longer overlap (2026-10-14); only the tint look is open.

## Selection and inspect

- Mouse selection of Chinese feels strange; the browser's own behaviour is
  better: a single hanzi can be selected on its own, double-click selects
  the word (什么, not 什 or 么). (Korean syllable blocks stopped snapping
  out to the eojeol on 2026-10-14; the Chinese part needs a repro from
  the Mac: double-click already picks the segmenter word, single-hanzi
  drags are not snapped.)
