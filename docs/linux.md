# Linux distribution: .deb, AUR, AppImage

> Status: **UNTESTED on Linux hardware** — static analysis only.
> The first `v*` tag CI run is the real test.

Ccez LLM is a Tauri v2 app (currently tauri 2.11.5 / tauri-build 2.6.3 per
`src-tauri/Cargo.lock`). Every Linux build needs the WebKitGTK 4.1 stack at
**build time** and the WebKitGTK/GTK runtime libs at **install time**.
`src-tauri/tauri.conf.json` now has the `bundle.linux` section (plus
`category`/descriptions) applied alongside `bundle.windows`, with
`bundle.targets` still `"all"` (see
[Required tauri.conf.json patch](#required-tauriconfjson-patch), kept as the
record of what was merged).

## .deb (Debian / Ubuntu / Pop!_OS)

Built by CI: `release.yml` (`release-linux` job) runs `tauri build`
on **ubuntu-22.04** with `--bundles deb,appimage` and attaches
`src-tauri/target/release/bundle/deb/*.deb` to the draft release for each
`v*` tag. Install with:

```sh
sudo apt install ./CcezLLM-linux-x64.deb
```

`apt install ./file.deb` (not `dpkg -i`) resolves the runtime deps below
automatically. The stock Tauri .deb already declares `libwebkit2gtk-4.1-0`
and `libgtk-3-0` (plus `libappindicator3-1` when the tray is used); extra
deps can be appended via `bundle.linux.deb.depends` (see patch).

Why 22.04 and not `ubuntu-latest`: the binary links against the build
host's glibc, so building on the oldest supported base keeps it runnable on
newer systems. Building on 24.04+ raises the minimum glibc and breaks older
installs with `version 'GLIBC_*' not found`. Same rule applies to Asahi
Fedora Remix / Debian-on-Asahi users: prefer the CI-built .deb over a local
build on a newer toolchain.

## AUR (Arch Linux)

Use the `-bin` package — it repackages the official CI-built .deb, so no
compilation and no webkit build toolchain needed:

```sh
git clone https://aur.archlinux.org/ccez-llm-bin.git
cd ccez-llm-bin
makepkg -si
# or: yay -S ccez-llm-bin
```

Source: `packaging/aur/PKGBUILD`. Details:

- Downloads `CcezLLM-linux-x64.deb` from the GitHub release tag
  `v${pkgver}` plus the `LICENSE` file; replace both `SKIP` checksums with
  `updpkgsums` output before submitting to the AUR.
- `depends=('webkit2gtk-4.1' 'gtk3' 'libappindicator-gtk3' 'librsvg'
  'openssl')` — pacman cannot see .deb metadata, so the WebKitGTK runtime
  (mandatory for every Tauri v2 app) is declared explicitly.
- Adds a `ccez-studio` → `ccez-llm` back-compat symlink in `/usr/bin` and installs the
  license under `/usr/share/licenses/ccez-llm-bin/`.
- After bumping `pkgver`, regenerate AUR metadata on an Arch box:
  `makepkg --printsrcinfo > .SRCINFO` (cannot be done on macOS — no
  `makepkg` here).

## AppImage (distro-agnostic fallback)

The same CI job builds `*.AppImage` via `--bundles appimage`. Run it with:

```sh
chmod a+x ./*.AppImage
./Ccez_LLM_*.AppImage
```

Notes (per the [Tauri AppImage guide](https://v2.tauri.app/distribute/appimage/)):

- The AppImage bundles most deps but still expects a WebKitGTK 4.1-capable
  host; oldest-supported-base rule from the .deb section applies — that is
  why CI builds on ubuntu-22.04.
- This app does not currently need audio/video playback, so
  `bundle.linux.appimage.bundleMediaFramework` stays `false` (it would pull
  gstreamer into the bundle and is only fully supported on Ubuntu builders).
  If media playback is added later, flip it to `true` in the patch below.
- Updater artifacts (`*.AppImage.tar.gz` + `.sig`) are produced because
  `createUpdaterArtifacts` is already `true`; they are signed only when the
  `TAURI_SIGNING_*` secrets are configured (same secrets as `release.yml`).

## System dependencies

Build-time packages (also installed verbatim by `release.yml`).
Sources: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/),
Debian/AppImage guides.

Debian / Ubuntu / Pop!_OS:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

Arch (only needed to build from source; `-bin` users skip this):

```sh
sudo pacman -Syu
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl \
  appmenu-gtk-module \
  libappindicator-gtk3 \
  librsvg \
  xdotool
```

Fedora / Asahi Fedora Remix (source builds only):

```sh
sudo dnf install webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  libxdo-devel
sudo dnf group install "c-development"
```

## Required tauri.conf.json patch

**Owned by another agent — report only, do NOT apply.** Merge this
`bundle` delta into `src-tauri/tauri.conf.json` (has
`productName: "Ccez LLM"`, `identifier: "studio.ccez.app"`, version
`0.1.0`, `bundle.targets: "all"`, no `category`, no `bundle.linux`;
note a sibling track has added a `bundle.windows` block — add `linux`
alongside it, key order irrelevant):

```diff
   "bundle": {
     "active": true,
     "targets": "all",
     "createUpdaterArtifacts": true,
+    "category": "Education",
+    "shortDescription": "BYOK desktop chatbot with language-learner aids",
+    "longDescription": "Ccez LLM is a Tauri + SvelteKit desktop chatbot with language-learner aids.",
+    "linux": {
+      "deb": {
+        "depends": [
+          "libwebkit2gtk-4.1-0",
+          "libgtk-3-0",
+          "libayatana-appindicator3-0"
+        ]
+      },
+      "appimage": {
+        "bundleMediaFramework": false
+      }
+    },
     "icon": [
       "icons/32x32.png",
       "icons/128x128.png",
```

Rationale per key:

- `category: "Education"` — freedesktop category for the generated
  `.desktop` `Categories=` entry; the app is a language-learning aid
  (a reference copy lives at `packaging/ccez-llm.desktop`).
- `shortDescription` / `longDescription` — feed the .deb control file
  `Description:` field; currently unset.
- `linux.deb.depends` — pins the exact runtime libs the stock bundler
  emits (`libwebkit2gtk-4.1-0`, `libgtk-3-0` per the
  [Debian guide](https://v2.tauri.app/distribute/debian/)) plus the
  ayatana indicator lib for tray support.
- `linux.appimage.bundleMediaFramework: false` — explicit opt-out of the
  gstreamer payload; flip to `true` if media playback lands.
- `targets` stays `"all"` so macOS/Android jobs are unaffected; the Linux
  job selects `--bundles deb,appimage` on the CLI instead.

## Verification status

Checked on macOS (Darwin arm64) 2026-09-10:

- `release.yml` parses as valid YAML (`python3 -c yaml.safe_load`)
  and uses only existing repo paths (`src-tauri/target/...` output globs,
  `oven-sh/setup-bun@v2`, `tauri-apps/tauri-action@v1` — same pins as the
  existing `release.yml`).
- `packaging/aur/PKGBUILD` follows `makepkg` conventions by inspection
  (`pkgname -bin`, `arch=('x86_64')`, `!strip`, `bsdtar` two-step .deb
  extraction, matching `sha256sums` entries).

NOT verifiable on this host (no Linux tooling — re-confirmed
2026-09-10: `dpkg-deb`, `desktop-file-validate`, `appimagetool`,
`makepkg`, `namcap`, `desktop-file-install` all absent on this Mac):

> NOTE (2026-09-10 quirk-hunt, static analysis only): the
> `bundle.linux` patch above has since been applied to
> `src-tauri/tauri.conf.json` (linux.deb.depends +
> linux.appimage.bundleMediaFramework=false, category Education),
> so the "currently has no `bundle.linux` section" premise at the
> top of this file is stale. Findings Q1–Q9 below were verified by
> reads on macOS; "needs runner" items require CI/Linux hardware.

- actual `tauri build --bundles deb,appimage` output and .deb contents;
- `desktop-file-validate packaging/ccez-llm.desktop`;
- `makepkg --printsrcinfo` / `.SRCINFO` generation and `namcap` lint of
  the PKGBUILD;
- end-to-end `release.yml` run (needs a `v*` tag push + secrets).

## Quirk-hunt findings (2026-09-10, static analysis on macOS, no edits to code)

Q1 — `open_voice_settings` Linux branch errors cleanly
(`src-tauri/src/lib.rs:71-74` returns
`"opening System Settings requires macOS"`; no `xdg-open`, no desktop
detection). The SettingsPanel fallback reads sanely: on Linux
`nativeTtsSupported()` is false (`src-tauri/src/tts.rs:639-640`), so
`SettingsPanel.svelte:199-206` forces `voiceEngine` to `"web"` and the
desktop voice-engine block (`SettingsPanel.svelte:612`) never renders —
the `openVoiceSetup` button (`:230-241`, `:638`) is unreachable there.
Cosmetic nit only: the fallback message shows the generic
`"Native speech is not available in this build."`
(`src/lib/nativeTts.ts:70`) instead of the friendlier
`"System voices need the Mac app…"` mapping (`:115-117`), because the
`tts_supported → false` path never emits the `"requires macos"` string
that mapping keys on. Proposed patch (frontend text only):
in `nativeTtsSupported()`, set
`lastNativeError = "Native speech is not available in this build."`
unchanged, but extend `friendlyNativeError` with
`if (/not available in this build/i.test(message)) return "System voices need the Mac app (this build only has web voices).";`
Status: confirmed by read; needs runner only for visual check.

Q2 — webkit2gtk 4.1 pin matches the distro spread. `.deb depends`
(`src-tauri/tauri.conf.json:46-52`:
`libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-0`) is
exactly the Tauri v2 Debian-guide set; `libayatana-appindicator3-0`
exists on Ubuntu 22.04/24.04, Debian bookworm, and Pop!_OS, and is
harmless where no tray is used (there is no tray plugin in
`src-tauri/Cargo.toml` — the dep is belt-and-braces, cosmetic).
Arch (`packaging/aur/PKGBUILD:33`: `webkit2gtk-4.1`, `gtk3`,
`libappindicator-gtk3`) and Fedora docs (`webkit2gtk4.1-devel`) use the
right per-distro names. `bundleMediaFramework: false`
(`tauri.conf.json:53-55`) is correct — no audio/video playback in the
app — consequence is only that a future media feature must flip it to
`true` (and then only Ubuntu builders fully support it). Status:
confirmed by read + `Cargo.lock` (`tauri 2.11.5`); needs runner for
`dpkg-deb -f` / install test on each distro.

Q3 — keyring on Linux needs a D-Bus Secret Service (`src-tauri/src/lib.rs:28-48`,
`keyring 3.6.3` + `zbus 5.19.0` in `Cargo.lock`: pure-Rust D-Bus, no
`.so` link dep, so no new `.deb depends` entry is required). On minimal
WMs / headless boxes without gnome-keyring or kwallet,
`keychain_set/get` return Err and `src/lib/secrets.ts:240-261` degrades
to session-only keys — and `withBlankedKeys` (`:321-327`) still blanks
the persisted settings, so the key is lost on restart. Breaks runtime
persistence (not build). Proposed patch (docs + optional dep):
document `gnome-keyring` (or kwallet) + unlock-at-login as a Linux
requirement in this file, and consider appending
`"libsecret-1-0"` to `linux.deb.depends` so the service backend is
present (it does not hurt GNOME-less systems). Status: backend chain
confirmed by read; actual no-daemon behavior needs runner.

Q4 — no native file-dialog / portal surface to quirk. No
`tauri-plugin-dialog`, `-fs`, `-notification`, tray, or deep-link code
anywhere (`Cargo.toml`, `src-tauri/src`, `capabilities/default.json`
has only `core`, `opener`, `updater`); attachments ride web
`<input type=file>` + canvas (`src/lib/attachments.ts`), updates go
through `plugin:opener|open_url` (`SettingsPanel.svelte:162`, xdg-open
under the hood). So xdg-portal/sandbox file-chooser quirks do not
apply. GPU/software-rendering: nothing sets
`WEBKIT_DISABLE_DMABUF_RENDERER` / `LIBGL_ALWAYS_SOFTWARE`, so VMs
without GL fall back (or fail) on WebKitGTK defaults — runtime,
needs-runner (launch with `-v` on a GL-less VM to prove). glibc floor:
`release.yml` (`release-linux` job) pins `ubuntu-22.04` (glibc 2.35) — correct,
confirmed.

Q5 — `release.yml` deps match this doc's Debian list verbatim
(lines 32-44 vs "System dependencies" above) and the workflow parses
(`yaml.safe_load`, 7 steps, `runs-on: ubuntu-22.04`). Two needs-runner
notes: (a) `tauri-action@v1` already uploads bundles AND the
`softprops/action-gh-release` step (`:67-78`, `if: always()`)
re-attaches them to the same draft `release.yml` creates — a double
writer on the same draft, unproven until a real `v*` tag push;
(b) updater `.sig` files are only produced when `TAURI_SIGNING_*`
secrets exist, else the `*.tar.gz.sig` glob silently matches nothing
(`fail_on_unmatched_files: false`).

Q6 — desktop-file / PKGBUILD nits (cosmetic, needs-runner).
`packaging/ccez-llm.desktop:7` `Exec=ccez-llm %U` matches the
`ccez-llm` binary (`src-tauri/Cargo.toml:2`) — good. But:
(a) `StartupWMClass=ccez-llm` (`:13`) vs the actual WM_CLASS WebKitGTK
sets (usually the product name/binary id) — verify with `xprop`;
wrong value only breaks dock grouping. Proposed patch: launch the .deb
on GNOME, read `xprop WM_CLASS`, set `StartupWMClass` to match.
(b) `MimeType=x-scheme-handler/ccez-llm;` (`:14`) claims a URL handler
nothing implements (no deep-link plugin) — dead claim; proposed patch:
delete the `MimeType` line unless deep links land. (c) `Categories=
Education;Utility;` vs generated `Education;` from `category` — drift
only; harmless. (d) `Icon=studio.ccez.app` — confirm the installed
hicolor name after one real `tauri build`. None lintable here
(`desktop-file-validate`, `makepkg` absent — see above).

Q7 — macOS-isms in shared UI are all gated; no Linux breakage found.
`Command::new("open")` is `cfg(target_os = "macos")`-gated
(`lib.rs:58-70`); `tts.rs`/`keyboard.rs` macOS blocks are `cfg`-gated
with `None`/`false`/Err stubs elsewhere (`tts.rs:639-665`,
`keyboard.rs:43-49`); SettingsPanel `isMacBrowser` gate (`:194-195`)
requires `!inShell`, so Linux shell never shows Mac guidance; the
`"Keys stay in the macOS Keychain"` string (`:503`) renders only under
`inShell && !androidUI` — which IS true on Linux, so Linux users read
"macOS Keychain" inaccurately (cosmetic; the Rust side is actually
Secret Service there). Proposed patch (text only): branch that note on
platform, e.g. `Keys stay in your login keyring…` on Linux. No hardcoded
`/Users/`, `/Library/`, `/Applications`, `C:\`, `%APPDATA%`, or
case-sensitive path assumptions found in `src`/`src-tauri/src`
(grep-verified); `TEXT_EXTENSIONS` lookup lowercases first
(`attachments.ts:100`).

Q8 — `titleBarStyle: "Overlay"` + `trafficLightPosition`
(`tauri.conf.json:16-17`) are macOS-only keys; Tauri ignores them on
Linux (WM draws decorations). Cosmetic at most — needs runner for one
visual confirm. `data-tauri-drag-region` + `startDragging()`
(`SettingsPanel.svelte:320-343`, `+page.svelte:3855`) degrade to no-op
clicks on Linux WMs that disallow client drag — the close-on-click path
still works.

Q9 — Linux speech QA gap (runtime, needs-runner). On Linux the engine
is always web `speechSynthesis` inside WebKitGTK, whose voice inventory
is frequently empty/silent — and `webVoiceAvailable`
(`src/lib/voice.ts:54-59`) returns `true` on an empty list by design,
so the UI offers speech it may not produce. Proposed patch: none
without hardware data; first measurement is `getVoices().length` +
audible check on the CI-built .deb and AppImage, then decide (e.g.
disable voice UI when the inventory stays empty post-`voiceschanged`).
