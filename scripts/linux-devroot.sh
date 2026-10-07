#!/bin/bash
# Tauri build headers on Debian/Ubuntu without root: download the -dev
# packages (and their -dev dependencies) with `apt-get download`, unpack
# them under a user-local sysroot, and point pkg-config at it. Runtime
# libraries come from the system (any desktop Ubuntu has WebKitGTK).
#
#   scripts/linux-devroot.sh            # once per machine
#   source ~/.local/devroot/env.sh      # then, per shell
#   bun run tauri build --bundles deb
#
# With root, `sudo apt install` the list in docs/platforms/linux.md
# instead and skip all of this.
set -euo pipefail
ROOT_DIR="${DEVROOT:-$HOME/.local/devroot}"
DEBS="$ROOT_DIR/debs"
SYSROOT="$ROOT_DIR/root"
mkdir -p "$DEBS" "$SYSROOT"
cd "$DEBS"

TOP="libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev
libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev"
# Every -dev package in the closure that isn't installed yet. libsoup's
# .pc needs krb5-gssapi, which lives in krb5-multidev (not a -dev name);
# libxdo3 is the runtime half of libxdo-dev. The last three are runtime
# libraries Playwright's WebKit wants.
NEED="krb5-multidev libxdo3 libevent-2.1-7t64 libmanette-0.2-0 libhidapi-hidraw0"
for p in $TOP $(apt-cache depends --recurse --no-recommends --no-suggests \
	--no-conflicts --no-breaks --no-replaces --no-enhances $TOP 2>/dev/null |
	grep -E '^\S' | grep -- '-dev$' | sort -u); do
	dpkg -s "$p" >/dev/null 2>&1 || NEED="$NEED $p"
done
# shellcheck disable=SC2086
apt-get download $NEED
for deb in "$DEBS"/*.deb; do dpkg -x "$deb" "$SYSROOT"; done

# The -dev symlinks (libfoo.so -> libfoo.so.0) dangle inside the
# sysroot: point them at the system's runtime copies.
find "$SYSROOT" -xtype l | while read -r link; do
	target=$(readlink "$link")
	case "$target" in
	/*) [ -e "$SYSROOT$target" ] && ln -sf "$SYSROOT$target" "$link" && continue ;;
	esac
	base=$(basename "$target")
	for dir in /usr/lib/x86_64-linux-gnu /usr/lib/x86_64-linux-gnu/mit-krb5; do
		if [ -e "$dir/$base" ]; then
			ln -sf "$dir/$base" "$link"
			break
		fi
	done
done

cat >"$ROOT_DIR/env.sh" <<EOF
# User-local -dev headers for Tauri/WebKitGTK builds (scripts/linux-devroot.sh).
R="$SYSROOT"
export PKG_CONFIG_SYSROOT_DIR="\$R"
export PKG_CONFIG_PATH="\$R/usr/lib/x86_64-linux-gnu/pkgconfig:\$R/usr/share/pkgconfig:/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig"
export LIBRARY_PATH="\$R/usr/lib/x86_64-linux-gnu\${LIBRARY_PATH:+:\$LIBRARY_PATH}"
export LD_LIBRARY_PATH="\$R/usr/lib/x86_64-linux-gnu\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
EOF
# shellcheck disable=SC1091
source "$ROOT_DIR/env.sh"
pkg-config --modversion webkit2gtk-4.1 gtk+-3.0 libsoup-3.0 javascriptcoregtk-4.1 \
	ayatana-appindicator3-0.1 librsvg-2.0 >/dev/null
echo "devroot ready: source $ROOT_DIR/env.sh"
