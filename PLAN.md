# Owner feedback, 2026-10-13 (from ccez-keeps notes)

The owner wrote these as notes in ccez-keeps through 2026-10-13 and asked
for them to live here instead; the notes were trashed once copied. Work
them off like `TODO.md` items: delete a row when it ships (the commit is
the record). Screenshots the owner attached are in
`docs/feedback/2026-10-13/`. Wording is the owner's, lightly trimmed.

## Annotations (A, the overlay, badges)

- Typing `A` to annotate a Japanese sentence does not focus the new
  textbox; the owner has to click into it.
- Hitting `a` on something still fetching an annotation opens the textbox
  ("A") version. It should do nothing while the fetch is in flight.
- If an annotation is loading and the owner hits `A` on it by accident,
  then Esc right away (without sending anything), the annotation that was
  loading is removed. The one in flight must survive.
- In the "A" annotation text bar the text sits too close to the left edge
  when there is little text.
- Highlight text, the annotate menu button appears, switch chat: the
  button still shows on the other chat.
- Open the annotation overlay menu, switch chat and come back: it is still
  on the overlay menu. Owner leans to "close it", not sure.
- Annotations stop loading when the owner goes to another chat; they
  should keep loading in the background.
- Add a keyboard or mouse shortcut that deletes all annotations on a
  message.
- Remove the feature where annotations attach to the main text prompt to
  send with the next message. (An archived note asked the prompt to show
  whether something is being annotated; moot once this goes.)
- Opinion wanted, do not build yet: colour-code things repeated in the
  same message that were already annotated above, or some feature like
  that.
- Right-click on a highlight reads "ichi" before the highlighted text: the
  reader is picking up the annotation badge number as well
  (`right-click-reads-annotation-ichi.jpg`).
- Right-clicking a highlight with several kanji removes the kanji from the
  highlight, and the furigana popups overlap each other; maybe spread them
  to different parts of the screen
  (`right-click-kanji-furigana-overlap.jpg`).
- Right-click read "hachinasuriawase", which is not in the highlight
  (`right-click-hachinasuriawase.jpg`: the highlight was すり合わせ).
- 露軍: right-clicking the first kanji gives つゆ the first time and ろ
  every time after; annotating both gives つゆぐん, right-click gives
  ろぐん (correct here). Single-kanji readings use the standalone reading,
  not the reading the kanji has in this sentence. Owner is not sure of the
  best handling.
- In the Korean/Japanese plural answer (`들` vs `たち`): right-clicking
  接尾辞 showed Chinese pinyin but read 접미 (Korean); 〜達 read as "tachi
  subashtu tachi". Per-token language detection inside a mixed-script
  answer is picking the wrong script.
- Right-click on Japanese text mixed with English in one bullet reads the
  entire bullet, not the selection: the Japanese voice reads the English
  and then the whole Japanese sentence (`tts-mixed-jp-en-bullet.jpg`).
  Only that bullet did it.

## Selection and inspect

- Mouse selection of Chinese feels strange; the browser's own behaviour is
  better: a single hanzi can be selected on its own, double-click selects
  the word (什么, not 什 or 么). Same for Korean eumjeol (syllable blocks).
- Inspect panel: clicking one of the decomposed kanji at the bottom should
  open the inspect panel for that kanji, with history so Back works.
- Inspect panel: audio for the kun and on readings; it could be bigger on
  desktop.
- Romaja on right-click for Korean.

## Speech

- Voice speed below 0.5x.
- "Dis-moi ce que tu en penses." used an English voice, not French.
- OCR button: first click showed the spinning rainbow wheel for a while
  (looked frozen), then produced 闪烁碎片飘到了海边; the second run was
  fast. Probably a first-time model install. Show what it is doing instead
  of blocking: the owner's real complaint about OCR is visibility.

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

## Unclear, ask the owner

- "The pinyin on 'a' needs to move to another keypress." (Which `a`: the
  hover+A aid toggle, or the annotate key? Both exist.)

## Related idea (not this app)

- ccez-lang: "How hard would it be to recreate something like Language
  Reactor (the Chrome extension) with my own AI translate and dictionary?"
  Answered in chat 2026-10-14; not scheduled.
