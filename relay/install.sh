#!/bin/sh
# Install or update the Google News relay on z: bundle it, run it at login
# (launchd keeps it up), publish it through Tailscale Funnel on :10000.
# The token in ~/.config/ccez-news-relay/token is made once; the site
# holds the same one as its RELAY_TOKEN secret (relay/README.md).
set -eu
cd "$(dirname "$0")/.."
DIR="$HOME/.local/share/ccez-news-relay"
PLIST="$HOME/Library/LaunchAgents/uk.ccez.news-relay.plist"
mkdir -p "$DIR" "$HOME/.config/ccez-news-relay"
chmod 700 "$HOME/.config/ccez-news-relay"
[ -f "$HOME/.config/ccez-news-relay/token" ] || openssl rand -hex 32 > "$HOME/.config/ccez-news-relay/token"
chmod 600 "$HOME/.config/ccez-news-relay/token"
bun build relay/news-relay.ts --target bun --outfile "$DIR/relay.js" >/dev/null
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>uk.ccez.news-relay</string>
  <key>ProgramArguments</key><array><string>$HOME/.local/share/mise/shims/bun</string><string>$DIR/relay.js</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$DIR/relay.log</string>
  <key>StandardOutPath</key><string>$DIR/relay.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/uk.ccez.news-relay" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
# Funnel waits for the tailnet to allow it (once, in Tailscale's admin page): say so instead of hanging.
OUT="$DIR/funnel.out"
tailscale funnel --bg --https=10000 http://127.0.0.1:8799 >"$OUT" 2>&1 &
pid=$!
sleep 6
if kill -0 "$pid" 2>/dev/null; then
	kill "$pid"
	echo "Funnel isn't on for this tailnet yet; open the link, then run this again:"
	grep -o 'https://login.tailscale.com/[^ ]*' "$OUT"
	exit 1
fi
echo "relay: $(curl -s http://127.0.0.1:8799/health) · https://$(tailscale status --self --json | python3 -c 'import sys,json;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'):10000"
