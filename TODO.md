# Ccez LLM — TODO (only open work)

Finished stages live in `DONE.md` (archive) — check items off by moving
them there, never by deleting. Spec is `README.md`; agent handoff
(commands, gates, architecture) is `AGENTS.md`.

## Goal + constraints

macOS desktop chatbot (BYOK: DeepSeek + Muse Spark): clean chat with
highlight-to-comment annotation, language-learner reading aids,
type-then-it-talks voice, vim-flavored prompt editing. Android rides the
same codebase via the Tauri mobile target.

- Free forever, offline-first, personal modern devices only, no paid accounts.
- Every OS supports every feature (macOS/Windows/Linux; Android where mobile).
- Commit + push when allowed.

## Standing decisions

- OS-native speech/OCR (no paid services). Per-arch DMGs, serialized
  single-writer release chain (verify -> publish -> prune -> rename).
- rAF scroll glide; per-chat draft scoping.
- FTS5 parked (IndexedDB not proven slow). Win/Linux device proof
  still needs real hardware; Android verifies on the S24 (release
  APKs + adb) — unit tests + honest unverified notes elsewhere,
  never pass claims.
- Ghost features: user believes all fixed — verify, then drop this item.
- Cmd+T browser removed (owner request, Sep 2026): the chord, sideview
  webview, fallback strip, width setting, and shortcut row are gone;
  Cmd+T returns to the OS/browser.

## Pile: Win/Linux device proof (still no hardware)

- [ ] Every shipped feature on Win/Linux: unit-tested contracts only
      (`platform.ts`, `updates.ts`, `langId.ts` + `langid.rs`,
      `secrets_*` fail-closed). No pass claims without the hardware.

## Pile: 0.5.3 field notes (mac app, 370% font size)

THINGS I NOTICED ON 0.5.3 mac app with 370% font size

Holding down the submit button when I have an annotation does not remove the language modifier.

The char X paste tag was too far to the left when I increased the chat width, it needs to go on top of the main text prompt.

The annotation creation text box and the annotation button on mac should scale with the font size 

Scroll speed should change with text size. 

On Mac the msg buttons need to scale more

When a message  is finished in mac, I think it scrolls me to the end but it should not do that. 

composer should increase with font size.

Hitting shift+command+j will open the main text prompt and shouldn't. Also, it's slower than I would have thought to switch chats, it's like 2s going down a chat and 1s going up. It's not going to storage on each chat is it? I'm in the Mac client. On a new chat, hitting shift+command+k  also focused the main text prompt and command+shift+j and command+shift+k should never open the main text prompt or focus it. Both on the window I am currently or on am heading to. 

I need a keyboard shortcut that plays the audio for the word that I'm on, then another one for its sentence, then another one for its paragraph

Command+[, command+down-arrow and command+up-arrow and command+] should switch chats.

After I pick a language with the language menu buttons and pick a chat language, the command+1 through command+0 should take me to other chats (2nd chat, 3rd chat, etc). and hitting hitting command+1 should clear the language and put it back on again. Each chat therefore should not switch from a french chat to a german one for example. 

The create annotation textbox should get more square like the more text that's inside it.

Used the English TTS for neigeait, dissous and dissoudre individually. Is my TTS detection for French that bad ? 

PART 2 

When I hit enter to submit a message, it scrolls me to the bottom when I don't want that.

I think it does become boxy actually but it becomes boxy too late on large font sizes

On Mac, clicking on the annotations menu for a previously sent message is way too small in width and height. It should span the full chat width and it should go twice as high.

PART 3

command+t should open a chat

text size stops at 600% on mac when hitting command + sign, should not be capped like that I don't think unless there's a good reason I'm forgetting.

## Pile: furigana popup backdrop should fit scrunched characters (Sep 2026)

- [ ] The furigana popup's backdrop width should shrink to only as wide
      as its characters, so everything still fits when they scrunch
      together — currently the backdrop can clip or overflow the text.

## Pile: Android in-app update install fails (reported on 0.5.2, Sep 2026)

- [ ] 0.5.2 sees the new version and downloads it, but Install errors:
      "installer did not start: Error invoking postMessage: Java
      exception was raised during method invocation." Likely the
      postMessage bridge call into the Activity (provider/FileUri or
      install-intent args) throwing before the installer starts —
      reproduce on the S24 with adb and read the full Java stack.

## Pile: maybe later (only if troublesome)

- [ ] Chats-sidebar swipe misfires on downward scrolls: directional
      lock (predominantly-horizontal past a minimum distance) or
      edge-started swipes. Owner call — implement only if it keeps
      happening.

## Non-goals

- No app-build/agentic features. No cloud sync / sharing / plugins.

## Verify (per AGENTS.md)

`bun run check` + `bun run test` + `cargo check/test` + focused e2e per area;
full suite before push. Device-only paths: unit tests + honest unverified
notes, never pass claims.
