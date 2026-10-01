# Android phone bugs (physical S24, filed 2026-09-09)

The emulator-only tap ghost does NOT reproduce on hardware. These two do.

## 1. Composer stays under the keyboard

Tapping the main text box to type: the prompt does not rise above the
keyboard — GBoard covers almost all of it except the top line. Typing
blind.

Suspects: `visualViewport` resize / `keyboardOpen` composer-height
handling in `src/routes/+page.svelte` (the textarea composer has no
`scrollIntoView` support from CodeMirror's side; check whether the
keyboard-resize path keys off `.cm-content` or the editor view and now
misses `.ta-input`).

## 2. Annotation creation box overflows the screen

Tapping annotate: the create-annotation textbox is wider than the
viewport (overflows horizontally).

Suspects: the annotation composer / review dialog width rules in
`src/routes/+page.svelte` (fixed widths or padding tuned for desktop;
check `.review`, annotation popover, and any `min-width`).

## 3. Annotation edit flash-closes the overlay

Review overlay → tap an annotation's edit button → the edit form pops in
but the overlay immediately disappears. Reopening the overlay shows the
edit box open with the text. So the edit click also fires the
overlay-close path (propagation? focus-out?); the pending edit state
survives and restores on reopen. Fix: the edit click must not close the
overlay.

## 4. Cancel close animates strangely

Tapping cancel in the review overlay does not smoothly fade — odd
animation. Check the overlay close transition.

## 5. Review overlay position

Not centered; should move right and cover the paperclip more (anchor to
the right side of the composer, not the left).

## 6. Settings swipe direction

Swipe-left mid-screen opens settings; with settings open, swipe-left
closes it again. Wanted: once open, ONLY swipe-right closes it.

## 7. Keyboard resize is intermittent + new-chat focus covers composer

Sometimes GBoard pushes the prompt up perfectly, sometimes not. Opening a
new chat from the sidebar ALWAYS brings the keyboard covering the
composer (never resizes). Prime suspect: the `<activity>` has no
`android:windowSoftInputMode` (defaults to adjustUnspecified = the OS
guesses = intermittent). Fix: `adjustResize` so the WebView always
shrinks. Then re-test the new-chat focus path.

## 8. Mobile gesture redesign (IMPLEMENTED 2026-09-09, pending device test)

- Two-finger DOUBLE TAP toggles the chats sidebar (replaces swipe-right
  on Android; other touch screens keep the edge swipe).
- Two-finger swipe right → newer chat; two-finger swipe left → older
  chat (`twoFingerSwipeDir` is now horizontal; was vertical).
- Single-finger swipe left ON A MESSAGE folds/unfolds it (`toggleFold`);
  active text selection wins over the fold. Leftward elsewhere still
  opens settings.
- Untouched: double three-finger tap still deletes the current chat
  (dangerous — revisit separately).

## 9. Rename: "ccez studio" → "ccez llm"

Display name only — keep package identifiers (`applicationId`, bundle
id) untouched. Touch: `@string/app_name`, Tauri product name/window
titles, frontend header strings.
