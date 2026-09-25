#!/bin/sh
# Installs (or updates) Duet from the latest GitHub release:
#
#   curl -fsSL https://raw.githubusercontent.com/firstprateek/duet/main/install.sh | sh
#
# Files downloaded with curl aren't quarantined, so macOS opens Duet without the "unidentified
# developer" dance. Duet is signed with its own self-signed certificate, and after this first
# install it keeps itself up to date (each update's signature is checked before it installs).
set -eu

REPO="${DUET_REPO:-firstprateek/duet}"
DEST="${DUET_DEST:-/Applications}"

say() { printf '%s\n' "$*"; }
fail() { say "Duet couldn't be installed: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "Duet runs on macOS."
command -v curl >/dev/null || fail "curl is missing."

api="https://api.github.com/repos/$REPO/releases/latest"
say "Looking for the latest Duet…"
release="$(curl -fsSL -H "Accept: application/vnd.github+json" "$api")" \
  || fail "couldn't reach GitHub (is the repository public?)."

# The app bundle the updater uses: Duet_universal.app.tar.gz or similar.
url="$(printf '%s' "$release" \
  | grep -o '"browser_download_url": *"[^"]*\.app\.tar\.gz"' \
  | head -n 1 \
  | sed 's/.*"\(https[^"]*\)"$/\1/')"
[ -n "$url" ] || fail "the latest release has no macOS app."
version="$(printf '%s' "$release" | grep -o '"tag_name": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')"

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
if pgrep -xq Duet; then
  say "Quitting Duet so it can be replaced…"
  osascript -e 'quit app "Duet"' >/dev/null 2>&1 || true
  sleep 1
fi
rm -rf "$DEST/Duet.app"
ditto "$app" "$DEST/Duet.app"
say "Duet $version is in $DEST. Opening it…"
open "$DEST/Duet.app"
