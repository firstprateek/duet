#!/bin/sh
# Installs (or updates) Duet from the latest GitHub release:
#
#   curl -fsSL https://firstprateek.github.io/duet/install.sh | sh
#
# Files downloaded with curl aren't quarantined, so macOS opens Duet without the "unidentified
# developer" dance. Duet is signed with its own self-signed certificate. After this first
# install it updates itself from GitHub, and checks each update's signature before installing.
set -eu

REPO="${DUET_REPO:-firstprateek/duet}"
DEST="${DUET_DEST:-/Applications}"

say() { printf '%s\n' "$*"; }
fail() { say "Duet couldn't be installed: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "Duet runs on macOS."
command -v curl >/dev/null || fail "curl is missing."

say "Looking for the latest Duet…"
manifest="$(curl -fsSL "https://github.com/$REPO/releases/latest/download/latest.json")" \
  || fail "couldn't find a release on GitHub (is this Mac online?)."
version="$(printf '%s' "$manifest" | grep -o '"version": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')"
url="$(printf '%s' "$manifest" | grep -o '"url": *"[^"]*\.app\.tar\.gz"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')"
[ -n "$url" ] || fail "the latest release has no Mac app in it."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
say "Downloading Duet $version…"
curl -fsSL "$url" -o "$tmp/duet.tar.gz" || fail "the download didn't finish."
tar -xzf "$tmp/duet.tar.gz" -C "$tmp" || fail "the download looks damaged."
app="$(find "$tmp" -maxdepth 2 -name '*.app' -type d | head -n 1)"
[ -n "$app" ] || fail "the download has no app in it."

if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi
if pgrep -xq Duet || pgrep -xq duet; then
  say "Quitting Duet so it can be replaced…"
  osascript -e 'quit app "Duet"' >/dev/null 2>&1 || true
  sleep 1
fi
rm -rf "$DEST/Duet.app"
ditto "$app" "$DEST/Duet.app"
say "Duet $version is in $DEST. Opening it…"
open "$DEST/Duet.app"
