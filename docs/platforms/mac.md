# macOS install — unsigned .dmg

The macOS release asset is an ARM64 (Apple Silicon) `.dmg` built by the
`release-macos` job in `.github/workflows/release.yml`
(`tauri-action@v1`, `--target aarch64-apple-darwin`).
`src-tauri/tauri.conf.json` sets `bundle.targets: "all"`, so the job
produces the `.dmg` installer plus the `.app` bundle and the updater
artifacts (`latest.json` + `.sig`, signed with `TAURI_SIGNING_PRIVATE_KEY`
for in-app updates only — unrelated to Gatekeeper).

## Signing status

The bundle is **ad-hoc signed**. No Apple Developer account is used and
the app is **not notarized**, so Gatekeeper does not recognize the
developer. This is expected, not a broken download. Since v0.1.4 the
build is **universal** (Apple Silicon + Intel in one `.dmg`).

## First launch

Double-clicking the app the first time shows a warning along the lines of
"Apple could not verify Ccez LLM is free of malware" (wording varies by
macOS version) with no Open button. Instead:

1. Install normally: open the `.dmg`, drag Ccez LLM into Applications.
2. In Finder, go to Applications, **right-click (or Control-click)**
   Ccez LLM and choose **Open** from the menu.
3. A dialog appears with an **Open** button this time — click it.

The choice sticks: later launches open with a normal double-click.

If you already dismissed the warning via double-click, the fallback is
System Settings → Privacy & Security → scroll to the Security section →
**Open Anyway** (offered for about an hour after the blocked launch),
then confirm with Open.

Downloaded copies can hit a harsher dialog — "**damaged** and can't be
opened … move to the Trash" — which offers no Open button at all. That
is still the same ad-hoc signature, not a corrupt file. Clear it with:

```sh
xattr -d com.apple.quarantine "/Applications/Ccez LLM.app"
```

then right-click → Open once as above.

## Notes

- The quarantine flag (`com.apple.quarantine`) is what triggers the
  warnings. The right-click-Open flow whitelists the
  "unverified developer" dialog; only the "damaged" dialog needs the
  `xattr` command above.
- In-app updates keep working once the app is past the first launch:
  they are verified against the updater public key in
  `src-tauri/tauri.conf.json`, not against Apple notarization.
- Cut a release with `bun run release [--major | --minor] [--dry-run]`
  (see `scripts/release.ts`); pushing a `v*` tag builds all targets.
