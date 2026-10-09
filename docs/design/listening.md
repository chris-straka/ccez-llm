# Listening drills

Short clips of a YouTube video's audio in the learner's language. Type
what you hear, and the next clip plays at once. The real transcript,
an English translation and short notes land behind you. Everything
follows the reply language picked in the app.

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
   and plays in the same frame. "?" on an empty prompt reveals the
   clip as a skip.
4. Translation and notes come from the active provider, two at a
   time, starting two clips ahead of the one playing. The prompt never
   sees the guess, so grading can start before you answer. A failed
   one offers Try again.
5. After the last clip: words heard, and the clips missed most, each
   with replay buttons. "Another video" opens a fresh drill chat.

Clip bodies are ordinary assistant messages (transcript, *translation*,
notes), so annotation, read-aloud and reading aids work on them.

## Pipeline

`src-tauri/listen` (crate `ccez-listen`), all yt-dlp:

- Availability: `yt-dlp -J`, slimmed and cached for 12 h. Native audio in
  the language wins over a dub. YouTube auto-dubs are audio formats
  tagged with a language and "dubbed-auto".
- Captions: YouTube's `<lang>-orig` speech recognition of the chosen
  track carries word timings, so no Whisper pass is needed. Uploaded
  subtitles are used when they exist.
- Clips: `listenClips.ts` cuts sentence-sized clips (2.2–8 s) on word
  timings, with a little padding. Nothing is re-encoded: the app loads
  the track once and plays each clip by seeking.
- Frames: the largest storyboard (320×180 sprite sheets, a frame every
  ~5 s) gives each clip a still from mid-clip. If the sheet doesn't
  load, the clip shows no frame.

## Where it runs

- **Mac desktop**: the shell runs yt-dlp itself (`listen_*` commands).
  This needs `brew install yt-dlp`, and the cache lives in app data.
- **Phone and web**: they can't run yt-dlp, so they call the same crate
  through `ccez-listen serve` on one of your machines. The address goes
  in the Listen panel ("Clip server"). Only the app's own origins pass
  (`ORIGINS` in the binary, plus `--allow-origin`). Put it on the
  tailnet only, behind Tailscale's HTTPS:

  ```sh
  cargo build --release --features server --manifest-path src-tauri/listen/Cargo.toml
  ccez-listen serve --addr 127.0.0.1:8797
  tailscale serve --bg --https=8797 http://127.0.0.1:8797
  ```

  Then use `https://<machine>.<tailnet>.ts.net:8797` as the clip server.

Trade-off: the desktop-local path has no server to keep running, but
only the Mac gets it. The server gives phones the same drill and a
shared cache, but it's one more process. Clips are for personal study:
they stay in the private cache and every clip links back to its moment
on YouTube.
