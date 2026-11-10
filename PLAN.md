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
   **Found while testing (open):** through `annotate --provider muse` the
   dictionary card lands in ~5 ms, then Muse's word card never comes back
   (3 min, the socket's limit); `ask --whole --provider muse` (the same
   non-streaming `chat()` notes use) returned an empty answer, while
   streaming `ask` works. Muse's API answered non-streaming fine when
   called directly (all thinking levels). The dev app's Muse key was a
   different, older one: replaced with the owner's 2026-11-10; retest
   first, then find where `chat()` loses the content if it still does.
   The owner says the instant dictionary card no longer shows: its logic
   works (above), so look at when the partial card is shown in the UI.
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
