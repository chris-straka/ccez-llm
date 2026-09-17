#!/bin/sh
# Dev shell with a stable Keychain identity: sign whatever the last
# build left behind, then launch. `tauri dev` rebuilds Rust code
# internally mid-session and relinks unsigned, so a watcher re-signs
# the binary after every relink — otherwise each rebuild looks like a
# brand-new app and macOS re-prompts once per Keychain item.
# Frontend-only rounds never relink, so they stay silent once the
# identity is allowed (Always Allow, not Allow — Allow repeats
# every launch). Idempotent pieces; safe to relaunch any time.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/src-tauri/target/debug/ccez-llm"
"$ROOT/scripts/sign-dev-binary.sh" || true
# Poll the binary's mtime; relinks rewrite it. Portable stat for
# macOS (-f) and Linux (-c). Failures stay silent by design (the
# sign script already explains itself when run directly).
watch_relinks() {
	last=""
	while sleep 2; do
		if [ -x "$BIN" ]; then
			cur="$(stat -f %m "$BIN" 2>/dev/null || stat -c %Y "$BIN" 2>/dev/null || echo "")"
			if [ -n "$last" ] && [ -n "$cur" ] && [ "$cur" != "$last" ]; then
				if "$ROOT/scripts/sign-dev-binary.sh" >/dev/null 2>&1; then
					echo "tauri-dev: dev binary relinked and re-signed (stable identity kept)"
				else
					echo "tauri-dev: dev binary relinked unsigned — run scripts/sign-dev-binary.sh" >&2
				fi
			fi
			last="$cur"
		fi
	done
}
watch_relinks &
WATCHER=$!
cleanup() {
	kill "$WATCHER" 2>/dev/null || true
}
trap cleanup INT TERM EXIT
bun run tauri dev -- "$@" &
APP=$!
wait "$APP"
STATUS=$?
cleanup
trap - INT TERM EXIT
exit "$STATUS"
