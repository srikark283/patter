#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# release.sh — one-command release for Patter
#
# Usage:
#   ./release.sh           # interactive — prompts for bump type
#   ./release.sh patch     # 0.1.5 → 0.1.6
#   ./release.sh minor     # 0.1.5 → 0.2.0
#   ./release.sh major     # 0.1.5 → 1.0.0
#   ./release.sh 2.0.0     # explicit version
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── Read current version from tauri.conf.json (source of truth) ──────
CURRENT=$(jq -r .version src-tauri/tauri.conf.json)
if [[ -z "$CURRENT" || "$CURRENT" == "null" ]]; then
  echo "❌ Could not read version from src-tauri/tauri.conf.json"
  exit 1
fi
echo "📦 Current version: $CURRENT"

# ── Parse current semver ─────────────────────────────────────────────
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# ── Determine new version ────────────────────────────────────────────
BUMP="${1:-}"
if [[ -z "$BUMP" ]]; then
  echo ""
  echo "How do you want to bump?"
  echo "  1) patch  → $MAJOR.$MINOR.$((PATCH + 1))"
  echo "  2) minor  → $MAJOR.$((MINOR + 1)).0"
  echo "  3) major  → $((MAJOR + 1)).0.0"
  echo "  4) custom"
  echo ""
  read -rp "Choice [1/2/3/4]: " CHOICE
  case "$CHOICE" in
    1|patch)  BUMP="patch" ;;
    2|minor)  BUMP="minor" ;;
    3|major)  BUMP="major" ;;
    4|custom)
      read -rp "Enter version (e.g. 2.0.0): " BUMP
      ;;
    *)
      echo "❌ Invalid choice"; exit 1 ;;
  esac
fi

case "$BUMP" in
  patch) NEW="$MAJOR.$MINOR.$((PATCH + 1))" ;;
  minor) NEW="$MAJOR.$((MINOR + 1)).0" ;;
  major) NEW="$((MAJOR + 1)).0.0" ;;
  *)
    # Validate custom version format
    if [[ ! "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "❌ Invalid version format: $BUMP (expected X.Y.Z)"
      exit 1
    fi
    NEW="$BUMP"
    ;;
esac

echo "🚀 Bumping: $CURRENT → $NEW"
echo ""

# ── Confirm ──────────────────────────────────────────────────────────
read -rp "Continue? [Y/n]: " CONFIRM
if [[ "${CONFIRM:-Y}" =~ ^[Nn] ]]; then
  echo "Aborted."; exit 0
fi

# ── Bump version in all manifests ────────────────────────────────────
echo "📝 Updating package.json"
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" package.json

echo "📝 Updating src-tauri/tauri.conf.json"
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" src-tauri/tauri.conf.json

echo "📝 Updating src-tauri/Cargo.toml"
sed -i '' "s/^version = \"$CURRENT\"/version = \"$NEW\"/" src-tauri/Cargo.toml

# ── Refresh Cargo.lock (fast metadata-only update) ───────────────────
echo "🔒 Refreshing Cargo.lock"
cargo update -p patter --manifest-path src-tauri/Cargo.toml

# ── Verify all three files agree ─────────────────────────────────────
V_PKG=$(jq -r .version package.json)
V_TAURI=$(jq -r .version src-tauri/tauri.conf.json)
V_CARGO=$(grep '^version' src-tauri/Cargo.toml | head -1 | sed 's/version = "\(.*\)"/\1/')

if [[ "$V_PKG" != "$NEW" || "$V_TAURI" != "$NEW" || "$V_CARGO" != "$NEW" ]]; then
  echo "❌ Version mismatch after bump!"
  echo "   package.json:    $V_PKG"
  echo "   tauri.conf.json: $V_TAURI"
  echo "   Cargo.toml:      $V_CARGO"
  exit 1
fi
echo "✅ All manifests at $NEW"

# ── Commit ───────────────────────────────────────────────────────────
echo ""
read -rp "Commit message (press Enter for default): " MSG
MSG="${MSG:-chore: bump version to $NEW}"

git add -A
git commit -m "$MSG"

# ── Tag & push ───────────────────────────────────────────────────────
TAG="v$NEW"
echo "🏷️  Tagging $TAG"
git tag "$TAG"

echo "⬆️  Pushing main + $TAG"
git push origin main
git push origin "$TAG"

echo ""
echo "✅ Done! Release workflow will start shortly."
echo "   👉 https://github.com/srikark283/patter/actions"
