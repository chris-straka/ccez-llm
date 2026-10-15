# Settings panel

Decided 2026-10-15, after the owner's report that the sliders were too
easy to misclick and the sidebar was small and hard to read
(`docs/owner-shots/2026-10-15-settings-sidebar.png`).

## Form: a wider right-hand panel, not a page or modal

Settings stays a panel docked on the right, now up to 30rem wide (was
22rem) with larger type, and a full-screen sheet on phones as before.
On smaller windows it narrows (down to 24rem) so the default chat
column stays visible beside it.

Why not a full settings page or a centered modal: most settings change
how the chat looks (text size, spacing, widths, theme, message color),
and the chat itself is the best preview. A page or modal would cover
exactly what you are tuning. The docked panel keeps the chat visible
beside it on desktop. On phones the sheet covers the chat anyway, so
the Reading group opens with a live sample (message size, spacing,
gap, and message color as currently set).

## Groups

One scroll, six groups, with a sticky bar at the top that jumps
between them and marks the current one: Reading, Voice, Layout, Look,
Chat, Model. Everything stays in one scroll so you can still find a
setting by scrolling. An opening with no usable API key lands on Model,
because nothing sends without one.

## Controls

- **Steppers** (− value +) for sizes and spacing, where you want a
  repeatable number: text size, prompt text size, annotation popup
  size, line spacing, gap between messages, voice speed, interface
  size, and the prompt's idle hide (Always, 2 to 10 s, Never). Each
  press moves one rung of a ladder (`src/lib/settingSteps.ts`): fine
  steps near 100%, coarse steps toward 2000%, so giant type stays a
  few presses away. A stray click changes the value by one visible
  step at most.
- **Sliders** only for continuous values judged by ear or eye: voice
  volume, video volume, chat width, and prompt width. Only a press on
  the thumb moves them. A click or tap elsewhere on the track does
  nothing, the wheel is never read (scrolling past leaves them alone),
  and vertical strokes on a phone scroll the sheet.
- **Segmented choices** for small sets: theme, style tiles, message
  color, thinking level, big-word reader.

The value is shown once, inside the stepper or at the right of the
slider's name. Reset is a small link beside the name that only
appears when the value is off its default. The old drag-up-to-reset
gesture is gone: it was a misclick source.

Interface size steps rather than slides because the panel zooms with
it; a slider thumb would move out from under the pointer mid-drag.

Targets are at least 2.6rem (about 42px) on desktop and 2.9rem (about
46px) on phones.
