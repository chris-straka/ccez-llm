#!/usr/bin/env bash
# Boots an iPhone Simulator, installs the unsigned debug .app built by
# `tauri ios build --target aarch64-sim`, and screenshots each scripted
# flow into OUT_DIR (one PNG per flow, numbered in run order).
# Usage: scripts/ios-sim-flows.sh <path/to/App.app> <out-dir>
set -euo pipefail

APP="$1"
OUT="$2"
BUNDLE_ID="studio.ccez.app"
mkdir -p "$OUT"

# Newest available iPhone runtime + device type.
DEVICE_TYPE="$(xcrun simctl list devicetypes -j | python3 -c '
import json, sys
types = [t for t in json.load(sys.stdin)["devicetypes"] if t["name"].startswith("iPhone") and "Pro" in t["name"] and "Max" not in t["name"]]
print(types[-1]["identifier"])')"
RUNTIME="$(xcrun simctl list runtimes -j | python3 -c '
import json, sys
rts = [r for r in json.load(sys.stdin)["runtimes"] if r["platform"] == "iOS" and r["isAvailable"]]
print(rts[-1]["identifier"])')"
echo "device type: $DEVICE_TYPE"
echo "runtime:     $RUNTIME"
UDID="$(xcrun simctl create ccez-preview "$DEVICE_TYPE" "$RUNTIME")"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
# Clean status bar so screenshots read like store shots.
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 || true

xcrun simctl install "$UDID" "$APP"

shot() {
  local name="$1"
  sleep "${2:-4}"
  xcrun simctl io "$UDID" screenshot "$OUT/$name.png"
  echo "shot: $name"
}

xcrun simctl launch "$UDID" "$BUNDLE_ID"
shot 01-first-run 15

# The share extension registers with the system (Share sheet entry).
xcrun simctl spawn "$UDID" pluginkit -m -v -p com.apple.share-services > "$OUT/share-extensions.txt" 2>&1 || true
grep -q "studio.ccez.app.share" "$OUT/share-extensions.txt" && echo "share extension: registered" || echo "share extension: NOT registered"

# Deep links: the same URL the share extension opens, then a fresh chat.
xcrun simctl openurl "$UDID" "ccez-llm://send?text=Bonjour%2C%20je%20voudrais%20un%20caf%C3%A9."
shot 02-share-text-prefill 6
xcrun simctl openurl "$UDID" "ccez-llm://new"
shot 03-deeplink-new-chat 5

xcrun simctl spawn "$UDID" log show --last 5m --predicate "process CONTAINS 'Ccez'" --style compact > "$OUT/app.log" 2>&1 || true
