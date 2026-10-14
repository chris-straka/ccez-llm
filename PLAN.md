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
- 露軍: right-clicking the first kanji gives つゆ the first time and ろ
  every time after; annotating both gives つゆぐん, right-click gives
  ろぐん (correct here). Single-kanji readings use the standalone reading,
  not the reading the kanji has in this sentence. Owner is not sure of the
  best handling.
- In the Korean/Japanese plural answer (`들` vs `たち`): right-clicking
  接尾辞 showed Chinese pinyin but read 접미 (Korean). Since 2026-10-14 the
  voice follows the panel (a pinyin panel reads Mandarin, wave dashes are
  never read); whether a Han-only word inside a Korean paragraph should
  show pinyin at all is still open.

## Annotations, round 2 (owner, 2026-10-14)

- Colour-code repeats: text later in a message that was already annotated
  above gets the same colour as its first annotation. The owner wants
  colour, not dimming or underlines ("dimming would make it harder to
  read"). Colours must stay readable in light and dark themes and must not
  clash with the reading colours (`docs/design/colors.md`).

## Selection and inspect

- Mouse selection of Chinese feels strange; the browser's own behaviour is
  better: a single hanzi can be selected on its own, double-click selects
  the word (什么, not 什 or 么). (Korean syllable blocks stopped snapping
  out to the eojeol on 2026-10-14; the Chinese part needs a repro from
  the Mac: double-click already picks the segmenter word, single-hanzi
  drags are not snapped.)

## Chats and prompt

- Scroll position is not kept per chat: A -> B -> A lands at the top of A.
  Owner wonders if each chat needs to be its own page.
- Text typed into the main prompt follows the owner into the next chat.
  Each chat gets its own draft.
- After sending, switching chats and back resets the thinking counter and
  may resend. Never resend if the app was not left; show the true age
  (24 s if the request is 24 s old).
- The edit button on the owner's own messages does nothing while the model
  is still thinking.
- The usual delete shortcuts should delete a message that is still
  "thinking..." and has not landed.
- Cmd+Z brings back deleted messages.
- The thinking seconds counter should fade in and out on hover.
- Cmd+Shift+J (new chat) should focus the main prompt; a visible but
  unfocused prompt is weird.
- Chat counter (1 / 2): holding Shift while the main prompt is not focused
  shows it at the top right (title bar was the other idea).
- Click-and-hold on the submit button cancels the current request, even
  when unsent text sits in the box.
- Android: open the chats sidebar by tap-and-hold, then swipe while
  holding.
- Android: pinch-to-zoom currently zooms parts of the UI such as the
  settings sidebar. Pinch should only change the font size.

## Layout and text size

- At 290% the thumbnails get tiny; at 300% the layout goes single column;
  3 -> 2 columns already at 200% is too early.
- The prompt text size slider looks like it goes much higher, but a third
  of the way is already very large.
- Keyboard shortcuts for growing and shrinking the prompt width may not be
  symmetrical.
- Arabic bullets and lists may be formatted wrong; numbered lists trail off
  screen on Android.
- Typing "مَا is what" in the prompt shows up as "is what مَا" in replies
  (bidi ordering).

## News, listen, video

- Singapore news, Chinese in the Asian submenu: the articles are all in
  English.
- No News or Listen button on the front page until a language is picked
  from the language menu.
- The video playback UI feels weird.
- Video clips look corrupted: from the start of the second clip onward.
- Video clips: the "type what you hear" box is too wide, and the video
  controls must stay reachable the whole time.
