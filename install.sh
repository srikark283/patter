#!/bin/sh
# Patter installer — downloads the latest release DMG and installs to /Applications.
# curl'd downloads carry no quarantine flag, so no xattr step is needed.
#   curl -fsSL https://raw.githubusercontent.com/srikark283/patter/main/install.sh | sh
set -eu

REPO="srikark283/patter"

case "$(uname -sm)" in
  "Darwin arm64") ;;
  *) echo "Patter requires an Apple Silicon Mac." >&2; exit 1 ;;
esac

echo "Finding latest release…"
DMG_URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  grep -o '"browser_download_url": *"[^"]*\.dmg"' | head -1 | cut -d'"' -f4)
[ -n "$DMG_URL" ] || { echo "No DMG found in the latest release." >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $(basename "$DMG_URL")…"
curl -fL --progress-bar "$DMG_URL" -o "$TMP/patter.dmg"

echo "Installing to /Applications…"
MOUNT=$(hdiutil attach -nobrowse -readonly "$TMP/patter.dmg" | grep -o '/Volumes/.*' | head -1)
[ -n "$MOUNT" ] || { echo "Failed to mount DMG." >&2; exit 1; }
APP=$(find "$MOUNT" -maxdepth 1 -name "*.app" | head -1)
rm -rf "/Applications/$(basename "$APP")"
cp -R "$APP" /Applications/
hdiutil detach "$MOUNT" -quiet

echo "Done — Patter is in /Applications. Launch it from Spotlight."
