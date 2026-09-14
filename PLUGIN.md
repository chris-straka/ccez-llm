# Tauri plugins (Sep 2026)

Inventory of official Tauri v2 plugins: what ships, how fully each is
used, what was evaluated and skipped, and why. Source of truth is the
repo, not this file — registration lives in `src-tauri/src/lib.rs`,
permissions in `src-tauri/capabilities/default.json`, frontend use in
`src/lib/`.

## Standing rule: three runtimes

Every Tauri call must work in three runtimes: the Tauri shell, the
plain browser preview (`bun run dev` — no Tauri APIs), and jsdom
tests. Guard with `tauriBackendAvailable()` (see `src/lib/secrets.ts`)
or try/catch with a local fallback; dynamic-import plugins so
node/jsdom never touch them (see `nativeNotifier` / `nativeHaptics`
in `src/lib/studyMedia.ts`). Never let `invoke` throw into UI
teardown. This rule decides most entries below: any plugin that only
works in the shell must degrade cleanly in the other two, and where a
web API already covers all three, the web API wins.

## In use (7)

- `opener` — full for our needs. One `open_url` invoke (update-route
  links in `SettingsPanel.svelte`); the JS `openUrl` API is
  equivalent sugar. Sideview's docked browser is a raw webview, not
  the opener, by design.
- `notification` — fullest extent. Permission flow, native-first with
  Web Notification fallback (the `Notification` ctor does not exist
  in the Android WebView), shell-aware via dynamic import. Tested in
  `studyMedia.test.ts`.
  UNVERIFIED ON DEVICE — unit-tested only; verify the permission
  flow and real delivery in the Mac shell and on Android (Web
  Notification fallback path).
- `haptics` — full. Send/first-token/done beats map to
  `selectionFeedback` / `impactFeedback`, `navigator.vibrate`
  fallback outside the shell.
  UNVERIFIED ON DEVICE — unit-tested only; feel the
  send/first-token/done beats on iPhone + Android, plus the
  vibrate fallback in the browser preview.
- `updater` — deliberately partial: `check()` only, then "download
  from the release page to install" (`SettingsPanel.svelte`
  `checkUpdates`). The plugin supports silent download+install+
  relaunch; manual install matches the serialized single-writer
  release chain (verify → publish → prune → rename, per-arch DMGs),
  so this is a decision, not a half-finished wiring. Revisit only if
  the release process changes.
- `dialog` + `fs` — chat export only (`save()` + `writeTextFile`
  in `src/lib/nativeExport.ts`, wired as the middle path in
  `exportChatMarkdown`). Granular capabilities (`dialog:allow-save`,
  `fs:allow-write-text-file`); the dialog grants the picked path to
  the fs scope at runtime, so no static path scope. Order is
  picker (browser) → native (shell) → blob download; a native
  cancel throws `AbortError` into the existing silent-dismiss path.
  Dynamic imports keep node/jsdom clean; unit-tested with injected
  handles, browser e2e pins the download fall-through.
- `global-shortcut` — summon chord only (`CommandOrControl+Shift+
  Space` in `desktop.rs install_summon_hotkey`, `on_shortcut` as a
  toggle (unfocused shows + focuses, focused hides back). Carbon hotkeys
  need no Accessibility grant; failed registration logs and the
  in-app chord still works. Extends summon to Windows/Linux (was
  macOS-only). Desktop-gated at all three layers (crate
  `not(mobile)` upstream; dep + registration `cfg(desktop)`),
  no capability entry (pure-Rust registration, no JS commands).
  UNVERIFIED ON DEVICE — no headless harness can press a
  system-wide chord; verify summon-from-elsewhere, focused-hide,
  and hidden-show on the Mac.

## Candidates (ranked)

1. `global-shortcut` — decision (Sep 2026): adopt it and remove
   the hand-rolled `NSEvent` summon monitor (`desktop.rs`
   `install_summon_hotkey`). The monitor is macOS-only, needs an
   Accessibility grant most users will not give, fails silently
   without it (an unreceived keypress cannot trigger guidance UI),
   and pins statics with `mem::forget`. Carbon hotkeys need no
   Accessibility grant, and the plugin extends summon to
   Windows/Linux, matching the every-OS-supports-every-feature
   constraint (Linux/Wayland stays best-effort; the in-app chord is
   the guaranteed path). Cost: a new crate (`global-hotkey`),
   reversing that file's no-new-crates call — justified because it
   replaces custom unsafe-adjacent code rather than adding surface.
   The focused-window skip logic stays custom either way.
   ~~Done (see In use): tap, `summon_match`, and keycode const
   removed; `block2` feature verified unneeded and dropped. Device
   checks still open.~~
2. `single-instance` (+ `deep-link`) — the socket singleton +
   hand-rolled `ccez://` arg parsing (`desktop.rs`) duplicate what
   these canonical plugins do. Lower priority: verify Android-target
   behavior first (`single-instance` is desktop-only; share-intent
   needs custom code regardless).
