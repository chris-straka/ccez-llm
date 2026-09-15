#!/bin/sh
# Dev shell with a stable Keychain identity: sign whatever the last
# build left behind, then launch. `tauri dev` rebuilds Rust code
# internally mid-session and relinks unsigned, so a round that
# touches src-tauri/ may still ask once per item until you re-run
# scripts/sign-dev-binary.sh (or relaunch this wrapper) and Always
# Allow once per item. Frontend-only rounds never relink, so they
# stay silent once the identity is allowed.
set -eu
"$(dirname "$0")/sign-dev-binary.sh" || true
exec bun run tauri dev -- "$@"
