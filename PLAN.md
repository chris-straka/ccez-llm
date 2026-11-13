# Bug review, 2026-11-13: left for later (v0.72.3 fixed six)

- A phrase's quick one-line answer counts as answered: backgrounded or
  restarted before the full answer, the one-liner stays for good
  (reading.ts:1285; mark it unfinished like card.partial).
- Mac speech: a readback interrupting another gets the old one's cancel
  under its id (tts.rs:591-592): keep the id per utterance.
- A note taken from a prefetch ignores its abort signal, so a hung request
  keeps it blue (+page.svelte:1112): pass the signal to take().
- Headline notes saved before v0.72.3 keep "French" as their language.

# Review, 2026-11-12 (the language side against what the owner has asked for)

Read-only, cut short; nothing here is checked on screen. Delete each as it ships.

Fixed (v0.72.2): the star follows the shared headword and a tap can no
longer clear a word in every app.

To fix:

- A compact voice of the exact locale can beat his Premium voice of
  another region when no System Voice is set (`src-tauri/src/tts.rs:207`,
  `src/lib/voiceTiers.ts:98`): quality should win outright.
- `focus()` without a `document.hasFocus()` check
  (`DictionaryManager.svelte:59`, `CaptureOverlay.svelte:27`).
- A phrase over 64 characters is starred here and dropped by the server
  with a 204 (`src/lib/phrase-list.ts:21`): the star stays local.
- Helper text: `DictionaryManager.svelte:157-161`,
  `settings/VoicePanel.svelte:302-312, 319-321, 423-431`,
  `ListenPanel.svelte:215-218`, `ReaderView.svelte:104-109`.
- English in language e2e specs (`e2e/annotation-answer.e2e.ts` and six
  more).

The owner's call:

- Known can't be set or seen here: one star, Learning or new. A word
  Known elsewhere shows an empty star and a tap makes it Learning.
- The card leads with the dictionary meaning and puts "in this sentence"
  last; his other apps put what it means here first. His 2026-10-24
  sketch for this app says dictionary first.
- Tense names on pieces are Wiktionary's ("imperfect", "preterite"), not
  course names; card wording goes to him first.
- Tamil shows Sri Lanka's flag (`src/lib/languages.ts:81`).

# Owner notes, 2026-11-10 (from ccez-keeps)

Work these off and delete each when it ships.

- Scrolling a web page in the browser pane leaves after-images (the Moscow
  Times page drew its headline and buttons twice): `docs/feedback/2026-11-10/browser-scroll-afterimage.jpg`.
  2026-11-11: the ccez-keys Mac app no longer sets AXEnhancedUserInterface
  on the front app (it treats it as a screen reader; ccez-keys 7a13b70), a
  likely cause of this and of the keeps flicker. Owner watching; if it
  comes back, reproduce with `bun scripts/drive-app.ts` (child WKWebView
  from browser.rs with a background colour).
- Check a drill on Android (emulator or the S24): clips now play from one
  MP4 the backend muxes per video and language (`src-tauri/listen/src/mux.rs`,
  2026-11-12), unverified in the Android WebView. Delete once seen.
- Notes flickered in ccez-keeps while switching to ccez-llm with
  cmd+shift+enter: the ccez-keys Mac app set AXEnhancedUserInterface on
  Chromium apps; off since ccez-keys 7a13b70 (2026-11-11). Owner watching.

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

## Bug review, 2026-11-13

Findings in docs/review-2026-11-13.md. Fixed that day: see the commits of 2026-11-13; everything else there is still open.

## Owner decisions, 2026-11-13

- Login: llm.ccez.uk/api/* (and the pages.dev twin) are behind Cloudflare
  Access for the owner's email (app `ccez-llm-api`, 730h sessions); every
  function checks the token too (functions/api/_access.ts, ACCESS_AUD in
  the Pages env). The news panel offers "Log in" (/api/login). Next: a
  server-held AI key route for him, so a new device needs only the login
  (needs his key as a Pages secret). Visitors keep bringing their own key.
- Weak spots in replies (approved to try): due words, phrases, grammar
  points and expressions gathered from all his apps (taps while watching,
  Again on screen words, accepted keyboard corrections, grammar the
  corrections keep catching), each checked by an AI pass before it counts
  (YouTube subtitles can be wrong). Two or three woven into a reply with a
  faint underline; reading one is a review, tapping it is Again.
- "Looked up three times becomes Learning": agreed.
- Furigana and pinyin: keep as they are.
- New words per reply: a setting; he wants more than the 95% research
  figure suggests.
- Parked (owner unsure, 2026-11-13): a short daily read per language from the
  news he follows, built on his due items.
- He builds for himself; no other users to design for.
