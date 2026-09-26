#!/bin/sh
# One-time setup for releases, run by whoever holds the keys (not by CI, and not by an agent).
#
# It makes two things and stores them as GitHub secrets for the release workflow:
#   1. The updater key pair. The app only installs updates signed by this key.
#   2. A self-signed code-signing certificate. No Apple Developer account is needed; a stable
#      signature means the keychain keeps trusting Duet across updates.
#
# Keys stay in ~/.duet-release (readable only by you). Back that folder up somewhere safe:
# losing the updater key means existing installs can't take updates.
#
# Needs: pnpm (for the Tauri CLI), openssl, and the GitHub CLI (gh auth login first).
set -eu

cd "$(dirname "$0")/.."
KEYS="$HOME/.duet-release"
mkdir -p "$KEYS"
chmod 700 "$KEYS"

command -v gh >/dev/null || { echo "Install the GitHub CLI and run 'gh auth login' first."; exit 1; }

printf 'A password for the keys (it is stored as a GitHub secret too): '
stty -echo; read -r PASSWORD; stty echo; printf '\n'
[ -n "$PASSWORD" ] || { echo "A password is needed."; exit 1; }

# 1. Updater keys
if [ ! -f "$KEYS/updater.key" ]; then
  pnpm --filter @duet/desktop exec tauri signer generate --ci -p "$PASSWORD" -w "$KEYS/updater.key"
fi
gh secret set TAURI_SIGNING_PRIVATE_KEY < "$KEYS/updater.key"
printf '%s' "$PASSWORD" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD

# 2. Self-signed code-signing certificate
IDENTITY="Duet Self-Signed"
if [ ! -f "$KEYS/signing.p12" ]; then
  openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
    -keyout "$KEYS/signing.key.pem" -out "$KEYS/signing.cert.pem" \
    -subj "/CN=$IDENTITY" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=critical,codeSigning"
  # 3DES and a SHA-1 MAC: OpenSSL 3's newer defaults don't always import into the macOS keychain.
  openssl pkcs12 -export -out "$KEYS/signing.p12" \
    -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
    -inkey "$KEYS/signing.key.pem" -in "$KEYS/signing.cert.pem" -passout "pass:$PASSWORD"
fi
base64 < "$KEYS/signing.p12" | gh secret set APPLE_CERTIFICATE
printf '%s' "$PASSWORD" | gh secret set APPLE_CERTIFICATE_PASSWORD
printf '%s' "$IDENTITY" | gh secret set APPLE_SIGNING_IDENTITY

echo
echo "Done. Last step: put this public key in apps/desktop/src-tauri/tauri.conf.json"
echo "(plugins.updater.pubkey) and commit it:"
echo
cat "$KEYS/updater.key.pub"
echo
