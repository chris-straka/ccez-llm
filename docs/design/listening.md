# Listening drills

Short clips of a YouTube video's audio in the learner's language. Type
what you hear, and the next clip plays at once. The real transcript
lands behind you, with an English translation and short notes one
click away. Everything follows the reply language picked in the app.

## The loop

1. Empty chat in a language → "Listen in French". The panel lists
   your channels (per user, in settings; none ship with the app) with
   their recent videos labelled "French auto-dub", "French audio" or
   "no French audio yet". Search finds videos or channels, filtered
   to "Only with French audio", and Add puts a channel on your list.
2. Picking a video turns the chat into a drill (`Chat.listen`). Clip 1
   shows its frame and plays. Space replays, S plays at 0.75×, and
   ⌥Space / ⌥S work mid-guess.
3. Enter submits the guess. The diff is local, so it shows instantly
   on clip 1 (heard, misspelled, misheard, missed), and clip 2 appears
   and plays in the same frame. ⌘Enter (or "?" on an empty prompt,
   or A outside it) reveals the clip as a skip.
4. Nothing is translated on the way. Opening a clip's "English" fold
   asks the active provider for that clip's translation and notes
   (once; "translating…" while it runs, Try again if it fails).
5. After the last clip: words heard, and the clips missed most, each
   with replay buttons. "Another video" opens a fresh drill chat.

Clip bodies are ordinary assistant messages holding just the
transcript, so annotation, read-aloud and reading aids work on them.
The translation and notes fold under the clip behind that "English"
toggle, closed by default.

## Pipeline

`src-tauri/listen` (crate `ccez-listen`) talks to YouTube's own API
(InnerTube) over plain HTTPS, the way YouTube's apps do. There's no
yt-dlp and nothing to install, so the same code runs on the Mac and
the phone.

- Session: the visitor id and web client version from the home page.
  Without one, YouTube answers API calls with a bot check.
- Tracks: the visionOS client's player response lists every audio
  track with its language and an `acont` tag (original, dubbed,
  dubbed-auto). Its media URLs need no signature solving or
  proof-of-origin token. Native audio in the language wins over a dub.
- Captions: YouTube's speech recognition of the picked track
  (`kind: asr` in its language) carries word timings, so no Whisper
  pass is needed. Uploaded subtitles are used when they exist.
- Clips: `listenClips.ts` cuts sentence-sized clips (2.2–8 s) on word
  timings, with a little padding. Nothing is re-encoded: the app loads
  the track once and plays each clip by seeking.
- Frames: the largest storyboard level gives each clip a still from
  mid-clip. If the sheet doesn't load, the clip shows no frame.
- Search and channel pages use the web client (`search`,
  `navigation/resolve_url`, `browse` on the Videos tab).

Everything caches under the app's cache dir (player responses for 12 h,
lists for 1 h, media until cleared). When YouTube changes something,
`cargo test --test live -- --ignored` in `src-tauri/listen` shows which
step broke. Parsing is pinned by fixtures from real responses.

## Where it runs

In the app, on the Mac and on Android, through the `listen_*`
commands. The plain web build has no backend (YouTube refuses browser
pages), so its Listen entry stays hidden.

Trade-off: owning the YouTube client means fixing it when YouTube
changes, where yt-dlp would get a release. It's a few hundred lines,
the live test names the broken step, and it's the only way the phone
gets drills. Clips are for personal study: they stay in the private
cache and every clip links back to its moment on YouTube.
