#!/bin/sh
# Verify the signed updater archive before replacing /Applications/Patter.app.
set -eu
umask 077
REPO="srikark283/patter"
PUBLIC_KEY="RWSWB+iq5oFAZiomK9u5j+1VWd9EvMuIreux3hoiq1eMYdhMvVMjNILD"
case "$(uname -sm)" in
  "Darwin arm64") ;;
  *) echo "Patter requires an Apple Silicon Mac." >&2; exit 1 ;;
esac
command -v minisign >/dev/null 2>&1 || { echo "Install minisign first (brew install minisign), then rerun this installer." >&2; exit 1; }
TMP=$(mktemp -d)
STAGE=""
cleanup() {
  rm -rf "$TMP"
  if [ -n "$STAGE" ] && [ ! -e "$STAGE/previous.app" ]; then rm -rf "$STAGE"; fi
}
trap cleanup EXIT
curl --proto '=https' --proto-redir '=https' -fsSL "https://api.github.com/repos/$REPO/releases/latest" -o "$TMP/release.json"
URL=$(grep -o '"browser_download_url": *"[^"]*\.app\.tar\.gz"' "$TMP/release.json" | head -1 | cut -d'"' -f4)
case "$URL" in
  "https://github.com/$REPO/releases/download/"*) ;;
  *) echo "No signed macOS updater archive found." >&2; exit 1 ;;
esac
curl --proto '=https' --proto-redir '=https' -fL "$URL" -o "$TMP/app.tar.gz"
curl --proto '=https' --proto-redir '=https' -fsSL "$URL.sig" -o "$TMP/signature.base64"
base64 --decode -i "$TMP/signature.base64" -o "$TMP/signature"
minisign -Vm "$TMP/app.tar.gz" -x "$TMP/signature" -P "$PUBLIC_KEY"
mkdir "$TMP/unpacked"
tar -xzf "$TMP/app.tar.gz" -C "$TMP/unpacked"
APP="$TMP/unpacked/Patter.app"
[ -d "$APP" ] && [ ! -L "$APP" ] || { echo "Verified archive does not contain Patter.app." >&2; exit 1; }
codesign --verify --deep --strict "$APP"
STAGE=$(mktemp -d /Applications/.patter-install.XXXXXX)
ditto "$APP" "$STAGE/Patter.app"
codesign --verify --deep --strict "$STAGE/Patter.app"
DEST="/Applications/Patter.app"
[ ! -L "$DEST" ] || { echo "Refusing to replace a symbolic link at $DEST." >&2; exit 1; }
if [ -e "$DEST" ]; then mv "$DEST" "$STAGE/previous.app"; fi
if ! mv "$STAGE/Patter.app" "$DEST"; then
  if [ -e "$STAGE/previous.app" ]; then mv "$STAGE/previous.app" "$DEST" || { echo "Recover the previous app from $STAGE/previous.app" >&2; exit 1; }; fi
  exit 1
fi
rm -rf "$STAGE/previous.app"
echo "Verified and installed Patter. Launch it from Spotlight."
