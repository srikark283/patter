#!/bin/bash
set -e

# Extract current version from tauri.conf.json
CURRENT_VERSION=$(grep '"version":' src-tauri/tauri.conf.json | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+')

# Split into parts
IFS='.' read -ra PARTS <<< "$CURRENT_VERSION"
MAJOR="${PARTS[0]}"
MINOR="${PARTS[1]}"
PATCH="${PARTS[2]}"

# Increment patch
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"

echo "Bumping version from $CURRENT_VERSION to $NEW_VERSION..."

# Update tauri.conf.json
sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json

# Update package.json (first occurrence only to avoid modifying dependencies)
sed -i '' "1,15s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" package.json

# Update Cargo.toml (first occurrence only to avoid modifying dependencies)
sed -i '' "1,10s/^version = \".*\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml

# Commit and tag
git add src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml
git commit -m "chore: release v$NEW_VERSION"
git tag "v$NEW_VERSION"

echo "Pushing changes and tag to trigger GitHub Actions..."
git push origin HEAD
git push origin "v$NEW_VERSION"

echo "Release v$NEW_VERSION started in GitHub Actions!"
