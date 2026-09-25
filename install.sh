#!/bin/sh
# Installs (or updates) Duet from our Mac mini. The repository is private, so the Mac mini keeps
# a copy of the latest release (duet-server update) and hands it to our Macs over Tailscale. It
# serves this script with its own address filled in, so on each Mac:
#
#   curl -fsSL https://<mac-mini>.<tailnet>.ts.net/app/install.sh | sh
#
# Files downloaded with curl aren't quarantined, so macOS opens Duet without the "unidentified
# developer" dance. Duet is signed with its own self-signed certificate. After this, Settings >
# Updates finds new versions on the same Mac mini, and each one's signature is checked before
# it installs.
set -eu

FROM="${DUET_FROM:-__DUET_FROM__}"
DEST="${DUET_DEST:-/Applications}"

say() { printf '%s\n' "$*"; }
fail() { say "Duet couldn't be installed: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "Duet runs on macOS."
command -v curl >/dev/null || fail "curl is missing."
case "$FROM" in
  https://*) ;;
  *) fail "use the copy of this script the Mac mini hands out, at https://<mac-mini>.<tailnet>.ts.net/app/install.sh." ;;
esac

say "Looking for the latest Duet on the Mac mini…"
manifest="$(curl -fsSL "$FROM/latest.json")" || fail "couldn't reach the Mac mini (is Tailscale on?)."
version="$(printf '%s' "$manifest" | grep -o '"version": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')"
[ -n "$version" ] || fail "the Mac mini doesn't have a release yet (run duet-server update there)."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
say "Downloading Duet $version…"
curl -fsSL "$FROM/Duet.app.tar.gz" -o "$tmp/duet.tar.gz" || fail "the download didn't finish."
expected="$(curl -fsSL "$FROM/Duet.app.tar.gz.sha256" | cut -d' ' -f1)" || fail "couldn't get the checksum."
actual="$(shasum -a 256 "$tmp/duet.tar.gz" | cut -d' ' -f1)"
[ "$expected" = "$actual" ] || fail "the download doesn't match its checksum."
tar -xzf "$tmp/duet.tar.gz" -C "$tmp" || fail "the download looks damaged."
app="$(find "$tmp" -maxdepth 2 -name '*.app' -type d | head -n 1)"
[ -n "$app" ] || fail "the download has no app in it."

if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi
if pgrep -xq Duet; then
  say "Quitting Duet so it can be replaced…"
  osascript -e 'quit app "Duet"' >/dev/null 2>&1 || true
  sleep 1
fi
rm -rf "$DEST/Duet.app"
ditto "$app" "$DEST/Duet.app"
say "Duet $version is in $DEST. Opening it…"
open "$DEST/Duet.app"
